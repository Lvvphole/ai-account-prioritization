# ADR-001: Bounded Agentic Runtime with Deterministic Authority Boundaries

- **Status:** Accepted
- **Original date:** 2026-07-31
- **Amended:** 2026-08-06
- **Decision owners:** Product and architecture

## Context

The shipped runtime started as a deterministic TypeScript pipeline. It scores and
ranks accounts, selects reason codes and next-best actions, produces template or
bounded model drafts, runs deterministic verification, requires approval, and
publishes or blocks recommendations.

The approved target architecture now gives the LLM bounded **What and How**
authority without giving it authority over the execution envelope. This amendment
supersedes the earlier drafting-only restriction in this ADR.

Approved target architecture and current implementation are different states. The
target can permit a capability before that capability is admitted to the current
production-spine implementation.

## Decision

Use bounded probabilistic cognition and execution inside deterministic authority
envelopes.

Deterministic software owns:

- Who, When, Where, and Why;
- tenant, user, account, batch, and task scope;
- goals and policy;
- available actions and action envelopes;
- available tools and tool allowlists;
- resource access and permissions;
- token, call, time, retry, delegation, worker, and concurrency budgets;
- deterministic postconditions;
- protected side-effect authorization;
- verification and publication authority; and
- completion.

When an explicit task contract permits it, the LLM may:

- perform bounded semantic interpretation;
- propose semantic field mappings;
- synthesize verified evidence;
- generate strict-schema artifacts;
- select a candidate action from a software-supplied action envelope;
- select and sequence allowlisted tools;
- decompose work;
- delegate bounded sub-tasks;
- synthesize worker results; and
- attempt bounded recovery.

The model cannot widen the authority envelope. It cannot create a new goal, tool,
permission, resource, action class, budget, validator exemption, side-effect
authority, publication authority, or completion state.

Only deterministic software can return `PASS`, `FAIL`, or `BLOCKED`.

Protected customer-facing sends and CRM writes require explicit human approval of
the final visible payload.

## Target runtime shape

```text
deterministic task envelope
  -> bounded model work when permitted
       -> direct execution
       OR
       -> bounded supervisor
            -> bounded worker task
            -> bounded worker task
       -> supervisor synthesis
  -> deterministic schema and grounding validation
  -> deterministic postcondition verification
  -> permission verification
  -> explicit human approval for protected side effects
  -> protected execution
  -> durable evidence
  -> PASS | FAIL | BLOCKED
```

Supervisor and worker roles use the same qualified, pinned production model. A
worker receives a child contract that is equal to or narrower than the parent
contract. A worker cannot inherit omitted tools, resources, permissions, or
budget by inference.

Direct execution remains preferred when it can satisfy the task contract. The
approved supervisor-worker capability does not require fan-out for each task.

## Candidate-action authority

The target architecture separates action choice from action authority.

Software supplies the allowed action envelope. A task contract can permit the
model to select one candidate action from that envelope. Deterministic software
then validates the candidate and all applicable postconditions.

The model cannot create an action outside the supplied envelope and cannot
approve or execute a protected side effect by itself.

## Tool authority

The target architecture permits bounded tool use. Software supplies the tool
allowlist, argument constraints, resource scope, permissions, budgets, and
side-effect classification.

The model can select an allowed tool, propose valid arguments, and sequence
allowed calls when the task contract permits it. Software validates each call
before execution.

Unrestricted or self-expanding tool authority is prohibited.

## Ingestion semantic mapping

The target architecture permits bounded model assistance during ingestion. The
model can interpret ambiguous source text or propose a mapping to the allowed
canonical schema.

Source authentication, quarantine, security checks, schema validation, row
disposition, canonical commit, provenance, and authoritative CRM state remain
deterministic. A model proposal does not make source data authoritative.

## Current production-spine implementation boundary

The full bounded What and How architecture above is approved. It is not the
required implementation scope of the current production spine.

The current runtime still selects the next-best-action type deterministically and
uses the model only for bounded drafting and synthesis. The current P4 work is
limited to the approved provider-neutral model boundary, variance control, and
qualification scope recorded in `AGENTS.md`, `docs/ARCHITECTURE.md`,
`docs/PRD.md`, and `prd_manifest.yaml`.

The following target capabilities remain deferred from current-spine
implementation:

- model-controlled candidate-action selection;
- a capability resolver driven by model-selected What;
- general tool orchestration, workflows, or side-effecting model tools;
- supervisor-worker fan-out and subagent delegation;
- multi-model routing or majority voting;
- a second action ontology beyond the current deterministic set; and
- production caching infrastructure.

A later implementation of a deferred capability requires a new explicit product
ruling and the applicable ADR-002 admission evidence. This ADR approves the target
architecture. It does not authorize expansion of the current P4 implementation
scope.

## Required controls

Any implemented probabilistic task must use the controls that apply to its task
contract:

- one qualified and pinned production configuration at a time;
- versioned prompt, schema, policy, model, and task-contract identity;
- minimum authorized context;
- strict structured output when the provider supports it;
- fixed externally owned budgets;
- allowlisted tools and resource scope when tools are admitted;
- child contracts that cannot widen parent authority when delegation is admitted;
- claim-level source references when factual generated claims require grounding;
- deterministic schema, grounding, permission, and postcondition validation;
- explicit fallback or held state;
- durable audit evidence for model work, tool work, fallback, approval, and side effects;
- adversarial prompt-injection tests; and
- deterministic verification that the model cannot self-certify completion.

## Determinism statement

Deterministic authority remains reproducible for all fields that the current task
contract assigns to deterministic software.

The current production spine keeps account eligibility, score, rank, confidence,
reason codes, source evidence, and next-best-action type deterministic.

When a future admitted task permits model-selected What, that candidate choice is
probabilistic by design. Its allowed envelope, validation, permissions, protected
side-effect authority, publication authority, and completion result remain
externally deterministic.

Generated wording and reasoning are governed by behavioral reliability and
qualification. The system does not claim byte-identical prose across provider
calls.

## Rationale

This authority split places probabilistic capability where it can add cognitive
value while keeping high-consequence authority in deterministic, testable
software.

It preserves:

- deterministic ranking and policy authority;
- explicit scope and resource boundaries;
- provenance and grounding;
- externally bounded spend;
- deterministic verification;
- human approval for protected actions;
- safe fallback when model work is unavailable or invalid; and
- independent evaluation outside acceptance authority.

## Consequences

### Positive

- The target architecture can support richer reasoning and execution without
  giving the model self-expanding authority.
- Candidate action choice and tool use can be added later without changing the
  core authority model.
- Direct execution and bounded supervisor-worker execution share one contract
  model.
- Provider or model failure does not remove deterministic fallback and hold
  semantics.

### Costs and risks

- Model-assisted mapping, tool use, and delegation add latency, token cost,
  security surface, and failure modes when implemented.
- Probabilistic candidate choices can vary across qualified runs.
- More capable task contracts require stronger budget, provenance, and
  postcondition enforcement.
- Approved target capabilities can be mistaken for shipped capabilities unless
  implementation status remains explicit.

## Rejected alternatives

### Let the LLM rank accounts

Rejected. Deterministic account eligibility, score, and rank remain product
policy authority.

### Give the model unrestricted or self-expanding authority

Rejected. A model cannot create its own goals, tools, resources, permissions,
actions, budgets, side-effect authority, publication authority, or completion
state.

### Require supervisor-worker fan-out for all model tasks

Rejected. Direct execution is the smaller path and remains preferred when it can
satisfy the task contract.

### Replace deterministic fallback without evidence

Rejected for the current spine. Model disablement, provider failure, or failed
verification must not remove the deterministic baseline where that baseline can
satisfy the product contract.

## Implementation rule

Implement only capabilities that are inside the current approved implementation
scope. A target-architecture statement is not implementation authorization.

For deferred Position B capabilities, require a new explicit ruling, apply
ADR-002, implement the smallest sufficient mechanism, and verify it against the
frozen task contract before production promotion.
