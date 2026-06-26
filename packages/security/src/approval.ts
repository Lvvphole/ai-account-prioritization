/**
 * Human-approval policy (Execution Rule #7).
 *
 * The single, canonical definition of *when* an action needs human approval and
 * *whether* that approval is satisfied. The deterministic runtime guardrail
 * delegates to this so the gate has one source of truth and cannot drift or be
 * silently weakened. Pure and dependency free.
 */

/** Whether the action reaches a customer or writes back to the CRM. */
export interface ApprovalAction {
  customerFacing: boolean;
  crmWriteBack: boolean;
}

/** Approval lifecycle state, mirroring the recommendation `approvalStatus` enum. */
export type ApprovalStatus =
  | "not_required"
  | "pending_approval"
  | "approved"
  | "rejected";

export interface ApprovalContext {
  /**
   * The hard safety switch (env `REQUIRE_HUMAN_APPROVAL`). It defaults ON and is
   * only ever disabled in explicitly non-production contexts.
   */
  requireHumanApproval: boolean;
  approvalStatus: ApprovalStatus;
}

/** An action needs approval iff it is customer-facing or writes back to the CRM. */
export function requiresApproval(action: ApprovalAction): boolean {
  return action.customerFacing || action.crmWriteBack;
}

/**
 * Whether the action may proceed under the approval policy.
 *
 * Fail-closed semantics, identical to the runtime permission gate:
 * - no approval needed              -> allowed
 * - approval globally disabled      -> allowed (non-prod only)
 * - otherwise                       -> allowed only when explicitly `approved`
 */
export function isApprovalSatisfied(
  action: ApprovalAction,
  ctx: ApprovalContext,
): boolean {
  if (!requiresApproval(action)) return true;
  if (!ctx.requireHumanApproval) return true;
  return ctx.approvalStatus === "approved";
}
