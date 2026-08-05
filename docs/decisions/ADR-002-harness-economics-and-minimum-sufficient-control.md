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

The minimum sufficient production harness is the **smallest deterministic and measurably governed boundary around the probabilistic model that makes Artifact DoD externally verifiable, failure contained, authority protected, continued spend bounded, and the harness configuration's contribution attributable when trustworthy measurement is enabled**.

Harness complexity is not an objective. It is a cost that must be justified.

Models may propose, draft, diagnose, and repair. They do not certify completion, grant acceptance authority, authorize additional spend, or certify harness improvement.

## Specification authority

This ADR is the single canonical normative source for **harness-economics semantics** in this repository, including:

- mandatory-invariant treatment;
- harness-component admission;
- simplicity precedence;
- machine-enforcement boundaries;
- Artifact DoD;
- Harness Fitness;
- removal economics; and
- repair economics.

`docs/ARCHITECTURE.md` records the architectural consequences of this decision. `AGENTS.md` operationalizes the decision for coding-agent execution. Those documents may reference or operationalize this ADR, but they must not redefine these semantics. If they conflict with this ADR on harness economics, correct the conflict rather than allowing parallel doctrine to persist.

This authority is narrow. It does not override an explicit user requirement or weaken existing product safety, approval, provenance, tenancy, schema, grounding, deterministic-decision, authorization, Trusted Acceptance, or production-verification invariants.

## Mandatory invariants versus control mechanisms

Harness economics does not decide whether an already-required invariant exists.

Required safety, verification, approval, provenance, tenancy, schema, grounding, authorization, and publication boundaries remain mandatory. The economics decision applies to **how those requirements are implemented**: use the least burdensome mechanism that satisfies the invariant and its acceptance evidence.

For discretionary or substitutable controls, harness economics also determines whether the control should be added or preserved at all.

Therefore:

```text
mandatory invariant
  -> choose the smallest sufficient implementation

discretionary control
  -> admit only when demonstrated value exceeds added burden
```

A required invariant must never be removed merely because its implementation carries cost. Reduce the implementation burden without weakening the invariant.

### Governing economic model

Do not compute a universal harness-value score. Compare demonstrated benefit with added burden while preserving every mandatory invariant.

Use measured values when authoritative measurement exists. Otherwise use qualitative evidence and explicit acceptance criteria. Economic measurement uses the existing 0M measurement contract; this ADR does not define a second metric vocabulary.

## Harness-component admission rule

Before adding a discretionary harness component, or choosing among alternative implementations of a required boundary, establish all of the following:

1. **Evidence** — the observed failure, explicit product requirement, or explicit high-consequence threat it addresses.
2. **Insufficiency** — why the existing system cannot satisfy the requirement.
3. **Minimum mechanism** — the least complex mechanism capable of addressing it without weakening mandatory invariants.
4. **Acceptance evidence** — the executable or reviewable evidence that will prove the mechanism works.
5. **Added burden** — new latency, token/compute cost, code, state, dependencies, operational work, and failure modes.
6. **Net value** — why the expected or measured benefit justifies the added burden.

If these cannot be established for a discretionary control, do not add it. If the requirement is mandatory, keep the requirement and choose a smaller valid implementation rather than deleting the invariant.

Each admission item names one decision owner and closes as **APPROVED**, **REJECTED**, or **NO_DECISION** when its justified decision bound expires. `APPROVED` permits implementation; it does not prove Artifact DoD or Trusted Acceptance. `REJECTED` and `NO_DECISION` do not authorize implementation.

Policy changes are separate admission items and apply prospectively by default. A closed item reopens only for a material change to the admitted implementation or evidence, a mandatory-invariant violation, a material escaped defect, or an admitted migration that names the item.

## Simplicity precedence

Simplicity precedence applies only among **genuinely substitutable mechanisms or control classes**. It does not apply to sequential runtime stages that perform different mandatory responsibilities.

Escalate among substitutable mechanisms only when the prior level is insufficient:

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

Do not move right when a simpler substitutable level satisfies the evidenced requirement. Do not use this ordering to omit a mandatory runtime boundary.

## Machine-enforcement boundary

Machine-enforce properties when they are:

- local enough to observe authoritatively;
- deterministic to evaluate;
- inexpensive relative to the protected operation;
- semantically unambiguous; and
- resistant to circumvention without reconstructing ambiguous external history.

Examples that normally belong in deterministic enforcement:

- schema validity;
- generated-artifact drift;
- deterministic scoring invariants;
- forbidden dependencies;
- authorization and approval boundaries;
- model inability to mutate authoritative fields;
- security invariants; and
- test, build, type, migration, and deployment gates.

Examples that normally remain engineering judgment unless a trustworthy authoritative representation exists:

- whether a change is too broad;
- whether a harness is over-engineered;
- whether another abstraction is necessary;
- whether a repair indicates a systemic design flaw;
- whether a control costs more than the risk it removes; and
- semantic classification of review findings from mutable review history.

Do not build a second complex subsystem merely to mechanically enforce a judgment rule.

## Hard rules

1. **Every discretionary harness component must pay rent.** A required invariant does not need to re-justify its existence; its implementation must still be the smallest sufficient mechanism that preserves the invariant.
2. **Evidence before mechanism.** Do not add controls for hypothetical failures unless an explicit high-consequence threat model requires them.
3. **Deterministic before probabilistic.** Do not use an LLM where deterministic software satisfies the requirement.
4. **Local before stateful.** Do not create durable state when the required decision is stateless.
5. **Represent before infer.** Do not infer authoritative state from mutable artifacts when it can be represented directly at the source.
6. **Simple before orchestrated.** Do not introduce multi-agent, workflow, or control-plane architecture when a smaller substitutable boundary works.
7. **Bound every loop.** Every retry, reflection, review, evaluation, and repair loop requires an explicit stop condition. A valid stop condition may be evidence exhaustion, an explicitly justified resource/time/attempt bound, or a systemic-defect trigger; there is no universal numeric retry count.
8. **Do not confuse green gates with correct architecture.** Passing CI proves only the properties covered by those gates.
9. **Do not turn heuristics into fail-closed law without evidence.** A threshold must correspond to a real requirement or demonstrated failure boundary.
10. **The harness is part of the failure surface.** Whole-system reliability is the target, not local reduction of model variability.
11. **Removal is a first-class optimization for discretionary or substitutable controls.** Simplify or remove controls that duplicate a simpler mechanism, no longer protect an evidenced requirement, or create more burden than value. Do not remove a mandatory invariant; reduce its implementation burden instead.
12. **Predictions are not non-regression evidence.** Predictions constrain scope and create falsifiable hypotheses. Improvement and non-regression are established only by post-change measurement.
13. **Measure complete configurations.** Component measurements are diagnostic; do not infer whole-harness value by summing control deltas.
14. **No model authorizes spend.** Retry, repair, delegation, context growth, and other spend-producing continuation decisions operate only inside externally enforced, explicitly justified bounds.

## Artifact DoD

**Artifact DoD** is deterministic completion of one implementation artifact against its frozen visible contract. Its verdict vocabulary is `PASS | FAIL | BLOCKED`.

Artifact DoD is satisfied only by `PASS` from the required deterministic gates. A repaired artifact always returns to deterministic verification. Probabilistic evaluators may measure residual semantic qualities only when no reliable deterministic oracle exists, and they never override `FAIL` or `BLOCKED`.

Held-out acceptance material is not part of Artifact DoD. It belongs only to Trusted Acceptance in the protected trust domain.

**Artifact DoD `PASS` is not Trusted Acceptance.** It must not satisfy, substitute for, or be published as the protected Trusted Acceptance required check.

## Review closure

Review uses a frozen artifact set. A reviewer returns all blockers known from that review epoch together. A new blocker against unchanged artifacts requires new evidence of a mandatory-invariant violation, invalid evidence, a material escaped defect, or a defect that could not reasonably have been evaluated in the prior scope. Preferences and optional improvements are separate work.

A surviving required mutant blocks closure unless equivalence is demonstrated and recorded.

## Repair economics

Repair behavior is governed by defect class and diagnostic evidence, not by maximizing attempts or imposing an arbitrary universal retry count.

```text
evidenced local failure
  -> smallest coherent local repair
  -> targeted verification
      -> verification passes: continue
      -> same failure persists + materially new diagnostic evidence
         identifies a specific, bounded, non-speculative correction
         + no explicitly justified bound reached:
           next smallest coherent repair
           -> targeted verification
           -> repeat only while each cycle produces materially new evidence
      -> same failure persists + no materially new diagnostic evidence: BLOCKED
      -> explicitly justified bound reached: BLOCKED
      -> new significant defect class from the same mechanism:
           STOP AND REASSESS / REDUCE / REDESIGN
```

Each additional repair must be earned by fresh evidence that materially reduces uncertainty and identifies a bounded correction. A different error message that does not narrow the diagnosis is not sufficient evidence for another repair.

The loop terminates when verification passes, materially new evidence is exhausted, an explicitly justified bound is reached, or the mechanism produces a new significant defect class requiring design reassessment.

Repeated significant defects generated by the same harness mechanism are evidence about the harness architecture itself. The governing response is:

```text
STOP -> REDUCE OR REDESIGN -> VERIFY
```

## Harness Fitness

Harness Fitness measures whether a complete harness configuration improves, preserves, or degrades whole-system behavior. It is separate from Artifact DoD and Trusted Acceptance.

A harness-improvement claim requires a locked model. A model-improvement claim requires a locked harness. Within one Harness Fitness epoch, keep the model and model configuration, evaluation-set hash, budgets, execution environment, verifier identity, and measurement protocol fixed. Compare complete configurations, not summed component deltas.

A prediction may define the expected effect of a change, but it is not evidence of improvement or non-regression. Both are established only by post-change measurement against the frozen evaluation set.

A verifier or evaluation-set change ends the current baseline epoch and requires a new baseline. Do not mutate either inside an active baseline window or report cross-epoch differences as attributable harness improvement.

An active Harness Fitness epoch starts only from an admitted change or other admitted evidence-driven trigger and must have a stop condition. It ends in **RETAIN**, **REVERT**, or **DEFER**. `DEFER` keeps the baseline configuration active and requires a decision deadline; expiry resolves to `REVERT`.

The existing 0M measurement contract owns metric names, calculations, missing-value behavior, baseline procedure, and passive telemetry. Passive telemetry does not authorize a parallel collector and remains subject to harness economics.

Harness Fitness is inactive until corpus isolation, candidate credential separation, fixed verifier and protected evaluation-set identity, measurement authority, and an approved baseline epoch exist. This ADR does not authorize new instrumentation, corpus creation, or automatic harness optimization before those prerequisites are complete.

## Architectural consequences

This decision reinforces the repository's mandatory responsibility separation:

```text
deterministic decision authority
  -> bounded drafting
       probabilistic generation when enabled
       OR approved deterministic fallback
  -> deterministic post-draft verification
  -> human approval for customer-facing or side-effecting actions
  -> publish or hold
```

A probabilistic draft never bypasses deterministic post-draft verification. These sequential responsibilities are not substitutable control classes.

For genuinely substitutable control implementations, prefer:

```text
simple local control
  > stateful control
  > orchestration
  > autonomous control plane
```

Move to a more complex substitutable control class only when evidence demonstrates that the simpler class is insufficient.

## Consequences

### Positive

- Lower harness latency, token use, operational cost, and maintenance burden.
- Smaller failure surface around probabilistic components.
- Easier debugging and stronger causal attribution when failures occur.
- Reduced incentive to convert every engineering preference into a state machine or CI policy.
- Architecture grows from observed requirements rather than pattern accumulation.
- One canonical doctrine prevents semantic drift across architecture and agent-operating documents.

### Tradeoffs

- Some decisions remain review judgments rather than machine-enforced predicates.
- A smaller harness can require disciplined human escalation when evidence is ambiguous.
- High-consequence systems may still justify expensive controls, but the justification must be explicit.
- `AGENTS.md` and `docs/ARCHITECTURE.md` must remain operational/consequence views rather than independent copies of this doctrine.

## Non-goals

This ADR does not weaken existing product safety, approval, provenance, tenancy, schema, grounding, deterministic-decision, authorization, Trusted Acceptance, or production-verification invariants.

It does not prohibit state, orchestration, retries, agents, evaluators, or control planes. It requires discretionary uses and implementation choices to satisfy the smallest-sufficient-control rule.

It does not define universal numeric complexity, line-count, retry-count, harness-value, or fitness thresholds.

It does not permit required post-draft verification or human approval to become optional because they have implementation cost.

It does not authorize automatic harness evolution or a second measurement system.

## Verification of this decision

Architecture and agent-contract reviews should be able to answer:

- Is this requirement a mandatory invariant or a discretionary/substitutable control?
- What evidenced requirement pays for this implementation or discretionary component?
- What simpler mechanism was considered and why is it insufficient?
- What new failure modes does the mechanism introduce?
- How will we know it improved the whole system without weakening a mandatory invariant?
- Can a discretionary component be removed or reduced without violating an invariant?
- Does repair continue only while materially new diagnostic evidence identifies a bounded correction, with an explicit stop condition?
- Is Artifact DoD deterministic and separate from Trusted Acceptance?
- If Harness Fitness is claimed, were the model, verifier, evaluation set, and measurement protocol fixed for the epoch and was non-regression measured after the change?

If those questions cannot be answered for a discretionary addition, the default decision is **do not add the component**. If the requirement is mandatory, preserve the requirement and reduce the implementation until it is the smallest sufficient mechanism.