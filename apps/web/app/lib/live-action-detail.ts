import { requiresApproval } from "@repo/security";
import type { Recommendation } from "@repo/shared-schemas";
import type { LiveDashboardAccountSummary } from "./live-dashboard-data";

export const ACTION_PAYLOAD_MAX_CHARS = 12_000;

// PostgreSQL's uuid input accepts the canonical 8-4-4-4-12 hexadecimal form
// without constraining RFC version or variant bits. Match that storage contract
// rather than rejecting durable UUID values that PostgreSQL accepts.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYLOAD_HASH = /^[0-9a-f]{64}$/;

export type ActionApprovalDecision = "approved" | "rejected";
export type ActionApprovalStatus =
  | "not_required"
  | "pending_approval"
  | "approved"
  | "rejected";

export interface VisibleActionPayload {
  actionType: Recommendation["nextBestAction"]["type"];
  content: string;
  requiresApproval: boolean;
  approvable: boolean;
}

export interface ActionApprovalState {
  status: ActionApprovalStatus;
  payloadHash: string | null;
  decidedAt: string | null;
}

export interface LiveActionScope {
  workspaceId: string;
  accountId: string;
  recommendationId: string;
}

export type LiveActionScopeReason =
  | "workspace_required"
  | "recommendation_required"
  | "repeated_workspace"
  | "repeated_recommendation"
  | "invalid_workspace"
  | "invalid_account";

export type LiveActionScopeResult =
  | { status: "ready"; scope: LiveActionScope }
  | { status: "invalid_scope"; reason: LiveActionScopeReason };

export interface LiveRecommendationDetail {
  workspaceId: string;
  recommendation: Recommendation;
  account: LiveDashboardAccountSummary;
  payload: VisibleActionPayload;
  approval: ActionApprovalState;
}

export type LiveRecommendationDetailResult =
  | { status: "ready"; data: LiveRecommendationDetail }
  | { status: "invalid_scope"; reason: LiveActionScopeReason }
  | { status: "not_found" };

export interface ActionApprovalRequest {
  workspaceId: string;
  recommendationId: string;
  content: string;
  decision: ActionApprovalDecision;
}

function singleQueryValue(
  value: string | string[] | undefined,
  repeatedReason: "repeated_workspace" | "repeated_recommendation",
):
  | { value: string | null; repeated: false }
  | { value: null; repeated: true; reason: typeof repeatedReason } {
  if (Array.isArray(value)) return { value: null, repeated: true, reason: repeatedReason };
  const normalized = value?.trim() ?? "";
  return { value: normalized || null, repeated: false };
}

export function resolveLiveActionScope(
  accountId: string,
  workspace: string | string[] | undefined,
  recommendation: string | string[] | undefined,
): LiveActionScopeResult {
  const workspaceValue = singleQueryValue(workspace, "repeated_workspace");
  if (workspaceValue.repeated) return { status: "invalid_scope", reason: workspaceValue.reason };

  const recommendationValue = singleQueryValue(recommendation, "repeated_recommendation");
  if (recommendationValue.repeated) {
    return { status: "invalid_scope", reason: recommendationValue.reason };
  }

  if (!workspaceValue.value) return { status: "invalid_scope", reason: "workspace_required" };
  if (!recommendationValue.value) {
    return { status: "invalid_scope", reason: "recommendation_required" };
  }

  const normalizedAccountId = accountId.trim();
  if (!UUID.test(workspaceValue.value)) {
    return { status: "invalid_scope", reason: "invalid_workspace" };
  }
  if (!UUID.test(normalizedAccountId)) {
    return { status: "invalid_scope", reason: "invalid_account" };
  }

  return {
    status: "ready",
    scope: {
      workspaceId: workspaceValue.value,
      accountId: normalizedAccountId,
      recommendationId: recommendationValue.value,
    },
  };
}

export function isVisiblePayloadApprovable(content: string): boolean {
  return (
    content.trim().length > 0 &&
    [...content].length <= ACTION_PAYLOAD_MAX_CHARS &&
    !content.includes("\u0000")
  );
}

export function buildVisibleActionPayload(rec: Recommendation): VisibleActionPayload {
  const content = rec.nextBestAction.draft ?? rec.nextBestAction.objective;
  return {
    actionType: rec.nextBestAction.type,
    content,
    requiresApproval: requiresApproval(rec.nextBestAction),
    approvable: isVisiblePayloadApprovable(content),
  };
}

export function isFullyVerifiedPublishedRecommendation(rec: Recommendation): boolean {
  return (
    rec.published &&
    rec.verification.status === "passed" &&
    rec.verification.schemaValid &&
    rec.verification.guardrailsPassed &&
    rec.verification.sourceSignalsVerified &&
    rec.verification.permissionGranted
  );
}

export function notRequiredApprovalState(): ActionApprovalState {
  return { status: "not_required", payloadHash: null, decidedAt: null };
}

export function pendingApprovalState(): ActionApprovalState {
  return { status: "pending_approval", payloadHash: null, decidedAt: null };
}

export function parseActionApprovalRequest(value: unknown): ActionApprovalRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ACTION_APPROVAL_INVALID_REQUEST");
  }

  const input = value as Record<string, unknown>;
  const allowed = new Set(["workspaceId", "recommendationId", "content", "decision"]);
  const keys = Object.keys(input);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    throw new Error("ACTION_APPROVAL_INVALID_REQUEST");
  }

  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
  const recommendationId =
    typeof input.recommendationId === "string" ? input.recommendationId.trim() : "";
  const content = typeof input.content === "string" ? input.content : "";
  const decision = input.decision;

  if (!UUID.test(workspaceId)) throw new Error("ACTION_APPROVAL_INVALID_WORKSPACE");
  if (!recommendationId || recommendationId.length > 512) {
    throw new Error("ACTION_APPROVAL_INVALID_RECOMMENDATION");
  }
  if (!isVisiblePayloadApprovable(content)) {
    throw new Error("ACTION_APPROVAL_INVALID_PAYLOAD");
  }
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("ACTION_APPROVAL_INVALID_DECISION");
  }

  return { workspaceId, recommendationId, content, decision };
}

export function parseActionApprovalState(value: unknown): ActionApprovalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ACTION_APPROVAL_RESULT_INVALID");
  }

  const result = value as Record<string, unknown>;
  const status = result.status;
  if (
    status !== "not_required" &&
    status !== "pending_approval" &&
    status !== "approved" &&
    status !== "rejected"
  ) {
    throw new Error("ACTION_APPROVAL_RESULT_INVALID");
  }

  const payloadHash = result.payloadHash;
  const decidedAt = result.decidedAt;
  const normalizedHash =
    payloadHash === null ? null : typeof payloadHash === "string" ? payloadHash : null;
  const normalizedDecidedAt =
    decidedAt === null ? null : typeof decidedAt === "string" ? decidedAt : null;

  if (normalizedHash !== null && !PAYLOAD_HASH.test(normalizedHash)) {
    throw new Error("ACTION_APPROVAL_RESULT_INVALID");
  }
  if (normalizedDecidedAt !== null && Number.isNaN(Date.parse(normalizedDecidedAt))) {
    throw new Error("ACTION_APPROVAL_RESULT_INVALID");
  }
  if (
    (status === "approved" || status === "rejected") &&
    (normalizedHash === null || normalizedDecidedAt === null)
  ) {
    throw new Error("ACTION_APPROVAL_RESULT_INVALID");
  }
  if (status === "not_required" && (normalizedHash !== null || normalizedDecidedAt !== null)) {
    throw new Error("ACTION_APPROVAL_RESULT_INVALID");
  }

  return { status, payloadHash: normalizedHash, decidedAt: normalizedDecidedAt };
}
