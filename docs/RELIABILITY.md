# Reliability

Status: canonical
Owner: reliability
Verification: deterministic tests, evals, migration tests, and CI

## Purpose

This document defines reliability rules that affect deterministic authority, recovery, replay, and failure containment.

## Reliability model

The system must contain failures at the smallest valid boundary.

```text
invalid account evidence
  -> hold that account
  -> write failed-gate evidence
  -> continue unrelated account work

invalid owner infrastructure dependency
  -> fail that owner run explicitly
  -> do not fabricate success

system-wide infrastructure failure
  -> fail the run
```

Ordinary business-state conditions such as missing or stale CRM evidence are not infrastructure exceptions.

## Temporal authority

Time-bearing evidence must use one temporal contract.

### Canonical instant

An authority-bearing timestamp must contain an explicit UTC marker or numeric offset.

Valid examples:

```text
2026-08-03T09:00:00Z
2026-08-03T09:00:00.000Z
2026-08-03T05:00:00-04:00
```

A zone-less timestamp is invalid authority input.

Do not allow host timezone, locale, or ICU configuration to change an authority decision.

### Ingestion admissibility

A capability observation must be validated before it becomes current durable authority.

- Reject an invalid timestamp.
- Reject an observation later than the database admission clock.
- Enforce tenant ownership before acceptance.
- Do not persist a value that the normal runtime cannot later replace or recover from.

### Durable ordering

The current capability snapshot is monotonic.

- A newer observation can replace an older observation.
- An older observation cannot replace newer authority.
- An equal-time replay is idempotent only when source, mapping version, and capability content are unchanged.

### Decision freshness

The current maximum-age policy is `crm-source-capability-max-age-7d-v1`.

Classify each account independently:

```text
fresh    -> eligible for connector-aware decision authority
stale    -> HELD: CAPABILITY_SNAPSHOT_STALE
future   -> HELD: CAPABILITY_SNAPSHOT_FUTURE
missing  -> HELD: CAPABILITY_SNAPSHOT_MISSING
invalid  -> HELD or rejected at the earliest safe boundary
```

A stale account must not abort reconciliation for other accounts or owners.

The repository returns structurally valid evidence. The deterministic policy decides whether that evidence is fresh enough for decision authority.

## Deterministic ordering

Any unordered collection that affects score, reasons, context, audit evidence, or side effects must be canonicalized before use.

- Use explicit ordinal comparison on stable IDs.
- Use explicit database `ORDER BY` when query order is part of the contract.
- Do not use locale-sensitive sorting for authority.
- Reverse-order tests must produce the same authority object.

## Exact money

Money that affects score, thresholds, action authority, or durable evidence uses exact minor-unit semantics.

- Preserve source decimal text before JavaScript number conversion.
- Validate allowed currency precision from the exact representation.
- Convert to integer minor units before aggregation.
- Use `BigInt` or another exact integer representation.
- Reject sub-cent source values.
- Record the derivation version and contributing source-record IDs.

## Derived features

A feature can be `derived` only when:

1. a deterministic derivation exists;
2. the derivation is versioned;
3. it consumes authoritative source records;
4. contributing source records are traceable;
5. the derivation version is durable evidence when authority changes.

Otherwise mark the feature `unavailable`.

## Idempotency

Every external side effect requires an unambiguous deterministic idempotency key.

Idempotency evidence must survive retries and process restarts. A completed delivery key cannot be reopened by deleting or rewriting terminal identity.

## State transitions

Database state machines must enforce legal transitions at the database boundary.

Application code cannot gain authority by writing a row shape that bypasses the intended transition.

Published/dead outbox rows and terminal delivery rows are immutable with respect to reopening.

## Process recovery

The transactional outbox owns publication recovery only.

After workflow publication, the durable workflow runtime owns process retries, waits, and resumption. Application tables must not implement a second generic retry scheduler.

Scheduled reconciliation uses the same domain policy as event processing and repairs missed event work without creating a second decision system.

## Failure evidence

A fail-closed decision must be observable.

For held or blocked work, preserve:

- account and run identity;
- failed-gate code;
- relevant source snapshot or absence reason;
- policy version;
- decision time;
- audit actor.

Silent drops are not failure containment.

## Verification

Use code-based tests for deterministic reliability rules. Use LLM evaluation only for subjective model-output quality that code cannot determine reliably.

Temporal-authority regression coverage must include:

- fresh snapshot;
- exact maximum-age boundary;
- stale snapshot;
- future snapshot;
- zone-less decision clock;
- future ingestion attempt;
- older replay;
- equal-time conflicting replay;
- newer replacement;
- one stale account beside one fresh account to prove failure containment.
