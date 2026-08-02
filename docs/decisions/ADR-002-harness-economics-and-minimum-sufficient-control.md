# ADR-002: Harness Economics and Minimum-Sufficient Control

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Repository maintainers
- Scope: AI harness architecture, coding-agent controls, runtime controls, verification, repair behavior, and CI/CD control design
- Evidence: PR #35 (`Harden coding-agent repair loop with fail-closed circuit breaker`)

## Context

This repository intentionally constrains probabilistic model behavior with deterministic software boundaries, schemas, verification, approval, observability, and evaluation.

PR #35 exposed a second-order risk: a harness can reduce model uncertainty while adding enough control-plane complexity that the harness itself becomes a dominant source of defects.

The sequence was instructive:

1. A prose-only coding-agent repair contract was correctly identified as non-enforceable.
2. Mechanical enforcement was added for line budgets and repair-loop state.
3. The enforcement passed its own contract tests, CI, evals, and security checks.
4. Independent review then found three new P1 defects in the harness state model.
5. An architectural redesign was authorized.
6. Independent review then found four additional P1 defects in the same harness subsystem.

The repeated failure surface was not the underlying product runtime. It was the control mechanism created to constrain the coding agent.

Therefore harness strength cannot be defined by the number of controls, amount of policy, or amount of enforcement code.

## Decision

The preferred harness is the **smallest sufficient deterministic shell around a probabilistic component that measurably improves correct-task completion, reliability, failure containment, safety, security, or operating cost without introducing greater complexity, latency, cost, or failure surface than the risk it removes**.

Harness complexity is not an objective. It is a cost that must be justified.

### Governing economic model

Use the following as a decision model, not invented telemetry:

```text
HarnessValue =
  demonstrated_benefit(correctness, reliability, safety, cost)
  - added_burden(complexity, latency, cost, state, dependencies, failure_surface)
```

A component is justified only when its expected or measured benefit exceeds its added burden.

If the required values are not measured, do not fabricate a numeric score. Use qualitative evidence and explicit acceptance criteria.

## Harness-component admission rule

Before adding a harness component, establish all of the following:

1. **Evidence** — the observed failure, explicit product requirement, or explicit high-consequence threat it addresses.
2. **Insufficiency** — why the existing system cannot satisfy the requirement.
3. **Minimum mechanism** — the least complex mechanism capable of addressing it.
4. **Acceptance evidence** — the executable or reviewable evidence that will prove the mechanism works.
5. **Added burden** — new latency, token/compute cost, code, state, dependencies, operational work, and failure modes.
6. **Net value** — why the expected benefit exceeds the added burden.

If these cannot be established, do not add the component.

## Simplicity precedence

Escalate control complexity only when the prior level is insufficient:

```text
no additional mechanism
  -> clearer contract, prompt, or context
  -> schema or static validation
  -> deterministic local code
  -> targeted test or evaluation
  -> bounded retry or recovery
  -> durable state
  -> orchestration or additional agents
  -> new control-plane subsystem
```

Do not move right when a simpler level satisfies the evidenced requirement.

## Machine-enforcement boundary

Machine-enforce properties when they are:

- local enough to observe authoritatively;
- deterministic to evaluate;
- inexpensive relative to the protected operation;
- semantically unambiguous;
- resistant to circumvention without reconstructing ambiguous external history.

Examples that normally belong in deterministic enforcement:

- schema validity;
- generated-artifact drift;
- deterministic scoring invariants;
- forbidden dependencies;
- authorization and approval boundaries;
- model inability to mutate authoritative fields;
- security invariants;
- test, build, type, migration, and deployment gates.

Examples that normally remain engineering judgment unless a trustworthy authoritative representation exists:

- whether a change is too broad;
- whether a harness is over-engineered;
- whether another abstraction is necessary;
- whether a repair indicates a systemic design flaw;
- whether a control costs more than the risk it removes;
- semantic classification of review findings from mutable review history.

Do not build a second complex subsystem merely to mechanically enforce a judgment rule.

## Hard rules

1. **Every harness component must pay rent.** Preserve it only when it provides evidenced value in correctness, reliability, safety, deterministic behavior, cost, latency, or necessary observability.
2. **Evidence before mechanism.** Do not add controls for hypothetical failures unless an explicit high-consequence threat model requires them.
3. **Deterministic before probabilistic.** Do not use an LLM where deterministic software satisfies the requirement.
4. **Local before stateful.** Do not create durable state when the required decision is stateless.
5. **Represent before infer.** Do not infer authoritative state from mutable artifacts when it can be represented directly at the source.
6. **Simple before orchestrated.** Do not introduce multi-agent, workflow, or control-plane architecture when a smaller boundary works.
7. **Bound every loop.** Retries, reflection, review, evaluation, and repair loops require explicit stop conditions.
8. **Do not confuse green gates with correct architecture.** Passing CI proves only the properties covered by those gates.
9. **Do not turn heuristics into fail-closed law without evidence.** A threshold must correspond to a real requirement or demonstrated failure boundary.
10. **The harness is part of the failure surface.** Whole-system reliability is the target, not local reduction of model variability.
11. **Removal is a first-class optimization.** Simplify or remove controls that duplicate a simpler mechanism, no longer protect an evidenced requirement, or create more burden than value.

## Repair economics

Repair behavior is governed by defect class and diagnostic evidence, not by maximizing the number of permitted attempts or imposing an arbitrary universal retry count.

```text
evidenced local failure
  -> smallest local repair
  -> targeted verification
      -> same failure + materially new diagnostic evidence:
           one specific, bounded, non-speculative follow-up repair
      -> same failure + no materially new diagnostic evidence: BLOCKED
      -> explicitly justified bound reached: BLOCKED
      -> new significant failure from same control mechanism: STOP AND REASSESS DESIGN
      -> verification passes without new defect class: continue
```

A local defect receives a local repair. A follow-up repair is justified only when targeted verification materially reduces uncertainty by identifying a specific, bounded correction. Unchanged failure without new diagnostic evidence does not earn another attempt.

When a repair exposes a new significant defect class caused by the same control mechanism, the next action is not automatic fix-forward. Reassess whether the mechanism is incorrectly modeled, over-complex, or unnecessary.

Repeated harness defects are evidence about the architecture of the harness itself.

The governing response is:

```text
STOP -> REDUCE OR REDESIGN -> VERIFY
```

## Architectural consequences

This decision reinforces the repository's existing separation:

```text
deterministic decision authority
  -> bounded probabilistic generation
  -> deterministic verification
  -> human approval for side effects
```

It also establishes a preferred control direction:

```text
simple local control
  > stateful control
  > orchestration
  > autonomous control plane
```

Move to a more complex control class only when evidence demonstrates that the simpler class is insufficient.

## Consequences

### Positive

- Lower harness latency, token use, operational cost, and maintenance burden.
- Smaller failure surface around probabilistic components.
- Easier debugging and stronger causal attribution when failures occur.
- Reduced incentive to convert every engineering preference into a state machine or CI policy.
- Architecture grows from observed requirements rather than pattern accumulation.

### Tradeoffs

- Some decisions remain review judgments rather than machine-enforced predicates.
- A smaller harness can require disciplined human escalation when evidence is ambiguous.
- High-consequence systems may still justify expensive controls, but the justification must be explicit.

## Non-goals

This ADR does not weaken existing product safety, approval, provenance, tenancy, schema, grounding, deterministic-decision, or production verification invariants.

It does not prohibit state, orchestration, retries, agents, evaluators, or control planes. It requires each to be justified by the smallest-sufficient-control rule.

It does not define universal numeric complexity, line-count, retry-count, or harness-value thresholds.

## Verification of this decision

Architecture and agent-contract reviews should be able to answer:

- What evidenced requirement pays for this component?
- What simpler mechanism was considered and why is it insufficient?
- What new failure modes does the component introduce?
- How will we know the component improved the whole system?
- Can the component be removed or reduced without violating an invariant?

If those questions cannot be answered, the default decision is **do not add the component**.
