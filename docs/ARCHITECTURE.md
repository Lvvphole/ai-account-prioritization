# Architecture

## Pattern

**Turborepo-based hybrid AI application** using a **co-located agent-module
pattern**, supported by:

- deterministic pre-draft decision authority
- bounded runtime LLM drafting and signal synthesis
- deterministic template fallback
- synchronous fail-closed post-draft verification
- human approval before customer-facing or CRM-write actions
- asynchronous LLM evaluation outside the runtime path
- shared-schema contract pattern
- eval-gated CI/CD
- MCP-compatible tool registry

The architecture deliberately separates **decision authority**, **language
generation**, and **publication verification**. TypeScript decides who is
prioritized, why, which action is allowed, and which permissions and approvals
apply. The runtime LLM may only determine how a verified recommendation is
expressed. A deterministic post-draft verifier decides whether the candidate may
publish or must be held.

## Minimum-sufficient harness principle

The canonical decision is
`docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md`.

This architecture deliberately minimizes both probabilistic authority and the
amount of machinery required to constrain it. **Harness complexity is not a
system objective.**

A new harness component is architecturally justified only when an evidenced
failure, explicit product requirement, or explicit high-consequence threat
cannot be satisfied by the existing simpler boundary. The preferred direction
is:

```text
deterministic software
  > bounded probabilistic capability
  > deterministic verification
```

and, for control complexity:

```text
simple local control
  > stateful control
  > orchestration
  > autonomous control plane
```

Moving right requires evidence that the simpler class is insufficient and that
the added component improves the whole system after accounting for latency,
token/compute cost, code, state, dependencies, operational burden, and new
failure modes.

Machine enforcement is reserved for properties that are authoritative,
deterministic, semantically unambiguous, and inexpensive enough to evaluate
relative to the protected operation. Engineering judgment is not converted into
a state machine merely to make it mechanically enforceable.

Whole-system reliability is the target. Reducing model uncertainty while
introducing greater harness uncertainty is an architectural regression, not an
improvement.

## Implementation status

This document defines the approved target architecture.

- **Implemented today:** deterministic scoring, stable ranking, closed-set reason
  codes, deterministic template drafting, synchronous guardrails, approval,
  audit, observability, and asynchronous judge evaluation.
- **Approved next implementation:** constrained runtime LLM drafting and bounded
  signal synthesis between deterministic recommendation creation and
  deterministic verification.
- **Not yet complete:** runtime model adapter, generated-draft schema, claim-level
  grounding validator, model telemetry, runtime-generation evals, and
  web-to-runtime production bridge.

Until those components pass their gates, the deterministic template path remains
the active runtime behavior.

## Monorepo layout

```text
apps/agent-runtime       Hybrid runtime with deterministic decision authority
apps/web                 Next.js UI (rep / manager / account / admin)
apps/api-python          Isolated FastAPI support service
packages/shared-schemas  TypeScript/Zod source of truth + JSON Schema generation
packages/security        RBAC, approval, and security policy
packages/observability   PII-safe events and measured runtime telemetry
packages/testing-evals   Deterministic evals + planned generative evals + async judge
packages/config-*        Shared TypeScript / ESLint configuration
supabase/                Postgres persistence, RLS, audit, and observability
```

## Four boundaries

### 1. Pre-draft deterministic authority boundary

The following values are authoritative, model-independent, and immutable before
runtime generation begins:

- extracted features
- priority score
- rank
- confidence
- reason codes
- verified source references
- next-best-action type
- permission and approval requirements

No model call may create, replace, or mutate these values.

### 2. Runtime generation boundary

The runtime model is permitted only after the pre-draft authority envelope is
complete. It may:

- synthesize verified signals into a concise account brief
- personalize an email draft
- generate a call objective
- draft a CRM note
- adapt wording to the verified account context and selected objective

It may not:

- score or rank accounts
- create reason codes
- change the selected action
- assert facts without verified source references
- use side-effecting tools
- approve, verify, publish, send, or write to the CRM

### 3. Post-draft deterministic verification boundary

The candidate model draft or deterministic fallback draft is untrusted input to
a deterministic verifier. TypeScript computes:

- generated-output schema result
- claim-grounding result
- guardrail result
- permission and approval result
- verification outcome
- publish or hold decision
- explicit failed-gate codes

The model cannot set or override these values. Different candidate drafts may
legitimately produce different deterministic gate results.

### 4. Evaluation boundary

The LLM-as-a-judge remains asynchronous and outside the customer-facing runtime.
It assesses system outputs and can block deployment, but it cannot alter a live
recommendation or authorize publication.

## Target runtime path

```text
orchestrator.agent.ts
  → orchestrator.state.ts
      Zod-validated state machine
  → account-prioritizer
      deterministic features, score, rank, signals, reason codes, action type
  → sales-execution/build-draft-context
      minimum authorized verified context
  → inference/runtime-model
      constrained model call with fixed prompt, schema, timeout, and token cap
        OR
      deterministic template fallback
  → GeneratedDraftSchema
      strict parsing and pre-draft field reconciliation
  → sales-execution/validate-draft-grounding
      every factual claim mapped to verified source IDs
  → orchestrator.guardrails.ts
      schema, claims, source verification, confidence, permission
  → human approval gate
  → deterministic verification outcome and publish-or-hold decision
  → audit log + analytics/observability
```

A failed model call does not bypass verification. Policy selects exactly one of
two outcomes:

1. use the explicit deterministic template fallback and verify it normally; or
2. hold the recommendation with a typed failure code.

Silent provider switching, silent heuristic substitution, and model
self-certification are forbidden.

## Current runtime path

Until the hybrid implementation is complete, the current production behavior is:

```text
orchestrator.agent.ts
  → orchestrator.state.ts
  → account-prioritizer
  → sales-execution deterministic templates
  → orchestrator.guardrails.ts
  → human approval gate
  → audit + analytics
  → publish or hold
```

This current path remains valid as the deterministic fallback and baseline.

## Evaluation path

```text
packages/testing-evals
  → deterministic evals
      scoring, ranking, guardrails, security, golden pre-draft authority envelope
  → planned runtime-generation evals
      schema, grounding, field immutability, injection, fallback, budgets
  → historical and adversarial fixtures
  → LLM-as-a-judge when enabled and keyed
  → threshold check
  → CI/CD deployment gate
```

The runtime-generation suites become deployment-blocking only after they are
implemented and registered. The judge is runtime-nonblocking and becomes
deployment-blocking when required by environment policy.

## Schema path

```text
packages/shared-schemas/src
  → pnpm generate:schemas
    → packages/shared-schemas/generated/json-schema
    → apps/api-python/src/schemas/generated
```

TypeScript/Zod remains the only schema source of truth. Python consumes generated
JSON Schema artifacts only and never imports TypeScript.

The hybrid implementation adds a generated-draft contract that keeps model output
separate from authoritative recommendation state. A model response must not be
parsed directly into the recommendation schema without deterministic
reconciliation.

## Runtime model contract

Each runtime generation call must record:

- run and recommendation identifiers
- provider and pinned model identifier
- prompt identifier and hash
- schema and policy versions
- authorized source-signal identifiers
- timeout and token caps
- measured latency and token usage
- parse, grounding, and guardrail outcomes
- fallback or held-state outcome

The prompt must treat CRM fields, notes, emails, uploads, and retrieved text as
untrusted data. The model receives no general tool registry and no side-effecting
capabilities.

## Determinism guarantees

### Pre-draft authority determinism

Given the same source snapshot, policy, configuration, schema, injected clock,
and code revision, the pre-draft authority envelope must be byte-identical. The
golden eval covers this boundary.

### Post-draft gate determinism

Given the same pre-draft authority envelope, candidate draft or fallback draft,
gate-policy versions, approval state, injected clock, and code revision, schema,
grounding, guardrail, verification, and publish-or-hold outputs must be
byte-identical.

A different probabilistic candidate may legitimately produce a different gate
result. The model still has no authority to set that result.

### Generation reliability

Generated wording is not claimed to be bit-identical. Pinned model, temperature
zero, fixed prompt, and seed reduce variation but do not guarantee identical
provider output.

Accepted generated drafts must instead satisfy behavioral invariants:

- valid strict schema
- unchanged pre-draft authoritative fields
- no unsupported or fabricated claims
- complete claim-to-source grounding
- no prompt-injection authority change
- enforced latency, token, retry, and cost budgets
- deterministic post-draft gate evaluation

## Fail-closed behavior

Any failed gate, including invalid schema, unverified signal, unsupported claim,
missing source reference, stale evidence, model-authority mutation, missing
approval, or sub-floor confidence, marks the recommendation unverified and
prevents publication.

Failures surface in the manager exception view with explicit failed-gate codes and
append-only audit evidence.

## Rollout path

1. Connect the deterministic runtime to durable Supabase recommendations and the
   web workspace.
2. Add the generated-draft Zod schema and generated JSON Schema artifacts.
3. Add the bounded runtime model adapter with no tools and no side effects.
4. Add minimum-context construction and claim-level grounding validation.
5. Preserve and test the deterministic template fallback.
6. Add deterministic and model-backed generation evals.
7. Enable the model path behind an environment policy and measured rollout.
8. Promote only after the production verification and deployment judge gates
   pass.