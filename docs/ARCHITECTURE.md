# Architecture

Status: canonical
Owner: architecture
Verification: `docs/VERIFICATION.md`

## System purpose

The product is an event-driven decision and action-support system with bounded automation and scheduled reconciliation.

The architecture separates four authorities:

```text
Supabase
  -> canonical business facts and durable business evidence

Transactional outbox
  -> atomic publication boundary for accepted source changes

Durable workflow runtime
  -> process steps, waits, retries, resumption, and operational traces

Deterministic domain policy
  -> feature authority, score, rank, reasons, action authority, and verification
```

ADR-003 selects Vercel Workflow SDK for the durable workflow runtime. The dependency and workflow implementation belong to the next bounded delivery.

## Process path

The event fast path and scheduled reconciliation path converge on one deterministic domain policy.

```text
CRM webhook OR scheduled reconciliation
  -> source adapter and capability declaration
  -> canonical CRM write plus transactional outbox event
  -> durable account-action workflow
  -> authoritative account snapshot
  -> supported feature derivation
  -> deterministic decision path
  -> bounded draft generation when permitted
  -> deterministic verification
  -> hold, internal delivery, or approval wait
  -> re-read authoritative approval after resume
  -> idempotent external action
  -> outcome and audit evidence
```

Scheduled reconciliation is a recovery path. It must not implement a second scoring or action policy.

## Deterministic decision path

```text
validated authoritative input
  -> feature extraction
  -> deterministic scoring
  -> stable ranking
  -> reason codes and next-best action
  -> minimum verified context
  -> bounded model draft OR deterministic template fallback
  -> strict output-schema validation
  -> claim-to-source grounding
  -> deterministic guardrails
  -> permission and approval evaluation
  -> publish or hold
```

The model can decide how to express a verified recommendation. It cannot decide who is prioritized, why the account is prioritized, which action is authorized, or whether a result can publish.

## Authority boundaries

### Supabase

Supabase owns:

- canonical CRM facts;
- capability snapshots and source provenance;
- persisted recommendations;
- approval state;
- delivery outcomes;
- durable business audit evidence.

Workflow state is not business authority.

### Transactional outbox

The outbox owns atomic event publication. A source adapter can create pending work. It cannot certify that a workflow started.

The relay credential owns publication transitions. Producer credentials must not have equivalent authority.

### Durable workflow runtime

The workflow runtime owns:

- process progression;
- completed-step checkpoints;
- waits and timers;
- process retries after publication;
- suspension and resumption;
- workflow-version binding;
- operational traces.

Application tables must not become a second workflow engine.

### Deterministic domain policy

Domain code owns:

- feature availability;
- deterministic derivations;
- scoring and ranking;
- reason predicates;
- next-best-action authority;
- confidence;
- post-draft verification;
- publish or hold decisions.

## Temporal authority

Time-bearing evidence is an authority input. `docs/RELIABILITY.md` defines the temporal contract.

The architecture requires these boundaries:

```text
source timestamp
  -> canonical offset-bearing instant validation
  -> ingestion admissibility
  -> monotonic durable storage
  -> per-account freshness classification
  -> decision eligibility or held result
```

Ordinary stale or missing business evidence must not become an infrastructure exception that aborts unrelated account work.

## Runtime generation boundary

Runtime model use is optional and bounded.

Required controls:

- immutable deterministic pre-draft authority;
- minimum authorized context;
- pinned provider/model and versioned prompt;
- strict generated-output schema;
- fixed timeout, token cap, and attempt bound;
- no general tool registry;
- no side-effecting model tools;
- deterministic grounding and guardrails;
- deterministic template fallback or explicit hold;
- durable model and verification telemetry.

Model output remains untrusted until deterministic verification completes.

## Evaluation boundary

Code-based tests and deterministic evals verify machine-checkable authority, state, ordering, schema, security, and replay invariants.

LLM-as-a-judge remains asynchronous. It can be a deployment gate. It cannot alter live authority or certify deterministic behavior that executable tests can prove directly.

## Schema boundary

TypeScript/Zod is the schema source of truth.

```text
packages/shared-schemas/src
  -> pnpm generate:schemas
  -> packages/shared-schemas/generated
  -> apps/api-python/src/schemas/generated
```

Python consumes generated schemas. It does not define a competing runtime contract.

## Framework isolation

Domain policy must remain independent of Vercel Workflow SDK, model providers, and UI frameworks.

Framework adapters call domain functions. Domain functions do not import workflow-specific state as business authority.

## Complexity rule

Use the smallest sufficient mechanism that preserves mandatory invariants. ADR-002 governs harness economics.

Do not add Kafka, another workflow platform, a multi-agent runtime, or a custom process-state machine unless measured requirements prove that the existing architecture is insufficient.

## Repository map

```text
apps/agent-runtime        deterministic decision and bounded drafting runtime
apps/web                  user and operator UI
apps/api-python           isolated Python support service
packages/shared-schemas   canonical schemas and generated artifacts
packages/security         RBAC and approval policy
packages/observability    PII-safe telemetry
packages/testing-evals    deterministic evals and asynchronous judge
supabase                  business persistence, RLS, audit, outbox, delivery ledger
docs/decisions            accepted architecture decisions
docs/design-docs          stable design knowledge
docs/exec-plans           active and completed implementation plans
```

## Related canonical documents

- `docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md`
- `docs/decisions/ADR-003-event-driven-crm-ingestion-and-notifications.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`
- `docs/VERIFICATION.md`
