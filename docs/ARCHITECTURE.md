# Architecture

## Pattern

**Turborepo-based hybrid AI application** using a **co-located agent-module
pattern**, supported by:

- deterministic decision core
- bounded runtime LLM drafting and signal synthesis
- deterministic template fallback
- synchronous fail-closed verification
- human approval before customer-facing or CRM-write actions
- asynchronous LLM evaluation outside the runtime path
- shared-schema contract pattern
- eval-gated CI/CD
- MCP-compatible tool registry

The architecture deliberately separates **decision authority** from **language
generation**. TypeScript decides who is prioritized, why, what action is allowed,
and whether a result may publish. The runtime LLM may only determine how a
verified recommendation is expressed.

## Implementation status

This document defines the approved target architecture.

- **Implemented today:** deterministic scoring, stable ranking, closed-set reason
  codes, deterministic template drafting, synchronous guardrails, approval,
  audit, observability, and asynchronous judge evaluation.
- **Approved next implementation:** constrained runtime LLM drafting and bounded
  signal synthesis between deterministic recommendation creation and
  deterministic verification.
- **Not yet complete:** runtime model adapter, generated-draft schema, claim-level
  grounding validator, model telemetry, and web-to-runtime production bridge.

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
packages/testing-evals   Deterministic evals + generative evals + async judge
packages/config-*        Shared TypeScript / ESLint configuration
supabase/                Postgres persistence, RLS, audit, and observability
```

## Three boundaries

### 1. Deterministic decision boundary

The following values are authoritative and model-independent:

- extracted features
- priority score
- rank
- confidence
- reason codes
- verified source references
- next-best-action type
- permission and approval requirements
- verification outcome
- publish or hold decision

No model call may create, replace, or mutate these values.

### 2. Runtime generation boundary

The runtime model is permitted only after the deterministic decision envelope is
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

### 3. Evaluation boundary

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
      strict parsing and authoritative-field reconciliation
  → sales-execution/validate-draft-grounding
      every factual claim mapped to verified source IDs
  → orchestrator.guardrails.ts
      schema, claims, source verification, confidence, permission
  → human approval gate
  → audit log + analytics/observability
  → publish or hold
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
      scoring, ranking, guardrails, security, golden decision envelope
  → runtime-generation evals
      schema, grounding, field immutability, injection, fallback, budgets
  → historical and adversarial fixtures
  → LLM-as-a-judge when enabled and keyed
  → threshold check
  → CI/CD deployment gate
```

The judge is runtime-nonblocking and becomes deployment-blocking when required by
environment policy.

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

### Decision determinism

Given the same source snapshot, policy, configuration, schema, injected clock,
and code revision, the decision envelope must be byte-identical. The golden eval
covers this boundary.

### Generation reliability

Generated wording is not claimed to be bit-identical. Pinned model, temperature
zero, fixed prompt, and seed reduce variation but do not guarantee identical
provider output.

Accepted generated drafts must instead satisfy behavioral invariants:

- valid strict schema
- unchanged authoritative fields
- no unsupported or fabricated claims
- complete claim-to-source grounding
- no prompt-injection authority change
- enforced latency, token, retry, and cost budgets
- deterministic publish or hold decision

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
