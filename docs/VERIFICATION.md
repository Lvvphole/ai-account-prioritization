# Verification

Status: canonical
Owner: reliability
Verification: executable repository gates

## Purpose

This document defines the completion and review contract. It prevents a review finding from becoming an endless patch loop.

The executor does not certify completion. Completion requires executable evidence and an independent review when the change affects architecture or authority.

## Verification order

Use this order:

```text
contract
  -> baseline
  -> targeted check
  -> affected integration checks
  -> repository completion gates
  -> independent review when required
  -> merge decision
```

Run the narrowest useful test first. Do not run the full suite repeatedly when a targeted test can diagnose the failure.

## Change classes

### Class A — local deterministic code

Examples: pure scoring helper, formatter, parser.

Required evidence:

- targeted unit or eval test;
- typecheck for the affected package;
- full affected package test before completion.

### Class B — authority, schema, persistence, security, or process boundary

Examples: scoring authority, capability provenance, approval, outbox, RLS, idempotency, temporal authority, generated schema.

Required evidence:

- class-level deterministic regression;
- integration or migration test at the real boundary;
- generated-schema drift check when schemas change;
- security or tenancy negative test when authority changes;
- full CI gates;
- independent review after the implementation is stable.

### Class C — bounded model generation

Required evidence:

- strict schema tests;
- authoritative-field immutability tests;
- claim-to-source grounding tests;
- prompt-injection tests;
- timeout and token-budget tests;
- deterministic fallback tests;
- asynchronous judge only for subjective quality that code cannot determine reliably.

## Review loop

For each finding:

1. Classify it as valid, partially valid, invalid, duplicate, outdated, or out of scope.
2. Identify the governing invariant and owning subsystem.
3. Fix the invariant, not only the reported line.
4. Search homologous paths before declaring the defect class repaired.
5. Add one class-level regression when the behavior is machine-checkable.
6. Run targeted verification.
7. Run affected completion gates.
8. Reply with evidence.

If another significant finding belongs to the same defect class, stop local patching.

Use this transition:

```text
repeated same-class finding
  -> STOP
  -> return to requirements/design
  -> simplify or replace the mechanism
  -> update canonical invariant
  -> rebuild once
  -> class-level verification
  -> one new independent review
```

Do not add a new permanent policy rule for each review comment.

## Independent-review gate

Request a new independent review only when:

- the governing design is stable;
- targeted regressions pass;
- required CI gates pass on one exact head;
- the PR description matches that head;
- unresolved earlier threads have a verified response.

A new review is not a substitute for local verification.

## Merge gate

Do not merge when any condition is true:

- a required check is failed, cancelled, skipped, missing, queued, or still running;
- an unresolved P0 or P1 finding exists;
- an unresolved P2 finding affects authority, determinism, security, tenancy, side effects, durable evidence, or recovery;
- generated artifacts differ from canonical sources;
- the implementation contradicts an accepted ADR or canonical contract;
- the PR description claims evidence from an older head;
- the executor is the only source of completion judgment.

Other P2 or P3 findings can be deferred only when they are explicitly classified as non-blocking and tracked outside the current change.

## Canonical root commands

Use the commands that apply to the change. A Phase 1 production-boundary change must pass all of these:

```text
pnpm install --frozen-lockfile
pnpm verify:knowledge
pnpm generate:schemas
git diff --exit-code -- packages/shared-schemas/generated apps/api-python/src/schemas/generated
pnpm build
pnpm typecheck
pnpm test
pnpm test:trajectory
pnpm test:evals
pnpm test:judge
pnpm verify:migrations
pnpm verify:security
pnpm verify:production
pnpm docker:config
pnpm docker:build
```

The exact CI workflow is authoritative for automated execution. This list defines the expected evidence categories.

## Evidence record

For a merge decision, record:

- exact head SHA;
- command or workflow;
- result;
- material failure or success evidence;
- unresolved review findings;
- scope exceptions, if any.

Do not report an obsolete green run as current-head evidence.

## Knowledge verification

`pnpm verify:knowledge` must verify at least:

- root `AGENTS.md` stays within its size limit;
- required canonical knowledge files exist;
- root `AGENTS.md` links to the canonical sources;
- canonical knowledge files include ownership and status metadata.

Knowledge verification does not prove architecture correctness. It prevents context drift and duplicate operating manuals.
