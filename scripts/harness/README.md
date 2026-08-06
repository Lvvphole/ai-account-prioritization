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

## Revision

`verify-dod-integrity.mjs` and `test/dodintegrity.test.mjs` are the frozen
16-test revision, installed byte-identical to the supplied archive. Neither file
is edited by this repository. If a gate fails, the defect is in the repository
or in the declaration — not something to resolve by editing the checker.

Current verdict:

```text
pnpm verify:dod      → DoD integrity: PASS (14 declared gates, 0 findings)
pnpm harness:verify  → 16/16
reverse direction    → harness:verify, test:judge
```

Two behaviours of this revision are load-bearing here, and a downgrade would
silently break them:

- **D11** lets `readYamlList` skip comment lines inside a block list. Without it
  the gate list truncates at the first comment and the declared count drops
  below 14.
- **D12** recognizes the `node [flags] <file>` execution form. Without it
  `verify:dod` — itself a node command — is reported
  `DOD_GATE_UNRECOGNIZED_FORM`, and the checker rejects itself.

An earlier commit on this branch deliberately shipped that second failure rather
than working around it, because the honest result was that the artifact revision
was wrong, not the repository.
