import { writeAuditLog } from "../audit/write-audit-log";
import { trackEvent } from "../analytics/track-event";
import { inMemoryRepository, type RuntimeRepository } from "../runtime-repository";
import { getEnv } from "../../config/env";

/**
 * CRM write-back (Execution Rule #7: requires human approval).
 *
 * This is the ONLY write tool. It fails closed: without explicit approval it
 * refuses to write and records an audit entry documenting the block.
 */
export interface WriteCrmNoteInput {
  runId: string;
  accountId: string;
  actorId: string;
  note: string;
  approved: boolean;
  occurredAt: string;
}

export interface WriteCrmNoteResult {
  written: boolean;
  reason: string;
}

export async function writeCrmNote(
  input: WriteCrmNoteInput,
  repo: RuntimeRepository = inMemoryRepository,
): Promise<WriteCrmNoteResult> {
  const env = getEnv();
  const approvalRequired = env.REQUIRE_HUMAN_APPROVAL;

  await trackEvent(
    {
      name: "crm_writeback_attempted",
      runId: input.runId,
      accountId: input.accountId,
      userId: input.actorId,
      occurredAt: input.occurredAt,
      properties: { approved: input.approved },
    },
    repo,
  );

  if (approvalRequired && !input.approved) {
    await writeAuditLog(
      {
        runId: input.runId,
        accountId: input.accountId,
        actorId: input.actorId,
        action: "crm_write_note",
        decision: "blocked",
        reason: "Human approval required before CRM write-back.",
        evidence: { note: input.note },
        occurredAt: input.occurredAt,
      },
      repo,
    );
    return { written: false, reason: "approval_required" };
  }

  // Approved (or approval disabled in non-prod): perform the write-back.
  await writeAuditLog(
    {
      runId: input.runId,
      accountId: input.accountId,
      actorId: input.actorId,
      action: "crm_write_note",
      decision: "approved",
      reason: "Approved CRM write-back executed.",
      evidence: { note: input.note },
      occurredAt: input.occurredAt,
    },
    repo,
  );
  return { written: true, reason: "ok" };
}
