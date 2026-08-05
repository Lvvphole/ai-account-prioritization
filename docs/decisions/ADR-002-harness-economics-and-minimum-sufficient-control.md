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

The model may propose, draft, diagnose, and repair. The model must not certify completion, grant acceptance authority, authorize additional spend, or certify that the harness improved.

## Specification authority

This ADR is the single canonical normative source for **harness-economics semantics** in this repository, including:

- mandatory-invariant treatment;
- harness-component admission;
- simplicity precedence;
- machine-enforcement boundaries;
- Artifact DoD semantics;
- harness-fitness semantics;
- removal economics; and
- repair economics.

`docs/ARCHITECTURE.md` records the architectural consequences of this decision. `AGENTS.md` operationalizes the decision for coding-agent execution. Those documents may reference or operationalize this ADR, but they must not redefine these semantics. If they conflict with this ADR on harness economics, correct the conflict rather than allowing parallel doctrine to persist.

This authority is narrow. It does not override an explicit user requirement or weaken existing product safety, approval, provenance, tenancy, schema, grounding, deterministic-decision, authorization, trusted-acceptance, or production-verification invariants.

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

Do not collapse harness value into one computed score unless a separately admitted contract defines commensurable units and weights.

For each discretionary control, establish evidence for:

- the requirement protected;
- the observed insufficiency;
- the smallest mechanism considered;
- the correctness, reliability, safety, or operating-cost effect;
- the added latency and compute burden;
- the added complexity, state, dependencies, and failure surface;
- the removal or reduction alternative; and
- the decision rationale.

If a claimed value is not measured, do not fabricate a number. Use qualitative evidence and explicit acceptance criteria. If the claimed value is economic, measurement must use the repository's existing measurement contract. This ADR does not create a second metric vocabulary.

## Harness-component admission rule

Before adding a discretionary harness component, or choosing among alternative implementations of a required boundary, establish all of the following:

1. **Evidence** — the observed failure, explicit product requirement, or explicit high-consequence threat it addresses.
2. **Insufficiency** — why the existing system cannot satisfy the requirement.
3. **Minimum mechanism** — the least complex mechanism capable of addressing it without weakening mandatory invariants.
4. **Acceptance evidence** — the executable or reviewable evidence that will prove the mechanism works.
5. **Added burden** — new latency, token/compute cost, code, state, dependencies, operational work, and failure modes.
6. **Net value rationale** — why the expected or measured benefit justifies the added burden.

If these cannot be established for a discretionary control, do not add it. If the requirement is mandatory, keep the requirement and choose a smaller valid implementation rather than deleting the invariant.

### Control-admission closure

Each control-admission item must name one decision owner. The repository-maintainer role remains the general owner class; the item record identifies the person who owns that decision.

A control-admission item closes when one of these conditions occurs:

- the named owner records **APPROVED**;
- the named owner records **REJECTED**; or
- the admitted decision bound expires with no decision, which is **NO_DECISION** and is fail-closed.

`NO_DECISION` does not authorize implementation. `REJECTED` terminates the item. `APPROVED` permits the separately defined implementation work to proceed; it does not prove implementation correctness and does not grant Trusted Acceptance.

The item record must contain the six admission areas above, the decision owner, the decision outcome, the evidence identity, and any required mutation-survivor disposition.

A policy amendment is a separate admission item. It applies prospectively by default. It does not reopen closed items merely because the policy version changed. A closed item may reopen only when an admitted policy migration names the affected item, or when its implementation materially changes, its evidence materially changes, a mandatory invariant violation is discovered, or a material escaped defect is discovered.

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
12. **Predictions are not non-regression evidence.** A pre-change prediction constrains scope and creates a falsifiable hypothesis. Improvement and non-regression are established only by post-change measurement under the frozen evaluation conditions.
13. **Measure configurations, not summed control deltas.** Component ablations are diagnostic evidence. Retention decisions compare complete harness configurations because component effects need not compose additively.
14. **No model authorizes spend.** Retry, repair, delegation, context growth, and other spend-producing continuation decisions operate only inside externally enforced and explicitly justified bounds.

## Artifact DoD

**Artifact DoD** is the only term used in this ADR for deterministic completion of one implementation artifact against its frozen visible contract.

Artifact DoD is computed by deterministic verification. The authoritative gate verdict vocabulary remains:

```text
PASS | FAIL | BLOCKED
```

Artifact DoD is satisfied only when the required Artifact DoD verification result is `PASS` under the frozen contract. A probabilistic evaluator may measure residual semantic qualities only where no reliable deterministic oracle exists. It must not override a deterministic `FAIL` or `BLOCKED` result.

Held-out acceptance material does not belong in the candidate-visible Artifact DoD contract. Held-out tests, inputs, expected outputs, assertion material, oracle logic, and reconstructible oracle values belong only to Trusted Acceptance in the protected trust domain.

A local Artifact DoD `PASS` is **not Trusted Acceptance**. It must not satisfy, substitute for, spoof, or be published as the protected trusted-acceptance required check.

This ADR does not redefine the already-closed T24, T25, or T26 trusted-acceptance contracts. Artifact DoD consumes those authority boundaries where applicable; it does not replace them.

## Review closure

A reviewer must evaluate the frozen artifact set and return the complete known blocking set for that review epoch. Non-blocking findings must be recorded separately and must not silently become merge requirements for the unchanged artifact set.

After a complete blocking set is returned, a new blocker against unchanged artifacts requires new evidence of one of these conditions:

- a previously unobserved mandatory-invariant violation;
- invalid or fabricated evidence;
- a material escaped defect; or
- a defect that could not reasonably have been evaluated in the prior review scope.

A preference, refinement, broader architecture idea, or optional improvement is separate work.

A surviving required mutant blocks closure unless equivalence is demonstrated. The equivalence record must identify the mutant, the protected property, the independent guard that preserves the property, the observable behavior with and without the mutation, and the reviewer who accepted the equivalence argument.

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

A repaired artifact always returns to deterministic verification. A failed attempt is not accepted merely because a model reports that it repaired the failure.

## Harness fitness and measurement

Harness Fitness answers a different question from Artifact DoD: whether one complete harness configuration improves, preserves, or degrades whole-system behavior relative to a frozen baseline configuration.

Harness Fitness does not create a new acceptance authority. It does not replace Artifact DoD or Trusted Acceptance.

### Attribution rule

A harness-improvement claim requires a locked model. A model-improvement claim requires a locked harness.

For a harness comparison, hold constant:

- model and model configuration;
- evaluation set;
- budgets;
- execution environment;
- verifier identity;
- measurement protocol; and
- review epoch.

Compare the complete baseline configuration `H0` with the complete proposed configuration `H1`. Do not infer the configuration delta by summing individual control deltas.

Improvement may be predicted before a change. The prediction is a scope-control and falsifiability mechanism only. Improvement is established by post-change measurement. Non-regression must also be measured after the change against the frozen evaluation set. It must not be predicted, asserted from a change manifest, or inferred from the absence of a predicted regression.

### Evaluation-set and verifier identity

The fitness evaluation set must be frozen and hash-bound for each baseline epoch.

A change to the verifier or to the fitness evaluation set invalidates cross-epoch attribution. Either change ends the current baseline window. It must not mutate `verifier_id`, `evaluation_set_hash`, or `review_epoch` inside an active baseline window. Establish the changed verifier or evaluation set, rotate the applicable identities, and open a new baseline epoch.

The prior and new epochs may be reported separately. Do not report their difference as attributable harness improvement because the measurement instrument or evaluation population changed.

Repository-visible evaluation files such as `packages/testing-evals/**` are not, by themselves, a protected fitness corpus. Their use does not satisfy the protected measurement prerequisites defined below.

### Active evaluation loop and stop condition

Continuous measurement does not authorize continuous harness mutation.

An active harness-fitness evaluation epoch has this bounded shape:

```text
admitted harness proposal
  -> freeze comparison conditions
  -> run the admitted evaluation window
  -> collect complete post-change evidence
  -> RETAIN | REVERT | DEFER
  -> freeze the resulting active configuration
  -> STOP
```

`DEFER` is not a third running configuration. While the decision is deferred, `H0` remains the active configuration. `DEFER` must carry an admitted decision deadline. If the deadline expires without a decision, the outcome is `REVERT`.

After `STOP`, measurement may continue, but no new harness-fitness epoch opens merely because someone plans or proposes a change. A new harness proposal may open an epoch only after the control-admission process admits that proposal.

Other evidence-driven triggers may require a new admitted evaluation epoch, including:

- material production drift;
- an escaped defect;
- a mandatory-invariant violation;
- a new model or model version that requires qualification;
- an approved policy change; or
- a material measurement-boundary change.

### Measurement ownership and enabling condition

The existing **0M measurement contract** is the sole owner of metric names, schemas, calculations, missing-value behavior, and baseline procedure. This ADR does not define a second metric vocabulary.

Passive telemetry means the existing 0M collection path only. It does not authorize a parallel collector. Passive telemetry is not exempt from harness economics: if it is discretionary, it must pay rent like any other harness mechanism.

Harness Fitness is a required capability but is **inactive** until all protected measurement prerequisites are satisfied:

- corpus isolation is complete;
- candidate credentials are verified to have no protected read access;
- verifier identity is fixed;
- the fitness evaluation set is fixed and protected as required;
- measurement-schema authority is fixed; and
- an approved baseline epoch is opened.

This requirement does not authorize new instrumentation, corpus creation, or optimization work before those prerequisites are complete.

When the baseline window opens, `verifier_id`, `evaluation_set_hash`, and `review_epoch` are fixed for that window. The existing baseline procedure governs the approved 14-21 day observation window and prohibits re-analysis during the window unless invalidating evidence occurs. A verifier or evaluation-set change ends the current window and requires a new baseline epoch; it does not mutate the frozen variables in place.

### Research evidence posture

External studies are supporting evidence, not normative thresholds.

`Agentic Harness Engineering: Observability-Driven Automatic Evolution of Coding-Agent Harnesses` reports two forms of regression-prediction statistics. The cross-iteration means are 11.8% regression precision and 11.1% regression recall. The cumulative counts are 43 regression predictions with 5 correct predictions and 40 unforeseen regressions, which gives 11.6% cumulative precision and 11.1% cumulative recall. This ADR cites the **cross-iteration means** when it uses percentage figures and keeps the cumulative counts separate. The same study reports materially stronger fix attribution than regression attribution and documents non-additive component effects. These results support post-change non-regression measurement and configuration-level comparison; they do not authorize automatic harness evolution.

`The Harness Effect: How Orchestration Design Sets the Token Economics of Enterprise Agentic AI` reports a controlled swap across 22 locked tasks and six foundation models. Cost, token use, and median latency decrease in that reported experiment when the orchestration layer changes while models and tasks are held fixed. The study is vendor-authored, uses one baseline/harness pair, and treats the aggregate quality delta as directional at its sample size. Record the measured result as evidence for harness-level economic attribution; do not convert its percentages into universal thresholds.

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

- Lower harness latency, token use, operational cost, and maintenance burden when measurement supports the claim.
- Smaller failure surface around probabilistic components.
- Easier debugging and stronger causal attribution when failures occur.
- Reduced incentive to convert every engineering preference into a state machine or CI policy.
- Architecture grows from observed requirements rather than pattern accumulation.
- One canonical doctrine prevents semantic drift across architecture and agent-operating documents.
- Artifact completion, Trusted Acceptance, and harness-fitness measurement remain separate authorities.

### Tradeoffs

- Some decisions remain review judgments rather than machine-enforced predicates.
- A smaller harness can require disciplined human escalation when evidence is ambiguous.
- High-consequence systems may still justify expensive controls, but the justification must be explicit.
- Harness Fitness requires a trustworthy frozen baseline before attribution is valid.
- `AGENTS.md` and `docs/ARCHITECTURE.md` must remain operational/consequence views rather than independent copies of this doctrine.

## Non-goals

This ADR does not weaken existing product safety, approval, provenance, tenancy, schema, grounding, deterministic-decision, authorization, trusted-acceptance, or production-verification invariants.

It does not prohibit state, orchestration, retries, agents, evaluators, or control planes. It requires discretionary uses and implementation choices to satisfy the smallest-sufficient-control rule.

It does not define universal numeric complexity, line-count, retry-count, harness-value, criticality, or economic thresholds.

It does not permit required post-draft verification or human approval to become optional because they have implementation cost.

It does not authorize automatic harness evolution, a new measurement subsystem, a parallel telemetry collector, held-out corpus creation, or economic optimization before the protected measurement prerequisites and baseline procedure permit that work.

## Verification of this decision

Architecture and agent-contract reviews should be able to answer:

- Is this requirement a mandatory invariant or a discretionary/substitutable control?
- What evidenced requirement pays for this implementation or discretionary component?
- What simpler mechanism was considered and why is it insufficient?
- What new failure modes does the mechanism introduce?
- What exactly makes the implementation satisfy Artifact DoD?
- What remains exclusively Trusted Acceptance authority?
- How will we know the complete harness configuration improved without weakening a mandatory invariant?
- Is non-regression measured after the change under a frozen model, verifier, evaluation set, budget, environment, and measurement protocol?
- Does the active evaluation epoch have a stop condition and a defined active configuration during deferral?
- Are verifier and evaluation-set changes treated as new baseline epochs rather than in-place mutations?
- Does passive telemetry use only the existing 0M collection path and satisfy the same rent rule as other discretionary controls?
- Can a discretionary component be removed or reduced without violating an invariant?
- Does repair continue only while materially new diagnostic evidence identifies a bounded correction, with an explicit stop condition?

If those questions cannot be answered for a discretionary addition, the default decision is **do not add the component**. If the requirement is mandatory, preserve the requirement and reduce the implementation until it is the smallest sufficient mechanism.