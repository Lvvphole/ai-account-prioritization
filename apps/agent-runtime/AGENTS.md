# Agent Runtime Determinism and Evidence Contract

This file applies to `apps/agent-runtime/**`. The root `AGENTS.md` and accepted ADRs remain authoritative. This file makes the deterministic decision and evidence rules local to runtime code.

## Derived-feature admission

A connector-aware feature can be `derived` only when all of these conditions are true:

1. The repository contains the deterministic derivation.
2. The derivation has an explicit version identifier.
3. The derivation consumes authoritative source records, not mapper defaults.
4. The recommendation evidence identifies the source records that contributed to the derived value.
5. The derivation version is carried into durable audit evidence when the derived value affects authority.

If any condition is false, mark the feature `unavailable`.

## Source-record traceability

- Aggregate evidence alone is insufficient when an aggregate is computed from source rows.
- For derived pipeline, preserve every contributing open opportunity ID in `sourceSignals` in stable ordinal order.
- Closed or otherwise excluded opportunities must not appear as contributors.
- A reason code must have direct evidence for its predicate. Unrelated verified evidence cannot satisfy grounding.
- Fail closed when a generated authoritative reason has no direct supporting evidence.

## Canonical ordering

Any collection that can originate from database, connector, event, or API order must be canonicalized before it affects serialized recommendation or audit evidence.

- Use explicit ordinal `<` / `>` comparison on stable identifiers.
- Do not use `localeCompare` for authoritative ordering.
- Do not depend on insertion order from PostgreSQL unless the query contract has an explicit deterministic `ORDER BY`.
- Reverse-order regression tests must produce the same complete authority object.

## Deterministic text rendering

Authoritative or persisted evidence text must not depend on host locale or ICU data.

- Do not use `toLocaleString`, `Intl.NumberFormat`, or locale-sensitive sorting in authority-bearing evidence.
- Render currency with repository-controlled deterministic formatting.
- If display text is used as durable audit evidence, identical numeric input must produce identical bytes on every supported host.

## Exact money

Money that affects score, reason thresholds, action authority, or audit evidence must use exact minor-unit semantics.

- Validate the canonical decimal representation to the allowed currency precision.
- Convert to integer minor units before aggregation.
- Use safe integer or `BigInt` arithmetic for aggregation.
- Convert only once after aggregation when a numeric score input is required.
- Reject sub-cent values independent of amount magnitude.
- Do not use floating-point accumulation or tolerance-based rounding for authoritative money.

## Durable recommendation identity

Deterministic in-memory candidate IDs and persisted recommendation IDs are different identity domains.

- Delivery persistence uses the canonical persisted recommendation UUID.
- Parse or validate the durable UUID before constructing a delivery idempotency key or delivery record.
- Do not pass deterministic candidate strings such as `rec_<run>_<account>` into database delivery references.
- Keep the distinction explicit in runtime types and helper names.

## Verification requirement

For every fix in one of these defect classes, sweep homologous paths before stopping:

- derived-feature provenance;
- unordered evidence collections;
- locale-dependent serialization;
- monetary precision;
- identifier-domain mismatch;
- missing direct reason evidence.

Add regression coverage for the whole defect class, not only the reported example.