# AI Account Prioritization Agent for B2B Sales Teams

Turn messy B2B CRM/account data into a **verified daily sales action plan**: which
accounts to contact first, **why** they matter, **what** to do next, the
**evidence** behind it, and whether it passed every safety, schema, permission,
and eval gate.

> The LLM never ranks accounts. Deterministic scoring decides priority, runtime
> guardrails are synchronous and deterministic, the LLM-as-a-judge runs only in
> evals, and nothing customer-facing is sent without human approval.

## Quickstart

```bash
pnpm install
pnpm generate:schemas      # Zod -> JSON Schema (also feeds the Python service)
pnpm build                 # turbo build (schemas, runtime, web, python)
pnpm typecheck             # turbo typecheck
pnpm test:evals            # deterministic eval gates

# see a deterministic run:
pnpm --filter agent-runtime dev

# async LLM-as-a-judge (heuristic fallback when no API key):
EVAL_JUDGE_ENABLED=true pnpm test:judge
```

## What's inside

```
apps/
  agent-runtime/   Deterministic orchestrator + scoring + guardrails (TypeScript)
  web/             Next.js UI: rep dashboard, account detail, manager, admin
  api-python/      Isolated FastAPI support service (consumes generated schemas)
packages/
  shared-schemas/  TypeScript/Zod source of truth + JSON Schema generation
  testing-evals/   Deterministic evals + async LLM-as-a-judge
  config-*/        Shared TS / ESLint config
docs/              PRD, ARCHITECTURE, CONTEXT
.github/workflows/ ci.yml, evals.yml, deploy.yml
```

## The loop

```
DISCOVER → PLAN → EXECUTE → VERIFY → ITERATE → (PUBLISH)
```

Every recommendation carries **score, confidence, reason codes, verified source
signals, and a next best action**, and only publishes after passing schema,
guardrail, source-verification, and permission gates. Failures fail **closed**
and are surfaced (with the failing gate) in the manager view.

## Docs

- [`AGENTS.md`](./AGENTS.md) — coding-agent operating contract (read first).
- [`docs/PRD.md`](./docs/PRD.md) — product requirements.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design.
- [`docs/CONTEXT.md`](./docs/CONTEXT.md) — Scrum + Strategic Programming process.

## Verify the production contract

```bash
bash scripts/verify-production-contract.sh
```
