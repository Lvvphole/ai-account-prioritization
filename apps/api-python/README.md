# api-python — Python Support Service

An **isolated** FastAPI service that supports the AI Account Prioritization Agent.
It is intentionally _not_ on the critical path.

## What it does

- Serves the **generated** JSON Schemas (the TS/Zod source of truth, emitted by
  `pnpm generate:schemas`) at `/schemas`.
- Runs **data-quality** assessment on account records (`/data-quality/*`).
- Produces **non-authoritative analytics** over published recommendations
  (`/scoring/summary`, `/scoring/validate`).

## What it must NOT do (by contract)

- It does **not** rank accounts. The authoritative deterministic scorer lives in
  `apps/agent-runtime` (TypeScript).
- It does **not** import TypeScript. It consumes only the generated JSON Schema
  artifacts under `src/schemas/generated/`.
- It does **not** control the agent runtime, publish recommendations, or write to
  the CRM.

## Develop

```bash
# from repo root — regenerate schema artifacts first
pnpm generate:schemas

# build / syntax-check (no third-party deps required)
pnpm build:api-python

# run the service (requires deps)
cd apps/api-python
pip install -e .
uvicorn main:app --app-dir src --reload
```

Schemas are loaded from `src/schemas/generated/`. If that directory is empty,
run `pnpm generate:schemas` from the repo root.
