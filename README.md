<div align="center">

# AI Account Prioritization Agent

**Turn CRM data into a clear daily sales action plan.**

[![CI](https://github.com/Lvvphole/ai-account-prioritization/actions/workflows/ci.yml/badge.svg)](https://github.com/Lvvphole/ai-account-prioritization/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20-3c873a)
![pnpm](https://img.shields.io/badge/pnpm-10.33-f69220)

</div>

This product helps sales teams decide **who to contact, why the account matters, what to do next, and what to say**.

AI can help write a message. It does not decide which accounts are important, change account priority, approve a recommendation, or publish one.

---

## What this product does

Sales representatives often spend time sorting through CRM data before they can decide where to focus. This product turns that information into a prioritized daily action plan.

For each account, it answers six questions:

| Question | What you get |
| --- | --- |
| Who should I contact first? | A prioritized list of accounts |
| Why is this account important? | Clear reasons based on verified account information |
| What should I do next? | A recommended next action |
| What should I say? | A ready-to-use message based on verified information |
| Where did this information come from? | The source behind the recommendation |
| Is it ready to use? | A clear status that shows whether the recommendation is ready or needs review |

## How it works

The product follows a simple path:

**Account data → Priority → Reason → Next action → Message → Review**

The system checks account information before it creates a recommendation. It uses fixed scoring rules to rank accounts and select the next action.

AI can help turn verified information into a useful message. If AI is unavailable or its output does not pass the required checks, the system can use an approved template or hold the recommendation for review.

Before a recommendation can be published, the system checks its information, permissions, and approval status. Customer-facing sends and CRM write-backs require human approval.

If the system cannot verify required information, it does not guess. It holds the recommendation and records why.

## The goal

Help sales teams spend less time deciding **who to contact, why to contact them, and what to say**, while keeping recommendations tied to information that can be checked.

## What users can expect

- **A consistent priority list.** The same account inputs use the same scoring and ranking rules.
- **Clear reasons.** Each recommendation explains why an account needs attention.
- **Source-backed information.** Important claims must connect to verified source information.
- **A recommended action.** The system selects the next action from the approved action set.
- **Message support.** The system can provide an approved template and, when enabled, a grounded AI draft.
- **Human control.** Protected customer-facing actions and CRM writes require approval.
- **Safe failure.** Missing evidence, failed checks, or missing approval hold the recommendation instead of publishing it.
- **An audit trail.** Important decisions, approvals, failures, and publishes are recorded.

## Current status

The deterministic baseline is implemented. It includes:

- account scoring and stable ranking
- reason codes and verified source signals
- deterministic template drafts
- synchronous guardrails
- human approval
- audit and observability records
- deterministic evaluations and a separate asynchronous LLM judge

The approved architecture also supports a bounded runtime AI drafting path. That path is not yet implemented. The deterministic template path remains active until the required schema, grounding, security, telemetry, and deployment checks pass.

The next implementation work is to connect runtime persistence to the web workspace, add the generated-draft schema and model adapter, construct the minimum verified context, validate generated claims against their sources, preserve the deterministic fallback, and add generation evaluations and rollout controls.

## Product workspace

The application has four main areas:

| Area | Purpose |
| --- | --- |
| Sales representative | View prioritized accounts, supporting information, drafts, approvals, and exports |
| Manager | Review exceptions, held recommendations, coverage, and revenue at risk |
| Admin | Manage operations, data health, policy, evaluations, users, audit records, and environments |
| Sign-in and landing | Enter the application and select the permitted role |

The web workspace currently uses demonstration data. A production connection to persisted runtime recommendations is still required.

## Safety and trust

The product keeps high-consequence decisions outside the AI model.

The model cannot rank accounts, change permissions, approve its own work, publish a recommendation, or perform protected customer-facing actions. CRM and customer text are treated as data, not as instructions to the system.

A recommendation is held when required evidence is missing, a claim cannot be supported, a safety check fails, permission is missing, or approval has not been given.

For the detailed authority, verification, security, and publication rules, see [`AGENTS.md`](./AGENTS.md) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

# Developer guide

The sections below are for contributors who need to run, test, or change the application.

## Project structure

```text
apps/
  agent-runtime/   Recommendation runtime
  web/             Next.js sales, manager, account, and admin workspace
  api-python/      FastAPI support service
packages/
  shared-schemas/  Zod schemas and JSON Schema generation
  supabase-client/ Typed Supabase clients and generated database types
  security/        Access, approval, PII, and security policy
  observability/   PII-safe events and telemetry
  testing-evals/   Deterministic and asynchronous evaluations
  config-*/        Shared TypeScript and ESLint configuration
infra/             Docker Compose and service Dockerfiles
supabase/          Migrations, Row Level Security policies, seed, and configuration
scripts/           Build and verification helpers
docs/              Product, architecture, context, and decision records
.github/workflows/ CI, evaluation, security, and deployment workflows
```

## Configuration

Copy `.env.example` to `.env` and add only the values that you need. Never commit secrets.

| Group | Variables | Purpose |
| --- | --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` | Database, authentication, and access control |
| Judge | `EVAL_JUDGE_ENABLED`, `ANTHROPIC_API_KEY`, `EVAL_JUDGE_MODEL` | Asynchronous evaluation only |
| CRM | `CRM_BASE_URL`, `CRM_API_KEY` | External CRM source; mock use is limited to non-production environments |
| Approval | `REQUIRE_HUMAN_APPROVAL` | Required approval control |
| Observability | `SENTRY_*`, `LANGFUSE_*` | Error and trace services |

Runtime drafting variables will be added when the model adapter is implemented.

## Run the checks

```bash
pnpm install --frozen-lockfile
pnpm generate:schemas
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm test:evals
pnpm verify:security
pnpm verify:observability
pnpm verify:production
```

Optional asynchronous judge:

```bash
EVAL_JUDGE_ENABLED=true pnpm test:judge
```

## Testing

The current deterministic tests cover scoring, stable ranking, guardrails, adversarial security, and a golden run.

The runtime AI drafting implementation must add deployment-blocking tests for:

- generated-output schema
- protected-field immutability
- claim-to-source grounding
- prompt-injection resistance
- model timeout and token budgets
- deterministic fallback
- approval and publication separation
- model and prompt provenance

These runtime-generation checks are planned and are not currently shipped. The LLM judge remains outside the live recommendation path.

## Deployment

- Validate containers with `pnpm docker:config`.
- Build images with `pnpm docker:build`.
- Deploy `apps/web` on Vercel with Root Directory `apps/web`.
- Apply `supabase/migrations` before production traffic.
- Use `ci.yml`, `evals.yml`, `security.yml`, and `deploy.yml` as promotion gates.
- Do not enable runtime AI drafting until its implementation-specific checks pass.

## Contributing

Read [`AGENTS.md`](./AGENTS.md) before you make a change. It is the repository operating contract.

Do not push directly to `main`. Use a branch and a reviewed pull request.

## Technical documentation

The README is the product entry point. Detailed implementation and governance information stays in the repository documentation so that users do not need to understand the internal architecture to understand the product.

- [`AGENTS.md`](./AGENTS.md) — repository operating contract
- [`docs/PRD.md`](./docs/PRD.md) — product requirements
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — detailed system design
- [`docs/CONTEXT.md`](./docs/CONTEXT.md) — delivery process
- [`docs/decisions/ADR-001-hybrid-runtime-drafting.md`](./docs/decisions/ADR-001-hybrid-runtime-drafting.md) — approved AI authority boundary
- [`docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md`](./docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md) — harness economics and minimum-sufficient-control doctrine

## License

MIT. See `package.json`.
