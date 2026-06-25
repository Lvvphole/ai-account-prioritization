# AGENTS.md — Coding-Agent Operating Contract

This file is the operating contract for any coding agent (or human) working in
this monorepo. It encodes the **non-negotiable execution rules** and the
**Strategic Programming (strict)** workflow. Read it before changing code.

## 0. Product in one sentence

Turn messy B2B CRM/account data into a **verified daily sales action plan**: which
accounts to contact first, why, what to do next, the evidence behind it, and
whether it passed every safety, schema, permission, and eval gate.

## 1. Non-negotiable execution rules

1. The LLM **must not** rank accounts.
2. **Deterministic scoring** decides account rank.
3. **TypeScript/Zod** is the schema source of truth.
4. **Python** consumes generated JSON Schema artifacts only (never imports TS).
5. Runtime guardrails are **synchronous, deterministic, low-latency**.
6. LLM-as-a-judge is **asynchronous and outside** the runtime path.
7. **Human approval** is required before customer-facing sends or CRM write-back.
8. Every recommendation includes **score, confidence, reason codes, source
   signals, and next best action**.
9. No recommendation publishes **without verification**.
10. No **unsupported customer-facing claims**.
11. No **fabricated** account facts, dates, contacts, prior conversations,
    discounts, approvals, availability, or customer intent.
12. Every critical action creates **audit evidence**.
13. Every eval gate is **executable through Turborepo**.
14. The executor **must not self-certify** completion.
15. The **verifier** owns completion judgment.
16. If verification fails, **stop and report** the failing gate.

## 2. Strategic Programming (strict) workflow

```
contract → plan → execute → verify → evaluate → iterate → stop
```

Do not continue building after a failed verification without reporting it.

## 3. Definition of Done (the gates)

```bash
pnpm install
pnpm generate:schemas
pnpm build
pnpm typecheck
pnpm test:evals
# optional judge gate (deployment-blocking when EVAL_JUDGE_ENABLED=true):
EVAL_JUDGE_ENABLED=true pnpm test:judge
```

Completion requires: no unstaged changes, no TypeScript errors, no failed evals,
no schema-generation failure, no runtime↔judge coupling, no weakened approval
gates, no direct push to `main`.

## 4. Architecture map (where things live)

| Concern | Path |
| --- | --- |
| Schema source of truth (Zod) | `packages/shared-schemas/src` |
| JSON Schema generation | `packages/shared-schemas/scripts/generate-json-schemas.ts` |
| Deterministic runtime (orchestrator, scoring, guardrails) | `apps/agent-runtime/src` |
| Deterministic scoring | `apps/agent-runtime/src/agents/account-prioritizer` |
| Synchronous guardrails | `apps/agent-runtime/src/agents/orchestrator/orchestrator.guardrails.ts` |
| Web UI (rep / manager / admin) | `apps/web/app` |
| Python support service | `apps/api-python/src` |
| Deterministic evals + async judge | `packages/testing-evals/src` |

## 5. The runtime path is sacred

```
orchestrator → Zod state validation → deterministic scoring → deterministic
guardrails → permission/approval gate → audit log → analytics → publish
```

There is **no model call** in this path. LLM narration and the judge are kept out
of it. Keep it that way.

## 6. Schema workflow

1. Edit Zod schemas in `packages/shared-schemas/src`.
2. Add new schemas to `SCHEMA_REGISTRY` in `src/index.ts`.
3. Run `pnpm generate:schemas` (writes to both `packages/shared-schemas/generated`
   and `apps/api-python/src/schemas/generated`).
4. Never hand-edit generated JSON; never import TS into Python.
