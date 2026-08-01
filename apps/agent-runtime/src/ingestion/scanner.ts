import type { ScanCheck, ScanCheckResult, ScanVerdict } from "@repo/shared-schemas";

/**
 * Malware scanning boundary (secure-ingestion spec, sections 7.2 step 5 and 21.1).
 *
 * The rule that matters is one line of the spec: "Fail closed in production
 * when the scanner is unavailable." That is easy to state and easy to lose,
 * because the tempting implementation treats a scanner it could not reach as a
 * scanner that found nothing. `unavailable` is therefore a distinct verdict
 * from `clean` all the way through this module, and the gate below refuses to
 * collapse the two.
 */

/** What a provider must implement. Deliberately narrow. */
export interface MalwareScanner {
  readonly providerId: string;
  /**
   * Scan an object already in quarantine storage. Returns `unavailable` rather
   * than throwing when the provider cannot answer, so the caller has to decide
   * what an unanswered scan means instead of catching an error by accident.
   */
  scan(input: {
    workspaceId: string;
    bucket: string;
    storagePath: string;
    sha256: string;
    signal?: AbortSignal;
  }): Promise<{ status: "clean" | "infected" | "unavailable"; detail?: string }>;
}

export interface ScanGateOptions {
  /** Null when no provider is configured for this deployment. */
  scanner: MalwareScanner | null;
  /** True in production. Fail-closed applies only here (section 4). */
  isProduction: boolean;
}

/** Why a batch may not proceed past scanning. */
export type ScanBlock =
  | "malware_detected"
  | "scanner_unavailable_in_production"
  | "no_scanner_configured_in_production"
  | "precheck_failed";

export class ScanBlockedError extends Error {
  readonly code = "INGEST_SCAN_BLOCKED";
  constructor(readonly reason: ScanBlock) {
    super(`Batch blocked at security scanning: ${reason}`);
    this.name = "ScanBlockedError";
  }
}

/**
 * Decide whether a batch may leave `security_scanning`.
 *
 * Returns the checks to record either way, because the review UI shows the
 * whole list (section 7.2 step 5) and a refusal is more useful than a pass when
 * it says which check failed.
 */
export function evaluateScanGate(
  verdict: ScanVerdict,
  options: ScanGateOptions,
): { allowed: true } | { allowed: false; reason: ScanBlock } {
  const failedPrecheck = verdict.checks.find((c) => !c.passed && c.check !== "malware");
  if (failedPrecheck) return { allowed: false, reason: "precheck_failed" };

  if (verdict.malwareStatus === "infected") {
    return { allowed: false, reason: "malware_detected" };
  }

  if (verdict.malwareStatus === "unavailable") {
    // Outside production an unavailable scanner is a development convenience.
    // In production it is a refusal, because "we could not check" and "there is
    // nothing there" are different facts and only one of them is safe.
    if (options.isProduction) {
      return {
        allowed: false,
        reason: options.scanner
          ? "scanner_unavailable_in_production"
          : "no_scanner_configured_in_production",
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

/** Throwing form, for callers that treat a block as an exception. */
export function assertScanAllows(verdict: ScanVerdict, options: ScanGateOptions): void {
  const result = evaluateScanGate(verdict, options);
  if (!result.allowed) throw new ScanBlockedError(result.reason);
}

/**
 * Run the pre-checks that need no provider, then the provider itself.
 *
 * The pre-checks are recorded even when one fails, so an administrator sees the
 * full list rather than only the first refusal.
 */
export async function runSecurityScan(input: {
  workspaceId: string;
  batchId: string;
  bucket: string;
  storagePath: string;
  sha256: string;
  byteSize: number;
  maxBytes: number;
  /** Results of checks the caller already performed (authorization, ownership). */
  precheck: Partial<Record<Exclude<ScanCheck, "malware">, boolean>>;
  scanner: MalwareScanner | null;
  now?: () => Date;
}): Promise<ScanVerdict> {
  const now = input.now ?? (() => new Date());

  const checks: ScanCheckResult[] = [
    check("authorization", input.precheck.authorization ?? false),
    check("workspace_binding", input.precheck.workspace_binding ?? false),
    check("object_ownership", input.precheck.object_ownership ?? false),
    check(
      "size_limits",
      input.byteSize > 0 && input.byteSize <= input.maxBytes,
      input.byteSize > input.maxBytes ? "object exceeds the configured byte limit" : null,
    ),
    check("text_format", input.precheck.text_format ?? false),
    check("parser_safety", input.precheck.parser_safety ?? false),
  ];

  let malwareStatus: ScanVerdict["malwareStatus"] = "unavailable";
  let detail: string | null = null;

  if (input.scanner) {
    try {
      const result = await input.scanner.scan({
        workspaceId: input.workspaceId,
        bucket: input.bucket,
        storagePath: input.storagePath,
        sha256: input.sha256,
      });
      malwareStatus = result.status;
      detail = result.detail ?? null;
    } catch {
      // A provider that threw has not cleared the file. Recording `unavailable`
      // rather than letting the exception escape keeps the decision with the
      // gate, which knows whether this deployment is allowed to continue.
      malwareStatus = "unavailable";
      detail = "scanner did not return a verdict";
    }
  } else {
    detail = "no scanning provider configured";
  }

  checks.push(check("malware", malwareStatus === "clean", detail));

  return {
    batchId: input.batchId,
    workspaceId: input.workspaceId,
    checks,
    malwareStatus,
    providerId: input.scanner?.providerId ?? null,
    scannedAt: now().toISOString(),
  };
}

function check(name: ScanCheck, passed: boolean, detail: string | null = null): ScanCheckResult {
  return { check: name, passed, detail };
}
