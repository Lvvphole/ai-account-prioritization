# Trajectory evaluation corpus

This fixture is the executable application-native subset of the synthetic evaluation pack
generated from `sales_pipeline.csv` with deterministic seed `23`.

The uploaded source CSV contains 8,800 opportunity rows and 8 fields. It is useful for
pipeline and ingestion testing, but it does not contain all account state required by the
runtime scorer. The corpus therefore adds fictional account, contact, opportunity,
activity, intent, health, and data-quality state while preserving the source dataset's
sales-pipeline shape as generation context.

## Files

- `runtime_contexts_with_expected.jsonl.gz.b64` — base64-encoded gzip payload containing
  500 canonical `AccountContext` cases plus their deterministic oracle.
- `guardrail_candidate_cases.json` — targeted unsupported-claim cases.
- `dataset_profile.json` — source and generated record counts used for provenance.
- `manifest.json` — corpus version, deterministic seed, evaluation clock, and payload
  hashes.

The uncompressed runtime corpus is intentionally not duplicated in Git. The eval runner
decodes and validates the compressed payload before execution. This keeps the repository
small while preserving all 500 cases.

## Oracle coverage

Each runtime case carries expected:

- deterministic score;
- confidence;
- stable rank;
- closed-set reason codes;
- next-best-action type;
- confidence-floor publish/hold gate.

The runner then executes the current deterministic planning, template drafting,
verification, approval simulation, prompt-injection authority check, synchronous claim
guardrails, and bounded-model stub trajectories for schema, grounding, fallback, and hold
behavior. It does not call an external model and does not grant the LLM ranking authority.

Run from the repository root:

```bash
pnpm --filter @repo/testing-evals test:trajectory
```

The suite also runs under the normal deterministic eval command.
