# Unrepaired fixture

The frozen `D1`–`D3b` cases assert that `CANDIDATE_ROOT` **is broken**: a vacuous
`pnpm lint`, an unenforced `pnpm test`, a second completion list in
`docs/CONTEXT.md`, and an overall `FAIL`. Those defects existed in this
repository until the DoD repair landed, and a repaired repository necessarily
fails all four assertions.

This directory preserves that pre-repair shape so those cases keep proving what
they were written to prove — that the checker *detects* those defect shapes —
rather than being deleted as soon as the repository stopped exhibiting them.
`pnpm harness:verify` points `CANDIDATE_ROOT` here. `pnpm verify:dod` separately
runs the checker against the live tree, which must be `PASS`.

The two commands assert opposite verdicts on purpose. A detection test that can
only pass while the product is broken is not a durable test.

## Expected verdict

```text
DOD_GATE_VACUOUS      pnpm lint  turbo task "lint" has 0 implementers
DOD_GATE_NOT_ENFORCED pnpm lint  not invoked by any pull_request workflow
DOD_GATE_NOT_ENFORCED pnpm test  not invoked by any pull_request workflow
DUPLICATE_DOD_LIST    docs/CONTEXT.md
DoD integrity: FAIL (4 declared gates, 4 findings)
```

`@fx/a` implements `typecheck` and `test` but not `lint`, which is what makes
`lint` vacuous while `test` is merely unenforced — the two failure modes have to
stay distinguishable. The workflow schedules `install` and `typecheck` only.

## Why the directory name starts with a dot

`findPackageJsons()` skips any entry beginning with `.`, so this fixture cannot
be picked up as a workspace of the real repository. Without that, its
`packages/a/package.json` would count as an implementer of the real repo's
`turbo run` tasks and could mask a genuine vacuous-gate regression upstream.
The dot is load-bearing, not cosmetic.

Nothing here is built, installed, or executed. These files are read-only input
to the checker.
