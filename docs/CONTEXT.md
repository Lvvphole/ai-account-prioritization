# Context — process and engineering philosophy

## Project planning: Agile Scrum

- **Product Owner** — product intent, scope, user outcomes, acceptance criteria.
- **Scrum Master** — workflow discipline, sprint boundaries, blockers, DoD.
- **Developer Agent** — code, tests, schemas, prompts, docs, CI, build scripts.
- **Verifier Agent** — typecheck, tests, evals, schema generation, CI parity,
  runtime authority checks, and final product gates. Owns completion judgment.
- **Evaluator Agent** — confirms the implementation still satisfies the
  architecture, safety, grounding, cost, latency, and product promise.

## Execution philosophy: Strategic Programming (strict)

```text
contract → baseline → plan → execute → verify → evaluate → iterate → stop|blocked
```

- **Contract** — exact target, authority boundaries, constraints, non-goals, and
  acceptance evidence.
- **Baseline** — inspect current behavior, schemas, prompts, tests, data paths,
  and telemetry before changing them.
- **Plan** — identify files, dependencies, model boundaries, fallbacks, and gates.
- **Execute** — modify only the coherent change set.
- **Verify** — run executable checks and inspect evidence.
- **Evaluate** — compare the result against the product and architecture
  contracts, not merely compilation success.
- **Iterate** — fix only evidenced failures.
- **Stop** — when verifier-owned gates pass or a typed blocked state is reached.

The executor never self-certifies; the verifier owns completion.

## Hybrid AI engineering rule

The product uses a deterministic decision core and a bounded probabilistic
language-generation stage.

```text
deterministic authority
  → minimum verified context
  → constrained candidate generation
  → deterministic verification
  → human approval
  → publish or hold
```

The model may improve expression and synthesis. It may not acquire decision,
tool, approval, verification, or publication authority.

## Sprint history and next delivery path

| Sprint | Scope | Exit gate |
| --- | --- | --- |
| 0 | Repo and build foundation | `pnpm install`, `pnpm build` |
| 1 | Shared schemas | `pnpm generate:schemas` |
| 2 | Deterministic runtime core | `pnpm typecheck` |
| 3 | Domain agents and tools | `pnpm test:evals` |
| 4 | Web application | `pnpm build` |
| 5 | Python support service | `pnpm build:api-python` |
| 6 | Deterministic and judge gates | `pnpm test:evals`, optional judge |
| 7 | Production verification foundation | full gate sequence |
| 8 | Hybrid runtime architecture contract | docs and manifest consistency |
| 9 | Runtime-to-web production bridge | persisted run visible in scoped UI |
| 10 | Generated-draft schema and model adapter | schema, typecheck, unit tests |
| 11 | Grounding, fallback, and security | grounding and adversarial evals |
| 12 | Measured rollout and promotion | production verification + judge |

## Required implementation order

1. Keep the current deterministic runtime passing.
2. Connect runtime results to durable persistence and the web workspace.
3. Add the generated-draft schema before adding provider output.
4. Add one bounded model adapter with no tools or side effects.
5. Add minimum-context and claim-grounding verification.
6. Preserve deterministic template fallback.
7. Add deterministic, generative, and security evals.
8. Add measured latency, token, cost, and fallback telemetry.
9. Enable the model path only behind explicit environment policy.
10. Promote only after all applicable gates pass.

## Definition of Done

Completion is defined by `prd_manifest.yaml:definition_of_done`, which is the
single completion authority. This document deliberately does **not** reproduce
the command list: a second copy is a second authority, and the two drift the
moment one is edited alone. `pnpm verify:dod` fails if any document reintroduces
an independent list.

Run `pnpm verify:dod` to confirm every declared gate resolves, has a real
execution target, and is scheduled by a pull_request workflow. The manifest also
classifies the gates that are required but are *not* Artifact DoD: the
`verify:production` release aggregator, the residual `test:judge` evaluation,
and the `harness:verify` control gate.

Runtime-generation changes additionally require evidence that:

- the model cannot mutate authoritative fields;
- output schema failures fail closed;
- every accepted factual claim is grounded;
- prompt injection cannot alter authority or control flow;
- timeout, token, attempt, and fallback policies are enforced;
- human approval and deterministic publication authority remain intact;
- the async judge is not coupled into the live runtime.

No unstaged or unrelated changes, no schema-generation drift, no failed gates,
no weakened approval or RLS controls, and no direct push to `main`.
