import type { AuditLogEntry } from "@repo/shared-schemas";
import { AuditLogEntrySchema } from "@repo/shared-schemas";
import { inMemoryRepository, type RuntimeRepository } from "../runtime-repository";

/**
 * Audit log writer (Execution Rule #12: every critical action creates audit
 * evidence). Validates with Zod, then appends to the immutable audit trail —
 * the in-memory store by default, or Supabase `audit_evidence` when the run's
 * repository is Supabase-backed.
 */
let counter = 0;

export async function writeAuditLog(
  input: {
    runId?: string;
    accountId?: string;
    actorId: string;
    action: string;
    decision: AuditLogEntry["decision"];
    reason: string;
    evidence?: Record<string, unknown>;
    occurredAt: string;
  },
  repo: RuntimeRepository = inMemoryRepository,
): Promise<AuditLogEntry> {
  const entry = AuditLogEntrySchema.parse({
    id: `audit_${++counter}_${input.action}`,
    runId: input.runId,
    accountId: input.accountId,
    actorId: input.actorId,
    action: input.action,
    decision: input.decision,
    reason: input.reason,
    evidence: input.evidence ?? {},
    occurredAt: input.occurredAt,
  } satisfies AuditLogEntry);
  await repo.appendAudit(entry);
  return entry;
}
