# Synthetic canonical-state trajectory policy regression

This fixture is a **versioned policy-lock regression corpus** for the current
canonical-input prioritization runtime:

- corpus kind: `synthetic-canonical-state-policy-regression`;
- input contract: `current-input-contract-v1`;
- oracle class: `policy-lock-regression-not-independent-ground-truth`;
- deterministic seed: `23`;
- fixed evaluation clock: `2026-08-03T12:00:00Z`.

It is not a source-to-delivery production trajectory suite and it is not an
independent correctness oracle.

## Scope and classification

The referenced `sales_pipeline.csv` had 8,800 opportunity rows and 8 fields. It
was used only as a **sales-pipeline shape reference**. The committed repository
does not contain the source bytes, a source SHA-256, a source-record-to-case
mapping, or the original external generator needed to reproduce the synthetic
augmentation.

The corpus therefore does **not** claim that its 500 account cases can be
independently regenerated from the CSV. `dataset_profile.json` and
`manifest.json` make this limitation machine-readable and hash the committed
profile so the stated provenance cannot drift silently.

The synthetic cases add the account, contact, opportunity, activity, intent,
health, tier, lifecycle, and data-quality state needed by the current scorer.
Expected outputs are used to construct some of that canonical state. The suite
is therefore useful for detecting changes to the current policy, but it can
preserve an existing policy defect as readily as correct behavior.

The tested path begins after source ingestion and feature derivation:

```text
synthetic canonical account context
→ deterministic score
→ ranking
→ reason and action generation
→ drafting
→ deterministic verification
→ approved-state publish eligibility or hold
```

It does not test:

```text
source payload
→ adapter mapping
→ source capabilities
→ canonical facts
→ observed / derived / unavailable feature values
→ weight renormalization
→ event ingestion / outbox / queue / retries
→ publication write
→ notification or CRM delivery
```

Those belong in separate future evaluation layers rather than this focused PR.

## Files

- `oracle.compact.json` — compact 500-account current-policy oracle.
- `guardrail_candidate_cases.json` — targeted unsupported-claim cases.
- `dataset_profile.json` — source-shape reference, synthetic-generation
  classification, and explicit non-reproducibility metadata.
- `manifest.json` — corpus contract, fixed cap, evaluation clock, oracle hash,
  dataset-profile hash, and score-rounding corrections.
- `../../trajectory/provenance.ts` — validates the committed provenance contract
  and dataset-profile hash before the suite executes.

The full 11,000-row augmentation and verbose generated context pack are not
committed.

## Locked current-runtime behavior

Each of the 500 single-account cases asserts:

- exact deterministic score;
- deterministic confidence;
- current ordered reason codes;
- current next-best-action type;
- verified source-signal presence;
- confidence-floor publish eligibility or hold.

The complete 500-account book then asserts all three of these independently:

```text
RUNTIME_CONFIG.maxRecommendations === 25
expected oracle top set length === 25
runtime selected set length === 25
```

The expected set is not derived from the runtime cap under test.

## Drafting and safety coverage

The runner also checks:

- every recommendation field other than the explicitly permitted generated
  `nextBestAction.draft` remains unchanged through template and model drafting;
- approval status, verification state, permission state, and publication state
  are included in that immutability comparison;
- model attempts to return approval, verification, or publication fields fail
  strict schema validation and fall back safely;
- pending and rejected approval remain held;
- approved state can become publish-eligible, but verification never performs
  publication;
- raw adversarial CRM note text does not affect deterministic ranking;
- raw note bodies are not admitted into verified model context;
- malicious model wording is rejected by grounding;
- deterministic fallback passes final verification without carrying the
  injected instruction;
- targeted unsupported claims are blocked;
- schema failure, grounding failure, action mutation, timeout fallback, and
  fallback-disabled hold behavior are covered without paid model calls.

The suite tests **approved-state verification and publish-eligibility
simulation**. It does not test an actual publication write, idempotency,
delivery failure, retry, or notification behavior.

### Cross-language score rounding

The external synthetic pack was generated in Python while the production scorer
uses JavaScript `Math.round`. Two account states land on half-cent boundaries.
The manifest records the exact current-runtime corrections:

- account `108`: `67.98`;
- account `89`: `57.80`.

The assertions remain exact; no score tolerance is used.

## Run

From a clean repository root after `pnpm install --frozen-lockfile`:

```bash
pnpm test:trajectory
```

The root command uses Turborepo to build workspace dependencies before it runs
the focused trajectory suite. The suite is also included in the normal
deterministic eval gate.
