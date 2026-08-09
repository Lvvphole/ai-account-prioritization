# P4 Unit 3 — Locked Qualification, Production Admission, and Acceptance B

## 1. Purpose

Use this procedure after Acceptance A passes.

P4 Unit 3 runs the approved model qualification policy, evaluates each candidate, selects the production candidate, and creates the production admission artifact in one trusted process.

The full qualification report is audit evidence. A later command does not read the report to reconstruct or approve the qualification decision.

This unit does not authorize model-controlled next-best-action selection, general tool orchestration, side-effecting model tools, subagents, routing, voting, a second action ontology, or production caching. Current next-best-action selection stays deterministic.

## 2. Locked policy

The executable policy is `config/p4-qualification-policy.json`.

It contains these approved limits:

```text
k = 30
qualificationEpochMaxRunTokens = 172650
fallback = template

production timeoutMs = 5000
production maxOutputTokens = 600
production maxInputTokens = 4000
production maxSignals = 6
production maxConcurrent = 4
production maxRunTokens = 20000
production maxEvidenceAgeDays = 90

minModelVerifierPassRate = 1.0
maxFallbackRate = 0.0
maxFalseAcceptRate = 0.0
requireCompleteTokenTelemetry = true
```

The only candidates are:

1. `anthropic-haiku-4-5-default` — `claude-haiku-4-5-20251001`, provider-default reasoning.
2. `anthropic-sonnet-4-6-low` — `claude-sonnet-4-6`, low reasoning.

Do not add a third candidate or provider.

## 3. Authority model

Use this sequence:

```text
locked qualification contract
  -> execute frozen cases
  -> evaluate run evidence in memory
  -> QUALIFIED | DISQUALIFIED | BLOCKED for each candidate
  -> deterministic Haiku -> Sonnet -> BLOCK selection
  -> minimal production admission artifact
  -> write full report as audit evidence
  -> exact runtime configuration match
  -> Acceptance B
  -> production verifier
```

The qualification process is the only authority that evaluates qualification run history. Production does not replay the report.

The selection rule is deterministic:

```text
Haiku QUALIFIED
  -> admit Haiku

Haiku not QUALIFIED and Sonnet QUALIFIED
  -> admit Sonnet

neither candidate QUALIFIED
  -> BLOCK; keep deterministic template behavior
```

The decision owner and decision reference are audit metadata. They do not select the candidate and cannot override this priority.

## 4. Budget semantics

Two token authorities exist because they protect different operations.

`qualificationEpochMaxRunTokens` bounds the total offline reservation for one candidate qualification epoch.

`budgets.maxRunTokens` is the production-shaped reservation cap for one simulated prioritization batch. Each `runIndex` receives a new production batch budget.

The qualification epoch checks its remaining reservation before an external model call. If the new reservation would exceed the epoch limit, the provider is not called and the candidate is `BLOCKED` by the qualification resource boundary.

## 5. Qualification boundary

A candidate can be `QUALIFIED` only when all 60 required runs complete the locked boundary:

- verifier pass rate is 60 of 60;
- fallback or hold rate is zero;
- false-accept rate is zero;
- authority violations are zero;
- request identity is stable for each frozen case;
- invocation-start identity is stable for each frozen case;
- effective provider configuration evidence is present and stable;
- required token telemetry is complete;
- token telemetry stays inside the deterministic reservation; and
- required model revision evidence, when configured, matches.

The model does not certify these properties. Deterministic qualification code derives the verdict from the in-memory run evidence.

## 6. Run the real qualification epoch

Provide `ANTHROPIC_API_KEY` through the environment. Do not commit credentials.

Provide durable audit metadata:

- `P4_ADMISSION_DECISION_OWNER`
- `P4_ADMISSION_DECISION_REF`

Run:

```bash
ANTHROPIC_API_KEY=<provider-credential> \
P4_ADMISSION_DECISION_OWNER=<decision-owner> \
P4_ADMISSION_DECISION_REF=<durable-decision-reference> \
pnpm qualify:models
```

Optional paths are:

```text
P4_QUALIFICATION_CONFIG
  default: config/p4-qualification-policy.json

P4_QUALIFICATION_REPORT
  default: generated file under packages/testing-evals/src/eval-results/

P4_PRODUCTION_MODEL_ADMISSION_OUTPUT
  default: config/production-model-admission.json
```

The command validates the locked policy before it resolves a provider credential or spends model tokens.

If an admission file already exists, the command refuses to replace it before provider spend. An explicit replacement decision must set `P4_ADMISSION_REPLACE_EXISTING=true`.

The command always writes the audit report after a completed epoch. It writes the production admission artifact only when the locked selection rule finds a `QUALIFIED` candidate.

There is no separate `admit:model` replay step.

## 7. Production admission artifact

The admission artifact contains the selected candidate identity, production budgets, fallback policy, decision metadata, qualification policy identity, frozen corpus identity, and qualification report hash.

The report hash is provenance only. The production runtime does not open the qualification report and does not reconstruct historical run decisions from it.

The admission artifact contains no provider credential.

## 8. Configure the admitted runtime model

Set `P4_PRODUCTION_MODEL_ADMISSION` to the admission artifact path.

Set the runtime provider, model, reasoning profile, fallback, and budgets to exactly the admission values. Provide the provider credential separately in `RUNTIME_DRAFT_API_KEY`.

When `NODE_ENV=production` and runtime drafting is enabled, startup fails if the admission artifact is absent or if the runtime configuration differs from the admitted configuration.

## 9. Run Acceptance B

Acceptance B requires at least one real invocation of the admitted production adapter. A provider failure can use only the admitted deterministic fallback. A hold that prevents the required production path from completing fails the profile.

Run:

```bash
P4_PRODUCTION_MODEL_ADMISSION=/absolute/path/production-model-admission.json \
RUNTIME_DRAFT_API_KEY=<provider-credential> \
RUNTIME_DRAFT_PROVIDER=<admitted-provider> \
RUNTIME_DRAFT_MODEL=<admitted-model> \
RUNTIME_DRAFT_REASONING_EFFORT=<admitted-profile> \
RUNTIME_DRAFT_TIMEOUT_MS=5000 \
RUNTIME_DRAFT_MAX_TOKENS=600 \
RUNTIME_DRAFT_MAX_INPUT_TOKENS=4000 \
RUNTIME_DRAFT_MAX_SIGNALS=6 \
RUNTIME_DRAFT_MAX_CONCURRENT=4 \
RUNTIME_DRAFT_MAX_RUN_TOKENS=20000 \
RUNTIME_DRAFT_MAX_EVIDENCE_AGE_DAYS=90 \
RUNTIME_DRAFT_FALLBACK=template \
pnpm test:acceptance:b
```

Generated draft wording can differ from Acceptance A. The model or fallback must not change these authority fields:

- tenant and owner scope;
- account identity and eligibility;
- score and rank;
- confidence;
- reason codes;
- source evidence;
- next-best-action type;
- approval state;
- verification and publication authority;
- protected side-effect authority; and
- completion authority.

The accepted recommendation must continue through durable persistence, representative RLS read, exact-payload approval, protected CRM action, and durable follow-up.

## 10. Production verification

`pnpm verify:production` always runs Acceptance A.

It runs Acceptance B when `P4_PRODUCTION_MODEL_ADMISSION` is set or when `config/production-model-admission.json` exists.

Before a model is admitted, Acceptance B is not active. This state does not mean that P4 or the application is complete.

After admission, an Acceptance B failure blocks production verification.

## 11. Current evidence boundary

This implementation supplies the reduced qualification and admission mechanism. It does not claim that Haiku or Sonnet is qualified until a real locked qualification epoch runs with live provider credentials.

The whole application remains `NOT_DONE` until the required single-qualified-model profile and the repository production verifier pass.
