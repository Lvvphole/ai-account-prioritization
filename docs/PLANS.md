# Plans

Status: canonical
Owner: engineering
Verification: `pnpm verify:knowledge`

## Purpose

Plans separate temporary execution state from permanent repository policy.

Use a lightweight local plan for a small single-file change. Use a checked-in execution plan when a change crosses architecture, authority, schema, persistence, security, deployment, or several packages.

## Locations

```text
docs/exec-plans/active/       work in progress
docs/exec-plans/completed/    finished plans kept for history
docs/exec-plans/tech-debt-tracker.md
```

## Required sections for an execution plan

1. Goal
2. Desired state
3. Contract and non-goals
4. Baseline evidence
5. Requirements
6. Design decision
7. Build steps
8. Verification evidence
9. Review findings and classification
10. Exit condition
11. Decision log

## Review-loop rule

Do not turn review comments into permanent architecture one at a time.

When the same defect class appears again:

```text
stop patching
  -> update the plan with the defect class
  -> return to the owning design invariant
  -> simplify or replace the mechanism
  -> build one coherent repair
  -> run class-level verification
```

## Plan completion

Move a plan from `active` to `completed` only after the merge gate in `docs/VERIFICATION.md` passes.

Do not delete decision history that explains why an architectural path was selected or rejected.
