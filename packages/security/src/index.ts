/**
 * @repo/security — deterministic, dependency-free security primitives shared
 * across the runtime, web, and API: RBAC capability checks, the canonical human
 * approval policy, and PII redaction. No I/O, no async, no framework coupling.
 */
export {
  can,
  requireCapability,
  capabilitiesFor,
  type AppRole,
  type Capability,
} from "./rbac";

export {
  requiresApproval,
  isApprovalSatisfied,
  type ApprovalAction,
  type ApprovalContext,
  type ApprovalStatus,
} from "./approval";

export { redactPII, redactValue, redactProperties } from "./pii";
