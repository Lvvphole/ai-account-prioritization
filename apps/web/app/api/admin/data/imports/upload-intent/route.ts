import { NextResponse, type NextRequest } from "next/server";
import { can, isAllowedUploadFilename, isPlausibleCsvContentType } from "@repo/security";
import { DEFAULT_IMPORT_LIMITS, IMPORT_TEMPLATE_KINDS } from "@repo/shared-schemas";
import { getSessionContext } from "../../../../../lib/auth";
import { isSupabaseConfigured } from "../../../../../lib/supabase/config";

/**
 * Upload intent (secure-ingestion spec, section 7.2 step 3).
 *
 * Two properties matter more than convenience here.
 *
 * The client never proposes a path. Everything it sends is metadata — the
 * filename included — and the storage path is derived from ids the server
 * already trusts, via `buildQuarantinePath`. A crafted filename therefore has
 * nothing to traverse into.
 *
 * It fails closed. Without configured storage there is no private bucket to
 * write to and no signed URL to mint, so this refuses rather than returning
 * something upload-shaped. A route that answers optimistically when its
 * dependencies are missing is how an unscanned file reaches a real bucket.
 *
 * The browser pre-flight result is not accepted as an input and is not trusted
 * if offered: every check it runs is repeated here, and again by the worker
 * against the bytes that actually land.
 */

interface IntentBody {
  templateKind?: unknown;
  originalFilename?: unknown;
  declaredContentType?: unknown;
  declaredBytes?: unknown;
}

function refuse(reason: string, status: number) {
  return NextResponse.json({ reason }, { status });
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return refuse("Not signed in.", 401);
  if (!can(ctx.role, "create_manual_import")) {
    return refuse("Starting an import needs the create_manual_import capability.", 403);
  }

  let body: IntentBody;
  try {
    body = (await request.json()) as IntentBody;
  } catch {
    return refuse("The request body was not readable as JSON.", 400);
  }

  if (
    typeof body.templateKind !== "string" ||
    !(IMPORT_TEMPLATE_KINDS as readonly string[]).includes(body.templateKind)
  ) {
    return refuse("Unknown import type.", 400);
  }

  if (typeof body.originalFilename !== "string" || !isAllowedUploadFilename(body.originalFilename)) {
    return refuse(
      "The filename must be a plain .csv with no path separators and no second extension.",
      400,
    );
  }

  if (
    body.declaredContentType !== undefined &&
    (typeof body.declaredContentType !== "string" ||
      !isPlausibleCsvContentType(body.declaredContentType))
  ) {
    // Advisory (section 21.1), so an implausible type is refused at the door
    // rather than recorded as evidence of anything about the contents.
    return refuse("The declared content type is not one a CSV export produces.", 400);
  }

  if (
    typeof body.declaredBytes !== "number" ||
    !Number.isInteger(body.declaredBytes) ||
    body.declaredBytes <= 0
  ) {
    return refuse("The declared size must be a positive whole number of bytes.", 400);
  }

  if (body.declaredBytes > DEFAULT_IMPORT_LIMITS.maxBytes) {
    // A claim, not a measurement. Refusing here saves an upload; the real check
    // is on the bytes storage reports at finalize.
    return refuse(
      `The file is larger than the ${Math.round(DEFAULT_IMPORT_LIMITS.maxBytes / (1024 * 1024))} MB limit.`,
      413,
    );
  }

  if (!isSupabaseConfigured()) {
    return refuse(
      "This deployment has no storage configured, so there is no private quarantine bucket to upload to and no batch was created. Configure Supabase to enable imports.",
      503,
    );
  }

  // Reaching here means the request is well-formed and the deployment has
  // storage. Creating the batch, generating the path and signing the URL is the
  // ingestion service's job (Epic 3 wiring); refusing is the correct answer
  // until that exists, because the alternative is handing back a signed URL
  // with no batch behind it to scan, parse or attribute the upload to.
  return refuse(
    "Storage is configured but the ingestion service is not attached, so no upload intent was issued and no batch was created.",
    503,
  );
}
