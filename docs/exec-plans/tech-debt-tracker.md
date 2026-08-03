# Technical Debt Tracker

Status: canonical
Owner: engineering
Verification: review during execution planning

Track accepted debt that is outside the active change. Do not use this file to defer merge-blocking authority, determinism, security, tenancy, side-effect, or durable-evidence defects.

| ID | Area | Debt | Evidence | Exit condition | Status |
| --- | --- | --- | --- | --- | --- |
| TD-001 | Durable workflow | Vercel Workflow SDK and `accountActionWorkflow` are selected but not implemented in Phase 1. | ADR-003 | Implement the bounded workflow delivery with separate relay and delivery-worker credentials. | planned |

Add a row only when the debt has a clear owner, evidence, and exit condition.
