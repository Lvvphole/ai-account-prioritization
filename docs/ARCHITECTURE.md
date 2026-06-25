# Architecture

## Pattern

**Turborepo-based modular agentic application** using a **co-located
agent-module pattern**, supported by:

- bounded, self-checking, human-in-the-loop workflow
- deterministic core + guarded LLM generation
- eval-gated CI/CD
- shared-schema contract pattern
- MCP-compatible tool registry

## Monorepo layout

```
apps/agent-runtime     Deterministic agent runtime (TypeScript)
apps/web               Next.js UI (rep / manager / account / admin)
apps/api-python        Isolated FastAPI support service
packages/shared-schemas TypeScript/Zod source of truth + JSON Schema generation
packages/testing-evals  Deterministic evals + async LLM-as-a-judge
packages/config-*       Shared TS / ESLint config
```

## Two paths, kept separate

### Runtime path (synchronous, deterministic — no LLM judge)

```
orchestrator.agent.ts
  → orchestrator.state.ts        (Zod-validated state machine)
  → account-prioritizer          (deterministic score + rank)
  → sales-execution              (template drafts from verified signals)
  → orchestrator.guardrails.ts   (regex/policy, source verification, permission)
  → human approval gate
  → audit log + analytics
  → publish
```

Runtime checks: Zod state validation, regex/policy guardrails, source-signal
verification, permission check, human approval gate, audit log, analytics event.

### Evaluation path (asynchronous — outside runtime)

```
packages/testing-evals
  → deterministic evals (scoring, guardrails, security, golden run)
  → historical fixtures
  → LLM-as-a-judge (model when enabled+keyed; deterministic heuristic otherwise)
  → threshold check
  → CI/CD gate
```

The judge is runtime-nonblocking and becomes **deployment-blocking** when
`EVAL_JUDGE_ENABLED=true`.

## Schema path

```
packages/shared-schemas/src           (Zod — source of truth)
  → pnpm generate:schemas
    → packages/shared-schemas/generated/json-schema
    → apps/api-python/src/schemas/generated
```

Python consumes generated JSON Schema artifacts only; it never imports
TypeScript.

## Determinism guarantees

- Scoring is a pure weighted sum of features (`config/runtime.ts` weights).
- Ranking is score-desc with a stable `accountId` tie-break.
- The narrative is template-built from reason codes + verified signals (no
  free-form model text in the runtime path), so it cannot contain fabricated
  claims.
- Given the same inputs, a run is byte-for-byte reproducible (asserted by the
  golden eval).

## Fail-closed behavior

Any failed gate — invalid schema, unverified signal, unsupported claim, missing
approval, or sub-floor confidence — marks the recommendation unverified and it is
**not published**; it appears in the manager's "held/blocked" view with the
failing gate(s), and an audit entry is written.
