import assert from "node:assert/strict";
import test from "node:test";
import type { Recommendation } from "@repo/shared-schemas";
import {
  ACTION_PAYLOAD_MAX_CHARS,
  approvalStateForSubmittedPayload,
  buildVisibleActionPayload,
  isFullyVerifiedPublishedRecommendation,
  isVisiblePayloadApprovable,
  parseActionApprovalRequest,
  parseActionApprovalState,
  resolveLiveActionScope,
} from "./live-action-detail";

const WORKSPACE = "aaaaaaaa-0000-0000-0000-000000000001";
const ACCOUNT = "aaaaaaa1-0000-0000-0000-000000000001";
const OWNER = "11111111-1111-1111-1111-111111111111";
const NOW = "2026-08-07T14:00:00.000Z";

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-action-1",
    runId: "run-action-1",
    accountId: ACCOUNT,
    ownerId: OWNER,
    score: 80,
    rank: 1,
    confidence: 0.9,
    reasonCodes: ["strategic_tier_account"],
    reasonNarrative: "Verified deterministic recommendation.",
    sourceSignals: [
      {
        kind: "account",
        refId: ACCOUNT,
        description: "Canonical account evidence.",
        verified: true,
      },
    ],
    nextBestAction: {
      type: "send_email",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Agree on the next conversation.",
      draft: "Subject: Next step\n\nCan we agree on the next conversation?",
    },
    verification: {
      status: "passed",
      schemaValid: true,
      guardrailsPassed: true,
      sourceSignalsVerified: true,
      permissionGranted: true,
      failedGates: [],
      checkedAt: NOW,
    },
    approvalStatus: "approved",
    published: true,
    createdAt: NOW,
    ...overrides,
  };
}

test("live action scope accepts the canonical PostgreSQL UUID form used by durable records", () => {
  assert.deepEqual(resolveLiveActionScope(ACCOUNT, WORKSPACE, "rec-action-1"), {
    status: "ready",
    scope: {
      workspaceId: WORKSPACE,
      accountId: ACCOUNT,
      recommendationId: "rec-action-1",
    },
  });
  assert.deepEqual(resolveLiveActionScope(ACCOUNT, undefined, "rec-action-1"), {
    status: "invalid_scope",
    reason: "workspace_required",
  });
  assert.deepEqual(resolveLiveActionScope(ACCOUNT, WORKSPACE, undefined), {
    status: "invalid_scope",
    reason: "recommendation_required",
  });
});

test("repeated authority parameters fail closed instead of selecting by request order", () => {
  assert.deepEqual(resolveLiveActionScope(ACCOUNT, [WORKSPACE, WORKSPACE], "rec-action-1"), {
    status: "invalid_scope",
    reason: "repeated_workspace",
  });
  assert.deepEqual(resolveLiveActionScope(ACCOUNT, WORKSPACE, ["rec-action-1", "rec-action-2"]), {
    status: "invalid_scope",
    reason: "repeated_recommendation",
  });
});

test("invalid UUID authority identifiers fail closed", () => {
  assert.deepEqual(resolveLiveActionScope(ACCOUNT, "not-a-workspace", "rec-action-1"), {
    status: "invalid_scope",
    reason: "invalid_workspace",
  });
  assert.deepEqual(resolveLiveActionScope("not-an-account", WORKSPACE, "rec-action-1"), {
    status: "invalid_scope",
    reason: "invalid_account",
  });
});

test("visible protected payload comes from persisted draft and remains approval-gated", () => {
  const payload = buildVisibleActionPayload(recommendation());
  assert.equal(payload.actionType, "send_email");
  assert.equal(payload.requiresApproval, true);
  assert.equal(payload.approvable, true);
  assert.equal(payload.content, "Subject: Next step\n\nCan we agree on the next conversation?");
});

test("non-protected action uses the persisted objective and needs no payload approval", () => {
  const rec = recommendation({
    nextBestAction: {
      type: "no_action_hold",
      customerFacing: false,
      crmWriteBack: false,
      objective: "Hold until verified evidence changes.",
    },
  });
  const payload = buildVisibleActionPayload(rec);
  assert.equal(payload.content, "Hold until verified evidence changes.");
  assert.equal(payload.requiresApproval, false);
});

test("payload approval request parser accepts only the exact authority surface", () => {
  assert.deepEqual(
    parseActionApprovalRequest({
      workspaceId: WORKSPACE,
      recommendationId: "rec-action-1",
      content: "Exact visible payload",
      decision: "approved",
    }),
    {
      workspaceId: WORKSPACE,
      recommendationId: "rec-action-1",
      content: "Exact visible payload",
      decision: "approved",
    },
  );

  assert.throws(
    () =>
      parseActionApprovalRequest({
        workspaceId: WORKSPACE,
        recommendationId: "rec-action-1",
        accountId: ACCOUNT,
        content: "Exact visible payload",
        decision: "approved",
      }),
    /ACTION_APPROVAL_INVALID_REQUEST/,
  );
  assert.throws(
    () =>
      parseActionApprovalRequest({
        workspaceId: WORKSPACE,
        recommendationId: "rec-action-1",
        content: "Exact visible payload",
        decision: "pending_approval",
      }),
    /ACTION_APPROVAL_INVALID_DECISION/,
  );
});

test("payload size boundary is deterministic and fail closed", () => {
  assert.equal(isVisiblePayloadApprovable("visible"), true);
  assert.equal(isVisiblePayloadApprovable("   "), false);
  assert.equal(isVisiblePayloadApprovable("x".repeat(ACTION_PAYLOAD_MAX_CHARS)), true);
  assert.equal(isVisiblePayloadApprovable("x".repeat(ACTION_PAYLOAD_MAX_CHARS + 1)), false);
});

test("only fully verified published recommendations are eligible for live action detail", () => {
  assert.equal(isFullyVerifiedPublishedRecommendation(recommendation()), true);
  assert.equal(
    isFullyVerifiedPublishedRecommendation(recommendation({ published: false })),
    false,
  );
  assert.equal(
    isFullyVerifiedPublishedRecommendation(
      recommendation({
        verification: {
          ...recommendation().verification,
          permissionGranted: false,
        },
      }),
    ),
    false,
  );
});

test("durable approval state parser requires a valid hash for final decisions", () => {
  const hash = "a".repeat(64);
  assert.deepEqual(
    parseActionApprovalState({
      status: "approved",
      payloadHash: hash,
      decidedAt: NOW,
    }),
    { status: "approved", payloadHash: hash, decidedAt: NOW },
  );
  assert.throws(
    () =>
      parseActionApprovalState({
        status: "approved",
        payloadHash: null,
        decidedAt: NOW,
      }),
    /ACTION_APPROVAL_RESULT_INVALID/,
  );
});

test("an async response cannot mark different displayed content as approved", () => {
  const approved = {
    status: "approved" as const,
    payloadHash: "b".repeat(64),
    decidedAt: NOW,
  };
  assert.deepEqual(
    approvalStateForSubmittedPayload("payload A", "payload A", approved),
    approved,
  );
  assert.equal(
    approvalStateForSubmittedPayload("payload B", "payload A", approved),
    null,
  );
});
