# Architecture

## Governing architecture

AI Account Prioritization is a **daily-first, batch-oriented hybrid AI application**.

The application treats the LLM as a capable but untrusted cognitive service.

The authority split is:

```text
Deterministic software
  owns Who + When + Where + Why
  owns permissions + resources + budgets
  owns side effects + completion

LLM
  may own bounded What + How
  may select and sequence allowlisted tools
  may decompose work
  may delegate bounded sub-tasks

Deterministic verifier
  alone returns PASS | FAIL | BLOCKED
```

This authority model is the governing runtime choice.

## Product runtime goal

The system converts one authoritative daily CRM snapshot into a verified, prioritized set of sales actions that the correct representative can inspect, approve, and execute.

Every probabilistic step remains inside a deterministic contract.

The system is not complete until the production path connects CRM ingestion, canonical storage, daily prioritization, bounded LLM work, durable recommendation persistence, the live representative dashboard, protected action approval, and durable outcome or feedback capture.

## Architectural principles

1. Use batch-first processing for this build.
2. Keep authoritative CRM facts in deterministic storage.
3. Keep eligibility and ranking deterministic.
4. Give the LLM the minimum context required for one task.
5. Permit the LLM to choose bounded What and How only inside an explicit task contract.
6. Permit only allowlisted tools and resources.
7. Permit subagent delegation only inside externally enforced limits.
8. Use one qualified, pinned production model for supervisor and worker roles.
9. Require deterministic validation after every probabilistic task.
10. Require explicit human approval before customer-facing sends or CRM writes.
11. Keep failures item-scoped when a system-level invariant does not require a full stop.
12. Record durable evidence for every material model, tool, approval, validation, and terminal-state decision.
13. Use the minimum sufficient harness defined by ADR-002.

## Minimum-sufficient harness doctrine

`docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md` is authoritative for harness-economics semantics.

This architecture applies that doctrine as follows:

```text
mandatory invariant
  -> keep the invariant
  -> use the smallest sufficient implementation

discretionary capability
  -> add only when evidence shows that the simpler design is insufficient
```

Subagent delegation is permitted by the runtime authority model. It is not mandatory for every task.

A single model call remains preferred when it can satisfy the task contract. Fan-out is used only when the task contract permits it and the externally enforced budget allows it.

## Authority model

### Who — deterministic

Software determines:

- tenant;
- authenticated user;
- role;
- representative;
- account set;
- batch;
- task subject; and
- resource scope.

A model cannot widen these values.

### When — deterministic

Software determines:

- daily processing schedule;
- batch cutoff;
- evidence freshness policy;
- timeouts;
- retry windows;
- deadlines; and
- terminal stop conditions.

### Where — deterministic

Software determines:

- source systems;
- canonical persistence;
- tool endpoints;
- execution environments;
- allowed resource identifiers;
- action destinations; and
- side-effect destinations.

### Why — deterministic

Software supplies:

- the product objective;
- task goal;
- eligibility policy;
- deterministic leading indicators;
- ranking policy;
- reason codes; and
- mandatory acceptance predicates.

A model may interpret these inputs. It cannot rewrite the goal or policy.

### What — bounded probabilistic

When the task contract permits it, the LLM may create or select a candidate cognitive artifact inside the supplied envelope.

Examples:

- evidence synthesis;
- situation characterization;
- structured extraction;
- candidate sales action from an allowed action set;
- call plan;
- email draft;
- meeting agenda;
- remediation proposal; and
- worker-task decomposition.

The artifact remains untrusted until deterministic postconditions pass.

### How — bounded probabilistic

When the task contract permits it, the LLM may:

- choose an allowlisted tool;
- sequence tool calls;
- create intermediate structured artifacts;
- decompose a task;
- fan out bounded workers;
- synthesize worker outputs; and
- attempt bounded recovery.

Software validates every tool request and enforces all budgets.

### Completion — deterministic

The model cannot declare a task complete.

Only the deterministic verifier can return:

- `PASS`;
- `FAIL`; or
- `BLOCKED`.

## Probabilistic task contract

Every LLM-assisted task must receive an explicit contract before execution.

The contract contains:

```text
goal
scope
  tenant
  user
  batch
  account or item

authorized inputs
allowlisted tools
allowed action envelope
strict output schema
deterministic postconditions
budgets
  input tokens
  output tokens
  total run tokens
  calls
  time
  retries
  delegation depth
  worker count
  concurrency
human approval requirement
terminal states = PASS | FAIL | BLOCKED
```

A child subagent contract must be equal to or narrower than the parent contract.

A child cannot inherit an omitted tool or resource by inference.

## Single pinned production model

One qualified, pinned production model is used for all runtime supervisor and worker roles in this version.

The exact model identity is a production configuration value. It must be qualified before enablement and recorded with every invocation.

Supervisor and worker behavior differs through:

- task contract;
- prompt;
- strict schema;
- context;
- allowlisted tools; and
- budgets.

The application does not use model routing or automatic model escalation in this version.

A second production model requires a separately admitted architectural change under ADR-002.

## Daily product spine

```text
Phase 1: Load CRM data
  -> Phase 2: Validate and prepare canonical data
  -> Phase 3: Prioritize accounts
  -> Phase 4: Analyze and prepare sales actions
  -> Phase 5: Review and take action
  -> Phase 6: Capture outcome and refresh
```

The path is batch-first. Real-time or event-driven ingestion is deferred.

## Phase 1 — Load CRM data

### Purpose

Create one authorized daily CRM input batch.

### Deterministic responsibilities

- authorize the uploader;
- select the tenant;
- select the import type;
- enforce file and row limits;
- create the batch identity;
- choose the quarantine path; and
- persist upload evidence.

### Optional model responsibilities

The LLM may assist with semantic field mapping when the task contract permits it.

Model suggestions cannot make data authoritative.

### Completion

Phase 1 returns success only when the batch is durably staged with the correct tenant and batch identity.

An explicit rejection is a valid terminal result for the upload attempt, but it does not advance the batch to Phase 2.

## Phase 2 — Validate and prepare canonical data

### Purpose

Convert the batch into trusted canonical CRM state.

### Deterministic responsibilities

- security scan;
- bounded parsing;
- schema validation;
- canonical type conversion;
- tenant checks;
- duplicate handling;
- row disposition;
- change-set calculation;
- approval requirements; and
- canonical commit.

### Optional model responsibilities

The LLM may:

- interpret ambiguous text;
- propose a mapping from the allowed schema;
- structure unstructured content; and
- explain findings.

The deterministic validator decides whether the result is admissible.

### Completion

Every source row has a deterministic disposition and all accepted records are committed to canonical storage.

## Phase 3 — Prioritize accounts

### Purpose

Create the representative's deterministic daily work order.

### Deterministic responsibilities

- account eligibility;
- feature derivation;
- controllable leading indicators;
- priority score;
- stable rank;
- evidence-quality or confidence policy;
- reason codes; and
- source evidence identifiers.

### Model responsibilities

No LLM is required for ranking.

### Completion

Every eligible account has deterministic priority state and the full ranked book is durably persisted.

Identical authoritative input, policy, clock, and code revision must produce the same deterministic ranking state.

## Phase 4 — Analyze and prepare sales actions

### Purpose

Perform the bounded cognitive work that is useful after deterministic prioritization.

### Deterministic responsibilities

For each selected account, software constructs the task contract and supplies:

- account scope;
- goal;
- verified evidence;
- deterministic reason codes;
- allowed action envelope;
- allowlisted tools;
- output schema;
- postconditions;
- budgets; and
- human approval requirement.

### Model responsibilities

The pinned model may act as a supervisor.

The supervisor may:

- solve the task directly;
- synthesize evidence;
- characterize the sales situation;
- select a candidate action when the contract permits it;
- choose and sequence allowlisted tools;
- create a structured action artifact;
- decompose work;
- fan out bounded workers;
- synthesize worker outputs; and
- attempt recovery inside the supplied limits.

All workers use the same pinned production model.

### Supervisor-worker pattern

```text
verified account envelope
  -> supervisor
       -> direct solution
       OR
       -> bounded worker task A
       -> bounded worker task B
       -> bounded worker task N
  -> supervisor synthesis
  -> deterministic validation
  -> PASS | FAIL | BLOCKED
```

Fan-out does not grant additional authority. Each worker receives a narrower child contract.

### Item-scoped failure

A failed or blocked recommendation does not invalidate unrelated recommendations.

Only a system-level failure, such as loss of tenant isolation or canonical data integrity, may stop the full run.

### Completion

Phase 4 is complete for an item only when deterministic postconditions have been evaluated and the external verifier returns `PASS`, `FAIL`, or `BLOCKED`.

## Phase 5 — Review and take action

### Purpose

Expose the real persisted daily plan to the correct representative and support human-controlled execution.

### Deterministic responsibilities

- authenticate the representative;
- authorize account access;
- load persisted recommendations;
- show evidence and terminal state;
- enforce side-effect permissions;
- bind approval to the visible payload; and
- verify the result of a protected side effect.

### Model responsibilities

The LLM may, inside a task contract:

- explain a recommendation;
- answer bounded questions;
- revise an action artifact;
- prepare call notes;
- prepare an email;
- prepare a meeting agenda; or
- use allowlisted tools to complete non-protected preparatory work.

### Human approval boundary

No customer-facing message or CRM write occurs without explicit human approval of the visible payload.

A previous approval does not authorize a different payload.

### Completion

The item reaches its verified action terminal state, or the system records `FAIL` or `BLOCKED` without hiding other usable items.

## Phase 6 — Capture outcome and refresh

### Purpose

Record what happened and create durable input for later evaluation and the next daily batch.

### Deterministic responsibilities

- persist feedback;
- persist known outcomes;
- preserve provenance;
- compute product metrics from authoritative records; and
- establish the next daily snapshot boundary.

### Optional model responsibilities

The LLM may perform bounded offline synthesis or classification of feedback.

It cannot change acceptance state, production policy, or authoritative outcomes.

### Completion

The available outcome or feedback is durably recorded, or the system explicitly records that the outcome is not known.

## Tool boundary

Tool use is permitted only through an allowlist supplied by deterministic software.

For every tool call, software validates:

- tool identity;
- argument schema;
- tenant and user scope;
- resource identifiers;
- permissions;
- call budget;
- time budget; and
- side-effect class.

A model cannot add a tool or construct new resource authority by naming it.

Protected side-effect tools require human approval after the final payload is visible.

## Context boundary

Each task receives the minimum sufficient context for its goal.

Do not load the full CRM batch into a model when an account-scoped packet is sufficient.

Do not give a worker the supervisor's full context by default.

Model-visible context must distinguish:

- authoritative facts;
- deterministic derivations;
- missing values;
- untrusted source text; and
- model-generated candidate content.

## Schema and grounding boundary

Every required model artifact uses a strict schema.

Unknown fields are rejected unless the task schema explicitly allows them.

A factual claim that requires source support must reference an allowed source identifier.

The deterministic verifier confirms that the source exists, belongs to the current scope, and supports the claim.

## Budget boundary

Software sets and enforces all budgets.

A model cannot increase:

- token limits;
- model-call limits;
- tool-call limits;
- time limits;
- retry limits;
- delegation depth;
- worker count; or
- concurrency.

A continuation decision that would exceed a budget returns `BLOCKED` or the task-specific bounded fallback state.

## Side-effect boundary

Customer-facing messages and CRM mutations are protected side effects.

The model may prepare a candidate payload.

The user must see and explicitly approve the final payload before execution.

Deterministic software then verifies the write or send result and records evidence.

## Evidence boundary

Durable evidence must include, as applicable:

- batch, tenant, user, run, recommendation, and task identifiers;
- source references;
- deterministic policy and schema versions;
- prompt and model identity;
- model invocation metadata;
- worker invocation metadata;
- tool calls and tool results;
- validation outcomes;
- approvals;
- side-effect results; and
- final `PASS`, `FAIL`, or `BLOCKED` state.

Model narration is not evidence of completion.

## Completion architecture

Completion has three nested levels.

### A. Runtime task or phase completion

A task is complete only when deterministic software proves all applicable postconditions:

1. the software-supplied goal was not rewritten and is satisfied;
2. only authorized inputs were used;
3. the strict schema is valid;
4. required factual claims are grounded;
5. deterministic fields remain unchanged;
6. tool calls were allowlisted and authorized;
7. application-level postconditions hold;
8. protected side effects have permission and explicit human approval;
9. all budgets were respected;
10. durable evidence exists; and
11. the verifier returns `PASS`, `FAIL`, or `BLOCKED`.

The model cannot self-certify.

### B. Harness-component completion

A harness component is complete only when:

- its protected behavior is explicit;
- the model's allowed freedom is explicit;
- context and authority boundaries are enforced;
- schema and postconditions are enforced;
- failure is contained;
- token, latency, call, retry, delegation, and concurrency limits are enforced;
- relevant deterministic regressions pass; and
- the external verifier returns `PASS`.

A claim that the harness improved reliability requires post-change Harness Fitness measurement under ADR-002. Green CI alone is not sufficient for that claim.

### C. Whole web-application completion

The product is complete only when one production-shaped acceptance path proves:

```text
Authorized CRM batch
  -> upload
  -> validation
  -> canonical commit
  -> deterministic daily prioritization
  -> bounded Phase 4 LLM work when required
  -> deterministic postconditions
  -> persisted verified recommendations
  -> correct representative sees real recommendations in the live dashboard
  -> representative can inspect evidence
  -> protected action requires explicit approval
  -> action result, outcome, or feedback is durably recorded
```

Until this path exists and passes, the web application is `NOT DONE`.

## Current repository status

The repository does not yet satisfy the whole web-application completion contract.

The current product has substantial deterministic prioritization, bounded runtime drafting, verification, security, observability, and web UI capability.

The remaining product-spine gaps include:

- a fully wired production ingestion commit path;
- durable runtime-to-web recommendation persistence and retrieval;
- removal of mock recommendation dependence from the live representative path;
- the Phase 4 bounded supervisor-worker implementation; and
- one production-shaped end-to-end acceptance path that covers the daily spine.

This specification does not represent those gaps as completed.

## Monorepo layout

```text
apps/agent-runtime       Daily runtime and bounded LLM execution
apps/web                 Representative, manager, account, and admin web UI
apps/api-python          Isolated support service
packages/shared-schemas  TypeScript/Zod schema source of truth
packages/security        RBAC, approval, and security policy
packages/observability   PII-safe operational evidence and telemetry
packages/testing-evals   Deterministic and probabilistic evaluation support
packages/config-*        Shared configuration
supabase/                Canonical persistence, RLS, audit, and observability
```

## Determinism guarantees

### Daily authority determinism

Given the same authoritative CRM snapshot, policy, configuration, injected clock, and code revision, the following values must be reproducible:

- eligibility;
- deterministic features;
- leading indicators;
- score;
- rank;
- reason codes; and
- source evidence identifiers.

### Task-verifier determinism

Given the same task contract, candidate output, tool results, approvals, postcondition policies, clock, and code revision, the task verifier must return the same validation results and terminal state.

### Generation reliability

Generated wording and reasoning are not claimed to be byte-identical.

The production model is pinned and qualified to reduce drift. Correctness is enforced through contract boundaries and external postconditions, not through a claim of deterministic generation.

## Evaluation boundary

Deterministic tests own properties that have deterministic oracles.

Probabilistic evaluators may assess residual semantic quality only when a reliable deterministic oracle does not exist.

An LLM evaluator cannot override a deterministic `FAIL` or `BLOCKED` result and cannot authorize live publication.

## Rollout order

Use the product spine as the priority order for further work:

1. complete the production ingestion commit path;
2. connect canonical data to the daily runtime;
3. persist runtime recommendations durably;
4. connect the live dashboard to persisted runtime recommendations and remove mocks from the production path;
5. implement the bounded Phase 4 supervisor-worker capability with one pinned model;
6. enforce the probabilistic task contract, tool grants, subagent limits, and postconditions;
7. complete protected side-effect approval and result evidence;
8. complete durable feedback and outcome capture; and
9. add one production-shaped end-to-end acceptance path for the complete daily spine.

Do not add real-time ingestion, model routing, or a general autonomous control plane to finish this build.
