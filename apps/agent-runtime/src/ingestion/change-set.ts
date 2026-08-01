import {
  DEFAULT_SECOND_APPROVAL_TRIGGER,
  NON_APPROVABLE_BLOCKERS,
  isCommittable,
  isHardBlock,
} from "@repo/shared-schemas";
import type {
  CanonicalObjectType,
  ChangeKind,
  RecordDisposition,
  SecondApprovalTrigger,
} from "@repo/shared-schemas";
import { scoreAccount } from "../agents/account-prioritizer/tools/score-accounts";
import { rankAccounts } from "../agents/account-prioritizer/tools/rank-accounts";
import type { AccountContext } from "../agents/account-prioritizer/prioritizer.policy";
import type { ValidatedRow, RowFinding } from "./validation";

/**
 * Deterministic change preview (secure-ingestion spec, section 7.2 steps 8 and 9).
 *
 * This is what an approver reads before deciding, so two properties matter more
 * than completeness:
 *
 *   1. It is derived only from staged rows and the snapshot. Nothing here
 *      queries live state a second time, so what the approver saw is what the
 *      commit applies.
 *   2. It never publishes. Rank impact runs the canonical scorer over a scratch
 *      projection and throws the result away; no recommendation is written.
 *
 * Rank impact uses `scoreAccount` and `rankAccounts`, not a local sort. A
 * preview that ranked by pipeline alone would disagree with the product about
 * which accounts matter, which is worse than showing nothing: it would be a
 * confident wrong answer in front of the person authorising the write.
 */

/** One operational record as it exists today. */
export interface ExistingRecord {
  internalRecordId: string;
  /**
   * Every current field value, so a before/after pair can be built for whatever
   * the import actually changes. A fixed subset would leave other fields
   * unrestorable at rollback.
   */
  values: Record<string, unknown>;
}

export interface OperationalSnapshot {
  existingByExternalId: ReadonlyMap<string, ExistingRecord>;
  totalAccounts: number;
  totalOpenPipelineUsd: number;
  /** Account external ids currently inside the top N, in rank order. */
  currentTopN: readonly string[];
  /**
   * Full scoring context per account external id. Optional: without it the
   * preview reports rank impact as unavailable rather than computing a number
   * from a different ranking than the product uses.
   */
  contextByExternalId?: ReadonlyMap<string, AccountContext>;
}

export interface ChangeSetItemPreview {
  sourceRowNumber: number;
  objectType: CanonicalObjectType;
  externalId: string;
  changeKind: ChangeKind;
  targetRecordId: string | null;
  /** Current values for exactly the fields this import changes. */
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
}

/** Null when the snapshot carried no scoring context. */
export interface RankImpact {
  accountsEnteringTopN: number;
  accountsLeavingTopN: number;
  topN: number;
}

export interface ChangeSetPreview {
  items: ChangeSetItemPreview[];
  newRecords: number;
  updatedRecords: number;
  unchangedRecords: number;
  ownerChanges: number;
  referentialFailures: number;
  duplicateRecords: number;
  /** Signed. An import can reduce pipeline as well as add to it. */
  pipelineDeltaUsd: number;
  /** Null when rank impact could not be computed. Never a guess. */
  rankImpact: RankImpact | null;
  rankImpactUnavailableReason: string | null;
  predictedGuardrailHolds: number;
  concentrationNotes: string | null;
  excluded: { sourceRowNumber: number; disposition: RecordDisposition }[];
}

/** True when the import sets this field to something different from now. */
function isChanged(before: Record<string, unknown>, field: string, after: unknown): boolean {
  const current = before[field];
  if (current === undefined && after === null) return false;
  return current !== after;
}

export function buildChangeSet(
  validated: readonly ValidatedRow[],
  snapshot: OperationalSnapshot,
  topN = 25,
): ChangeSetPreview {
  const items: ChangeSetItemPreview[] = [];
  const excluded: ChangeSetPreview["excluded"] = [];

  let newRecords = 0;
  let updatedRecords = 0;
  let unchangedRecords = 0;
  let ownerChanges = 0;
  let duplicateRecords = 0;
  let referentialFailures = 0;
  let pipelineDeltaUsd = 0;

  for (const v of validated) {
    if (v.disposition === "duplicate") duplicateRecords += 1;
    if (
      v.findings.some(
        (f) =>
          f.ruleId === "parent_account_not_found" ||
          f.ruleId === "owner_not_a_workspace_member",
      )
    ) {
      referentialFailures += 1;
    }

    if (!isCommittable(v.disposition) || !v.row.externalId) {
      excluded.push({ sourceRowNumber: v.row.sourceRowNumber, disposition: v.disposition });
      continue;
    }

    const externalId = v.row.externalId;
    const existing = snapshot.existingByExternalId.get(externalId);
    const after = v.row.payload;
    const afterPipeline = typeof after.openPipelineUsd === "number" ? after.openPipelineUsd : null;

    if (!existing) {
      newRecords += 1;
      items.push({
        sourceRowNumber: v.row.sourceRowNumber,
        objectType: v.row.objectType,
        externalId,
        changeKind: "create",
        targetRecordId: null,
        beforeValues: {},
        afterValues: { ...after },
      });
      if (afterPipeline !== null) pipelineDeltaUsd += afterPipeline;
      continue;
    }

    // Before and after for exactly the fields this import changes, read from
    // the record's real current values. A fixed subset would both leave other
    // fields unrestorable and write back a stale value for one nobody touched.
    const changedAfter: Record<string, unknown> = {};
    const changedBefore: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(after)) {
      if (!isChanged(existing.values, field, value)) continue;
      changedAfter[field] = value;
      changedBefore[field] = existing.values[field] ?? null;
    }

    // Compare the normalized values including null: clearing an owner is an
    // ownership change, and a string-only check would call a bulk unassignment
    // an ordinary update and skip the approval threshold.
    const ownerChanged =
      "ownerId" in changedAfter &&
      (changedAfter.ownerId ?? null) !== (existing.values.ownerId ?? null);
    if (ownerChanged) ownerChanges += 1;

    if (Object.keys(changedAfter).length === 0) {
      unchangedRecords += 1;
      items.push({
        sourceRowNumber: v.row.sourceRowNumber,
        objectType: v.row.objectType,
        externalId,
        changeKind: "unchanged",
        targetRecordId: existing.internalRecordId,
        beforeValues: {},
        afterValues: {},
      });
      continue;
    }

    updatedRecords += 1;
    items.push({
      sourceRowNumber: v.row.sourceRowNumber,
      objectType: v.row.objectType,
      externalId,
      changeKind: ownerChanged ? "owner_change" : "update",
      targetRecordId: existing.internalRecordId,
      beforeValues: changedBefore,
      afterValues: changedAfter,
    });

    if (afterPipeline !== null) {
      const currentPipeline =
        typeof existing.values.openPipelineUsd === "number"
          ? existing.values.openPipelineUsd
          : 0;
      pipelineDeltaUsd += afterPipeline - currentPipeline;
    }
  }

  const { rankImpact, reason } = projectRankImpact(items, snapshot, topN);
  const predictedGuardrailHolds = validated.filter((v) => v.disposition === "warning").length;

  return {
    items,
    newRecords,
    updatedRecords,
    unchangedRecords,
    ownerChanges,
    referentialFailures,
    duplicateRecords,
    pipelineDeltaUsd: Math.round(pipelineDeltaUsd * 100) / 100,
    rankImpact,
    rankImpactUnavailableReason: reason,
    predictedGuardrailHolds,
    concentrationNotes: describeConcentration(newRecords, snapshot.totalAccounts),
    excluded,
  };
}

/**
 * Rank impact through the canonical deterministic scorer.
 *
 * Only accounts participate: ranking is an account-level concept, so a contact
 * or activity import reports no rank impact rather than a meaningless one.
 */
function projectRankImpact(
  items: readonly ChangeSetItemPreview[],
  snapshot: OperationalSnapshot,
  topN: number,
): { rankImpact: RankImpact | null; reason: string | null } {
  const contexts = snapshot.contextByExternalId;
  if (!contexts) {
    return {
      rankImpact: null,
      reason:
        "No scoring context was supplied, so rank impact would use a different ranking than the product does.",
    };
  }

  const accountItems = items.filter(
    (i) => i.objectType === "account" && i.changeKind !== "unchanged",
  );

  // Start from every account the workspace knows, then apply the staged
  // changes onto scratch copies. Nothing here mutates the snapshot.
  const projected = new Map<string, AccountContext>();
  for (const [externalId, ctx] of contexts) {
    projected.set(externalId, ctx);
  }

  for (const item of accountItems) {
    const base = contexts.get(item.externalId);
    if (!base) continue; // A brand-new account has no context to score yet.
    projected.set(item.externalId, {
      ...base,
      account: { ...base.account, ...(item.afterValues as Partial<typeof base.account>) },
    });
  }

  const rankOf = (source: ReadonlyMap<string, AccountContext>): string[] => {
    const scored = [...source.entries()].map(([externalId, ctx]) => ({
      externalId,
      scored: scoreAccount(ctx),
    }));
    // `rankAccounts` owns the ordering, including the locale-independent
    // accountId tie-break, so the preview and the product cannot disagree.
    const ranked = rankAccounts(scored.map((s) => s.scored));
    const byAccountId = new Map(scored.map((s) => [s.scored.accountId, s.externalId]));
    return ranked
      .slice(0, topN)
      .map((r) => byAccountId.get(r.accountId))
      .filter((id): id is string => id !== undefined);
  };

  const projectedTopN = rankOf(projected);
  const currentSet = new Set(snapshot.currentTopN);
  const projectedSet = new Set(projectedTopN);

  return {
    rankImpact: {
      accountsEnteringTopN: projectedTopN.filter((id) => !currentSet.has(id)).length,
      accountsLeavingTopN: snapshot.currentTopN.filter((id) => !projectedSet.has(id)).length,
      topN,
    },
    reason: null,
  };
}

function describeConcentration(newRecords: number, totalAccounts: number): string | null {
  if (totalAccounts === 0 || newRecords === 0) return null;
  const fraction = newRecords / totalAccounts;
  if (fraction < 0.1) return null;
  return `This import adds ${newRecords} accounts to an existing ${totalAccounts}, a ${Math.round(
    fraction * 100,
  )} percent increase.`;
}

/* ------------------------------------------------------------- approvals -- */

export interface ApprovalRequirement {
  secondApprovalRequired: boolean;
  reasons: string[];
  blockers: string[];
}

/**
 * Decide what approval this change set needs (section 7.2 step 9).
 *
 * Blockers are separate from `secondApprovalRequired` on purpose. A hard
 * security finding or a cross-workspace reference is not a bigger approval, it
 * is a refusal, and modelling it as "needs two people" would imply two people
 * could wave it through.
 */
export function assessApproval(
  preview: ChangeSetPreview,
  validated: readonly ValidatedRow[],
  snapshot: OperationalSnapshot,
  thresholds: SecondApprovalTrigger = DEFAULT_SECOND_APPROVAL_TRIGGER,
): ApprovalRequirement {
  const reasons: string[] = [];
  const blockers: string[] = [];

  const allFindings: RowFinding[] = validated.flatMap((v) => v.findings);
  for (const f of allFindings) {
    if (isHardBlock(f.ruleId) && !blockers.includes(f.ruleId)) blockers.push(f.ruleId);
  }
  for (const blocker of NON_APPROVABLE_BLOCKERS) {
    if (allFindings.some((f) => f.ruleId === blocker) && !blockers.includes(blocker)) {
      blockers.push(blocker);
    }
  }

  const recordsChanged = preview.newRecords + preview.updatedRecords;
  if (recordsChanged > thresholds.recordsChanged) {
    reasons.push(`${recordsChanged} operational records change`);
  }

  if (snapshot.totalAccounts > 0) {
    const accountFraction = recordsChanged / snapshot.totalAccounts;
    if (accountFraction > thresholds.workspaceAccountFraction) {
      reasons.push(`${Math.round(accountFraction * 100)} percent of workspace accounts change`);
    }
    const ownerFraction = preview.ownerChanges / snapshot.totalAccounts;
    if (ownerFraction > thresholds.ownerChangeFraction) {
      reasons.push(`${Math.round(ownerFraction * 100)} percent of account owners change`);
    }
  }

  if (Math.abs(preview.pipelineDeltaUsd) > thresholds.absolutePipelineDeltaUsd) {
    reasons.push(
      `pipeline moves by $${Math.abs(preview.pipelineDeltaUsd).toLocaleString("en-US")}`,
    );
  }

  return { secondApprovalRequired: reasons.length > 0, reasons, blockers };
}
