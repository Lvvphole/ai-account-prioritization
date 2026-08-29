# Plan artifact template

Adapt to the task — these are information classes, not fixed headings.

## Required sections — PLAN_READY

1. **Disposition** — first line: `PLAN_READY`.
2. **Frozen contract** — goal, DoD, Scout path, scope, non-goals.
3. **Planning mode** — GREENFIELD or BROWNFIELD with evidence.
4. **Corrected beliefs** — any Scout claim corrected, with both the original and the evidence.
5. **Authority and invariants** — governing documents, protected actions with state and gates.
6. **Obligations** — table: DoD item → obligation ID → behavior status → verification status → increment → verifier.
7. **Selected design** — what was selected, what was rejected and why.
8. **Contracts** — API boundaries, schemas, error contracts. What is preserved, what changes.
9. **Increments** — ordered vertical slices, each with: objective, obligation closed, files, action, verification, stop condition, recovery (when stateful).
10. **Source binding** — commit, staged diff, unstaged diff, and each untracked file's path plus content hash (excluding the artifact path). Builder preflight recomputes before the first increment.
11. **Stop conditions** — when the builder must halt and return evidence.
12. **Completion authority** — who accepts. Never the planner.

## Required sections — PLAN_BLOCKED

1. **Disposition** — first line: `PLAN_BLOCKED`.
2. **Condition** — the named blocking condition.
3. **Evidence** — the conflicting authorities, missing inputs, or invalidating evidence.
4. **Resolution path** — what would unblock planning.
5. **Source binding** — same as PLAN_READY, or unexcluded when no artifact was written.

No design, contracts, or increments. A blocked plan has not reached those steps.

## PLAN_READY — compact example

```
PLAN_READY

# Plan: reject duplicate account submissions

Source binding (artifact path excluded: plans/reject-duplicate-account-submissions.md):
  commit: 4f1c9ab | staged: e3b0c442 | unstaged: e3b0c442 | untracked: none

Frozen contract:
  Goal: reject duplicate account submissions.
  Scout path: enforce uniqueness at the persistence boundary.
  DoD: D1 new external_id → 201 + one row; D2 existing → 409, no row; D3 concurrent → one row.
  Scope: account ingestion. Non-goals: backfill, cross-tenant dedup.

Mode: BROWNFIELD — existing src/api/accounts.py, src/store/accounts.py, migrations/0007.

Authority: AGENTS.md (make verify gates merge; migration merge needs sign-off).
  docs/security.md (tenant filter on every query; tenant_id never from body).
Protected: merge migration → APPROVAL_GATED, after implementation, before merge, owner: reviewer.

Obligations:
  D1 → OBL-1a (201 response)    SATISFIED/COVERED  — preserve via test_create_persists
  D1 → OBL-1b (one row exists)  SATISFIED/GAP      — INC-0: add test_create_single_row
  D2 → OBL-2a (409 response)    GAP/GAP            — INC-1: test_duplicate_returns_409
  D2 → OBL-2b (no row written)  GAP/GAP            — INC-1: test_duplicate_writes_no_row
  D3 → OBL-3  (concurrent)      GAP/GAP            — INC-1: test_concurrent_single_row

Design: unique constraint + store-boundary DuplicateAccount + API 409 translation.
  Rejected A (service-layer check): inadmissible — fails D3 under concurrency.
  Rejected C (plugin layer): inadmissible — fails scope.
  Rejected D (API-level translation): admissible, eliminated by fallback heuristic 4
    (information hiding) — D exposes driver types to the API layer.

INC-0: verification only for OBL-1b. Add row-count assertion. Stop if it fails on current source.
INC-1: unique index + DuplicateAccount + 409 translation + tests. Vertical slice.
  Recovery: revert code, contract, and migration together — neither half alone is valid.
  Stop if: existing duplicates block the constraint.
  Approval gate: build and verify, then stop before merge.

Completion: make verify + reviewer. Not the planner.
```

## PLAN_BLOCKED — compact example

```
PLAN_BLOCKED

Condition: DoD requires cross-tenant bulk import; docs/security.md forbids queries
  without a tenant filter. No ADR authorizes an exception.
Evidence: DoD item D-X; docs/security.md:12-30; src/store/accounts.py:44-71.
Resolves by: narrow D-X to per-tenant batches, or authorize a cross-tenant path via ADR.
```

## Writing style

Short sentences. Stable terminology. Conditions before commands. Cite paths, not
descriptions. No hedging. The reader is an agent executing steps, not a human reading prose.
