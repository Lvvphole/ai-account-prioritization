---
name: ci-checks
description: >
  Run CI verification checks locally before pushing. Use this skill whenever the
  user asks to run CI, checks, gates, verification, linting, or wants to validate
  their changes before pushing or opening a PR. Also use it when CI has failed and
  the user wants to reproduce or debug a failure locally, or when they ask "what
  checks does this repo run?" or "how do I verify my changes?" Trigger on: "run
  checks", "run CI", "verify", "pre-push", "gates", "lint", "typecheck", "build",
  "test", "evals", "security scan", "schema drift", "acceptance test", "docker
  build", "migration lint", "production verification", "completion gate".
---

# CI Checks

This skill documents every CI gate in the repository and provides commands to
run them locally. The checks are organized by the GitHub Actions workflow they
belong to, with shortcuts for running common subsets.

## Quick reference — run groups

Use these grouped commands to run a targeted subset of checks. Each group
matches one CI workflow or a common local need. All commands assume
`pnpm install --frozen-lockfile` has already been run.

### Full canonical completion gate

This is the Definition of Done from AGENTS.md section 13. Run every gate:

```bash
pnpm install --frozen-lockfile
pnpm scan:secrets
pnpm generate:schemas
git diff --exit-code -- packages/shared-schemas/generated apps/api-python/src/schemas/generated
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm test:evals
pnpm build:api-python
pnpm check:no-prisma
pnpm verify:security
pnpm verify:observability
pnpm verify:migrations
pnpm docker:config
pnpm docker:build
pnpm verify:production
git diff --check
```

> **Note:** `pnpm verify:production` is the canonical production verification
> script, but it may not yet include every gate listed above. Run the individual
> commands separately to ensure full coverage until the script catches up.

### Fast local checks (no Docker, no DB)

The quickest feedback loop — catches most issues without infrastructure:

```bash
pnpm generate:schemas
git diff --exit-code -- packages/shared-schemas/generated apps/api-python/src/schemas/generated
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm test:evals
pnpm check:no-prisma
```

### Schema checks only

Verify Zod→JSON Schema generation has no drift:

```bash
pnpm generate:schemas
git diff --exit-code -- packages/shared-schemas/generated apps/api-python/src/schemas/generated
```

### Security checks only

Matches the Security workflow:

```bash
pnpm scan:secrets
pnpm verify:security
pnpm check:no-prisma
pnpm verify:observability
```

> The zizmor GitHub Actions workflow audit runs only in CI (it needs
> `fetch-depth: 0` and the zizmor action). Locally, review workflow changes
> manually or install [zizmor](https://github.com/zizmorcore/zizmor) CLI.

### Evals only

```bash
pnpm test:trajectory
pnpm test:evals
pnpm test:judge
```

> `pnpm test:judge` uses a deterministic heuristic fallback when no provider API
> key is set. This is acceptable for local/CI runs but is not evidence that the
> model judge passed.

### Docker / containerization checks

Requires Docker daemon:

```bash
docker compose -f infra/compose.yaml config
docker compose -f infra/compose.yaml build
```

Or via pnpm aliases:

```bash
pnpm docker:config
pnpm docker:build
```

### Acceptance A — deterministic baseline

Runs the full deterministic daily runtime with AI disabled, then runs the
migration verifier and durable continuity suite:

```bash
pnpm test:acceptance:a
```

### Migration lint

Requires Docker (for PostgreSQL) and the pinned Supabase CLI v2.111.0:

```bash
pnpm verify:migrations
pnpm db:lint --db-url "$DATABASE_URL"
```

This workflow in CI starts a controlled PostgreSQL container on port 54329 and
creates a `migration_lint` database. To reproduce locally, either:
- Use `supabase start` if you have Supabase CLI installed, or
- Start PostgreSQL manually:
  ```bash
  docker run --detach --name migration-lint-postgres \
    --env POSTGRES_PASSWORD=postgres --publish 54329:5432 \
    ghcr.io/supabase/postgres:15.8.1.085
  ```
  Then set `DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:54329/migration_lint?sslmode=disable`.

### Production verification

```bash
pnpm verify:production
```

### Harness kernel (PR to main only)

Verifies affected repository contracts between two commits. Requires base and
head SHAs — typically only meaningful in a PR context:

```bash
pnpm harness:verify --base <base-sha> --head <head-sha> --evidence verification-reports/harness-evidence.json
```

---

## Workflow-by-workflow reference

### 1. CI (`ci.yml`)

**Triggers:** all pushes, all PRs

| Step | Command | Infrastructure |
|------|---------|---------------|
| Install deps | `pnpm install --frozen-lockfile` | — |
| Generate schemas | `pnpm generate:schemas` | — |
| Schema drift check | `git diff --exit-code -- packages/shared-schemas/generated apps/api-python/src/schemas/generated` | — |
| Build | `pnpm build` | — |
| Typecheck | `pnpm typecheck` | — |
| Deterministic evals | `pnpm test:evals` | — |
| Python build | `pnpm build:api-python` | Python 3.11 |
| No-Prisma guard | `pnpm check:no-prisma` | — |
| Acceptance A | `pnpm test:acceptance:a` | — |
| Docker Compose config | `docker compose -f infra/compose.yaml config` | Docker |
| Docker image build | `docker compose -f infra/compose.yaml build` | Docker |

### 2. Security (`security.yml`)

**Triggers:** all pushes, all PRs

| Step | Command | Infrastructure |
|------|---------|---------------|
| Workflow audit | zizmor action (CI only) | — |
| Secret scan | `pnpm scan:secrets` | — |
| Security controls | `pnpm verify:security` | — |
| No-Prisma guard | `pnpm check:no-prisma` | — |
| Observability | `pnpm verify:observability` | — |

### 3. Evals (`evals.yml`)

**Triggers:** all pushes, all PRs, manual dispatch

| Step | Command | Infrastructure |
|------|---------|---------------|
| Trajectory check | `pnpm test:trajectory` | — |
| Deterministic evals | `pnpm test:evals` | — |
| Judge eval (offline) | `pnpm test:judge` | — |

### 4. Harness Kernel (`harness-kernel.yml`)

**Triggers:** PRs to `main` only

| Step | Command | Infrastructure |
|------|---------|---------------|
| Contract verification | `pnpm harness:verify --base $BASE --head $HEAD --evidence verification-reports/harness-evidence.json` | — |

### 5. Migration Lint (`migration-lint.yml`)

**Triggers:** PRs/pushes touching `supabase/` paths

| Step | Command | Infrastructure |
|------|---------|---------------|
| Apply & verify migrations | `pnpm verify:migrations` | PostgreSQL, Docker |
| Lint public schema | `pnpm db:lint --db-url $DATABASE_URL` | Supabase CLI v2.111.0 |

### 6. Production Verification (`production-verification.yml`)

**Triggers:** PRs to `main` only

| Step | Command | Infrastructure |
|------|---------|---------------|
| Merge candidate identity | (CI only — verifies base/head SHA) | — |
| Full production gate | `pnpm verify:production` | Python 3.11 |

### 7. Deploy (`deploy.yml`)

**Triggers:** pushes to `main`, manual dispatch

| Step | Command | Infrastructure |
|------|---------|---------------|
| Production contract gate | `pnpm verify:production` | Python 3.11 |
| Deploy | placeholder | — |

---

## Infrastructure requirements

| Requirement | Needed by |
|-------------|-----------|
| Node 22 + pnpm | Everything |
| Python 3.11 | `build:api-python`, `verify:production` |
| Docker daemon | `docker:config`, `docker:build`, migration lint |
| Supabase CLI v2.111.0 | `db:lint` |
| PostgreSQL (via Docker) | `verify:migrations`, `db:lint` |

---

## How to use this skill

When asked to "run checks", "run CI", or "verify changes", choose the
appropriate group based on what the user changed:

- **Schema changes** (`packages/shared-schemas/`): run schema checks, then fast local checks.
- **Security-sensitive changes** (`packages/security/`, workflows): run security checks.
- **Migration changes** (`supabase/`): run migration lint (needs Docker + Supabase CLI).
- **Any code change**: run fast local checks as a minimum.
- **Before opening a PR to main**: run the full canonical completion gate.
- **CI failure reproduction**: identify which workflow/step failed and run that specific command.

When running checks, execute them in order and stop on the first failure so the
user can fix it before proceeding. Report which gate failed and the error output.
