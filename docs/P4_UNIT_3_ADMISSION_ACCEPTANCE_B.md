# P4 Unit 3 — Locked Qualification, Production Admission, and Acceptance B

## 1. Purpose

Use this procedure after Acceptance A passes.

P4 Unit 3 runs the approved model qualification policy, evaluates each candidate, selects the production candidate, and creates one immutable production admission artifact in one trusted process.

The full qualification report is audit evidence. A later command does not read the report to reconstruct or approve the qualification decision.

This unit permits qualification across more than one provider. It does not authorize runtime provider routing, automatic cross-provider failover, model-controlled next-best-action selection, general tool orchestration, side-effecting model tools, subagents, voting, a second action ontology, production caching, or live model-admission replacement. Current next-best-action selection stays deterministic.

## 2. Executable policy authority

`config/p4-qualification-policy.json` is the single executable source for the current P4 qualification policy.

Do not duplicate candidate identities, candidate priority, pricing, qualification limits, production budgets, or qualification thresholds in another executable definition.

The order of `candidates` in the policy file is the deterministic admission priority. Qualification and production admission are separate properties. A candidate can be `QUALIFIED` by the offline evaluator but still be non-admittable when the current runtime has no implemented production adapter for its provider.

The integrated admission step selects the first candidate in configured order that is both `QUALIFIED` and production-admittable. A qualified non-admittable candidate remains in the audit report and does not abort evaluation of later candidates. If no qualified production-admittable candidate exists, the result is `BLOCKED` and no new admission artifact is created.

The policy can contain candidates from more than one provider. Each candidate identifies its own credential environment variable. Adding a provider candidate does not make that provider production-admittable and does not authorize runtime routing.

A policy change is a change to `config/p4-qualification-policy.json`. Review and verify that change through the repository gates before a live qualification epoch. Do not represent a provider as production-admittable until its production adapter, sandbox profile, and required verification exist.

## 3. Authority model

Use this sequence:

```text
canonical qualification policy
  -> execute frozen cases
  -> evaluate run evidence in memory
  -> QUALIFIED | DISQUALIFIED | BLOCKED for each candidate
  -> preserve qualification evidence for every candidate
  -> first QUALIFIED + production-admittable candidate in configured order
  -> minimal immutable production admission artifact at a new path
  -> write full report as immutable audit evidence
  -> controlled runtime activation outside the qualification CLI
  -> exact runtime configuration match
  -> Acceptance B
  -> production verifier
```

The qualification process is the only authority that evaluates qualification run history. Production does not replay the report.

The decision owner and decision reference are audit metadata. They do not select the candidate and cannot override configured candidate priority. They are retained in the qualification report for both `PASS` and `BLOCKED` epochs. The report also records the selected candidate identifier and any qualified candidates that were not production-admittable.

The qualification CLI does not revoke, overwrite, or hot-replace an admission that running workers already loaded.

Multiple immutable admission artifacts can exist as audit history or staged successors. A running production deployment loads exactly one admission artifact. The existence of another artifact does not make it active.

## 4. Budget semantics

The policy contains two token authorities because they protect different operations.

`qualificationEpochMaxRunTokens` bounds the total offline reservation for one candidate qualification epoch.

`budgets.maxRunTokens` is the production-shaped reservation cap for one simulated prioritization batch. Each `runIndex` receives a new production batch budget.

The qualification epoch checks its remaining reservation before an external model call. If the new reservation would exceed the epoch limit, the provider is not called and the candidate is `BLOCKED` by the qualification resource boundary.

Candidate budgets do not transfer between providers. Qualification does not authorize a runtime call to another provider when one candidate or active provider fails.

## 5. Qualification boundary

A candidate can be `QUALIFIED` only when all required runs complete the configured qualification boundary.

The deterministic qualification code evaluates the configured verifier pass-rate threshold, fallback threshold, mandatory zero false-accept boundary, authority immutability, request identity stability, invocation-start identity stability, effective provider configuration evidence, required token telemetry, reservation compliance, and required revision evidence.

The model does not certify these properties.

A `QUALIFIED` result is evidence for the exact provider, model, reasoning profile, provider configuration, policy, corpus, budgets, and code revision that the report identifies. Do not infer provider equivalence from similar control names.

## 6. Run the real qualification epoch

Provide every provider credential required by the canonical policy through the environment. Do not commit credentials.

For each candidate, use the environment variable named by that candidate's `credentialEnv` field. A policy that contains candidates from more than one provider can therefore require more than one provider credential for one complete epoch.

For a candidate-specific credential name, use a shell assignment that keeps the environment-variable name as data. Repeat these commands for each required `credentialEnv` value:

```bash
credential_env="ANTHROPIC_API_KEY"
credential_value="replace-with-provider-credential"
export "$credential_env=$credential_value"
```

Replace `ANTHROPIC_API_KEY` with the exact `credentialEnv` value from the canonical policy when the candidate uses another provider.

Provide durable audit metadata:

- `P4_ADMISSION_DECISION_OWNER`
- `P4_ADMISSION_DECISION_REF`

Run:

```bash
P4_ADMISSION_DECISION_OWNER="repository-maintainer" \
P4_ADMISSION_DECISION_REF="durable-decision-reference" \
pnpm qualify:models
```

Replace the example metadata values with the approved durable values for the qualification epoch.

`pnpm qualify:models` always reads `config/p4-qualification-policy.json`. It does not accept an alternate qualification-policy path.

Optional output paths are:

```text
P4_QUALIFICATION_REPORT
  default: generated file under packages/testing-evals/src/eval-results/
  requirement: the path must not already exist

P4_PRODUCTION_MODEL_ADMISSION_OUTPUT
  default: config/production-model-admission.json
  requirement: the path must not already exist
```

The resolved report and admission paths must be different. The command validates both output paths before provider spend. If either path already exists, or if both variables resolve to the same path, the command fails closed before qualification begins.

Both outputs use exclusive-create semantics. The qualification report is append-only audit evidence and is never overwritten. The admission artifact is immutable and is never overwritten or deleted by the qualification CLI.

Current P4 does not implement live replacement or runtime revocation. To qualify a successor while another admission is active, set `P4_PRODUCTION_MODEL_ADMISSION_OUTPUT` to a different unused path. This stages a new immutable admission artifact only. It does not change the model configuration already loaded by running workers.

Activate a successor only through a controlled deployment that drains or stops all existing runtime workers and then starts the runtime with `P4_PRODUCTION_MODEL_ADMISSION` pointing to the successor artifact. Hot replacement while old workers are still running is outside current P4 and requires separate implementation authorization and ADR-002 evidence.

A successor can use a different provider when that provider is production-admittable and the successor artifact contains its exact qualified configuration. This remains a controlled deployment operation, not automatic failover.

The command writes the audit report after a completed epoch. It writes the production admission artifact only when the canonical selection rule finds a candidate that is both `QUALIFIED` and production-admittable.

There is no separate `admit:model` replay step.

## 7. Production admission artifact

The admission artifact contains the selected candidate identity, production budgets, fallback policy, decision metadata, qualification policy identity, frozen corpus identity, and qualification report hash.

The report hash is provenance only. The production runtime does not open the qualification report and does not reconstruct historical run decisions from it.

The admission artifact contains no provider credential.

Admission artifacts are immutable. Current P4 does not mutate an artifact to represent revocation or replacement.

The artifact selects one provider, one model, and one exact production configuration. It does not contain an ordered runtime failover set.

## 8. Configure the active admitted runtime model

Set `P4_PRODUCTION_MODEL_ADMISSION` to the one admission artifact for the running deployment.

Set the runtime provider, model, reasoning profile, fallback, and budgets to the exact values in the admission artifact. Provide the provider credential separately in `RUNTIME_DRAFT_API_KEY`.

The provider registry must resolve the fixed sandbox execution profile and provider-specific output configuration for the admitted provider. Those derived values must remain consistent with the verified production adapter and must be recorded where the runtime audit contract requires them.

When `NODE_ENV=production` and runtime drafting is enabled, startup fails if the admission artifact is absent or if the runtime configuration differs from the admitted configuration.

More than one provider can be implemented or qualified. More than one immutable admission artifact can exist as history or a staged successor. The running deployment must still use exactly one active admission artifact.

A successor artifact becomes active only when the runtime is restarted with `P4_PRODUCTION_MODEL_ADMISSION` changed to that artifact after existing workers are drained or stopped.

## 9. Run Acceptance B

Acceptance B requires at least one real invocation of the active admitted production adapter. A provider failure can use only the admitted deterministic fallback. It must not invoke another provider automatically. A hold that prevents the required production path from completing fails the profile.

Configure the runtime environment from the admission artifact, then run:

```bash
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

Acceptance B proves the active configuration only. It does not prove that another implemented or qualified provider is active or interchangeable.

## 10. Production verification

`pnpm verify:production` always runs Acceptance A.

It runs Acceptance B when `P4_PRODUCTION_MODEL_ADMISSION` is set or when `config/production-model-admission.json` exists.

Before a model is admitted, Acceptance B is not active. This state does not mean that P4 or the application is complete.

After admission, an Acceptance B failure blocks production verification.

Provider-specific production verification must also prove the required admitted sandbox profile. A second implemented provider must not create an unverified direct-host fallback or automatic cross-provider path.

## 11. Current evidence boundary

This implementation supplies the reduced qualification and immutable admission-artifact mechanism. It does not claim that any configured candidate is qualified until a real canonical qualification epoch runs with live provider credentials.

It keeps offline qualification evidence distinct from production-admission eligibility. A provider can remain measurable offline without gaining production authority before its runtime adapter and required sandbox profile are separately implemented and admitted.

Multiple implemented or qualified providers are compatible with this boundary. Runtime provider routing, automatic cross-provider failover, and simultaneous model voting are not.

The current repository can retain an inactive provider adapter after another provider becomes active. Retention does not grant runtime authority. The active deployment still resolves only the provider in its loaded production admission artifact.

This unit also does not implement live admission replacement or shared runtime revocation state. Those capabilities are not required to qualify and stage an immutable successor artifact and are deferred unless a later explicit requirement justifies them.

The whole application remains `NOT_DONE` until the required single-active-qualified-model profile and the repository production verifier pass.
