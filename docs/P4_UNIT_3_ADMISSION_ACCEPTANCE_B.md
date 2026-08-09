# P4 Unit 3 — Production Model Admission and Acceptance B

## 1. Purpose

Use this procedure after P4 offline qualification.

P4 Unit 3 converts real qualification evidence, the locked candidate-priority rule, and an explicit human admission decision into one production model admission. It also defines Acceptance B for that admitted configuration.

The locked priority rule selects only between the two approved qualification candidates. It is not production routing. Production still uses one admitted model configuration only.

This unit does not implement model-controlled WHAT, capability resolution, general tool orchestration, side-effecting model tools, subagents, routing, voting, a second action ontology, or production result caching.

Current next-best-action selection remains deterministic.

## 2. Required sequence

Use this sequence:

```text
locked qualification contract
  -> real qualification epoch
  -> QUALIFIED | DISQUALIFIED | BLOCKED evidence for each candidate
  -> apply locked Haiku -> Sonnet -> BLOCK priority
  -> human confirms the policy-selected candidate and decision reference
  -> production admission artifact
  -> exact runtime configuration match
  -> Acceptance B
  -> production verifier
```

Do not skip a stage.

## 3. Locked qualification contract

The approved policy is encoded as `config/p4-locked-qualification.json`.

The executable contract uses `p4-model-qualification-v2`. It contains the product-owned `k`, separate token authorities, production budgets, thresholds, exact candidate model identifiers, credential references, and pricing evidence.

Use two separate token authorities:

- `qualificationEpochMaxRunTokens` limits one offline candidate qualification epoch across all frozen cases and all repeated `k` runs.
- `budgets.maxRunTokens` limits one production-shaped runtime batch. Production admission copies this value.

One authority must not increase the other authority.

The locked token values are:

```text
qualificationEpochMaxRunTokens = 172650
budgets.maxRunTokens = 20000
```

The locked production budgets are:

```text
timeoutMs = 5000
maxOutputTokens = 600
maxInputTokens = 4000
maxSignals = 6
maxConcurrent = 4
maxRunTokens = 20000
maxEvidenceAgeDays = 90
```

Optional `maxP95LatencyMs` and `maxCostPerVerifiedPassUsd` thresholds are absent. Do not encode the word `omitted` as a value.

`modelRevisionOrFingerprint` is also absent for both locked candidates. Do not encode the word `omitted` as a value.

The locked candidates are:

```text
anthropic-haiku-4-5-default
  provider = anthropic
  modelId = claude-haiku-4-5-20251001
  reasoningProfile = provider_default
  credentialEnv = ANTHROPIC_API_KEY

anthropic-sonnet-4-6-low
  provider = anthropic
  modelId = claude-sonnet-4-6
  reasoningProfile = low
  credentialEnv = ANTHROPIC_API_KEY
```

## 4. Qualification acceptance boundary

The frozen current-spine corpus contains two cases. The locked value is `k = 30`. Therefore each candidate must have 60 qualification runs.

A candidate is `QUALIFIED` only when all of these conditions are true:

```text
60/60 verifier PASS
AND fallback_rate = 0
AND false_accept_rate = 0
AND authority_violations = 0
AND complete_token_telemetry = true
AND stable_request_identity = true
```

Missing required credential, provider access, or required telemetry produces `BLOCKED` evidence as defined by the qualification runner.

Provide the provider credential through the environment. Do not commit credentials.

Run:

```bash
P4_QUALIFICATION_CONFIG=config/p4-locked-qualification.json \
P4_QUALIFICATION_REPORT=/absolute/path/qualification-report.json \
ANTHROPIC_API_KEY=<credential> \
pnpm qualify:models
```

The command verifies the locked policy before provider spend begins. It rejects an added or substituted provider or model.

The runner records `QUALIFIED`, `DISQUALIFIED`, or `BLOCKED` for each candidate. The locked P4 policy then sets the qualification-epoch verdict used for admission.

Do not invent missing thresholds, token counts, latency, cost, revision evidence, or provider equivalence.

## 5. Locked admission rule

Use this exact rule:

```text
Haiku QUALIFIED
  -> select Haiku

Haiku DISQUALIFIED or BLOCKED
AND Sonnet QUALIFIED
  -> select Sonnet

neither QUALIFIED
  -> BLOCK
  -> retain deterministic template path
  -> do not add another provider or model without new evidence
```

If both candidates are `QUALIFIED`, select Haiku.

If Haiku is `BLOCKED` and Sonnet is `QUALIFIED`, the locked policy permits Sonnet admission.

The human admission decision confirms the policy-selected candidate. It does not choose a different qualified candidate.

Record the decision owner and a durable decision reference.

Run:

```bash
P4_QUALIFICATION_CONFIG=config/p4-locked-qualification.json \
P4_QUALIFICATION_REPORT=/absolute/path/qualification-report.json \
P4_ADMISSION_CANDIDATE_ID=<policy-selected-candidate-id> \
P4_ADMISSION_DECISION_OWNER=<decision-owner> \
P4_ADMISSION_DECISION_REF=<durable-decision-reference> \
P4_PRODUCTION_MODEL_ADMISSION_OUTPUT=config/production-model-admission.json \
pnpm admit:model
```

The admission command rejects a candidate that differs from the locked priority result.

The admission command also verifies these conditions again:

- The report verdict matches the locked P4 policy.
- The report uses the current frozen corpus.
- The report policy hash matches the locked qualification contract.
- The selected candidate identity matches the contract.
- The selected candidate has `QUALIFIED` status and no failure reasons.
- The mandatory zero false-accept boundary still holds.
- Deterministic authority remained immutable.
- The verifier, fallback, telemetry, latency, and cost thresholds still hold when applicable.
- A production adapter exists for the selected provider.

If neither candidate is `QUALIFIED`, do not create an admission artifact. Keep the deterministic template path.

If the selected provider has no production adapter, the command blocks. Implement only that selected provider adapter under a separate evidence-bearing change. Do not add runtime routing or unselected provider adapters.

The generated admission artifact contains no provider credential. It contains `budgets.maxRunTokens = 20000`. It does not contain `qualificationEpochMaxRunTokens`.

Do not replace an existing admission silently. An explicit replacement decision must set `P4_ADMISSION_REPLACE_EXISTING=true` and must use new valid qualification evidence.

## 6. Configure the one admitted runtime model

Set `P4_PRODUCTION_MODEL_ADMISSION` to the admitted artifact path.

Set the runtime provider, model, reasoning profile, fallback, and budgets to exactly the values in the admission artifact. Provide the provider credential separately in `RUNTIME_DRAFT_API_KEY`.

When `NODE_ENV=production` and runtime drafting is enabled, startup fails if the admission artifact is absent or if the effective runtime configuration differs from the admitted configuration.

The runtime audit policy records the admission hash and qualification evidence hashes. It does not record the credential.

## 7. Run Acceptance B

Acceptance B uses the admitted production adapter. It requires at least one real provider invocation. A provider failure can use only the admitted deterministic fallback. A hold that prevents the production path from completing fails the profile.

Run:

```bash
P4_PRODUCTION_MODEL_ADMISSION=/absolute/path/production-model-admission.json \
RUNTIME_DRAFT_API_KEY=<provider-credential> \
RUNTIME_DRAFT_PROVIDER=<admitted-provider> \
RUNTIME_DRAFT_MODEL=<admitted-model> \
RUNTIME_DRAFT_REASONING_EFFORT=<admitted-profile> \
RUNTIME_DRAFT_TIMEOUT_MS=<admitted-value> \
RUNTIME_DRAFT_MAX_TOKENS=<admitted-value> \
RUNTIME_DRAFT_MAX_INPUT_TOKENS=<admitted-value> \
RUNTIME_DRAFT_MAX_SIGNALS=<admitted-value> \
RUNTIME_DRAFT_MAX_EVIDENCE_AGE_DAYS=<admitted-value> \
RUNTIME_DRAFT_MAX_CONCURRENT=<admitted-value> \
RUNTIME_DRAFT_MAX_RUN_TOKENS=<admitted-value> \
RUNTIME_DRAFT_FALLBACK=<admitted-value> \
pnpm test:acceptance:b
```

The profile compares the admitted-model run with the deterministic Acceptance A authority envelope. Generated draft wording can differ. These fields must not differ because of the model:

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

The accepted recommendation then continues through durable persistence, representative RLS read, exact-payload approval, protected CRM action, and the durable follow-up path.

## 8. Production verification behavior

`pnpm verify:production` always runs Acceptance A.

It runs Acceptance B when either condition is true:

- `P4_PRODUCTION_MODEL_ADMISSION` is set; or
- `config/production-model-admission.json` exists.

Before a model is admitted, the verifier records Acceptance B as not active. This state does not mean that P4 or the whole application is complete.

After a model is admitted, an Acceptance B failure blocks the production verifier.

## 9. Current evidence boundary

The Haiku and Sonnet candidates, qualification boundary, token authorities, and admission priority are locked in executable policy.

This implementation does not claim that Haiku or Sonnet is qualified. A real qualification epoch still requires live provider credentials and real provider evidence.

A production admission still requires the explicit human decision owner and durable decision reference after the deterministic policy selects the candidate.

Until the real qualification epoch, admission, Acceptance B, and remaining production acceptance evidence pass, the whole application remains `NOT_DONE`.
