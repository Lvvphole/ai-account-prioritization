/**
 * Orchestrator prompt / operating contract.
 *
 * The orchestrator is a DETERMINISTIC state machine, not an LLM agent. This
 * constant documents the contract it enforces and is surfaced in docs and the
 * admin UI. There is intentionally no model call in the orchestrator path.
 */
export const ORCHESTRATOR_CONTRACT = `
Daily Account Prioritization — runtime contract:

Phases: DISCOVER -> PLAN -> EXECUTE -> VERIFY -> ITERATE -> PUBLISH.

Invariants enforced at runtime (synchronous, deterministic):
1. The LLM never ranks accounts; ranking comes from deterministic scoring.
2. Orchestrator state is validated with Zod on every transition.
3. Every recommendation carries score, confidence, reason codes, verified source
   signals, and a next best action.
4. No recommendation publishes without passing the guardrail verification.
5. Customer-facing sends and CRM write-backs require human approval.
6. Every critical action (publish, block, approval, write-back) is audited.
7. The LLM-as-a-judge is never consulted here; it runs offline in evals only.
`.trim();
