# Read-only discipline, access modes, and evidence citation

Read this at the start of a scouting run.

## Contents

- [Access mode decision table](#access-mode-decision-table)
- [Repo acquisition](#repo-acquisition)
- [Permitted commands](#permitted-commands)
- [Forbidden commands](#forbidden-commands)
- [Evidence citation format](#evidence-citation-format)
- [High-signal search patterns](#high-signal-search-patterns)

## Access mode decision table

Check what is actually available before assuming a mode.

| Available | Mode | How you read |
|---|---|---|
| Shell + repo path on disk | **Local clone** | `ls`, `find`, `rg`/`grep -n`, `sed -n`/`head`, read-only `git` |
| GitHub connector / MCP tools | **Connector** | Repo tree, file contents, commits, issues, PRs, CI runs via the tool |
| Web fetch only | **Web** | Fetch repo pages and raw file URLs; slower, so lean harder on targeted paths |
| None of the above | **Blocked** | Ask the user for a clone path or repo URL. Do not infer contents from the repo name. |

Modes combine. A local clone plus a connector lets you read working-tree state *and*
open PRs and CI results — say so in Sources examined when you use both.

State the mode in section 2 of the report. It tells the downstream agent what your
findings could and could not have covered — a connector read of `main` says nothing
about uncommitted local work.

## Repo acquisition

If the repo is named but is not present locally and no connector is available, ask the
user for an accessible clone path or repository access. Do not clone or create a scratch
copy during scouting. Report the access gap rather than proceed blind.

## Permitted commands

Observation only — nothing that changes repo state, working tree, installed packages, or
build artifacts.

```
ls, tree, find, stat, wc, file
grep -n, rg -n, ag
cat (small files only), head, tail, sed -n '<start>,<end>p'
git log, git log --oneline --stat, git show, git diff (read of existing state),
git status, git ls-files, git blame, git rev-parse, git branch --list, git tag --list,
git remote -v
```

## Forbidden commands

Not exhaustive — the principle is that nothing you run may change anything.

```
git add / commit / checkout / switch / restore / merge / rebase / pull / fetch /
  push / stash / clean / reset / tag -a / branch -d
npm install / ci / run <anything>, yarn, pnpm, pip install, poetry install,
  cargo build / run, go build, make, just, gradle, mvn
pytest, jest, vitest, go test, cargo test — including "just to see if they pass"
black, prettier, eslint --fix, ruff --fix, gofmt -w, any formatter or codegen
mkdir, touch, rm, mv, cp, chmod, any shell redirection (>, >>, tee)
docker build / run, terraform plan / apply, any deployment or migration tool
```

Two specific traps:

- **Running the test suite.** Tempting, because it directly answers "what's passing?".
  It also mutates caches, `.pytest_cache`, coverage files, and sometimes fixtures.
  Instead, report the exact command the next agent should run, cite where it is defined
  (CI config, `Makefile`, npm scripts), and infer current state from CI history, badges,
  or skip/xfail markers.
- **Installing to inspect a dependency.** Read the lockfile and the manifest instead.

User authorization never relaxes the Scout read-only boundary. If a requested action can
change repository, working-tree, dependency, cache, fixture, build, or external system
state, do not run it in Scout. Defer it to a non-Scout workflow. If that action is required
to produce a grounded Scout Report, report the evidence gap as blocked until the action is
run outside Scout and its result is supplied as evidence.

## Evidence citation format

**Files:** `path/from/repo/root.ext:120-148` — always relative to the repo root, always
with a line range when the file is more than a few lines.

**Commands:** the command as run, then a summarized result.

```
$ rg -n "def verify_" --glob '*.py'
→ 3 definitions: src/gates/structure.py:44, src/gates/faithful.py:71, src/cli.py:210
```

**Connector or web reads:** name the tool or URL and what you retrieved
(`GitHub connector → workflows/ci.yml @ main`).

**Absence is evidence too**, and it needs a citation just as much as presence — cite the
search that came up empty:

```
$ rg -n "sufficiency" --glob '!node_modules'
→ no matches; DoD criterion 3 has no corresponding implementation or test
```

Do not cite line numbers you did not actually observe. A fabricated range is worse than
no citation, because the downstream agent will trust it.

## High-signal search patterns

Cheap searches that usually pay off early:

```bash
ls -a                                        # governance files, CI dir, config
rg -n "TODO|FIXME|HACK|XXX" --glob '!node_modules'
rg -n "NotImplemented|pass  # stub|raise NotImplementedError|throw new Error\('not"
rg -n "@pytest.mark.(skip|xfail)|it.skip|test.skip|describe.skip|t.Skip"
git log --oneline -20                        # where work stopped
git log --oneline -10 --name-only            # which files are hot
find . -name "*.yml" -path "*workflow*"      # verification surface
rg -n "Definition of Done|DoD|Acceptance|acceptance criteria" -i
```

The pairing that most often produces the single best next path: recent commit history
(where work stopped) crossed with skip/stub markers (what was left undone) crossed with
the DoD criteria (what still has to be true).

## Structural localization patterns

Run these in Step 3, before opening source files. Substitute the symbol the DoD
objective turns on for `<name>`.

```bash
# where it is defined
rg -n "def <name>|class <name>|function <name>|const <name>|<name>\s*=" --glob '!node_modules'

# who calls or imports it (dependents)
rg -n "\b<name>\b" --glob '!node_modules' -l        # files, then narrow
rg -n "import.*<name>|from.*import.*<name>|require.*<name>"

# what it depends on — read the import block of the defining file
sed -n '1,40p' <defining-file>

# which tests or CI steps exercise it
rg -n "<name>" tests/ test/ spec/ 2>/dev/null
rg -n "<name>" .github/ Makefile justfile 2>/dev/null

# language-server alternative, when available: find-references on the symbol
# beats grep, because it resolves scope instead of matching text
```

Grep matches text, not scope — it over-matches on common names and misses
dynamic dispatch, reflection, and string-keyed lookups. When a name is generic,
narrow by path or file glob before widening. When a language server or
dependency-graph tool is available, prefer it and say so in Sources examined;
when it is not, say that too, because a grep-derived dependency picture has
known blind spots and the downstream agent should know which kind it got.

Read the located units complete. Reading half of a function to save tokens
produces a citation that looks grounded while the claim rests on lines you never
saw — the worst outcome available, worse than declining to make the claim.
