# Report template and worked example

Read this before writing your first scout report. The template is in SKILL.md; this file
shows the density, tone, and level of specificity that make a report actionable.

## Section rules

**1. DoD target** — Verifiable terms only. "Tests pass" is not a DoD; "`pytest
tests/gates/` exits 0 with all 19 cases unskipped" is. End with the scope boundary.

**2. Sources examined** — Access mode first. Then one line per artifact with a relevance
note. Include failed and empty searches. This section is what lets a downstream agent
trust the report without redoing it.

**3. Key findings** — Organize against DoD criteria, not against directory structure.
Every sentence carries a citation or is cut.

**4. Architecture / dependency summary** — Only the pieces that bear on the objective. A
full architecture tour is out of scope and dilutes the report.

**5. Single best next path** — One action. Names what and where, never how. The
justification is a gap argument: this DoD criterion is unmet, this is the nearest
unblocked work that satisfies it, these other gaps are blocked or lower-leverage.

**6. Start here** — The one or two files the next agent opens first, and why.

## Worked example

```markdown
# Scout Report: acme/ingest-pipeline — DoD gate coverage

## 1. DoD target
Per `AGENTS.md:12-31`, done means all four gates (structure, file-integrity,
sufficiency, faithfulness) run in CI and exit 0 via `make verify`. Immediate objective:
determine which gates are unimplemented and what advances that state.
Scope: `src/gates/`, `tests/gates/`, and CI config. Runtime performance and the
`web/` frontend are out of scope.

## 2. Sources examined
Access mode: local clone at `/repo` (shell), plus GitHub connector for CI history.

- `AGENTS.md:12-31` — the four-gate DoD and the `make verify` contract
- `Makefile:8-14` — `verify` target; invokes `python -m gates.cli --all`
- `src/gates/__init__.py:1-22` — gate registry; three entries registered
- `src/gates/structure.py:1-96` — implemented; validates manifest shape
- `src/gates/integrity.py:1-140` — implemented; checksum comparison
- `src/gates/sufficiency.py:1-18` — stub, raises `NotImplementedError` at :14
- `.github/workflows/ci.yml:22-30` — runs `make verify` on push to main
- `$ rg -n "faithful" --glob '!node_modules'` → no matches outside `AGENTS.md`
- `$ git log --oneline -20` → last 6 commits all touch `integrity.py`; none touch gates 3-4
- GitHub connector → CI runs on main: 8 consecutive failures, all at `make verify`

## 3. Key findings
- Two of four DoD gates are complete: structure (`src/gates/structure.py:1-96`) and
  file-integrity (`src/gates/integrity.py:1-140`), both registered
  (`src/gates/__init__.py:9-11`).
- Sufficiency exists as a stub only and raises on call (`src/gates/sufficiency.py:14`),
  but is registered in the registry (`src/gates/__init__.py:12`), so `make verify`
  currently aborts on gate 3 — this is the cause of the 8 CI failures.
- Faithfulness has no implementation, no test, and no registry entry — the term appears
  nowhere in the tree outside the DoD statement (`$ rg -n "faithful"`).
- Test convention is established: each gate has `tests/gates/test_<name>.py` with a
  fixture-driven pass/fail pair (`tests/gates/test_structure.py:1-60`). No test file
  exists for sufficiency or faithfulness.

## 4. Architecture / dependency summary
`make verify` → `gates.cli:main` (`src/gates/cli.py:18-44`) → iterates the registry in
`src/gates/__init__.py:6-13` → calls each gate's `run(manifest) -> GateResult`. Gates
share the `GateResult` dataclass (`src/gates/types.py:5-20`) and depend only on the
manifest loader (`src/gates/loader.py:30-52`). Gates are independent of each other;
adding one requires an implementation module, a registry entry, and a test file.

## 5. Single best next path
**Action:** Implement the sufficiency gate in `src/gates/sufficiency.py`, replacing the
stub at :14, with a companion `tests/gates/test_sufficiency.py` following the fixture
pair convention in `tests/gates/test_structure.py:1-60`.

**Why this is the single best path:** It is the only unmet DoD criterion that is
currently blocking the whole pipeline — sufficiency is already registered
(`src/gates/__init__.py:12`), so every `make verify` run aborts there before reaching
anything else, which accounts for all 8 CI failures. Faithfulness is the other unmet
criterion but is strictly downstream: it is unregistered, so it neither blocks CI nor
can be validated until `verify` completes a full pass. The interface is fixed and
proven twice over (`src/gates/types.py:5-20`), so the change is scoped to one module
plus one test file.

**Blockers / residual gaps:** `AGENTS.md:22-24` names sufficiency but does not define its
threshold; no fixture data for it exists under `tests/fixtures/`. The threshold must be
confirmed before implementation.

## 6. Start here
`src/gates/sufficiency.py` (the stub to replace) alongside `src/gates/integrity.py:1-140`
as the nearest complete reference implementation of the same interface.
```

## What the example demonstrates

- The blocker in section 5 is not a failure of the scout — it is the highest-value line
  in the report, because it stops the implementer from guessing a threshold.
- Faithfulness is mentioned but explicitly ranked and dismissed with a reason. That is
  not "offering options"; it is showing that the single path survived comparison.
- Absence of evidence (`rg` with no matches) is cited exactly like presence.
- Nothing was executed. CI state came from history, not from running `make verify`.

