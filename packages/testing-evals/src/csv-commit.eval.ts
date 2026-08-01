import { describe, it, expect } from "vitest";
import {
  buildChangeSet,
  assessApproval,
  planCommit,
  assertCommitPlanSafe,
  planRollback,
  CommitRefusedError,
  validateBatch,
  type OperationalSnapshot,
  type ValidationContext,
  type ValidatedRow,
  type NormalizedRow,
  type CommitPlan,
} from "agent-runtime";
import { CommitNotAuthorizedError, type CommitAuthorization } from "@repo/security";
import { isCommittable } from "@repo/shared-schemas";

/**
 * Change-set preview, commit and rollback (spec sections 7.2 steps 8 and 9,
 * and 7.3).
 *
 * The headline assertion is the epic exit gate: no rejected or quarantined row
 * reaches an operational write, proven through the real pipeline rather than at
 * the disposition layer alone.
 */

const NOW = new Date("2026-08-01T00:00:00.000Z");
const WS = "ws-1";

function row(overrides: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    objectType: "account",
    externalId: "EXT-1",
    sourceRowNumber: 2,
    payload: { name: "Acme", openPipelineUsd: 1000 },
    fieldTrust: { name: "unverified_structured", openPipelineUsd: "verified_structured" },
    rowHash: "a".repeat(64),
    unmappedColumns: [],
    failures: [],
    missingRequired: [],
    ...overrides,
  };
}

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    workspaceId: WS,
    knownExternalIds: new Set(),
    knownAccountExternalIds: new Set(["ACC-1"]),
    workspaceMemberIds: new Set(["user-1"]),
    baseline: { accountCount: 100, totalOpenPipelineUsd: 1_000_000 },
    now: NOW,
    ...overrides,
  };
}

function snapshot(overrides: Partial<OperationalSnapshot> = {}): OperationalSnapshot {
  return {
    existingByExternalId: new Map(),
    totalAccounts: 100,
    totalOpenPipelineUsd: 1_000_000,
    currentTopN: [],
    ...overrides,
  };
}

const auth: CommitAuthorization = {
  workspaceId: WS,
  batchId: "batch-1",
  approvalId: "approval-1",
  approvedBy: "user-1",
  secondApprovalRequired: false,
  secondApprovedBy: null,
};

function commit(validated: ValidatedRow[], snap = snapshot()): CommitPlan {
  const preview = buildChangeSet(validated, snap);
  return planCommit({
    batchId: "batch-1",
    workspaceId: WS,
    changeSetId: "cs-1",
    authorization: auth,
    preview,
    validated,
  });
}

describe("change set preview", () => {
  it("counts a new record and its pipeline", () => {
    const validated = validateBatch([row()], ctx());
    const preview = buildChangeSet(validated.rows, snapshot());
    expect(preview.newRecords).toBe(1);
    expect(preview.updatedRecords).toBe(0);
    expect(preview.pipelineDeltaUsd).toBe(1000);
  });

  it("reports a signed pipeline delta when an import reduces it", () => {
    const snap = snapshot({
      existingByExternalId: new Map([
        ["EXT-1", { internalRecordId: "rec-1", ownerId: "user-1", openPipelineUsd: 5000 }],
      ]),
    });
    const validated = validateBatch([row({ payload: { openPipelineUsd: 1000 } })], ctx());
    const preview = buildChangeSet(validated.rows, snap);
    expect(preview.updatedRecords).toBe(1);
    // An import that lowers pipeline must show a negative number, not an
    // absolute one, or an approver reads a cut as growth.
    expect(preview.pipelineDeltaUsd).toBe(-4000);
  });

  it("separates an owner change from an ordinary update", () => {
    const snap = snapshot({
      existingByExternalId: new Map([
        ["EXT-1", { internalRecordId: "rec-1", ownerId: "user-1", openPipelineUsd: 1000 }],
      ]),
    });
    const validated = validateBatch(
      [row({ payload: { ownerId: "user-1", openPipelineUsd: 1000 } })],
      ctx({ workspaceMemberIds: new Set(["user-1", "user-2"]) }),
    );
    expect(buildChangeSet(validated.rows, snap).ownerChanges).toBe(0);

    const changed = validateBatch(
      [row({ payload: { ownerId: "user-2", openPipelineUsd: 1000 } })],
      ctx({ workspaceMemberIds: new Set(["user-1", "user-2"]) }),
    );
    const preview = buildChangeSet(changed.rows, snap);
    expect(preview.ownerChanges).toBe(1);
    expect(preview.items[0]?.changeKind).toBe("owner_change");
  });

  it("recognises an unchanged row", () => {
    const snap = snapshot({
      existingByExternalId: new Map([
        ["EXT-1", { internalRecordId: "rec-1", ownerId: "user-1", openPipelineUsd: 1000 }],
      ]),
    });
    const validated = validateBatch([row({ payload: { openPipelineUsd: 1000 } })], ctx());
    const preview = buildChangeSet(validated.rows, snap);
    expect(preview.unchangedRecords).toBe(1);
    expect(preview.pipelineDeltaUsd).toBe(0);
  });

  it("leaves uncommittable rows out of the counts and says so", () => {
    const validated = validateBatch(
      [
        row({ sourceRowNumber: 2, externalId: "OK" }),
        row({ sourceRowNumber: 3, externalId: null }),
        row({ sourceRowNumber: 4, externalId: "BAD", payload: { ownerId: "stranger" } }),
      ],
      ctx(),
    );
    const preview = buildChangeSet(validated.rows, snapshot());
    // Showing a quarantined row under "new records" would tell an approver
    // they are about to write something the commit will refuse.
    expect(preview.newRecords).toBe(1);
    expect(preview.excluded.map((e) => e.sourceRowNumber).sort()).toEqual([3, 4]);
  });

  it("previews rank impact without publishing anything", () => {
    const snap = snapshot({
      existingByExternalId: new Map([
        ["OLD-1", { internalRecordId: "r1", ownerId: "user-1", openPipelineUsd: 100 }],
      ]),
      currentTopN: ["OLD-1"],
    });
    const validated = validateBatch(
      [row({ externalId: "NEW-1", payload: { openPipelineUsd: 99_999 } })],
      ctx(),
    );
    const preview = buildChangeSet(validated.rows, snap, 1);
    expect(preview.accountsEnteringTopN).toBe(1);
    expect(preview.accountsLeavingTopN).toBe(1);
    // The snapshot passed in is untouched: the projection is scratch.
    expect(snap.currentTopN).toEqual(["OLD-1"]);
  });
});

describe("approval thresholds", () => {
  it("needs no second approver for an ordinary import", () => {
    const validated = validateBatch([row()], ctx());
    const preview = buildChangeSet(validated.rows, snapshot());
    const assessment = assessApproval(preview, validated.rows, snapshot());
    expect(assessment.secondApprovalRequired).toBe(false);
    expect(assessment.blockers).toEqual([]);
  });

  it("demands a second approver past the account fraction and says why", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ sourceRowNumber: i + 2, externalId: `NEW-${i}` }),
    );
    const validated = validateBatch(rows, ctx());
    const snap = snapshot({ totalAccounts: 100 });
    const preview = buildChangeSet(validated.rows, snap);
    const assessment = assessApproval(preview, validated.rows, snap);
    expect(assessment.secondApprovalRequired).toBe(true);
    expect(assessment.reasons.join(" ")).toMatch(/percent of workspace accounts/);
  });

  it("demands a second approver past the pipeline delta", () => {
    const validated = validateBatch(
      [row({ payload: { openPipelineUsd: 20_000_000 } })],
      ctx({ baseline: { accountCount: 100, totalOpenPipelineUsd: 1_000_000_000 } }),
    );
    const preview = buildChangeSet(validated.rows, snapshot());
    const assessment = assessApproval(preview, validated.rows, snapshot());
    expect(assessment.secondApprovalRequired).toBe(true);
    expect(assessment.reasons.join(" ")).toMatch(/pipeline moves by/);
  });

  it("reports a hard block as a blocker, never as a bigger approval", () => {
    const validated: ValidatedRow[] = [
      {
        row: row(),
        disposition: "rejected",
        findings: [
          {
            sourceRowNumber: 2,
            findingClass: "workspace_boundary",
            severity: "critical",
            ruleId: "cross_workspace_reference",
            canonicalField: null,
            redactedValue: null,
            explanation: "parent in another tenant",
            downstreamImpact: null,
          },
        ],
      },
    ];
    const preview = buildChangeSet(validated, snapshot());
    const assessment = assessApproval(preview, validated, snapshot());
    // Two people cannot wave through something that is not approvable.
    expect(assessment.blockers).toContain("cross_workspace_reference");
    expect(assessment.secondApprovalRequired).toBe(false);
  });
});

describe("commit authorization", () => {
  it("refuses a commit with no approval", () => {
    const validated = validateBatch([row()], ctx());
    expect(() =>
      planCommit({
        batchId: "batch-1",
        workspaceId: WS,
        changeSetId: "cs-1",
        authorization: { ...auth, approvalId: "" },
        preview: buildChangeSet(validated.rows, snapshot()),
        validated: validated.rows,
      }),
    ).toThrow(CommitNotAuthorizedError);
  });

  it("refuses an approval belonging to another workspace", () => {
    const validated = validateBatch([row()], ctx());
    expect(() =>
      planCommit({
        batchId: "batch-1",
        workspaceId: "ws-2",
        changeSetId: "cs-1",
        authorization: auth,
        preview: buildChangeSet(validated.rows, snapshot()),
        validated: validated.rows,
      }),
    ).toThrow(CommitNotAuthorizedError);
  });

  it("refuses the whole batch when any row is hard blocked", () => {
    const validated: ValidatedRow[] = [
      { row: row({ sourceRowNumber: 2 }), disposition: "ready", findings: [] },
      {
        row: row({ sourceRowNumber: 3, externalId: "EXT-2" }),
        disposition: "rejected",
        findings: [
          {
            sourceRowNumber: 3,
            findingClass: "malware",
            severity: "critical",
            ruleId: "malware_detected",
            canonicalField: null,
            redactedValue: null,
            explanation: "x",
            downstreamImpact: null,
          },
        ],
      },
    ];
    // Not just the bad row: a hard block is never approvable, so no amount of
    // sign-off makes the rest of the batch safe to apply.
    expect(() => commit(validated)).toThrow(CommitRefusedError);
  });
});

describe("exit gate: no rejected or quarantined row reaches an operational write", () => {
  it("holds through the real pipeline", () => {
    const rows = [
      row({ sourceRowNumber: 2, externalId: "OK-1" }),
      row({ sourceRowNumber: 3, externalId: null }),
      row({ sourceRowNumber: 4, externalId: "OK-2", payload: { ownerId: "stranger" } }),
      row({
        sourceRowNumber: 5,
        externalId: "OK-3",
        payload: { openPipelineUsd: 500, closeDate: "2030-01-01T00:00:00.000Z" },
      }),
      row({ sourceRowNumber: 6, externalId: "OK-1" }),
    ];
    const validated = validateBatch(rows, ctx());
    const plan = commit(validated.rows);

    const byRow = new Map(validated.rows.map((v) => [v.row.sourceRowNumber, v.disposition]));
    for (const entry of plan.entries) {
      const disposition = byRow.get(entry.sourceRowNumber)!;
      expect(isCommittable(disposition), `row ${entry.sourceRowNumber}`).toBe(true);
      expect(disposition).not.toBe("rejected");
      expect(disposition).not.toBe("quarantined");
      expect(disposition).not.toBe("duplicate");
    }

    // Only the ready row and the warning row are written. The missing external
    // id, the unknown owner and the duplicate are not.
    expect(plan.entries.map((e) => e.sourceRowNumber)).toEqual([2, 5]);
    expect(plan.skipped.map((s) => s.sourceRowNumber).sort()).toEqual([3, 4, 6]);
  });

  it("throws when a plan is hand-built with an uncommittable row", () => {
    // The filter in planCommit is not the only guard. If it were edited
    // wrongly it would fail open and silently; this assertion fails loudly.
    const validated = validateBatch([row({ payload: { ownerId: "stranger" } })], ctx());
    const forged: CommitPlan = {
      batchId: "batch-1",
      workspaceId: WS,
      changeSetId: "cs-1",
      approvalId: "approval-1",
      entries: [
        {
          sourceRowNumber: 2,
          externalId: "EXT-1",
          changeKind: "create",
          targetRecordId: null,
          values: {},
          eventType: "account.created",
        },
      ],
      skipped: [],
    };
    expect(() => assertCommitPlanSafe(forged, validated.rows)).toThrow(CommitRefusedError);
  });

  it("refuses a plan naming a row that was never validated", () => {
    const validated = validateBatch([row()], ctx());
    const forged: CommitPlan = {
      batchId: "batch-1",
      workspaceId: WS,
      changeSetId: "cs-1",
      approvalId: "approval-1",
      entries: [
        {
          sourceRowNumber: 99,
          externalId: "GHOST",
          changeKind: "create",
          targetRecordId: null,
          values: {},
          eventType: "account.created",
        },
      ],
      skipped: [],
    };
    expect(() => assertCommitPlanSafe(forged, validated.rows)).toThrow(CommitRefusedError);
  });

  it("raises exactly one domain event per operational write", () => {
    const validated = validateBatch(
      [
        row({ sourceRowNumber: 2, externalId: "NEW-1" }),
        row({ sourceRowNumber: 3, externalId: "NEW-2" }),
      ],
      ctx(),
    );
    const plan = commit(validated.rows);
    expect(plan.entries).toHaveLength(2);
    // Section 15.3: the mutation and its event happen together, so a write
    // without an event would leave triggers blind to a real change.
    expect(plan.entries.every((e) => e.eventType)).toBe(true);
    expect(plan.entries.map((e) => e.eventType)).toEqual([
      "account.created",
      "account.created",
    ]);
  });

  it("raises no event for an unchanged row and does not write it", () => {
    const snap = snapshot({
      existingByExternalId: new Map([
        ["EXT-1", { internalRecordId: "rec-1", ownerId: "user-1", openPipelineUsd: 1000 }],
      ]),
    });
    const validated = validateBatch([row({ payload: { openPipelineUsd: 1000 } })], ctx());
    const plan = commit(validated.rows, snap);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });
});

describe("rollback compensates rather than deletes", () => {
  const committedAt = new Date("2026-07-31T00:00:00.000Z");
  const item = {
    sourceRowNumber: 2,
    externalId: "EXT-1",
    changeKind: "update" as const,
    targetRecordId: "rec-1",
    beforeValues: { openPipelineUsd: 500 },
    afterValues: { openPipelineUsd: 1000 },
  };

  it("restores the pre-commit values", () => {
    const plan = planRollback({
      originalCommitId: "commit-1",
      workspaceId: WS,
      committedAt,
      now: NOW,
      items: [item],
      current: new Map([["EXT-1", { openPipelineUsd: 1000 }]]),
    });
    expect(plan.entries).toEqual([
      {
        externalId: "EXT-1",
        targetRecordId: "rec-1",
        values: { openPipelineUsd: 500 },
        eventType: "account.updated",
      },
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it("reports a conflict instead of overwriting a later edit", () => {
    // Somebody changed the record after the import. Rolling back the import
    // must not quietly destroy their work.
    const plan = planRollback({
      originalCommitId: "commit-1",
      workspaceId: WS,
      committedAt,
      now: NOW,
      items: [item],
      current: new Map([["EXT-1", { openPipelineUsd: 7777 }]]),
    });
    expect(plan.entries).toEqual([]);
    expect(plan.conflicts).toEqual([
      { externalId: "EXT-1", field: "openPipelineUsd", committedValue: 1000, currentValue: 7777 },
    ]);
  });

  it("flags a rollback requested outside the window", () => {
    const late = new Date("2026-08-10T00:00:00.000Z");
    const plan = planRollback({
      originalCommitId: "commit-1",
      workspaceId: WS,
      committedAt,
      now: late,
      items: [item],
      current: new Map([["EXT-1", { openPipelineUsd: 1000 }]]),
    });
    expect(plan.outsideWindow).toBe(true);
  });

  it("stays inside the window for a prompt rollback", () => {
    const plan = planRollback({
      originalCommitId: "commit-1",
      workspaceId: WS,
      committedAt,
      now: NOW,
      items: [item],
      current: new Map([["EXT-1", { openPipelineUsd: 1000 }]]),
    });
    expect(plan.outsideWindow).toBe(false);
  });
});
