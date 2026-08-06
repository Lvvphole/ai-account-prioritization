# Context — process and engineering philosophy

## Project planning: Agile Scrum

- **Product Owner** — product intent, scope, user outcomes, acceptance criteria.
- **Scrum Master** — workflow discipline, sprint boundaries, blockers, DoD.
- **Developer Agent** — code, tests, schemas, prompts, docs, CI, build scripts.
- **Verifier Agent** — typecheck, tests, evals, schema generation, CI parity,
  runtime authority checks, and final product gates. Owns completion judgment.
- **Evaluator Agent** — confirms the implementation still satisfies the
  architecture, safety, grounding, cost, latency, and product promise.

These project roles do not imply that supervisor-worker runtime fan-out is part of
the current production-spine implementation.

## Execution philosophy: Strategic Programming (strict)

```text
contract → baseline → plan → execute → verify → evaluate → iterate → stop|blocked
```

- **Contract** — exact target, authority boundaries, constraints, non-goals, and
  acceptance evidence.
- **Baseline** — inspect current behavior, schemas, prompts, tests, data paths,
  and telemetry before changing them.
- **Plan** — identify files, dependencies, model boundaries, fallbacks, and gates.
- **Execute** — modify only the coherent change set. Use direct execution when it
  is sufficient. Use bounded supervisor-worker execution only when the current
  implementation scope explicitly permits it.
- **Verify** — run executable checks and inspect evidence.
- **Evaluate** — compare the result against the product and architecture
  contracts, not merely compilation success.
- **Iterate** — fix only evidenced failures.
- **Stop** — when verifier-owned gates pass or a typed blocked state is reached.

The executor never self-certifies; the verifier owns completion.

## Position B hybrid AI engineering rule

The approved target architecture uses deterministic authority envelopes around
bounded probabilistic What and How.

```text
deterministic authority envelope
  → bounded model What and How when the task contract permits it
  → deterministic schema, grounding, and postcondition verification
  → explicit human approval for protected side effects
  → protected execution when authorized
  → PASS | FAIL | BLOCKED
```

The target architecture can permit bounded semantic mapping, candidate-action
selection inside a software-supplied action envelope, allowlisted tool selection
and sequencing, task decomposition, bounded subagent delegation, worker-result
synthesis, and bounded recovery.

The model cannot create or widen goals, scope, tools, resources, permissions,
budgets, action authority, side-effect authority, publication authority, or
completion authority.

## Approved target versus current production spine

Target-architecture approval does not authorize implementation.

The current production spine keeps account eligibility, score, rank, confidence,
reason codes, source evidence, and next-best-action type deterministic. The model
remains limited to bounded drafting and synthesis with deterministic fallback or
hold.

Current P4 is limited to the provider-neutral model boundary, provider-native
constrained output, normalized reasoning or effort configuration, full model and
prompt identity evidence, offline cross-model k-run qualification, one qualified
production configuration at a time, deterministic fallback or hold, and the two
production acceptance profiles defined in `docs/PRD.md` and
`docs/ARCHITECTURE.md`.

The following approved target capabilities remain deferred from current P4:

- model-controlled candidate-action selection;
- a capability resolver driven by model-selected What;
- general tool orchestration, workflows, or side-effecting model tools;
- supervisor-worker fan-out or subagent delegation;
- multi-model routing or majority voting;
- a second action ontology beyond the current deterministic set; and
- production caching infrastructure.

A deferred capability requires a new explicit ruling and the applicable ADR-002
admission evidence before implementation.

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
3. Preserve the generated-draft schema, minimum context, grounding, and fallback
   boundaries already used by bounded drafting.
4. Complete only the authorized P4 provider-neutral model boundary and
   qualification work.
5. Preserve deterministic next-best-action selection for the current spine.
6. Preserve deterministic template fallback or hold.
7. Add or update deterministic, generative, security, and qualification evals
   required by the P4 change.
8. Preserve measured latency, token, cost, fallback, prompt, schema, policy, and
   model identity evidence when telemetry is available.
9. Enable only one qualified production model configuration at a time.
10. Prove the deterministic-baseline and qualified-model production acceptance
    profiles.
11. Promote only after all applicable gates pass.
12. Do not implement deferred Position B capabilities without a new explicit
    ruling and ADR-002 admission.

## Definition of Done

```bash
pnpm install --frozen-lockfile
pnpm scan:secrets
pnpm generate:schemas
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm test:evals
pnpm verify:security
pnpm verify:observability
pnpm verify:production
git diff --check
```

Runtime-generation changes additionally require evidence that:

- model work cannot widen software-owned authority;
- output schema failures fail closed;
- every accepted factual claim that requires evidence is grounded;
- prompt injection cannot alter authority or control flow;
- timeout, token, attempt, and fallback policies are enforced;
- human approval and deterministic publication authority remain intact;
- the async judge is not coupled into the live runtime; and
- current P4 changes do not introduce any deferred Position B capability.

No unstaged or unrelated changes, no schema-generation drift, no failed gates,
no weakened approval or RLS controls, and no direct push to `main`.
