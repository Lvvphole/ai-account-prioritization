# Context — process & engineering philosophy

## Project planning: Agile Scrum

- **Product Owner** — product intent, scope, user outcomes, acceptance criteria.
- **Scrum Master** — workflow discipline, sprint boundaries, blockers, DoD.
- **Developer Agent** — code, tests, schemas, docs, CI, build scripts.
- **Verifier Agent** — typecheck, tests, evals, schema generation, CI parity,
  final product gates. Owns completion judgment.
- **Evaluator Agent** — confirms the implementation still satisfies the
  architecture, safety, and product promise.

## Execution philosophy: Strategic Programming (strict)

```
contract → plan → execute → verify → evaluate → iterate → stop
```

- **Contract** — exact target and constraints.
- **Plan** — files, dependencies, acceptance checks.
- **Execute** — modify only required files.
- **Verify** — run commands, inspect output.
- **Evaluate** — compare result against the product contract.
- **Iterate** — fix failures only.
- **Stop** — when gates pass or a blocked state is reached.

The executor never self-certifies; the verifier owns completion. On a failed
verification, stop and report the failing command/file/error.

## Sprint history (as delivered)

| Sprint | Scope | Exit gate |
| --- | --- | --- |
| 0 | Repo & build foundation | `pnpm install`, `pnpm build` |
| 1 | Shared schemas | `pnpm generate:schemas` |
| 2 | Agent runtime core | `pnpm typecheck` |
| 3 | Domain agents & tools | `pnpm test:evals` |
| 4 | Web app | `pnpm build` |
| 5 | Python support service | `pnpm build:api-python` |
| 6 | Eval & judge gates | `pnpm test:evals`, `EVAL_JUDGE_ENABLED=true pnpm test:judge` |
| 7 | Final verification & push | full gate sequence |

## Definition of Done

```bash
pnpm install
pnpm generate:schemas
pnpm build
pnpm typecheck
pnpm test:evals
```

No unstaged changes · no TS errors · no failed evals · no schema-generation
failure · no runtime↔judge coupling · no weakened approval gates · no direct push
to `main`.
