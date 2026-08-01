import { assertCommitAuthorized, type CommitAuthorization } from "@repo/security";
import { isCommittable, isHardBlock } from "@repo/shared-schemas";
import type { ChangeKind, DomainEventType, RecordDisposition } from "@repo/shared-schemas";
import type { ChangeSetPreview, ChangeSetItemPreview } from "./change-set";
import type { ValidatedRow } from "./validation";

/**
 * The commit seam (secure-ingestion spec, sections 7.2 step 9 and 15.3).
 *
 * This is the only place staged data becomes product data, and the epic exit
 * gate is a property of this file: no rejected or quarantined row reaches an
 * operational table.
 *
 * The property is enforced twice, deliberately. `planCommit` filters by
 * disposition, and `assertCommitPlanSafe` re-checks the plan it produced. The
 * second check exists because the first is a filter, and a filter that is
 * edited wrongly fails silently: it simply lets more through. An assertion that
 * throws does not.
 */

export interface CommitPlanEntry {
  sourceRowNumber: number;
  externalId: string;
  changeKind: ChangeKind;
  targetRecordId: string | null;
  values: Record<string, unknown>;
  /** The domain event this write must raise, in the same transaction. */
  eventType: DomainEventType;
}

export interface CommitPlan {
  batchId: string;
  workspaceId: string;
  changeSetId: string;
  approvalId: string;
  entries: CommitPlanEntry[];
  /** Rows the plan deliberately leaves out, with the reason. */
  skipped: { sourceRowNumber: number; disposition: RecordDisposition }[];
}

export class CommitRefusedError extends Error {
  readonly code = "INGEST_COMMIT_REFUSED";
  constructor(readonly reason: string) {
    super(`Commit refused: ${reason}`);
    this.name = "CommitRefusedError";
  }
}

/** An unchanged row raises no event, because nothing happened to it. */
function eventFor(changeKind: ChangeKind): DomainEventType | null {
  switch (changeKind) {
    case "create":
      return "account.created";
    case "update":
      return "account.updated";
    case "owner_change":
      return "account.owner_changed";
    case "unchanged":
      return null;
    default:
      return null;
  }
}

/**
 * Turn an approved change set into the exact list of operational writes.
 *
 * Takes the validated rows as well as the preview so the disposition is read
 * from the validation result rather than inferred from the preview's shape.
 * Deriving it from the preview would mean trusting that whoever built the
 * preview filtered correctly, which is the thing being guarded.
 */
export function planCommit(input: {
  batchId: string;
  workspaceId: string;
  changeSetId: string;
  authorization: CommitAuthorization;
  preview: ChangeSetPreview;
  validated: readonly ValidatedRow[];
}): CommitPlan {
  assertCommitAuthorized(input.authorization, input.workspaceId);

  // A hard block refuses the whole batch, not just its row. Section 13.4: it is
  // never approvable, so no amount of sign-off makes the rest safe to apply.
  for (const v of input.validated) {
    for (const f of v.findings) {
      if (isHardBlock(f.ruleId)) {
        throw new CommitRefusedError(`hard block present: ${f.ruleId}`);
      }
    }
  }

  const dispositionByRow = new Map<number, RecordDisposition>();
  for (const v of input.validated) {
    dispositionByRow.set(v.row.sourceRowNumber, v.disposition);
  }

  const entries: CommitPlanEntry[] = [];
  // Rows the preview already excluded carry forward, so the plan is a complete
  // account of every row rather than only of the ones it considered. An audit
  // written from the plan alone would otherwise under-report what was dropped.
  const skipped: CommitPlan["skipped"] = input.preview.excluded.map((e) => ({
    sourceRowNumber: e.sourceRowNumber,
    disposition: e.disposition,
  }));

  for (const item of input.preview.items) {
    const disposition = dispositionByRow.get(item.sourceRowNumber);
    if (disposition === undefined) {
      // A preview row with no validation result is not something to guess at.
      throw new CommitRefusedError(
        `row ${item.sourceRowNumber} has no validation result`,
      );
    }
    if (!isCommittable(disposition)) {
      skipped.push({ sourceRowNumber: item.sourceRowNumber, disposition });
      continue;
    }
    if (item.changeKind === "unchanged") {
      skipped.push({ sourceRowNumber: item.sourceRowNumber, disposition });
      continue;
    }

    const eventType = eventFor(item.changeKind);
    if (!eventType) {
      throw new CommitRefusedError(`no domain event defined for ${item.changeKind}`);
    }

    entries.push({
      sourceRowNumber: item.sourceRowNumber,
      externalId: item.externalId,
      changeKind: item.changeKind,
      targetRecordId: item.targetRecordId,
      values: item.afterValues,
      eventType,
    });
  }

  const plan: CommitPlan = {
    batchId: input.batchId,
    workspaceId: input.workspaceId,
    changeSetId: input.changeSetId,
    approvalId: input.authorization.approvalId,
    entries,
    skipped,
  };

  assertCommitPlanSafe(plan, input.validated);
  return plan;
}

/**
 * Re-check a plan against the validation results.
 *
 * The exit-gate property, asserted rather than assumed. `planCommit` already
 * filtered, but a filter that is edited wrongly fails open and silently. This
 * throws, so the same mistake becomes a crash in a test rather than a rejected
 * row in an operational table.
 */
export function assertCommitPlanSafe(
  plan: CommitPlan,
  validated: readonly ValidatedRow[],
): void {
  const byRow = new Map(validated.map((v) => [v.row.sourceRowNumber, v]));

  for (const entry of plan.entries) {
    const v = byRow.get(entry.sourceRowNumber);
    if (!v) {
      throw new CommitRefusedError(
        `plan contains row ${entry.sourceRowNumber} with no validation result`,
      );
    }
    if (!isCommittable(v.disposition)) {
      throw new CommitRefusedError(
        `plan contains a ${v.disposition} row (${entry.sourceRowNumber})`,
      );
    }
    if (v.findings.some((f) => isHardBlock(f.ruleId))) {
      throw new CommitRefusedError(
        `plan contains a hard-blocked row (${entry.sourceRowNumber})`,
      );
    }
    if (!entry.externalId) {
      throw new CommitRefusedError(`plan entry ${entry.sourceRowNumber} has no external id`);
    }
    if (entry.changeKind !== "create" && !entry.targetRecordId) {
      throw new CommitRefusedError(
        `plan entry ${entry.sourceRowNumber} updates nothing identifiable`,
      );
    }
  }

  // Every write raises exactly one event. Section 15.3 requires the operational
  // mutation and its domain event to happen together, so a plan that produced
  // fewer events than writes would leave triggers blind to real changes.
  if (plan.entries.some((e) => !e.eventType)) {
    throw new CommitRefusedError("a planned write raises no domain event");
  }
}

/* -------------------------------------------------------------- rollback -- */

export interface RollbackWindow {
  /** Hours after a commit during which rollback needs no incident approver. */
  hours: number;
}

export const DEFAULT_ROLLBACK_WINDOW: RollbackWindow = { hours: 72 };

export interface RollbackConflict {
  externalId: string;
  /** What the commit wrote, and what the record holds now. */
  committedValue: unknown;
  currentValue: unknown;
  field: string;
}

export interface RollbackPlan {
  originalCommitId: string;
  workspaceId: string;
  entries: {
    externalId: string;
    targetRecordId: string;
    /** Restores the pre-commit state field by field. */
    values: Record<string, unknown>;
    eventType: DomainEventType;
  }[];
  conflicts: RollbackConflict[];
  /** True when the window has passed and an incident approver is needed. */
  outsideWindow: boolean;
}

/**
 * Plan a compensating rollback (section 7.3).
 *
 * Imports do not support delete in v1, so this restores before-values rather
 * than removing rows. A record changed since the original commit is reported as
 * a conflict rather than overwritten: rolling back an import should not quietly
 * destroy a human's later edit.
 */
export function planRollback(input: {
  originalCommitId: string;
  workspaceId: string;
  committedAt: Date;
  now: Date;
  items: readonly (ChangeSetItemPreview & { targetRecordId: string })[];
  /** Current operational values, keyed by external id. */
  current: ReadonlyMap<string, Record<string, unknown>>;
  window?: RollbackWindow;
}): RollbackPlan {
  const window = input.window ?? DEFAULT_ROLLBACK_WINDOW;
  const elapsedHours = (input.now.getTime() - input.committedAt.getTime()) / 3_600_000;

  const entries: RollbackPlan["entries"] = [];
  const conflicts: RollbackConflict[] = [];

  for (const item of input.items) {
    const now = input.current.get(item.externalId);
    if (!now) continue; // The row is gone; nothing to restore onto.

    let conflicted = false;
    for (const [field, committedValue] of Object.entries(item.afterValues)) {
      if (now[field] !== committedValue) {
        conflicts.push({
          externalId: item.externalId,
          field,
          committedValue,
          currentValue: now[field],
        });
        conflicted = true;
      }
    }
    if (conflicted) continue;

    entries.push({
      externalId: item.externalId,
      targetRecordId: item.targetRecordId,
      values: { ...item.beforeValues },
      eventType: "account.updated",
    });
  }

  return {
    originalCommitId: input.originalCommitId,
    workspaceId: input.workspaceId,
    entries,
    conflicts,
    outsideWindow: elapsedHours > window.hours,
  };
}
