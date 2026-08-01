import { NextResponse, type NextRequest } from "next/server";
import { can } from "@repo/security";
import {
  IMPORT_TEMPLATE_KINDS,
  renderTemplateCsv,
  templateFilename,
} from "@repo/shared-schemas";
import type { ImportTemplateKind } from "@repo/shared-schemas";
import { getSessionContext } from "../../../../../lib/auth";

/**
 * Template download (secure-ingestion spec, section 7.2 step 2).
 *
 * The `kind` is checked against the closed set rather than used to index the
 * template map directly. A caller-supplied string that reaches a lookup is how
 * a prototype-pollution key or an unexpected `undefined` gets rendered into a
 * file somebody then trusts as a contract.
 */
export async function GET(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ reason: "Not signed in." }, { status: 401 });
  }
  if (!can(ctx.role, "view_ingestion_batches")) {
    return NextResponse.json({ reason: "Forbidden." }, { status: 403 });
  }

  const requested = request.nextUrl.searchParams.get("kind") ?? "accounts";
  if (!(IMPORT_TEMPLATE_KINDS as readonly string[]).includes(requested)) {
    return NextResponse.json({ reason: "Unknown template." }, { status: 400 });
  }
  const kind = requested as ImportTemplateKind;

  return new NextResponse(renderTemplateCsv(kind), {
    status: 200,
    headers: {
      // `charset=utf-8` is not decoration: the pipeline accepts UTF-8 only, and
      // a template that opens as Latin-1 produces a file that fails its own
      // encoding check.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${templateFilename(kind)}"`,
      // The template is derived from code, so a stale cached copy is a stale
      // contract. Revalidate rather than serve one after a version bump.
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
