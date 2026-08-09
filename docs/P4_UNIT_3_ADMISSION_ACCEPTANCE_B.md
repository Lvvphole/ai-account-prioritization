# P4 Unit 3 — Locked Qualification, Production Admission, and Acceptance B

## 1. Purpose

Use this procedure after Acceptance A passes.

P4 Unit 3 runs the approved model qualification policy, evaluates each candidate, selects the production candidate, and creates one immutable production admission artifact in one trusted process.

The full qualification report is audit evidence. A later command does not read the report to reconstruct or approve the qualification decision.

This unit does not authorize model-controlled next-best-action selection, general tool orchestration, side-effecting model tools, subagents, routing, voting, a second action ontology, production caching, or live model-admission replacement. Current next-best-action selection stays deterministic.

## 2. Executable policy authority

`config/p4-qualification-policy.json` is the single executable source for the current P4 qualification policy.

Do not duplicate candidate identities, candidate priority, pricing, qualification limits, production budgets, or qualification thresholds in another executable definition.

The order of `candidates` in the policy file is the deterministic admission priority. The first candidate with a `QUALIFIED` verdict is selected. If no configured candidate qualifies, the result is `BLOCKED` and no new admission artifact is created.

A policy change is a change to this JSON file. Review and verify that change through the repository gates before it is used for a live qualification epoch.

## 3. Authority model

Use this sequence:

```text
canonical qualification policy
  -> execute frozen cases
  -> evaluate run evidence in memory
  -> QUALIFIED | DISQUALIFIED | BLOCKED for each candidate
  -> first QUALIFIED candidate in configured order
  -> minimal immutable production admission artifact at a new path
  -> write full report as audit evidence
  -> controlled runtime activation outside the qualification CLI
  -> exact runtime configuration match
  -> Acceptance B
  -> production verifier
```

The qualification process is the only authority that evaluates qualification run history. Production does not replay the report.

The decision owner and decision reference are audit metadata. They do not select the candidate and cannot override configured candidate priority.

The qualification CLI does not revoke, overwrite, or hot-replace an admission that running workers already loaded.

## 4. Budget semantics

The policy contains two token authorities because they protect different operations.

`qualificationEpochMaxRunTokens` bounds the total offline reservation for one candidate qualification epoch.

`budgets.maxRunTokens` is the production-shaped reservation cap for one simulated prioritization batch. Each `runIndex` receives a new production batch budget.

The qualification epoch checks its remaining reservation before an external model call. If the new reservation would exceed the epoch limit, the provider is not called and the candidate is `BLOCKED` by the qualification resource boundary.

## 5. Qualification boundary

A candidate can be `QUALIFIED` only when all required runs complete the configured qualification boundary.

The deterministic qualification code evaluates the configured verifier pass-rate threshold, fallback threshold, mandatory zero false-accept boundary, authority immutability, request identity stability, invocation-start identity stability, effective provider configuration evidence, required token telemetry, reservation compliance, and required revision evidence.

The model does not certify these properties.

## 6. Run the real qualification epoch

Provide the provider credential required by the canonical policy through the environment. Do not commit credentials.

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

`pnpm qualify:models` always reads `config/p4-qualification-policy.json`. It does not accept an alternate qualification-policy path.

Optional output paths are:

```text
P4_QUALIFICATION_REPORT
  default: generated file under packages/testing-evals/src/eval-results/

P4_PRODUCTION_MODEL_ADMISSION_OUTPUT
  default: config/production-model-admission.json
  requirement: the path must not already exist
```

The command checks the admission output path before provider spend. If the path already exists, the command fails closed. It never overwrites or deletes the existing artifact. The final write also uses exclusive-create semantics so a concurrent file creation cannot overwrite an existing admission.

Current P4 does not implement live replacement or runtime revocation. To qualify a successor while another admission is active, set `P4_PRODUCTION_MODEL_ADMISSION_OUTPUT` to a different unused path. This stages a new immutable admission artifact only. It does not change the model configuration already loaded by running workers.

Activate a successor only through a controlled deployment that drains or stops all existing runtime workers and then starts the runtime with `P4_PRODUCTION_MODEL_ADMISSION` pointing to the successor artifact. Hot replacement while old workers are still running is outside current P4 and requires separate implementation authorization and ADR-002 evidence.

The command writes the audit report after a completed epoch. It writes the production admission artifact only when the canonical selection rule finds a `QUALIFIED` candidate.

There is no separate `admit:model` replay step.

## 7. Production admission artifact

The admission artifact contains the selected candidate identity, production budgets, fallback policy, decision metadata, qualification policy identity, frozen corpus identity, and qualification report hash.

The report hash is provenance only. The production runtime does not open the qualification report and does not reconstruct historical run decisions from it.

The admission artifact contains no provider credential.

Admission artifacts are immutable. Current P4 does not mutate an artifact to represent revocation or replacement.

## 8. Configure the admitted runtime model

Set `P4_PRODUCTION_MODEL_ADMISSION` to the admission artifact path.

Set the runtime provider, model, reasoning profile, fallback, and budgets to the exact values in the admission artifact. Provide the provider credential separately in `RUNTIME_DRAFT_API_KEY`.

When `NODE_ENV=production` and runtime drafting is enabled, startup fails if the admission artifact is absent or if the runtime configuration differs from the admitted configuration.

A successor artifact becomes active only when the runtime is restarted with `P4_PRODUCTION_MODEL_ADMISSION` changed to that artifact after existing workers are drained or stopped.

## 9. Run Acceptance B

Acceptance B requires at least one real invocation of the admitted production adapter. A provider failure can use only the admitted deterministic fallback. A hold that prevents the required production path from completing fails the profile.

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

## 10. Production verification

`pnpm verify:production` always runs Acceptance A.

It runs Acceptance B when `P4_PRODUCTION_MODEL_ADMISSION` is set or when `config/production-model-admission.json` exists.

Before a model is admitted, Acceptance B is not active. This state does not mean that P4 or the application is complete.

After admission, an Acceptance B failure blocks production verification.

## 11. Current evidence boundary

This implementation supplies the reduced qualification and immutable admission-artifact mechanism. It does not claim that any configured candidate is qualified until a real canonical qualification epoch runs with live provider credentials.

It also does not implement live admission replacement or shared runtime revocation state. Those capabilities are not required to qualify and stage an immutable successor artifact and are deferred unless a later explicit requirement justifies them.

The whole application remains `NOT_DONE` until the required single-qualified-model profile and the repository production verifier pass.
