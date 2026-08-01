# ADR-001: Hybrid Runtime Drafting with Deterministic Decision Authority

- **Status:** Accepted
- **Date:** 2026-07-31
- **Decision owners:** Product and architecture

## Context

The shipped runtime is a deterministic TypeScript pipeline. It scores and ranks
accounts, selects reason codes and next-best actions, produces template drafts,
runs guardrails, requires approval, and publishes or blocks recommendations.
The only active LLM is in asynchronous evaluation.

This baseline is reliable and auditable, but deterministic templates limit the
quality of account-specific synthesis and action drafting. The product should
become a true hybrid AI application without surrendering ranking, safety, or
publication authority to a probabilistic model.

## Decision

Add one constrained runtime LLM stage after deterministic recommendation
creation and before deterministic verification.

```text
verified CRM data
  → deterministic score, rank, reasons, and action
  → minimum verified draft context
  → constrained LLM draft OR deterministic template fallback
  → strict schema and claim grounding
  → deterministic guardrails and permission checks
  → human approval
  → publish or hold
```

The model may synthesize verified signals and draft language. It may not change:

- score
- rank
- confidence
- reason codes
- source verification
- next-best-action type
- tool authority
- permissions
- approval state
- verification status
- publication eligibility

## Rationale

This boundary places probabilistic capability where it adds value and keeps
high-consequence decisions inside deterministic, testable code.

It preserves:

- reproducible account prioritization
- explainability and provenance
- low-latency fail-closed guardrails
- human approval
- safe fallback when the model is unavailable or invalid
- independent asynchronous semantic evaluation

## Required controls

- Pinned provider model and versioned prompt.
- Strict Zod output schema.
- Minimum authorized verified context.
- No general tools and no side-effecting tools.
- Fixed timeout, token cap, and bounded attempts.
- Claim-level source references.
- Deterministic grounding validator.
- Authoritative-field reconciliation.
- Explicit template fallback or held state.
- Audit and measured telemetry for every model call and fallback.
- Adversarial prompt-injection tests.
- Deployment-blocking generation evals.

## Determinism statement

The decision envelope remains byte-identical for identical inputs. Generated
prose is governed by behavioral reliability, not claimed bit identity.

## Consequences

### Positive

- The application becomes genuinely runtime AI-enabled.
- Drafts can be more contextual and useful.
- Ranking and publication remain reproducible and auditable.
- Provider failure does not break the decision core.

### Costs and risks

- Additional latency and token cost.
- New prompt-injection and data-minimization surface.
- Generated prose can vary across provider calls.
- Grounding, model telemetry, and rollout infrastructure are required.

## Rejected alternatives

### Let the LLM rank accounts

Rejected because it weakens reproducibility, explainability, policy simulation,
and regression testing.

### Keep the LLM only in offline evaluation

Rejected as the long-term product architecture because it does not add runtime
AI capability to the customer workflow.

### Replace deterministic templates without fallback

Rejected because provider failure would unnecessarily block useful, already
verified recommendations.

### Give the drafter tool access

Rejected because drafting does not require side effects and additional authority
would increase risk without proportional value.

## Implementation sequence

1. Connect runtime persistence to the web workspace.
2. Add generated-draft schema.
3. Add bounded runtime model adapter.
4. Add minimum-context builder.
5. Add claim-grounding validator.
6. Preserve deterministic template fallback.
7. Add generation, security, and rollout evals.
8. Enable behind explicit environment policy.
9. Promote after all production gates pass.
