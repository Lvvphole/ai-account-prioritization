# DoD-integrity harness

Proves that the declared Definition of Done is honest. A declared gate set is not
trustworthy merely because the list exists.

For every gate in `prd_manifest.yaml:definition_of_done`:

1. **Resolvable** — the root `pnpm` command exists.
2. **Real execution target** — a recognized execution form, with turbo fan-out
   having at least one implementer and script files present. Unrecognized forms
   fail closed rather than being assumed valid.
3. **PR enforced** — an actual `pull_request` workflow `run:` step schedules it.
   YAML comments, env strings, shell comments, and deploy-only workflows do not
   count.
4. **Single authority** — no second document independently reproduces the
   command list.

It also reports, without judging, the PR-scheduled root `pnpm` commands that
Artifact DoD does not declare, so each can be explicitly classified.

## Two commands, deliberately classified apart

| Command | Asserts | Artifact DoD? |
| --- | --- | --- |
| `pnpm verify:dod` | the checker's verdict on **this repository** | yes — it is a property of the artifact |
| `pnpm harness:verify` | the checker's **own test suite** | no — it is a property of the mechanism |

`harness:verify` points `CANDIDATE_ROOT` at `.fixtures/unrepaired`, which
preserves the pre-repair defect shape. The two commands assert opposite verdicts
on purpose: see that fixture's README.

## What this proves, and what it does not

It proves every declared gate is resolvable, has a real execution target, and is
PR-enforced. It does **not** prove that an arbitrary gate is capable of failing,
and it does not prove that every undeclared PR command is correctly classified —
it reports those for a human to classify.

Direct CI plumbing (`git diff --check`, the Docker steps) stays outside the
declared set. A new Artifact DoD property must first receive a versioned root
command before it can be declared; CI plumbing does not silently redefine
Artifact DoD.

## Revision status — read before trusting a green run

> `verify-dod-integrity.mjs` and `test/dodintegrity.test.mjs` in this directory
> are the **pre-D11/D12 revision** and are pending replacement by the frozen
> 16-test revision. They are committed unmodified, exactly as received.

Measured, not inferred:

- the test file runs **14 tests, not 16**;
- `readYamlList` terminates the gate list at the first comment line inside it
  (D11 absent), which is why the manifest keeps its explanatory comments *above*
  `definition_of_done:` rather than inside the list;
- the execution-target recognizer accepts only `turbo run`, `bash`, and
  `pnpm --filter` — there is no `node [flags] <file>` form (D12 absent).

**Consequence:** `pnpm verify:dod` currently reports

```text
DOD_GATE_UNRECOGNIZED_FORM  pnpm verify:dod  unrecognized script form: node scripts/harness/verify-dod-integrity.mjs .
DoD integrity: FAIL (14 declared gates, 1 findings)
```

That single finding is the checker rejecting itself — precisely the case D12
exists to fix — not a defect in this repository. Confirmed by running an
unmodified copy of this checker with only node-form support added, against this
same tree:

```text
DoD integrity: PASS (14 declared gates, 0 findings)
```

The repository repair is therefore complete. Replacing the two files above with
the frozen revision, changing nothing else, is expected to turn `verify:dod`
green. If it does not, that difference is evidence to diagnose — not a reason to
edit the checker or the manifest.
