# P4 Unit 3 — Production Model Admission and Acceptance B

## 1. Purpose

Use this procedure after P4 offline qualification.

P4 Unit 3 converts real qualification evidence and an explicit human decision into one production model admission. It also defines Acceptance B for that admitted configuration.

This unit does not select a model automatically. It does not implement model-controlled WHAT, capability resolution, general tool orchestration, side-effecting model tools, subagents, routing, voting, a second action ontology, or production result caching.

Current next-best-action selection remains deterministic.

## 2. Required sequence

Use this sequence:

```text
locked qualification contract
  -> real qualification epoch
  -> QUALIFIED | DISQUALIFIED | BLOCKED evidence
  -> human selects one QUALIFIED candidate
  -> production admission artifact
  -> exact runtime configuration match
  -> Acceptance B
  -> production verifier
```

Do not skip a stage.

## 3. Run the real qualification epoch

Provide a locked qualification JSON contract. The contract must contain the product-owned `k`, budgets, thresholds, exact candidate model identifiers, credential references, and any authoritative pricing evidence.

Provide provider credentials through the environment. Do not commit credentials.

Run:

```bash
P4_QUALIFICATION_CONFIG=/absolute/path/locked-qualification.json \
P4_QUALIFICATION_REPORT=/absolute/path/qualification-report.json \
pnpm qualify:models
```

The qualification runner returns `QUALIFIED`, `DISQUALIFIED`, or `BLOCKED` for each candidate. It does not rank candidates and it does not admit a winner.

Do not invent missing thresholds, token counts, latency, cost, revision evidence, or provider equivalence.

## 4. Make the human admission decision

Review only candidates with `QUALIFIED` status.

Select one candidate explicitly. Record the human decision owner and a durable decision reference.

Run:

```bash
P4_QUALIFICATION_CONFIG=/absolute/path/locked-qualification.json \
P4_QUALIFICATION_REPORT=/absolute/path/qualification-report.json \
P4_ADMISSION_CANDIDATE_ID=<qualified-candidate-id> \
P4_ADMISSION_DECISION_OWNER=<decision-owner> \
P4_ADMISSION_DECISION_REF=<durable-decision-reference> \
P4_PRODUCTION_MODEL_ADMISSION_OUTPUT=config/production-model-admission.json \
pnpm admit:model
```

The admission command verifies these conditions again:

- The qualification epoch has `PASS` status.
- The report uses the current frozen corpus.
- The report policy hash matches the locked qualification contract.
- The selected candidate identity matches the contract.
- The selected candidate has `QUALIFIED` status and no failure reasons.
- The mandatory zero false-accept boundary still holds.
- Deterministic authority remained immutable.
- Product-owned verifier, fallback, telemetry, latency, and cost thresholds still hold when applicable.
- A production adapter exists for the selected provider.

If the selected qualified provider has no production adapter, the command blocks. Implement only that selected provider adapter under a separate evidence-bearing change. Do not add runtime routing or adapters for unselected providers merely because they were qualification candidates.

The generated admission artifact contains no provider credential.

Do not replace an existing admission silently. An explicit replacement decision must set `P4_ADMISSION_REPLACE_EXISTING=true` and must use new valid qualification evidence.

## 5. Configure the one admitted runtime model

Set `P4_PRODUCTION_MODEL_ADMISSION` to the admitted artifact path.

Set the runtime provider, model, reasoning profile, fallback, and budgets to exactly the values in the admission artifact. Provide the provider credential separately in `RUNTIME_DRAFT_API_KEY`.

When `NODE_ENV=production` and runtime drafting is enabled, startup fails if the admission artifact is absent or if the effective runtime configuration differs from the admitted configuration.

The runtime audit policy records the admission hash and qualification evidence hashes. It does not record the credential.

## 6. Run Acceptance B

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

The profile compares the admitted-model run with the deterministic Acceptance A authority envelope. Generated draft wording may differ. These fields must not differ because of the model:

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

The accepted recommendation then continues through the migrated durable persistence, representative RLS read, exact-payload approval, protected CRM action, and durable follow-up path.

## 7. Production verification behavior

`pnpm verify:production` always runs Acceptance A.

It runs Acceptance B when either condition is true:

- `P4_PRODUCTION_MODEL_ADMISSION` is set; or
- `config/production-model-admission.json` exists.

Before a model is admitted, the verifier records Acceptance B as not active. This state does not mean that P4 or the whole application is complete.

After a model is admitted, an Acceptance B failure blocks the production verifier.

## 8. Current evidence boundary

P4 Unit 3 provides the admission and Acceptance B mechanisms.

This implementation change does not claim that a named OpenAI, Anthropic, xAI, or Google model is qualified. A real qualification epoch requires a locked product-owned contract and live provider credentials. A production admission also requires an explicit human selection from the resulting qualified candidates.

Until those external inputs exist and Acceptance B passes, the whole application remains `NOT_DONE`.
