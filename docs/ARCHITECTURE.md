# Architecture

## Governing architecture

AI Account Prioritization is a **daily-first, batch-oriented hybrid AI application**.

The application treats the LLM as a capable but untrusted cognitive service.

The authority split is:

```text
Deterministic software
  owns Who + When + Where + Why
  owns scope + permissions + resources + tool allowlists + budgets
  owns deterministic postconditions
  owns protected side-effect authorization
  owns verification + publication authority + completion

LLM
  may own bounded What + How
  may perform bounded semantic interpretation
  may select a candidate action from a supplied action envelope
  may select and sequence allowlisted tools
  may decompose work
  may delegate bounded sub-tasks
  may synthesize worker results
  may attempt bounded recovery

Deterministic verifier
  alone returns PASS | FAIL | BLOCKED

Human
  explicitly approves protected customer-facing or CRM side effects
```

This is the approved Position B target architecture.

The model can make choices only inside a software-supplied authority envelope. It cannot widen its goal, scope, actions, tools, resources, permissions, budgets, side-effect authority, publication authority, or completion authority.

## Approved target versus current implementation

The full Position B surface is approved target architecture. It is not the required implementation scope of the current production spine.

The current runtime remains narrower:

- account eligibility is deterministic;
- feature derivation is deterministic;
- score and stable rank are deterministic;
- confidence or evidence-quality policy is deterministic;
- reason codes and source evidence are deterministic;
- next-best-action type is deterministic;
- the runtime model performs bounded drafting and synthesis only; and
- deterministic fallback or hold preserves correctness when model work is disabled, unavailable, or rejected.

Candidate-action selection, general tool orchestration, and supervisor-worker fan-out are approved target capabilities but are not implemented in the current production spine.

No statement of target architecture authorizes implementation beyond the current production-spine scope without a new explicit ruling.

## P4 — Provider-Neutral Model Boundary, Variance Control, and Qualification

### Current production-spine implementation scope

P4 is optional. The complete daily path must remain operable with the deterministic fallback when the model is disabled, unavailable, or fails verification.

Authorized P4 v1 work is limited to:

1. Refactor `RuntimeModelClient` into a provider-neutral boundary.
2. Remove Anthropic-specific types from the common policy.
3. Support provider-native constrained output, including Structured Outputs or `output_config.format` when supported.
4. Normalize reasoning or effort configuration without claiming that providers expose identical controls.
5. Remove hard-coded `temperature: 0` from Claude-5-compatible requests.
6. Preserve full prompt, schema, policy, and model identity in audit evidence.
7. Build offline cross-model k-run qualification.
8. Admit only one qualified production configuration at a time.
9. Keep deterministic template fallback or hold as the fail-safe.
10. Prove both production acceptance profiles defined below.

Explicitly deferred from the current production spine:

- model-controlled candidate-action selection;
- a capability resolver driven by model-selected What;
- general tool orchestration, workflows, or side-effecting model tools;
- supervisor-worker fan-out or subagent delegation;
- multi-model routing or majority voting;
- a second action ontology beyond the current deterministic set; and
- production caching infrastructure.

These capabilities remain approved under the target architecture. A later implementation requires a new explicit ruling and the applicable ADR-002 admission evidence.

### P4 production acceptance profiles

**Acceptance A — deterministic baseline:** AI is disabled. The production-shaped daily spine must pass end to end with deterministic behavior and approved fallback semantics.

**Acceptance B — qualified model:** the same spine runs with the single qualified production model configuration. Model success or safe fallback must never alter tenant, owner, account, eligibility, score, rank, confidence, reason codes, source evidence, next-best-action type, permissions, approval state, publication authority, side-effect authority, or completion authority.

## Product runtime goal

The system converts one authoritative daily CRM snapshot into a verified, prioritized set of sales actions that the correct representative can inspect, approve, and execute.

Every probabilistic step remains inside a deterministic authority envelope and an explicit task contract.

The system is not complete until the production path connects CRM ingestion, canonical storage, daily prioritization, optional bounded P4 work, durable recommendation persistence, the live representative dashboard, protected action approval, and durable outcome or feedback capture.

## Architectural principles

1. Use batch-first processing for the current production spine.
2. Keep authoritative CRM facts in deterministic storage.
3. Keep account eligibility and ranking deterministic.
4. Give the LLM the minimum authorized context required for one task.
5. Permit the LLM to choose bounded What and How only inside an explicit task contract.
6. Permit only software-supplied actions, tools, resources, and budgets.
7. Permit subagent delegation only when separately admitted and inside externally enforced limits.
8. Use one qualified, pinned production model configuration at a time.
9. When supervisor-worker execution is admitted, use the same qualified model for supervisor and worker roles.
10. Require deterministic validation after every probabilistic task.
11. Require explicit human approval before customer-facing sends or CRM writes.
12. Keep failures item-scoped when a system-level invariant does not require a full stop.
13. Record durable evidence for every material model, tool, approval, validation, and terminal-state decision that exists in the implemented path.
14. Use the minimum sufficient harness defined by ADR-002.
15. Keep approved target architecture separate from current implementation authorization.

## Minimum-sufficient harness doctrine

`docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md` is authoritative for harness-economics semantics.

This architecture applies that doctrine as follows:

```text
mandatory invariant
  -> keep the invariant
  -> use the smallest sufficient implementation

discretionary or substitutable implementation
  -> add only when evidence shows that the simpler design is insufficient
```

Position B capabilities are approved product capabilities. ADR-002 does not prohibit their existence. It governs when a current implementation should pay the cost to use them.

A single model call remains preferred when it can satisfy the task contract. Fan-out is used only after explicit implementation authorization, when the task contract permits it, and when the additional mechanism satisfies ADR-002.

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
- deadlines;
- spend-producing continuation bounds; and
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

A model may interpret these inputs when the task contract permits it. It cannot rewrite the goal or policy.

### What — bounded probabilistic

When the task contract and current implementation scope permit it, the LLM may create or select a candidate cognitive artifact inside the supplied envelope.

Target-architecture examples include:

- evidence synthesis;
- situation characterization;
- structured extraction;
- semantic field-mapping proposals;
- candidate sales action from an allowed action set;
- call plan;
- email draft;
- meeting agenda;
- remediation proposal; and
- worker-task decomposition.

The artifact remains untrusted until deterministic postconditions pass.

In the current production spine, next-best-action selection remains deterministic. Model-controlled candidate-action selection is deferred.

### How — bounded probabilistic

When the task contract and current implementation scope permit it, the LLM may:

- choose an allowlisted tool;
- sequence tool calls;
- create intermediate structured artifacts;
- decompose a task;
- fan out bounded workers;
- synthesize worker outputs; and
- attempt bounded recovery.

Software validates every admitted tool request and enforces all resources, permissions, budgets, and stop conditions.

General tool orchestration and supervisor-worker fan-out are target capabilities. They are deferred from current P4.

### Completion — deterministic

The model cannot declare a task complete.

Only the deterministic verifier can return:

- `PASS`;
- `FAIL`; or
- `BLOCKED`.

## Probabilistic task contract

Every LLM-assisted task must receive an explicit contract before execution.

The target contract contains:

```text
goal
scope
  tenant
  user
  batch
  account or item

authorized inputs
allowlisted tools
allowed resources
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

`allowed resources` is always explicit. Use an empty grant when no resources are authorized.

A field that does not apply to the current implementation remains empty or constrained by policy. The model cannot infer omitted authority.

When delegation is implemented, a child subagent contract must be equal to or narrower than the parent contract. A child cannot inherit an omitted tool or resource by inference.

## Single qualified production configuration

Only one qualified, pinned production model configuration is active at a time in the current version.

The exact model identity and effective provider configuration are production configuration values. They must be qualified before enablement and recorded with every invocation.

The current P4 qualification process can evaluate multiple model configurations offline. It does not authorize multi-model routing or simultaneous production voting.

When supervisor-worker execution is later admitted, supervisor and worker behavior will differ through:

- task contract;
- prompt;
- strict schema;
- context;
- allowlisted tools; and
- budgets.

The application does not use production model routing, automatic model escalation, or majority voting in the current spine.

## Daily product spine

```text
Phase 1: Load CRM data
  -> Phase 2: Validate and prepare canonical data
  -> Phase 3: Prioritize accounts
  -> Phase 4: Analyze and prepare sales actions
  -> Phase 5: Review and take action
  -> Phase 6: Capture outcome and refresh
```

The current path is batch-first. Real-time or event-driven ingestion is deferred.

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

### Target optional model responsibilities

The approved target permits bounded semantic field mapping when a task contract allows it.

Model suggestions cannot make data authoritative. Source authentication, quarantine, schema enforcement, row disposition, and canonical commit remain deterministic.

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

### Target optional model responsibilities

The approved target may allow the LLM to:

- interpret ambiguous text;
- propose a mapping from the allowed schema;
- structure unstructured content; and
- explain findings.

The deterministic validator decides whether the result is admissible. Model output does not make a row authoritative.

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

No LLM is authorized to rank accounts.

### Completion

Every eligible account has deterministic priority state and the full ranked book is durably persisted.

Identical authoritative input, policy, clock, and code revision must produce the same deterministic ranking state.

## Phase 4 — Analyze and prepare sales actions

### Purpose

Perform bounded cognitive work that is useful after deterministic prioritization.

### Target architecture

For each selected account, software constructs the task contract and supplies:

- account scope;
- goal;
- verified evidence;
- deterministic reason codes;
- allowed action envelope;
- allowlisted tools;
- allowed resources;
- output schema;
- postconditions;
- budgets; and
- human approval requirement.

The approved target permits the pinned model to:

- solve a task directly;
- synthesize evidence;
- characterize the sales situation;
- select a candidate action when the task contract permits it;
- choose and sequence allowlisted tools;
- create a structured action artifact;
- decompose work;
- fan out bounded workers;
- synthesize worker outputs; and
- attempt recovery inside supplied limits.

When delegation is admitted, all workers use the same qualified, pinned production model configuration.

### Target supervisor-worker pattern

```text
verified task envelope
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

### Current production-spine P4

The current P4 path does not implement candidate-action selection, general tool orchestration, or supervisor-worker fan-out.

It is limited to the ten P4 v1 items defined above. Current next-best-action type remains deterministic. The model performs bounded drafting or synthesis after deterministic prioritization, with deterministic fallback or hold.

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

### Target model responsibilities

Inside a separately authorized task contract, the target architecture may allow the LLM to:

- explain a recommendation;
- answer bounded questions;
- revise an action artifact;
- prepare call notes;
- prepare an email;
- prepare a meeting agenda; or
- use allowlisted tools to complete permitted preparatory work.

The current production spine does not grant general or side-effecting tool orchestration to the model.

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

The LLM may perform bounded offline synthesis or classification of feedback when a separately authorized task contract permits it.

It cannot change acceptance state, production policy, or authoritative outcomes.

### Completion

The available outcome or feedback is durably recorded, or the system explicitly records that the outcome is not known.

## Tool boundary

The approved target permits model tool use only through an allowlist supplied by deterministic software.

For every admitted tool call, software validates:

- tool identity;
- argument schema;
- tenant and user scope;
- resource identifiers;
- permissions;
- call budget;
- time budget; and
- side-effect class.

A model cannot add a tool or construct new resource authority by naming it.

Protected side-effect tools require explicit human approval after the final payload is visible.

General tool orchestration and side-effecting model tools remain deferred from current P4.

## Context boundary

Each task receives the minimum sufficient authorized context for its goal.

Do not load the full CRM batch into a model when an account-scoped packet is sufficient.

When workers are admitted, do not give a worker the supervisor's full context by default.

Model-visible context must distinguish:

- authoritative facts;
- deterministic derivations;
- missing values;
- untrusted source text; and
- model-generated candidate content.

## Schema and grounding boundary

Every required model artifact uses a strict schema.

Use provider-native constrained output when the provider and qualified configuration support it. Do not assume all providers expose identical structured-output controls.

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

The model may prepare a candidate payload when the task contract permits it.

The user must see and explicitly approve the final payload before execution.

Deterministic software then verifies the write or send result and records evidence.

## Evidence boundary

Durable evidence must include, as applicable to the implemented path:

- batch, tenant, user, run, recommendation, and task identifiers;
- source references;
- deterministic policy and schema versions;
- full prompt identity and hash;
- model identity and effective provider configuration;
- model invocation metadata;
- worker invocation metadata when delegation is implemented;
- tool calls and tool results when tool use is implemented;
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
5. software-owned authority fields remain protected;
6. tool calls, when implemented, were allowlisted and authorized;
7. application-level postconditions hold;
8. protected side effects have permission and explicit human approval;
9. all applicable budgets were respected;
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
- applicable token, latency, call, retry, delegation, and concurrency limits are enforced;
- relevant deterministic regressions pass; and
- the external verifier returns `PASS`.

A claim that the harness improved reliability requires post-change Harness Fitness measurement under ADR-002. Green CI alone is not sufficient for that claim.

### C. Whole web-application completion

The product is complete only when the production-shaped spine proves:

```text
Authorized CRM batch
  -> upload
  -> validation
  -> canonical commit
  -> deterministic daily prioritization
  -> optional bounded P4 drafting/synthesis or safe fallback/hold
  -> deterministic postconditions
  -> persisted verified recommendations
  -> correct representative sees real recommendations in the live dashboard
  -> representative can inspect evidence
  -> protected action requires explicit approval
  -> action result, outcome, or feedback is durably recorded
```

The acceptance path must pass with AI disabled and under the single qualified-model profile defined by P4.

Until this path exists and passes, the web application is `NOT_DONE`.

## Current repository status

The repository does not yet satisfy the whole web-application completion contract.

The current product has substantial deterministic prioritization, deterministic next-best-action selection, bounded runtime drafting, verification, security, observability, and web UI capability.

The remaining production-spine gaps include:

- a fully wired production ingestion commit path;
- durable runtime-to-web recommendation persistence and retrieval;
- removal of mock recommendation dependence from the live representative path;
- completion of P4 provider-neutral boundary and qualification work; and
- one production-shaped end-to-end acceptance path that covers the daily spine.

The following approved target capabilities are not current-spine implementation gaps because they are explicitly deferred: candidate-action selection, general tool orchestration, supervisor-worker fan-out, multi-model routing or voting, a second action ontology, and production caching.

This specification does not represent deferred target capabilities or current product-spine gaps as completed.

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

Given the same authoritative CRM snapshot, policy, configuration, injected clock, and code revision, the current production spine must reproduce:

- eligibility;
- deterministic features;
- leading indicators;
- score;
- rank;
- confidence or deterministic evidence-quality output;
- reason codes;
- source evidence identifiers; and
- next-best-action type.

The target architecture may later permit probabilistic candidate-action selection only after a separately authorized implementation change. That future candidate choice does not change deterministic ownership of the allowed action envelope or final authority gates.

### Task-verifier determinism

Given the same task contract, candidate output, tool results, approvals, postcondition policies, clock, and code revision, the task verifier must return the same validation results and terminal state.

### Generation reliability

Generated wording and reasoning are not claimed to be byte-identical.

The production configuration is pinned and qualified to reduce drift. Correctness is enforced through authority boundaries and external postconditions, not through a claim of deterministic generation.

## Evaluation and qualification boundary

Deterministic tests own properties that have deterministic oracles.

Probabilistic evaluators may assess residual semantic quality only when a reliable deterministic oracle does not exist.

An LLM evaluator cannot override a deterministic `FAIL` or `BLOCKED` result and cannot authorize live publication.

P4 qualification evaluates model configurations offline with repeated k-runs. Qualification can compare providers and configurations, but production admits only one qualified configuration at a time.

Do not claim a provider control is equivalent to another provider's control merely because both have similar labels.

## Rollout order

Use the production spine as the priority order for current work:

1. complete the production ingestion commit path;
2. connect canonical data to the daily runtime;
3. persist runtime recommendations durably;
4. connect the live dashboard to persisted runtime recommendations and remove mocks from the production path;
5. complete only the authorized P4 v1 provider-neutral boundary, constrained-output, qualification, audit, fallback, and acceptance-profile work;
6. complete protected side-effect approval and result evidence;
7. complete durable feedback and outcome capture; and
8. add one production-shaped end-to-end acceptance path for the complete daily spine.

Do not implement deferred Position B capabilities as part of this rollout without a new explicit ruling and ADR-002 admission.

Do not add real-time ingestion, multi-model routing, majority voting, production caching, or a general autonomous control plane to finish the current spine.
