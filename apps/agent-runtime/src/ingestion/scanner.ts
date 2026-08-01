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

/** How long a provider gets before its silence counts as unavailable. */
export const DEFAULT_SCAN_TIMEOUT_MS = 60_000;

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

/**
 * The checks a verdict must carry before the malware result means anything.
 * Section 7.2 step 5 lists them; absence is treated as failure, not as silence.
 */
export const REQUIRED_CHECKS: readonly Exclude<ScanCheck, "malware">[] = [
  "authorization",
  "workspace_binding",
  "object_ownership",
  "size_limits",
  "text_format",
  "parser_safety",
];

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
  // Every non-malware check must be present and passing. Looking only for a
  // failure would let a verdict that simply omits the prechecks through: an
  // array containing nothing but a passing malware result has no failure in it,
  // and would otherwise be indistinguishable from a fully checked file.
  for (const required of REQUIRED_CHECKS) {
    const results = verdict.checks.filter((c) => c.check === required);
    if (results.length !== 1 || !results[0]?.passed) {
      return { allowed: false, reason: "precheck_failed" };
    }
  }

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
  /** Deadline for the provider call. Defaults to DEFAULT_SCAN_TIMEOUT_MS. */
  timeoutMs?: number;
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
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // A provider that never settles would otherwise leave the batch in
      // security_scanning forever, which is neither a pass nor the fail-closed
      // refusal the spec requires. The race turns a hang into `unavailable`.
      const result = await Promise.race([
        input.scanner.scan({
          workspaceId: input.workspaceId,
          bucket: input.bucket,
          storagePath: input.storagePath,
          sha256: input.sha256,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error("scan timed out")),
          );
        }),
      ]);

      // TypeScript does not validate what came back over a network. A provider
      // returning an unexpected status would otherwise assign it here and fall
      // through the gate, so anything outside the known set is `unavailable`.
      if (result && (result.status === "clean" || result.status === "infected")) {
        malwareStatus = result.status;
        detail = typeof result.detail === "string" ? result.detail.slice(0, 500) : null;
      } else {
        malwareStatus = "unavailable";
        detail = "scanner returned an unrecognised status";
      }
    } catch {
      // A provider that threw has not cleared the file. Recording `unavailable`
      // rather than letting the exception escape keeps the decision with the
      // gate, which knows whether this deployment is allowed to continue.
      malwareStatus = "unavailable";
      detail = "scanner did not return a verdict";
    } finally {
      clearTimeout(timer);
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
