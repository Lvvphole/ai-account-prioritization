import {
  DEFAULT_SECOND_APPROVAL_TRIGGER,
  NON_APPROVABLE_BLOCKERS,
  isCommittable,
  isHardBlock,
} from "@repo/shared-schemas";
import type {
  ChangeKind,
  RecordDisposition,
  SecondApprovalTrigger,
} from "@repo/shared-schemas";
import type { ValidatedRow, RowFinding } from "./validation";

/**
 * Deterministic change preview (secure-ingestion spec, section 7.2 steps 8 and 9).
 *
 * This is what an approver reads before deciding, so two properties matter more
 * than completeness:
 *
 *   1. It is derived only from staged rows and the existing snapshot. Nothing
 *      here queries live state a second time, so what the approver saw is what
 *      the commit applies.
 *   2. It never publishes. The rank impact is computed against a temporary
 *      snapshot and thrown away; no recommendation is written.
 */

/** What the workspace looks like now, for diffing. */
export interface OperationalSnapshot {
  /** External id to the operational row it already resolves to. */
  existingByExternalId: ReadonlyMap<
    string,
    { internalRecordId: string; ownerId: string | null; openPipelineUsd: number }
  >;
  totalAccounts: number;
  totalOpenPipelineUsd: number;
  /** Account external ids currently inside the top N, in rank order. */
  currentTopN: readonly string[];
}

export interface ChangeSetItemPreview {
  sourceRowNumber: number;
  externalId: string;
  changeKind: ChangeKind;
  targetRecordId: string | null;
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
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
  accountsEnteringTopN: number;
  accountsLeavingTopN: number;
  predictedGuardrailHolds: number;
  concentrationNotes: string | null;
  /** Rows that cannot commit, and why, so the count is explainable. */
  excluded: { sourceRowNumber: number; disposition: RecordDisposition }[];
}

/**
 * Build the preview.
 *
 * Only committable rows contribute to the counts. A quarantined row is not a
 * pending change: showing it in "new records" would tell an approver they are
 * about to write something the commit will refuse.
 */
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

  // Projected pipeline per account, starting from what exists today. Built as a
  // scratch map rather than by mutating the snapshot, so nothing this function
  // touches survives it.
  const projected = new Map<string, number>();
  for (const [externalId, row] of snapshot.existingByExternalId) {
    projected.set(externalId, row.openPipelineUsd);
  }

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

    if (!isCommittable(v.disposition)) {
      excluded.push({ sourceRowNumber: v.row.sourceRowNumber, disposition: v.disposition });
      continue;
    }

    const externalId = v.row.externalId;
    if (!externalId) {
      excluded.push({ sourceRowNumber: v.row.sourceRowNumber, disposition: v.disposition });
      continue;
    }

    const existing = snapshot.existingByExternalId.get(externalId);
    const after = v.row.payload;
    const afterPipeline = typeof after.openPipelineUsd === "number" ? after.openPipelineUsd : null;

    if (!existing) {
      newRecords += 1;
      items.push({
        sourceRowNumber: v.row.sourceRowNumber,
        externalId,
        changeKind: "create",
        targetRecordId: null,
        beforeValues: {},
        afterValues: { ...after },
      });
      if (afterPipeline !== null) {
        pipelineDeltaUsd += afterPipeline;
        projected.set(externalId, afterPipeline);
      }
      continue;
    }

    const before: Record<string, unknown> = {
      ownerId: existing.ownerId,
      openPipelineUsd: existing.openPipelineUsd,
    };
    const changedFields: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(after)) {
      if (field in before && before[field] === value) continue;
      if (!(field in before) && value === null) continue;
      changedFields[field] = value;
    }

    const ownerChanged =
      typeof after.ownerId === "string" && after.ownerId !== existing.ownerId;
    if (ownerChanged) ownerChanges += 1;

    if (Object.keys(changedFields).length === 0) {
      unchangedRecords += 1;
      items.push({
        sourceRowNumber: v.row.sourceRowNumber,
        externalId,
        changeKind: "unchanged",
        targetRecordId: existing.internalRecordId,
        beforeValues: before,
        afterValues: {},
      });
      continue;
    }

    updatedRecords += 1;
    items.push({
      sourceRowNumber: v.row.sourceRowNumber,
      externalId,
      changeKind: ownerChanged ? "owner_change" : "update",
      targetRecordId: existing.internalRecordId,
      beforeValues: before,
      afterValues: changedFields,
    });

    if (afterPipeline !== null) {
      pipelineDeltaUsd += afterPipeline - existing.openPipelineUsd;
      projected.set(externalId, afterPipeline);
    }
  }

  // Rank impact against the scratch projection. This is a preview: no
  // recommendation is written and no run is published (section 7.2 step 8).
  const projectedTopN = [...projected.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([externalId]) => externalId);

  const currentSet = new Set(snapshot.currentTopN);
  const projectedSet = new Set(projectedTopN);
  const accountsEnteringTopN = projectedTopN.filter((id) => !currentSet.has(id)).length;
  const accountsLeavingTopN = snapshot.currentTopN.filter((id) => !projectedSet.has(id)).length;

  // A warning row commits, and each one is a guardrail the reviewer accepted
  // rather than one the system cleared.
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
    accountsEnteringTopN,
    accountsLeavingTopN,
    predictedGuardrailHolds,
    concentrationNotes: describeConcentration(newRecords, snapshot.totalAccounts),
    excluded,
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
  /** Which thresholds fired, so the UI can say why rather than just that. */
  reasons: string[];
  /** Present when the change set cannot be committed at all. */
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
    if (isHardBlock(f.ruleId) && !blockers.includes(f.ruleId)) {
      blockers.push(f.ruleId);
    }
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
      reasons.push(
        `${Math.round(accountFraction * 100)} percent of workspace accounts change`,
      );
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
