# AI Account Prioritization: Canonical Model-Adapter and Variance-Control Specification

- Version: 1.0
- Status: Approved Position B target specification
- Current implementation scope: P4 provider-neutral boundary and offline cross-model qualification only
- Authority: `AGENTS.md`, ADR-001, ADR-002, and the product contract remain higher-priority sources for implementation scope and safety rules

## 1. Purpose

This specification defines the target model adapter and the model-variance control model for AI Account Prioritization.

The target model adapter has one central purpose:

> Allow a qualified probabilistic model to own bounded WHAT and HOW while deterministic software owns the authority envelope and deterministic verification owns acceptance.

This specification does not authorize all target capabilities for the current production spine.

The current production spine keeps next-best-action selection deterministic. The current model performs bounded drafting and synthesis only. The following target capabilities remain deferred until the user gives separate implementation authorization and ADR-002 admits the implementation:

- Model-controlled WHAT or candidate-action selection.
- A capability resolver driven by model-selected WHAT.
- General tool orchestration or workflow selection.
- Side-effecting model tools.
- Subagent or worker fan-out.
- Multi-model routing or voting.
- A second action ontology.
- Production result caching.

The repository permits the provider-neutral P4 boundary and offline cross-model qualification. Production permits one qualified model configuration at a time. Qualification candidates do not imply dynamic provider routing.

## 2. Target model-adapter shape

The approved Position B target has this shape:

```text
AUTHORITATIVE CRM STATE
        ↓
DETERMINISTIC PRIORITIZATION
        ↓
WHO + WHEN + WHERE + WHY
        ↓
PROBABILISTIC TASK CONTRACT
  ├─ goal
  ├─ scope
  ├─ verified evidence
  ├─ reason codes
  ├─ allowed WHAT/action envelope
  ├─ available capability registry
  ├─ strict schemas
  ├─ deterministic postconditions
  ├─ permissions
  ├─ budgets
  └─ approval requirements
        ↓
PROVIDER-NEUTRAL MODEL ADAPTER
        ↓
QUALIFIED MODEL
 GPT | Claude | Grok | Gemini
        ↓
MODEL SELECTS BOUNDED WHAT
        ↓
DETERMINISTIC CAPABILITY RESOLVER
        ↓
REDUCED CAPABILITY ENVELOPE
        ↓
MODEL SELECTS BOUNDED HOW
  ├─ solve directly
  ├─ tool selection
  ├─ tool sequencing
  ├─ workflow selection
  ├─ task decomposition
  ├─ bounded worker fan-out
  └─ synthesis
        ↓
STRICT CANDIDATE ARTIFACT
        ↓
DETERMINISTIC VERIFICATION
        ↓
PASS | FAIL | BLOCKED
        ↓
HUMAN APPROVAL
when protected side effect exists
```

The governing rules are:

```text
WHAT can select capability.
WHAT cannot create capability.
HOW can use granted capability.
HOW cannot expand authority.
```

Software supplies the goal and the bounded authority envelope. The model cannot widen scope, actions, tools, resources, permissions, budgets, side-effect authority, publication authority, or completion authority.

### 2.1 Normalized target contract

The target provider adapter normalizes these concepts:

```text
ModelProfile
  provider
  model_id
  model_revision_or_fingerprint
  reasoning_profile
  structured_output_profile
  tool_schema_profile
  sampling_profile
  max_output_tokens
  timeout

TaskContract
  goal
  scope
  verified_evidence
  deterministic_reason_codes
  allowed_actions
  available_capabilities
  strict_schema
  deterministic_postconditions
  permissions
  budgets
  approval_requirement

CandidateResult
  what
    action_code
    objective
  how
    strategy
    tools
    workflow
    workers
  evidence_refs
  candidate_artifact
  model_provenance
```

These structures describe the target architecture. P4 Unit 2 does not implement model-selected WHAT, a capability resolver, tools, workflows, or workers.

## 3. Authority matrix

| Decision or state | Target owner | Current production P4 | Rule |
| --- | --- | --- | --- |
| WHO | Deterministic | Deterministic | Software owns the tenant, user, representative, account, batch, and task subject. |
| WHEN | Deterministic | Deterministic | Software owns the schedule, freshness, timeout, and retry window. |
| WHERE | Deterministic | Deterministic | Software owns data sources, resources, destinations, and environments. |
| WHY | Deterministic | Deterministic | Software owns the objective, ranking policy, reason codes, and acceptance predicates. |
| WHAT | LLM, bounded | Deterministic today | A future model can select a candidate action only from a supplied action envelope. |
| Situation interpretation | LLM, bounded | Bounded synthesis | The model cannot rewrite authoritative facts. |
| Candidate action | LLM, bounded | Deterministic today | A future candidate must canonicalize to an admitted action. |
| HOW | LLM, bounded | Drafting and synthesis only | The model can use strategy only inside the granted envelope. |
| Tool selection | LLM, bounded | Deferred | The model can select only from a closed registry when this capability is admitted. |
| Tool sequencing | LLM, bounded | Deferred | Software validates every invocation. |
| Workflow selection | LLM, bounded | Deferred | The model can select only registered workflows when this capability is admitted. |
| Task decomposition | LLM, bounded | Deferred | A child task must preserve the parent goal. |
| Worker or subagent selection | LLM, bounded | Deferred | The model can select only registered worker types when this capability is admitted. |
| Delegation depth | Deterministic | Deferred | Software enforces the external limit. |
| Capability availability | Deterministic | Deterministic | The model cannot invent a capability. |
| Resource authority | Deterministic | Deterministic | The model cannot widen resource scope. |
| Permissions | Deterministic | Deterministic | The model cannot grant permission. |
| Tokens, calls, and time | Deterministic | Deterministic | The model cannot authorize additional spend. |
| Protected side effects | Deterministic plus human | Deterministic plus human | The human approves the final visible payload. |
| Verification | Deterministic verifier | Deterministic verifier | The model cannot self-certify. |
| Completion | Deterministic verifier | Deterministic verifier | The verifier returns only PASS, FAIL, or BLOCKED. |

ADR-002 permits approved bounded WHAT and HOW. ADR-002 does not give the model completion, spend, or acceptance authority. ADR-002 also requires the least complex sufficient mechanism for each mandatory invariant.

## 4. Model-variance classes

The objective is not zero model variability. The objective is to remove or contain variability that can change the correct authoritative outcome.

| Variance | Definition | Account Prioritization example | Harness response |
| --- | --- | --- | --- |
| V1 — Request/state variance | Material model input changed. | The CRM snapshot, evidence, prompt, policy, schema, model, tool set, or clock changed. | Freeze and version material state. Compute a canonical request identity. |
| V2 — Structural variance | The same intent has a different machine representation. | Evidence identifiers are missing, JSON shape changes, or tool arguments are malformed. | Use native constrained output, strict schemas, and closed enums. |
| V3 — Semantic/correctness variance | The model reaches a materially different WHAT or HOW. | One target run selects `RECOVER_OPEN_QUOTE`; another unsupported run selects `DISCOVER_NEW_PROJECT`. | Use a closed WHAT ontology, grounding, the capability resolver, and deterministic postconditions when those target controls are admitted. |
| V4 — Surface/trajectory variance | A correct equivalent result uses different wording or a different path. | Wording, worker order, decomposition, or an equivalent plan changes. | Use canonicalization and deterministic aggregation. Use a qualified result cache only if production caching is separately admitted. |

### 4.1 Correct and incorrect variance

This target variation is acceptable:

```text
Run A:
"Determine what blocks the open quote."

Run B:
"Identify why the quote has not converted."

        ↓ canonicalize
WHAT = RECOVER_OPEN_QUOTE
```

This target variation is not acceptable:

```text
same authoritative evidence
Run A → RECOVER_OPEN_QUOTE
Run B → DISCOVER_NEW_PROJECT
Run C → SEND_PROMOTION
```

The target flow is:

```text
probabilistic expression
        ↓
bounded semantic choice
        ↓
canonical business state
        ↓
deterministic verification
```

Generated prose does not have to be byte-identical. A temperature value of zero, a seed, or a similarly named provider control does not prove determinism.

The target action codes above are design examples. P4 Unit 2 does not add a second current-production action ontology. The current production next-best-action vocabulary remains deterministic and unchanged.

## 5. Variance-control levers

The table ranks the controls by what they buy for this application.

| Rank | Lever | Where | Cost | Primary variance | What it buys |
| ---: | --- | --- | --- | --- | --- |
| 1 | Deterministic authority envelope plus closed WHAT ontology | Application and harness | Free | V3 | Collapses open-ended business choice into an admitted action space. |
| 2 | Deterministic verifier plus postconditions | Harness | Low | V3 | Prevents an incorrect candidate from becoming authoritative. |
| 3 | Deterministic capability resolver | Harness | Negligible | V3 | Gives the same legal capability envelope for the same canonical WHAT. |
| 4 | Native constrained output plus strict tool schemas | Provider | Near-free | V2 | Removes structural variance by grammar instead of persuasion. |
| 5 | Frozen minimum verified evidence packet | Harness | Low | V1/V3 | Makes candidates reason from the same authoritative facts. |
| 6 | Canonical request identity or hash | Harness | Negligible | V1 | Shows whether two calls received the same material state. |
| 7 | Closed versioned capability registries | Harness | Free | V3 | Prevents the model from creating tools, workflows, resources, or worker authority. |
| 8 | Narrow child contracts | Harness | Low | V3 | Prevents delegation from widening parent authority. |
| 9 | Semantic canonicalization or equivalence mapping | Harness | Negligible | V2/V4 | Maps different correct expressions to the same internal state. |
| 10 | Pinned qualified model and configuration | Adapter | Free | V1/V3 | Removes deployment-configuration drift. |
| 11 | Externally enforced token, call, time, and delegation budgets | Harness | Negative/low | V3/V4 | Bounds cost, latency, recovery, and trajectory variance. |
| 12 | Verified result cache on complete material-state identity | Harness | Negative | V4 | Gives exact replay without another model call. |
| 13 | Offline k-run cross-model qualification | Evaluation | k calls | V3/V4 | Measures actual correctness and convergence. |
| 14 | Fixed reasoning, thinking, or effort profile | Adapter | Variable | V3/V4 | Prevents reasoning-budget changes from becoming another variable. |
| 15 | Temperature, top-p, and seed | Adapter | Free | Mainly V4 | Reduces residual sampling variation only when the provider supports the controls and evaluation proves value. |
| 16 | "Be deterministic" prompt language | Prompt | Tokens | Weak V4 | Provides persuasion only. |

An exact qualified cache hit is the strongest exact-replay mechanism after a result exists. A cache is not the strongest correctness mechanism. A cache cannot make an incorrect result correct. Production result caching remains deferred in the current repository scope.

### 5.1 Parallel execution rule

Do not set `parallel_tool_calls=false` as a universal target rule.

Use this target rule after parallel tools or workers receive separate implementation authorization:

```text
ordering-sensitive or mutating operation
  → SERIAL

independent read-only worker tasks
  → PARALLEL permitted within a hard budget

worker aggregation
  → CANONICAL ORDER
  → deterministic verification
```

P4 Unit 2 runs cross-model qualification serially. Serial execution makes the current offline evaluation order explicit and keeps spend easy to bound. Unit 2 does not implement worker fan-out.

## 6. Candidate data status

The model names, availability statements, prices, role mappings, and provider-control notes in Sections 7 through 10 are product-owner-supplied qualification inputs as of 2026-08-07.

They are not measured runtime telemetry. They are not automatic production-admission evidence.

Before a qualification epoch, lock and verify these inputs:

- The exact API model identifier.
- The model availability status.
- The provider control support.
- The pricing source.
- The pricing effective date.
- The qualification credentials.

The qualification runner calculates cost only when the locked qualification contract contains pricing and the provider returns the required token telemetry. Otherwise, cost is `n/a` in the evidence model.

## 7. OpenAI GPT candidates

Prices are product-owner-supplied standard text API prices per 1 million tokens.

| Model | Input | Cached input | Output | Use in this application |
| --- | ---: | ---: | ---: | --- |
| GPT-5.6 Sol | $5.00 | $0.50 | $30.00 | Hardest WHAT/HOW supervisor candidate. |
| GPT-5.6 Terra | $2.50 | $0.25 | $15.00 | Balanced supervisor candidate. |
| GPT-5.6 Luna | $1.00 | $0.10 | $6.00 | Cost-sensitive supervisor or worker candidate. |
| GPT-5.5 | $5.00 | $0.50 | $30.00 | Strong comparison or legacy-qualified candidate. |
| GPT-5.5 Pro | $30.00 | None | $180.00 | Offline or exception challenger. Routine economics are weak. |
| GPT-5.4 | $2.50 | $0.25 | $15.00 | Older balanced comparison model. |
| GPT-5.4 Pro | $30.00 | None | $180.00 | Weak fit because of cost and no native Structured Outputs in the supplied profile. |
| GPT-5.4 mini | $0.75 | $0.075 | $4.50 | Low-cost worker and possible bounded WHAT candidate. |
| GPT-5.4 nano | $0.20 | $0.02 | $1.25 | Extraction, classification, evidence tagging, and narrow worker candidate. |

### 7.1 GPT role posture

| Model | WHAT | HOW | Worker | Qualification posture |
| --- | --- | --- | --- | --- |
| Sol | High-complexity | High-complexity | Usually excessive | Admit only if measured quality gain pays for cost. |
| Terra | Strong candidate | Strong candidate | Strong | Balanced candidate. |
| Luna | Must prove WHAT accuracy | Strong bounded HOW | Strong | Economic candidate. |
| 5.5 | Strong | Strong | Expensive | Comparator or legacy candidate. |
| 5.5 Pro | Strong | Strong | Excessive | Offline exception. |
| 5.4 | Strong | Strong | Moderate | Comparator. |
| 5.4 Pro | Strong reasoning | Weak structural fit | Excessive | Avoid for the routine path. |
| 5.4 mini | Must prove WHAT accuracy | Strong bounded HOW | Very strong | Economic candidate. |
| 5.4 nano | Narrow WHAT only | Narrow tasks | Very strong | Do not use for open-ended WHAT without evidence. |

### 7.2 GPT control order

1. Deterministic authority envelope and closed WHAT ontology.
2. Deterministic verifier.
3. Deterministic capability resolver.
4. Structured Outputs and strict function or tool schemas.
5. Frozen verified evidence.
6. Canonical request identity.
7. Closed capability registry and narrow child contracts.
8. Semantic canonicalization.
9. Pinned model or dated snapshot.
10. Externally enforced budgets.
11. Qualified verified cache.
12. Offline k-run qualification.
13. Fixed `reasoning.effort`.
14. Sampling controls only when supported and evaluation proves value.
15. Prompt-only determinism.

The supplied candidate list identifies these dated snapshots when available:

- `gpt-5.5-2026-04-23`.
- `gpt-5.4-2026-03-05`.
- `gpt-5.4-mini-2026-03-17`.

For the supplied GPT-5.4 Pro profile, use external schema validation in place of native Structured Outputs.

## 8. Anthropic Claude candidates

Prices are product-owner-supplied standard prices per 1 million tokens.

| Model | Input | Output | Use in this application |
| --- | ---: | ---: | --- |
| Claude Fable 5 | $10.00 | $50.00 | Hardest long-horizon WHAT/HOW challenger. |
| Claude Mythos 5 | $10.00 | $50.00 | Limited-availability challenger. Governance review is required. |
| Claude Opus 5 | $5.00 | $25.00 | High-capability supervisor candidate. |
| Claude Sonnet 5 | $2.00* | $10.00* | Balanced production candidate. |
| Claude Haiku 4.5 | $1.00 | $5.00 | Cost-sensitive worker or bounded supervisor candidate. |

`*` The supplied Sonnet 5 data states introductory pricing of $2/$10 through 2026-08-31 and standard pricing of $3/$15 from 2026-09-01.

### 8.1 Claude role posture

| Model | WHAT | HOW | Worker | Qualification posture |
| --- | --- | --- | --- | --- |
| Fable 5 | Highest-end candidate | Highest-end | Economically excessive | Admit only if measured lift justifies cost. |
| Mythos 5 | Similar capability | Similar | Excessive | Limited availability. Do not use as the default baseline. |
| Opus 5 | Strong | Strong | Usually excessive | High-capability challenger. |
| Sonnet 5 | Strong candidate | Strong | Strong | Balanced candidate. |
| Haiku 4.5 | Must prove WHAT | Strong bounded tasks | Very strong | Economic candidate. |

### 8.2 Claude control order

1. Deterministic authority envelope and closed WHAT ontology.
2. Deterministic verifier.
3. Deterministic capability resolver.
4. `output_config.format` and strict tool schemas.
5. Frozen verified evidence.
6. Canonical request identity.
7. Closed capability registry and narrow child contracts.
8. Semantic canonicalization.
9. Pinned qualified model identifier.
10. Externally enforced budgets.
11. Qualified verified cache.
12. Offline k-run qualification.
13. Fixed effort profile.
14. Sampling controls only when supported.
15. Prompt-only determinism.

The supplied profile does not treat Claude sampling controls as a deterministic contract. The target adapter fixes the qualified effort profile and records the effective provider configuration.

## 9. xAI Grok candidates

Prices are product-owner-supplied short-context prices per 1 million tokens.

| Model | Input | Cached input | Output | Use in this application |
| --- | ---: | ---: | ---: | --- |
| Grok 4.5 | $2.00 | $0.30 | $6.00 | High-capability Grok supervisor candidate. |
| Grok 4.3 | $1.25 | $0.20 | $2.50 | Economical balanced candidate. |
| Grok 4.20 Reasoning | $1.25 | $0.20 | $2.50 | Fixed-ID reasoning candidate. |
| Grok 4.20 Non-Reasoning | $1.25 | $0.20 | $2.50 | Narrow classification or selection candidate. |
| Grok 4.20 Multi-Agent Beta | $1.25 | $0.20 | $2.50 | Offline challenger only. It adds hidden orchestration. |
| Grok Build 0.1 | $1.00 | $0.20 | $2.00 | Coding-specific model. It is not an Account Prioritization runtime candidate. |

The supplied candidate data identifies these fixed IDs:

- `grok-4.20-0309-reasoning`.
- `grok-4.20-0309-non-reasoning`.

### 9.1 Grok role posture

| Model | WHAT | HOW | Worker | Qualification posture |
| --- | --- | --- | --- | --- |
| Grok 4.5 | Strong candidate | Strong | Strong but possibly excessive | Frontier Grok challenger. |
| Grok 4.3 | Must qualify | Strong | Strong | Economic candidate. |
| Grok 4.20 Reasoning | Strong candidate | Strong | Strong | Fixed-ID qualification candidate. |
| Grok 4.20 Non-Reasoning | Narrow WHAT | Bounded HOW | Very strong | Classification or action-selection experiment. |
| Grok 4.20 Multi-Agent | Broad | Internally orchestrated | Not applicable | Do not use as the normal baseline without separate evidence and admission. |
| Grok Build 0.1 | Wrong product domain | Coding | Coding only | Exclude from the application runtime. |

The Multi-Agent candidate has an internal collaboration mechanism. This hidden orchestration is not the repository's bounded worker-contract mechanism. ADR-002 requires evidence before added orchestration complexity. The current production spine does not admit this mechanism.

### 9.2 Grok control order

1. Deterministic authority envelope and closed WHAT ontology.
2. Deterministic verifier.
3. Deterministic capability resolver.
4. Native Structured Outputs or strict schema.
5. Frozen verified evidence.
6. Canonical request identity.
7. Closed capability registry and narrow child contracts.
8. Semantic canonicalization.
9. Fixed model ID. Avoid `*-latest` when a fixed ID exists.
10. Externally enforced budgets.
11. Qualified verified result cache.
12. Offline k-run qualification.
13. Fixed reasoning effort.
14. Sampling parameters only when supported and qualification proves value.
15. Prompt-only determinism.

## 10. Google Gemini candidates

Prices are product-owner-supplied standard API prices per 1 million tokens.

| Model | Input | Output | Use in this application |
| --- | ---: | ---: | --- |
| Gemini 3.6 Flash | $1.50 | $7.50 | Primary high-capability Gemini candidate. |
| Gemini 3.5 Flash | $1.50 | $9.00 | Strong agentic comparison candidate. |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | Economical worker or subagent candidate. |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | Older low-cost comparator. |
| Gemini 3.1 Pro Preview | $2.00 / $4.00* | $12.00 / $18.00* | High-capability offline challenger. Preview status weakens production reproducibility. |

`*` The supplied Gemini 3.1 Pro Preview data uses $2/$12 below 200K tokens and $4/$18 above 200K tokens.

### 10.1 Gemini role posture

| Model | WHAT | HOW | Worker | Qualification posture |
| --- | --- | --- | --- | --- |
| 3.6 Flash | Strong candidate | Strong | Strong | Main Gemini candidate. |
| 3.5 Flash | Strong candidate | Strong | Strong | Comparison candidate. |
| 3.5 Flash-Lite | Must prove WHAT | Strong bounded HOW | Excellent | Very strong economic worker. |
| 3.1 Flash-Lite | Narrow WHAT | Bounded | Strong | Older low-cost comparator. |
| 3.1 Pro Preview | High-capability | Strong | Excessive | Offline challenger until a stable production ID exists. |

### 10.2 Gemini control order

1. Deterministic authority envelope and closed WHAT ontology.
2. Deterministic verifier.
3. Deterministic capability resolver.
4. Structured Outputs or function schemas.
5. Frozen verified evidence.
6. Canonical request identity.
7. Closed capability registry and narrow child contracts.
8. Semantic canonicalization.
9. Stable exact model ID. Do not qualify `*-latest` for production when a stable ID is available.
10. Externally enforced budgets.
11. Qualified verified cache.
12. Offline k-run qualification.
13. Fixed thinking level.
14. Provider sampling parameters only when supported.
15. Prompt-only determinism.

Structured output controls V2. It does not prove V3 semantic correctness. The deterministic verifier remains required.

The supplied target profile does not use a universal `temperature=0` setting for Gemini. The adapter records the qualified thinking level and removes unsupported or deprecated sampling controls from the common contract.

## 11. Provider-neutral deterministic profile

The common contract must not require these cross-provider fields:

```text
temperature=0
top_p=1
seed=23
```

Use this provider-neutral profile:

```text
model_id=PINNED_OR_STABLE
model_configuration=QUALIFIED
request_state=CANONICAL
evidence=VERIFIED_AND_VERSIONED
prompt=VERSIONED
schema=VERSIONED
policy=VERSIONED
capabilities=VERSIONED
what=BOUNDED_TO_CLOSED_ACTION_ENVELOPE
how=BOUNDED_TO_GRANTED_CAPABILITIES
output=PROVIDER_NATIVE_CONSTRAINED_SCHEMA
tool_inputs=STRICT_SCHEMA
reasoning_profile=FIXED_PER_QUALIFIED_MODEL
permissions=EXTERNAL
budgets=EXTERNAL
side_effect_authority=EXTERNAL
completion_authority=DETERMINISTIC_VERIFIER
qualification=OFFLINE_K_RUN
production_model_count=1
failure=FALLBACK_OR_HOLD
silent_provider_switching=FORBIDDEN
```

Provider-specific target delta:

| Provider | Model-level variance control |
| --- | --- |
| OpenAI | Fixed reasoning effort, Structured Outputs, and a dated snapshot when the provider exposes one. |
| Anthropic | Fixed effort, `output_config.format`, strict tools when admitted, and omission of unsupported sampling controls. |
| xAI | Fixed reasoning effort, Structured Outputs, and a fixed dated ID when the provider exposes one. |
| Google | Fixed thinking level, Structured Outputs, a stable ID, and removal of deprecated sampling controls. |

## 12. Qualification contract

Cross-provider qualification evaluates the same application state. It does not use generic benchmark scores as the production admission oracle.

Freeze these items for one qualification epoch:

```text
same evaluation corpus
same CRM snapshot
same authoritative WHO/WHEN/WHERE/WHY
same verified evidence
same current deterministic action envelope
same schemas
same postconditions
same budgets
same verifier
same measurement protocol
```

The current production spine still owns WHAT deterministically. Therefore, P4 Unit 2 qualifies the provider and model for the current bounded drafting and synthesis role. The Unit 2 runner does not claim target WHAT, HOW, tool-selection, or delegation metrics that the current spine cannot authoritatively exercise.

When the repository separately admits target WHAT and HOW capabilities, the qualification contract can add the corresponding metrics without changing the authority rules in this specification.

### 12.1 Target metric set

The full target qualification metric set is:

| Metric | Purpose |
| --- | --- |
| Canonical WHAT correctness | Determine whether the model selected a supported business action. |
| Canonical WHAT agreement | Measure repeated-run convergence to the same equivalent action. |
| HOW admissibility | Determine whether the strategy stays inside the capability envelope. |
| Tool-selection correctness | Determine whether the model selected permitted and relevant tools. |
| Delegation validity | Determine whether child tasks are useful, bounded, and narrower than the parent. |
| Grounding pass rate | Measure support for required factual claims. |
| Verifier PASS rate | Measure how often the full candidate satisfies deterministic postconditions. |
| False-accept rate | Detect an incorrect result that the deterministic verifier accepted. |
| Canonical drift | Measure variance after semantic canonicalization instead of wording variation. |
| Input and output tokens | Record actual provider telemetry. |
| Latency | Record measured model and end-to-end latency where available. |
| Cost per verified PASS | Compare economics when locked pricing and measured token telemetry exist. |

### 12.2 Current Unit 2 metric boundary

P4 Unit 2 implements these measurements for the current drafting and synthesis role:

- Grounding pass rate.
- Model verifier pass rate.
- False-accept count and rate.
- Deterministic authority-field immutability.
- Fallback or hold rate.
- Canonical request-identity stability.
- Accepted artifact variants by frozen case.
- Provider latency when measured.
- Provider input, cached-input, and output tokens when measured.
- Cost per verified PASS only when the qualification contract supplies locked pricing and the provider supplies required token telemetry.

P4 Unit 2 reports these target metrics as `n/a` because the related capabilities remain deferred:

- Canonical WHAT correctness.
- Canonical WHAT agreement.
- HOW admissibility.
- Tool-selection correctness.
- Delegation validity.

The runner must not invent values for these metrics.

### 12.3 Qualification decisions

Use this flow:

```text
QUALIFY
    ↓
Does the candidate satisfy every mandatory and product-owned threshold?
    ├─ NO → DISQUALIFIED
    └─ YES → QUALIFIED

Missing required credential, provider access, authoritative telemetry, or other
required evidence
    → BLOCKED
```

The qualification harness does not invent numerical effectiveness, fallback, latency, or economic thresholds. The locked qualification contract must supply the thresholds that the product requires.

The false-accept threshold is zero because an incorrect accepted result violates the deterministic acceptance boundary.

The qualification harness does not rank models automatically. After qualification, compare qualified candidates with the locked product criteria. A human or other authorized product decision admits one production configuration.

Production does not route among the qualification candidates.

## 13. P4 Unit 2 executable implementation

P4 Unit 2 implements an offline qualification harness in `packages/testing-evals/src/model-qualification`.

The implementation has these properties:

- It uses a frozen, versioned current-spine corpus.
- It computes a corpus hash.
- It requires an explicit positive integer `k`.
- It requires one shared budget envelope for the candidate set.
- It requires explicit product-owned qualification thresholds.
- It executes candidates in a stable serial order.
- It uses the real current `attachHybridActionDraft` path for schema, grounding, fallback, and authority reconciliation.
- It records the actual non-secret provider output configuration used by the qualification adapter.
- It does not copy credentials into reports.
- It returns `QUALIFIED`, `DISQUALIFIED`, or `BLOCKED` for each candidate.
- It returns `PASS`, `FAIL`, or `BLOCKED` for the qualification epoch.
- It does not admit a production model automatically.
- It does not change the production provider registry.
- It does not implement model-controlled WHAT, tools, workers, routing, or caching.

Run an offline qualification epoch from the repository root:

```bash
P4_QUALIFICATION_CONFIG=/absolute/path/to/locked-qualification.json \
  pnpm qualify:models
```

The optional `P4_QUALIFICATION_REPORT` variable sets the report path. The default report path is under the existing ignored evaluation-results directory.

The qualification contract includes this required shape:

```text
contractVersion = p4-model-qualification-v1
corpusVersion = current-spine-drafting-corpus-v1
k = explicit product value
fallback = template | hold
budgets = explicit shared bounds
thresholds = explicit product-owned bounds
candidates = explicit provider/model/configuration records
```

Do not commit live provider credentials. Each candidate names an environment variable through `credentialEnv`.

## 14. Production admission boundary

P4 Unit 2 creates qualification evidence. P4 Unit 2 does not create production admission authority.

The next authorized P4 stage can admit one configuration only after the qualification evidence exists and an authorized decision selects the configuration.

The production configuration must then stay pinned and singular:

```text
qualified candidate set
        ↓
authorized admission decision
        ↓
ONE provider + ONE model + ONE qualified configuration
        ↓
Acceptance B
```

A production failure can use the configured deterministic template fallback or hold. A production failure cannot silently switch to another provider or model.

## 15. Final target system shape

The approved Position B target remains:

```text
                   DETERMINISTIC AUTHORITY
             WHO + WHEN + WHERE + WHY
                         │
                  VERIFIED EVIDENCE
                         │
                 CLOSED WHAT SPACE
                         │
                         ▼
                 QUALIFIED LLM
          GPT | CLAUDE | GROK | GEMINI
                         │
                         ▼
                  BOUNDED WHAT
                         │
                         ▼
          DETERMINISTIC CAPABILITY RESOLVER
                         │
                         ▼
                   BOUNDED HOW
              ┌──────────┼──────────┐
            direct      tools     workers
              └──────────┼──────────┘
                         ▼
                  CANONICAL RESULT
                         │
                         ▼
             DETERMINISTIC VERIFIER
                         │
             ┌───────────┼───────────┐
            PASS        FAIL       BLOCKED
             │
     human approval if required
             │
             ▼
        AUTHORIZED ACTION
```

The target is not to make GPT, Claude, Grok, and Gemini produce identical prose or identical hidden reasoning.

The target is:

```text
different probabilistic models
          ↓
same frozen business problem
          ↓
same bounded semantic space
          ↓
same authority constraints
          ↓
canonical WHAT + admissible HOW
          ↓
same deterministic verifier
          ↓
equivalently correct authoritative outcome
```

This is the target definition of close-to-deterministic, model-agnostic behavior for AI Account Prioritization.

The current implementation must continue to keep WHAT deterministic until the user separately authorizes target WHAT and HOW capabilities and ADR-002 admits their implementation.
