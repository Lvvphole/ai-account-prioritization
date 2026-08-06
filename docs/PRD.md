# PRD — AI Account Prioritization for B2B Sales Teams

## Governing choice

This product uses a **daily-first batch architecture**.

The system converts an authoritative daily CRM snapshot into a verified, prioritized set of sales actions that the correct representative can inspect, approve, and execute.

The runtime treats every LLM as a capable but untrusted cognitive service.

The authority model is:

- deterministic software owns **Who, When, Where, Why, permissions, resources, budgets, side effects, and completion**;
- the LLM may own bounded **What and How**;
- only deterministic software can return `PASS`, `FAIL`, or `BLOCKED`.

The LLM may select and sequence only allowlisted tools. It may decompose a task and delegate bounded work to subagents. Supervisor and worker roles use the same qualified, pinned production model. Role differences come from the task contract, schema, context, and tool grant.

The LLM cannot expand its own scope, rewrite the supplied goal, grant permissions, increase budgets, authorize side effects, or declare success.

## Problem

B2B sales representatives have more accounts and opportunities than they can actively work. CRM exports contain useful signals, but representatives spend time searching records and deciding what deserves attention.

The application must reduce that search and decision burden without turning model output into customer or opportunity fact.

## Product user story

As a sales representative managing more accounts and opportunities than I can actively work, I want the application to use authoritative CRM data to show me which accounts have controllable leading indicators worth acting on, explain the evidence behind each signal, and help me decide the next sales action, so I can create more qualified pipeline, advance more opportunities, close more business, and generate more revenue without spending my day searching systems.

## Trust clause

The application must distinguish:

- known facts;
- deterministic derivations;
- missing information; and
- model-generated assistance.

AI assumptions must never become customer or opportunity facts.

## Desired state

The desired state is reached only when all conditions below are true at the same time.

### Daily spine is real

An authorized CRM batch can be uploaded, validated, committed to canonical storage, prioritized, optionally enriched by bounded LLM work, persisted, and shown to the correct representative in the live web application.

The production path must not depend on mock recommendations or sample-only persistence.

### Authority remains deterministic

The model never decides:

- account eligibility;
- account rank;
- permissions;
- approval requirements;
- publication eligibility;
- spend authority;
- side-effect authority; or
- completion.

Deterministic software supplies and enforces those values.

### LLM cognitive freedom is bounded and explicit

For a task that permits model work, the LLM may:

- synthesize evidence and characterize the situation;
- produce structured artifacts against a strict schema;
- select and sequence only allowlisted tools;
- select a candidate action or execution path only when the task contract permits it and only inside the supplied action envelope;
- decompose work;
- fan out bounded subagents that use the same pinned production model;
- synthesize worker results; and
- attempt recovery only inside pre-declared limits.

The LLM may not:

- change the goal;
- change the user, tenant, account, or batch scope;
- create new permissions or tools;
- increase token, time, retry, call, concurrency, or delegation limits;
- bypass a required validator;
- approve or execute a protected side effect; or
- declare the task complete.

### Every probabilistic step has an external postcondition contract

Before model execution, software supplies:

- the goal;
- authorized inputs;
- the allowlisted tools;
- the strict output schema;
- deterministic postconditions;
- budgets; and
- the allowed terminal states.

After model execution, software evaluates the postconditions and returns exactly one terminal state: `PASS`, `FAIL`, or `BLOCKED`.

### Human-in-the-loop is mandatory for protected side effects

No customer-facing message or CRM write occurs without explicit human approval of the visible payload.

Approval is bound to the payload that will be sent or written. A model cannot approve its own output.

### Failure is item-scoped and graceful

One recommendation may return `FAIL` or `BLOCKED` without discarding the rest of the daily plan.

Usable recommendations remain available to the representative.

### One pinned production model

One qualified, pinned production model is used for supervisor and worker roles.

The system does not route tasks across models in this version. The exact model identity must be qualified before production enablement and then pinned in runtime configuration and audit evidence.

### Evidence is durable

The system records and makes inspectable, as applicable:

- source and batch identifiers;
- authoritative inputs;
- policy, prompt, schema, tool, and model versions;
- model invocations;
- subagent invocations;
- tool calls and tool results;
- validation results;
- human approvals;
- side-effect results; and
- terminal states.

## Users

- **Representative** — sees the daily ranked account list, supporting evidence, and permitted actions. The representative approves protected actions.
- **Manager** — sees team coverage, held or failed items, and outcome trends.
- **Admin or authorized data operator** — uploads and commits CRM batches and manages product configuration within assigned permissions.

The representative does not need permission to administer ingestion.

## Runtime authority model

### Deterministic software owns Who

Software determines the current tenant, user, role, representative, account set, batch, and resource scope.

### Deterministic software owns When

Software determines the daily processing schedule, evidence freshness policy, timeouts, retry windows, and deadline rules.

### Deterministic software owns Where

Software determines source systems, canonical storage, tool endpoints, execution environments, data destinations, and side-effect destinations.

### Deterministic software owns Why

Software supplies the product goal, policy objectives, eligibility rules, deterministic leading indicators, ranking policy, and reason codes that explain why an account is in the daily work plan.

### The LLM may own bounded What

Within a task contract, the LLM may determine the structured cognitive artifact needed to satisfy the supplied goal. Examples include:

- an evidence synthesis;
- an account situation brief;
- a candidate sales action selected from the supplied action envelope;
- a call plan;
- an email draft;
- a meeting agenda;
- structured extraction from ambiguous text; or
- a proposed remediation artifact.

The output remains candidate data until deterministic postconditions pass.

### The LLM may own bounded How

Within a task contract, the LLM may:

- select an allowlisted tool;
- sequence tool calls;
- write intermediate structured artifacts;
- decompose the task;
- delegate bounded sub-tasks;
- combine worker results; and
- recover from permitted errors.

Software enforces tool, resource, budget, and stop limits at every step.

## Canonical daily workflow

### Phase 1 — Load CRM data

**Goal:** create an authorized daily input batch.

Deterministic software owns upload permission, accepted formats, file limits, batch identity, quarantine location, and tenant scope.

The LLM is optional. It may assist with semantic field mapping only when the task contract allows it. Deterministic schema and mapping rules decide what is accepted.

Phase 1 is complete when the authorized batch is durably staged or explicitly rejected.

### Phase 2 — Validate and prepare canonical data

**Goal:** convert the uploaded batch into trusted canonical CRM state.

Deterministic software owns security checks, parsing limits, schema validation, canonical types, tenancy, duplicate handling, row dispositions, approval, and commit authority.

The LLM may explain ambiguous data, propose bounded mappings, or structure unstructured content. Model output does not make a row authoritative.

Phase 2 is complete when every input row has a deterministic disposition and all accepted records are committed to canonical storage.

### Phase 3 — Prioritize accounts

**Goal:** produce the daily ranked work plan.

Deterministic software owns:

- account eligibility;
- feature and leading-indicator derivation;
- score;
- stable rank;
- confidence or deterministic evidence-quality measures;
- reason codes; and
- source evidence identifiers.

No LLM is required to rank accounts.

Phase 3 is complete when every eligible account has deterministic priority state and the ranked daily book is persisted.

### Phase 4 — Analyze and prepare sales actions

**Goal:** perform bounded cognitive work for selected recommendations.

Software supplies, for each task:

- the account and tenant scope;
- the goal;
- verified evidence;
- deterministic reason codes;
- the allowed action and tool envelope;
- the strict output schema;
- deterministic postconditions;
- token, time, call, retry, concurrency, and delegation budgets; and
- the terminal-state contract.

The pinned production model may act as a supervisor. It may solve the task directly or, when the task contract permits and the budgets allow, delegate bounded work to subagents that use the same pinned model.

A worker receives only the context and tools needed for its sub-task.

The supervisor may synthesize the worker outputs, but it cannot certify them.

Phase 4 is complete for an item only when deterministic software validates all required postconditions and returns `PASS`, `FAIL`, or `BLOCKED`.

### Phase 5 — Review and take action

**Goal:** let the correct representative inspect and act on usable recommendations.

The live web application shows persisted recommendations, evidence, model-assisted artifacts, validation state, and required approvals.

The LLM may answer bounded questions, revise an artifact, or prepare a permitted action inside a task contract.

No customer-facing send or CRM write occurs until the representative explicitly approves the visible payload.

Phase 5 is complete for an item when the permitted action reaches its verified terminal state, or when the item is explicitly held, failed, or blocked.

### Phase 6 — Capture outcome and refresh

**Goal:** record what happened and prepare the next daily cycle.

Deterministic software owns outcome storage, feedback provenance, metric calculations, and the next daily snapshot boundary.

The LLM may perform offline synthesis or classification of feedback when the task contract permits it. It does not change production policy or acceptance state.

Phase 6 is complete when the available outcome or feedback is durably recorded, or the system records that the outcome is not yet known.

## Probabilistic task contract

Every LLM-assisted task must define these fields before execution:

1. `goal`
2. `authorized_inputs`
3. `scope`
4. `allowlisted_tools`
5. `allowed_action_envelope`
6. `strict_output_schema`
7. `deterministic_postconditions`
8. `budgets`
9. `human_approval_requirement`
10. `terminal_states = PASS | FAIL | BLOCKED`

A subagent receives a stricter child contract. A child contract cannot widen the parent contract.

## Definition of Done

Completion is evaluated at three nested levels.

Only the deterministic verifier may return the terminal state.

### A. Task or phase completion

A single LLM-assisted task or phase is complete only when the harness can prove all applicable conditions below:

1. The goal supplied by software is satisfied and was not rewritten.
2. Only authorized inputs from the current batch, tenant, user, and task scope were used.
3. The output parses against the required strict schema.
4. Every factual claim that requires evidence resolves to an allowed source identifier.
5. No deterministically controlled field was modified.
6. Every tool call used an allowlisted tool, valid arguments, and authorized resources.
7. Application-level postconditions on the resulting state hold.
8. Any side effect carried the required permission and explicit human approval.
9. All token, call, time, retry, delegation-depth, and concurrency budgets were respected.
10. Durable evidence of the applicable conditions exists.
11. The deterministic harness returns exactly one of `PASS`, `FAIL`, or `BLOCKED`.

The model's claim of completion has no weight.

### B. Harness-component completion

A harness change is complete only when:

1. the protected behavior and the model's allowed freedom are explicit in a task contract;
2. boundary, context, schema, postcondition, failure-containment, and economic-bound properties are enforced;
3. relevant deterministic regressions pass; and
4. the external verifier returns `PASS`.

Green CI alone is not evidence that a harness change improved whole-system reliability. A reliability-improvement claim requires post-change Harness Fitness measurement under ADR-002.

### C. Whole web-application completion

The web application is complete only when one production-shaped acceptance path succeeds end to end:

```text
Authorized CRM batch
  -> upload and validation succeed
  -> accepted records become canonical facts
  -> daily prioritization produces deterministic ranks and reason codes
  -> Phase 4 bounded LLM work, when required, satisfies its postconditions
  -> verified recommendations are persisted
  -> real recommendations appear in the correct representative's dashboard
  -> the representative can inspect evidence
  -> protected actions require explicit approval of the visible payload
  -> the outcome or feedback is durably recorded
```

Until this path exists and passes, the web application is **NOT DONE**, regardless of harness sophistication.

## Summary statement of completion

The system is done when an authoritative daily CRM batch can be turned into a verified, prioritized, human-controllable sales work plan that is visible and actionable in the live web application, and every probabilistic step executes inside an explicit deterministic contract that only the harness can mark `PASS`, `FAIL`, or `BLOCKED`.

## Failure semantics

Failure is item-scoped unless a system-level invariant requires the full run to stop.

- `PASS` — all required postconditions for the item or task are true.
- `FAIL` — one or more required postconditions are false.
- `BLOCKED` — completion cannot be established because required evidence, authority, dependency, or resource is unavailable.

A failed or blocked recommendation must not erase usable recommendations from the same daily run.

## Model policy

This version uses one qualified, pinned production model for all runtime supervisor and worker roles.

The system must record the model identity for every invocation.

Do not add model routing, automatic model escalation, or a second production model unless a separately admitted change demonstrates that the simpler single-model design is insufficient under ADR-002.

## Success metrics

Commercial success is evaluated longitudinally through:

- qualified pipeline creation;
- opportunity progression;
- closed-won deals; and
- revenue.

These are product outcome measures. They are not per-artifact completion gates.

Short-horizon movement is not causal evidence by itself. Causal attribution requires a defensible comparison design such as randomized rollout, matched cohorts, switchback analysis, or another valid intervention design.

## Current implementation status

The repository contains substantial parts of the daily runtime and web experience, but the whole product is not complete.

Known completion gaps include:

- the production ingestion commit path is not fully wired end to end;
- the web application still has mock-backed recommendation surfaces;
- the durable runtime-to-web recommendation bridge is not complete; and
- bounded supervisor-worker delegation is an approved runtime capability in this specification but is not yet the completed production path.

The current state is therefore **NOT DONE** under the whole web-application completion contract.

## Non-goals for this build

- Real-time or event-driven CRM ingestion is not required.
- A general-purpose autonomous agent platform is not required.
- Model routing is not required.
- The model does not own ranking, eligibility, permissions, approval, publication, budgets, side effects, or completion.
- The model does not send customer messages or write to the CRM without explicit human approval.
- The product does not claim byte-identical model prose across provider calls.
