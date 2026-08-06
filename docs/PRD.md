# PRD — AI Account Prioritization for B2B Sales Teams

## Governing choice

This product uses a **daily-first batch architecture**.

The system converts an authoritative daily CRM snapshot into a verified, prioritized set of sales actions that the correct representative can inspect, approve, and execute.

The runtime treats every LLM as a capable but untrusted cognitive service.

The authority model is:

- deterministic software owns **Who, When, Where, Why, scope, permissions, resources, tool allowlists, budgets, deterministic postconditions, protected side-effect authorization, verification, publication authority, and completion**;
- the LLM may own bounded **What and How** inside an explicit task contract; and
- only deterministic software can return `PASS`, `FAIL`, or `BLOCKED`.

The LLM may select and sequence only allowlisted tools. It may decompose a task and delegate bounded work to subagents. Supervisor and worker roles use the same qualified, pinned production model. Role differences come from the task contract, schema, context, and tool grant.

The LLM cannot expand its own scope, rewrite the supplied goal, create tools or permissions, increase budgets, bypass required validation, authorize protected side effects, publish, or declare success.

## Approved target architecture versus current implementation

The full Position B architecture is the approved target architecture. It permits:

- bounded What and How;
- bounded semantic interpretation and mapping proposals during ingestion;
- candidate-action selection inside a software-supplied action envelope;
- allowlisted tool selection and sequencing;
- task decomposition;
- bounded supervisor-worker execution and subagent delegation;
- worker-result synthesis; and
- bounded recovery.

Target-architecture approval is not implementation authorization.

The current production spine remains narrower. Account eligibility, score, rank, confidence, reason codes, source evidence, and next-best-action type remain deterministic in the current implementation. The current runtime model is limited to bounded drafting and synthesis until a separately approved implementation change admits a wider Position B capability.

### P4 — Provider-Neutral Model Boundary, Variance Control, and Qualification

#### Implementation scope for the current production spine

P4 is optional. The application must be able to complete the daily path with the deterministic fallback when the model is disabled, unavailable, or fails verification.

Authorized current-spine P4 work is limited to:

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

The following capabilities remain explicitly deferred from the current production spine:

- model-controlled candidate-action selection;
- a capability resolver driven by model-selected What;
- general tool orchestration, workflows, or side-effecting model tools;
- supervisor-worker fan-out or subagent delegation;
- multi-model routing or majority voting;
- a second action ontology beyond the current deterministic set; and
- production caching infrastructure.

These deferred capabilities remain approved under the target architecture. A later implementation requires a new explicit ruling and the applicable ADR-002 admission evidence. No authority-document update can be interpreted as authorization to expand P4 beyond this scope.

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

The model never decides or expands:

- account eligibility;
- account rank;
- tenant, user, account, or batch scope;
- permissions;
- available tools or resources;
- budgets;
- approval requirements;
- publication eligibility;
- spend authority;
- protected side-effect authority; or
- completion.

Deterministic software supplies and enforces those values.

The target architecture can permit a model to select a candidate action inside a supplied action envelope. This candidate choice does not grant action authority. In the current production spine, next-best-action selection remains deterministic.

### LLM cognitive freedom is bounded and explicit

For a task that permits model work, the target architecture may let the LLM:

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
- create new permissions, tools, resources, or action classes;
- increase token, time, retry, call, concurrency, or delegation limits;
- bypass a required validator;
- approve or execute an unapproved protected side effect;
- authorize publication; or
- declare the task complete.

### Every probabilistic step has an external postcondition contract

Before model execution, software supplies:

- the goal;
- authorized inputs;
- the allowlisted tools;
- the allowed resources;
- the allowed action envelope;
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

### One pinned production configuration

Only one qualified production model configuration is active at a time.

The approved target can use the same qualified, pinned model for supervisor and worker roles when supervisor-worker execution is later admitted. The current P4 implementation does not add supervisor-worker fan-out.

The system does not route tasks across production models in this version. Model identity and effective configuration must be qualified before production enablement and recorded in audit evidence.

### Evidence is durable

The system records and makes inspectable, as applicable:

- source and batch identifiers;
- authoritative inputs;
- policy, prompt, schema, tool, task-contract, and model versions;
- model invocations;
- subagent invocations when delegation is implemented;
- tool calls and tool results when tool use is implemented;
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

Software determines the daily processing schedule, evidence freshness policy, timeouts, retry windows, deadline rules, and externally enforced continuation limits.

### Deterministic software owns Where

Software determines source systems, canonical storage, tool endpoints, execution environments, data destinations, resource identifiers, and side-effect destinations.

### Deterministic software owns Why

Software supplies the product goal, policy objectives, eligibility rules, deterministic leading indicators, ranking policy, reason codes, and mandatory acceptance predicates.

### The LLM may own bounded What

Within a task contract, the target architecture may let the LLM determine the structured cognitive artifact needed to satisfy the supplied goal. Examples include:

- an evidence synthesis;
- an account situation brief;
- a candidate sales action selected from the supplied action envelope;
- a call plan;
- an email draft;
- a meeting agenda;
- structured extraction from ambiguous text; or
- a proposed remediation artifact.

The output remains candidate data until deterministic postconditions pass.

Current production-spine P4 does not implement model-controlled candidate-action selection. The next-best-action type remains deterministic in the current runtime.

### The LLM may own bounded How

Within a task contract, the target architecture may let the LLM:

- select an allowlisted tool;
- sequence tool calls;
- write intermediate structured artifacts;
- decompose the task;
- delegate bounded sub-tasks;
- combine worker results; and
- recover from permitted errors.

Software enforces tool, resource, permission, budget, and stop limits at every step.

General tool orchestration and supervisor-worker fan-out remain deferred from the current production spine.

## Canonical daily workflow

### Phase 1 — Load CRM data

**Goal:** create an authorized daily input batch.

Deterministic software owns upload permission, accepted formats, file limits, batch identity, quarantine location, and tenant scope.

The approved target allows bounded LLM assistance with semantic field mapping when the task contract permits it. Deterministic schema and mapping rules decide what is accepted. A model suggestion cannot make data authoritative.

Phase 1 is complete when the authorized batch is durably staged or explicitly rejected.

### Phase 2 — Validate and prepare canonical data

**Goal:** convert the uploaded batch into trusted canonical CRM state.

Deterministic software owns security checks, parsing limits, schema validation, canonical types, tenancy, duplicate handling, row dispositions, approval, and commit authority.

The approved target may allow the LLM to explain ambiguous data, propose bounded mappings, or structure unstructured content. Model output does not make a row authoritative.

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

No LLM is required or authorized to rank accounts.

Phase 3 is complete when every eligible account has deterministic priority state and the ranked daily book is persisted.

### Phase 4 — Analyze and prepare sales actions

**Goal:** perform bounded cognitive work for selected recommendations.

In the approved target architecture, software supplies, for each task:

- the account and tenant scope;
- the goal;
- verified evidence;
- deterministic reason codes;
- the allowed action and tool envelope;
- the allowed resources;
- the strict output schema;
- deterministic postconditions;
- token, time, call, retry, concurrency, and delegation budgets; and
- the terminal-state contract.

The target architecture may permit the pinned production model to act as a supervisor, solve the task directly, or delegate bounded work to subagents that use the same pinned model. A worker receives only the context and tools needed for its sub-task. The supervisor may synthesize worker outputs, but it cannot certify them.

**Current production-spine rule:** P4 v1 is limited to the ten authorized provider-neutral boundary, constrained-output, qualification, audit, fallback, and acceptance-profile items stated above. Candidate-action selection, general tool orchestration, and supervisor-worker fan-out are not part of the current spine.

Phase 4 is complete for an item only when deterministic software validates all required postconditions and returns `PASS`, `FAIL`, or `BLOCKED`.

### Phase 5 — Review and take action

**Goal:** let the correct representative inspect and act on usable recommendations.

The live web application shows persisted recommendations, evidence, model-assisted artifacts, validation state, and required approvals.

The target architecture may permit bounded questions, artifact revision, and allowed preparatory actions inside a task contract. The current spine does not grant the model general side-effecting tool authority.

No customer-facing send or CRM write occurs until the representative explicitly approves the visible payload.

Phase 5 is complete for an item when the permitted action reaches its verified terminal state, or when the item is explicitly held, failed, or blocked.

### Phase 6 — Capture outcome and refresh

**Goal:** record what happened and prepare the next daily cycle.

Deterministic software owns outcome storage, feedback provenance, metric calculations, and the next daily snapshot boundary.

The LLM may perform offline synthesis or classification of feedback when a separately authorized task contract permits it. It does not change production policy or acceptance state.

Phase 6 is complete when the available outcome or feedback is durably recorded, or the system records that the outcome is not yet known.

## Probabilistic task contract

Every LLM-assisted task must define these fields before execution:

1. `goal`
2. `authorized_inputs`
3. `scope`
4. `allowlisted_tools`
5. `allowed_resources`
6. `allowed_action_envelope`
7. `strict_output_schema`
8. `deterministic_postconditions`
9. `budgets`
10. `human_approval_requirement`
11. `terminal_states = PASS | FAIL | BLOCKED`

If no resources are authorized, `allowed_resources` must be an explicit empty grant.

When delegation is implemented, a subagent receives a stricter child contract. A child contract cannot widen the parent contract.

## Definition of Done

Completion is evaluated at three nested levels.

Only the deterministic verifier may return the terminal state.

### A. Task or phase completion

A single LLM-assisted task or phase is complete only when the harness can prove all applicable conditions below:

1. The goal supplied by software is satisfied and was not rewritten.
2. Only authorized inputs from the current batch, tenant, user, and task scope were used.
3. The output parses against the required strict schema.
4. Every factual claim that requires evidence resolves to an allowed source identifier.
5. No software-owned authority field was modified outside the task contract.
6. Every tool call, when tool use is implemented, used an allowlisted tool, valid arguments, and authorized resources.
7. Application-level postconditions on the resulting state hold.
8. Any protected side effect carried the required permission and explicit human approval.
9. All applicable token, call, time, retry, delegation-depth, and concurrency budgets were respected.
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
  -> optional P4 bounded drafting/synthesis succeeds or safely falls back/holds
  -> verified recommendations are persisted
  -> real recommendations appear in the correct representative's dashboard
  -> the representative can inspect evidence
  -> protected actions require explicit approval of the visible payload
  -> the outcome or feedback is durably recorded
```

Until this path exists and passes, the web application is **NOT DONE**, regardless of harness sophistication.

### P4 production acceptance profiles

**Acceptance A — deterministic baseline:** AI is disabled. The full production-shaped daily path must pass end to end using the deterministic baseline and approved fallback behavior.

**Acceptance B — qualified model:** the same spine runs with the single qualified production model configuration. Model success or safe fallback must never alter tenant, owner, account, eligibility, score, rank, confidence, reason codes, source evidence, next-best-action type, permissions, approval state, publication authority, side-effect authority, or completion authority.

The model can be disabled, unavailable, or rejected by verification without breaking the correctness of the daily spine.

## Summary statement of completion

The system is done when an authoritative daily CRM batch can be turned into a verified, prioritized, human-controllable sales work plan that is visible and actionable in the live web application, and every probabilistic step executes inside an explicit deterministic authority envelope that only the harness can mark `PASS`, `FAIL`, or `BLOCKED`.

## Failure semantics

Failure is item-scoped unless a system-level invariant requires the full run to stop.

- `PASS` — all required postconditions for the item or task are true.
- `FAIL` — one or more required postconditions are false.
- `BLOCKED` — completion cannot be established because required evidence, authority, dependency, or resource is unavailable.

A failed or blocked recommendation must not erase usable recommendations from the same daily run.

## Model policy

Only one qualified, pinned production configuration is active at a time.

The system must record effective model identity and configuration for every invocation.

Do not add model routing, automatic model escalation, majority voting, or a second active production model configuration in the current spine.

The approved target may later use the same qualified model for supervisor and worker roles after that capability receives explicit implementation authorization and ADR-002 admission.

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

Implemented current-runtime properties include deterministic prioritization and deterministic next-best-action selection followed by bounded single-call drafting or deterministic fallback.

Known completion gaps include:

- the production ingestion commit path is not fully wired end to end;
- the web application still has mock-backed recommendation surfaces;
- the durable runtime-to-web recommendation bridge is not complete;
- the P4 provider-neutral boundary and cross-model qualification work is not complete; and
- the production-shaped daily acceptance path is not complete.

Approved target capabilities that are not shipped in the current production spine include model-controlled candidate-action selection, general tool orchestration, and supervisor-worker delegation.

The current state is therefore **NOT DONE** under the whole web-application completion contract.

## Non-goals for the current production-spine build

- Real-time or event-driven CRM ingestion is not required.
- A general-purpose autonomous agent platform is not required.
- Model routing or majority voting is not required.
- Model-controlled candidate-action selection is not part of current P4.
- General tool orchestration and side-effecting model tools are not part of current P4.
- Supervisor-worker fan-out is not part of current P4.
- A second action ontology is not part of current P4.
- Production caching infrastructure is not part of current P4.
- The model does not own ranking, eligibility, scope, permissions, approval, publication, budgets, protected side-effect authority, or completion.
- The model does not send customer messages or write to the CRM without explicit human approval.
- The product does not claim byte-identical model prose across provider calls.