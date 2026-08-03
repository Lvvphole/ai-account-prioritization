# Trajectory evaluation corpus

This fixture is the executable application-native projection of the synthetic evaluation
pack generated from `sales_pipeline.csv` with deterministic seed `23`.

The uploaded source CSV contains 8,800 opportunity rows and 8 fields. It is useful for
pipeline and ingestion testing, but it does not contain all account state required by the
runtime scorer. The trajectory corpus therefore adds fictional account, contact,
opportunity, activity, intent, health, and data-quality state while preserving the
source dataset's sales-pipeline shape as generation context.

## Files

- `oracle.compact.json` — compact 500-account deterministic oracle. It stores the fields
  that materially govern scoring, ranking, confidence, reason codes, next-best-action,
  and publish/hold expectations. The runner expands each row into the minimum canonical
  CRM context required by the current schemas.
- `guardrail_candidate_cases.json` — targeted unsupported-claim cases.
- `dataset_profile.json` — source and generated record counts used for provenance.
- `manifest.json` — corpus version, deterministic seed, evaluation clock, and oracle
  hash.

The full 11,000-row augmentation and verbose 500-account context pack are intentionally
not duplicated in Git. The repository keeps only the executable oracle and provenance
needed by CI. This preserves the evaluation state space without adding unused fixture
bulk to the production repository.

## Oracle coverage

Each runtime case carries expected:

- deterministic score;
- confidence;
- stable rank;
- closed-set reason codes;
- next-best-action type;
- confidence-floor publish/hold gate.

The runner executes the current deterministic planning, template drafting, verification,
approval simulation, prompt-injection authority check, synchronous claim guardrails,
and bounded-model stub trajectories for schema, grounding, fallback, and hold behavior.
It does not call an external model and does not grant the LLM ranking authority.

Run from the repository root:

```bash
pnpm --filter @repo/testing-evals test:trajectory
```

The suite also runs under the normal deterministic eval command.
