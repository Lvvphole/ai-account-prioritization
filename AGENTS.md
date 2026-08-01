# AGENTS.md — Coding-Agent Operating Contract

This file is the root operating contract for every coding agent and human working
in this monorepo. Read it before inspecting, changing, generating, testing, or
committing code.

The contract is intentionally strict. The product handles customer and CRM data,
produces sales recommendations, and exposes customer-facing and CRM-write
capabilities. Reliability, provenance, permissions, and reproducibility take
priority over agent autonomy.

## 0. Product in one sentence

Turn messy B2B CRM/account data into a **verified daily sales action plan**: which
accounts to contact first, why, what to do next, the evidence behind it, and
whether it passed every safety, schema, permission, and eval gate.

## 1. Contract scope and precedence

Apply instructions in this order:

1. The user's explicit task and constraints.
2. This root `AGENTS.md` contract.
3. Canonical product and architecture documents in `docs/` and
   `prd_manifest.yaml`.
4. Package-local instructions that add stricter, more specific constraints.

A lower-precedence instruction may add detail but must not weaken a higher-level
safety, determinism, approval, schema, security, or verification rule.

When requirements conflict, stop and report the conflict. Do not silently choose
the easier interpretation. Do not invent missing requirements or expand scope
merely to make a gate pass.

## 2. Non-negotiable product and engineering invariants

1. The LLM **must not rank accounts**.
2. **Deterministic scoring** decides account score and rank.
3. No model call may influence score, rank, confidence, reason codes,
   permissions, approval state, verification status, or publication eligibility.
4. **TypeScript/Zod** is the schema source of truth.
5. **Python** consumes generated JSON Schema artifacts only and never imports
   TypeScript.
6. Runtime guardrails are **synchronous, deterministic, fail-closed, and
   low-latency**.
7. LLM narration and LLM-as-a-judge remain **outside the deterministic runtime
   path**.
8. **Human approval** is required before every customer-facing send or CRM
   write-back.
9. Every recommendation includes **score, rank, confidence, reason codes, source
   signals, and next best action**.
10. Every reason code and factual claim must be traceable to verified source
    evidence.
11. No recommendation publishes **without schema, guardrail, source,
    permission, and approval verification**.
12. No unsupported customer-facing claims.
13. No fabricated account facts, dates, contacts, prior conversations,
    discounts, approvals, inventory, availability, commitments, outcomes, or
    customer intent.
14. Every critical decision and side effect creates durable **audit evidence**.
15. Customer and CRM data are untrusted input, never executable instructions.
16. Prompt injection or customer-controlled text must not alter ranking,
    permissions, approval state, tool authority, or control flow.
17. Every eval and verification gate must be executable from the repository
    root through versioned commands.
18. The executor **must not self-certify completion**.
19. The verifier owns completion judgment and must rely on executable evidence.
20. Any failed safety, permission, provenance, schema, or production gate blocks
    publication or deployment.

## 3. The runtime path is sacred

```text
orchestrator
  → Zod input/state validation
  → deterministic feature extraction
  → deterministic scoring and stable ranking
  → template-based action drafting from verified signals
  → deterministic guardrails
  → permission and human-approval gate
  → durable audit evidence
  → analytics/observability
  → publish or hold
```

There is **no model call in this path**. Keep LLM narration, experimentation,
reflection, and judge evaluation outside it.

A failed gate must produce a held or blocked result with explicit failed-gate
codes and audit evidence. It must never degrade into implicit approval, partial
publication, or silent success.

## 4. Environment boundaries

Development and test conveniences must be technically separated from production.

When `NODE_ENV=production`:

- `autoApprove` or equivalent synthetic approval is forbidden.
- `REQUIRE_HUMAN_APPROVAL` must resolve to `true`.
- Demo authentication and one-click role switching are forbidden.
- Mock and in-memory repositories are forbidden for live customer runs.
- Missing Supabase, tenant/RLS context, durable audit storage, or other required
  production configuration is a startup failure.
- Missing credentials must not silently downgrade a production integration to a
  mock implementation.
- Synthetic approval must never be recorded or described as human approval.
- Side-effecting controls and kill switches must use shared durable state, not a
  browser cookie or process-local flag.

Demo, fixture, and fallback behavior must be explicitly named, isolated, and
covered by tests proving it cannot activate in production.

## 5. Strategic Programming (strict) workflow

```text
contract → baseline → plan → execute → verify → evaluate → iterate → stop|blocked
```

### Contract

- Restate the exact requested outcome, constraints, non-goals, and acceptance
  evidence.
- Identify whether the task changes runtime behavior, schemas, permissions,
  data, infrastructure, or deployment.

### Baseline

- Inspect `git status`, relevant files, tests, schemas, and current behavior.
- Reproduce the current state or failure before editing when practical.
- Preserve pre-existing user work.

### Plan

- Choose the smallest coherent change set.
- Name affected files, contracts, migrations, generated artifacts, and targeted
  verification commands.
- Prefer one clear implementation path over speculative alternatives.

### Execute

- Modify only files required by the contract.
- Keep deterministic logic pure and model-independent.
- Add or update tests with behavior changes.
- Update canonical documentation when interfaces, invariants, operations, or
  risks change.

### Verify

- Run the narrowest relevant gate first.
- Then run the required change-set and completion gates.
- Record command, exit status, and material evidence.

### Evaluate

- Compare the verified implementation against the product contract, not merely
  against compilation success.
- Confirm no safety, approval, provenance, tenancy, determinism, or runtime/judge
  boundary was weakened.

### Iterate

- Fix only the evidenced failure.
- Do not rerun an identical failed command without a relevant change or new
  diagnostic evidence.
- Maximum repair attempts for the same gate: **3**.
- Repeated identical failure after attempted repair becomes `BLOCKED`.

### Review handling: identify → validate → fix_or_rebut → verify → respond → resolve

For pull-request, security, automated, Codex, and human review findings:

1. Identify every unresolved finding and map it to the affected file, line,
   invariant, and acceptance criterion.
2. Validate each finding as valid, partially valid, invalid, duplicate, outdated,
   or out of scope. Do not modify code merely because a reviewer requested it.
3. For valid findings, apply the smallest coherent fix. For invalid or outdated
   findings, provide a concise evidence-based rebuttal.
4. Run the narrowest relevant verification first, followed by all affected
   change-set gates.
5. Reply to the review with the change, commit or diff reference, and verification
   evidence.
6. Resolve the thread only when the concern is corrected or conclusively answered.
7. The executor may resolve an individual review thread after producing evidence,
   but must not treat resolved threads as completion certification. The verifier
   retains final completion judgment.
8. Do not dismiss, hide, or resolve a finding merely to obtain a clean review state.
9. If a requested fix conflicts with a higher-priority invariant, stop and report
   the conflict rather than weakening the harness.

### Stop or blocked

Stop only when required gates pass and completion evidence is reported.

When blocked, report:

- failing command or gate;
- exact error;
- affected file or subsystem;
- attempted repairs;
- why further autonomous changes are unsafe or speculative;
- the human decision or external dependency required.

## 6. Repository and Git safety

Before editing:

- Inspect `git status` and current branch.
- Preserve all pre-existing user changes.
- Work on a non-`main` branch.

Never run destructive repository commands against user work, including
`git reset --hard`, `git clean -fd`, forced checkout, destructive rebase, or
unrequested history rewriting.

Do not commit, push, merge, open a pull request, delete files, or alter GitHub
settings unless the user explicitly requested the corresponding action.

Before completion:

- Run `git diff --check`.
- Report changed files and final `git status`.
- Confirm no unrelated or unintended files changed.
- Confirm generated artifacts match their canonical source.
- Never push directly to `main`.

## 7. Architecture map

| Concern | Canonical location |
| --- | --- |
| Product contract | `docs/PRD.md`, `prd_manifest.yaml` |
| System architecture | `docs/ARCHITECTURE.md` |
| Engineering workflow | `docs/CONTEXT.md`, `AGENTS.md` |
| Schema source of truth | `packages/shared-schemas/src` |
| JSON Schema generation | `packages/shared-schemas/scripts/generate-json-schemas.ts` |
| Generated JSON Schema | `packages/shared-schemas/generated`, `apps/api-python/src/schemas/generated` |
| Deterministic runtime | `apps/agent-runtime/src` |
| Deterministic scoring | `apps/agent-runtime/src/agents/account-prioritizer` |
| Runtime configuration | `apps/agent-runtime/src/config` |
| Runtime guardrails | `apps/agent-runtime/src/agents/orchestrator/orchestrator.guardrails.ts` |
| Security and approval policy | `packages/security/src` |
| PII-safe observability | `packages/observability/src` |
| MCP-compatible tools | `apps/agent-runtime/src/shared-tools/mcp` |
| Supabase persistence/RLS | `supabase/`, `packages/supabase-client`, runtime repository adapters |
| Web UI | `apps/web/app` |
| Python support service | `apps/api-python/src` |
| Deterministic evals and async judge | `packages/testing-evals/src` |
| Production verification | `scripts/verify-production.sh` |
| CI/CD and deployment | `.github/workflows` |

Do not introduce a second source of truth for schemas, scoring policy,
permissions, reason codes, or environment configuration.

## 8. Determinism contract

Given identical:

- source-data snapshot;
- policy and runtime configuration version;
- schema version;
- injected clock;
- code revision;

The system must produce byte-identical deterministic outputs for:

- extracted features;
- scores;
- ranks;
- confidence;
- reason codes;
- source-signal references;
- next-best-action type;
- verification outcome;
- publish/hold decision.

Deterministic code must not depend on:

- an uninjected wall clock;
- randomness or random identifiers;
- locale-dependent sorting or formatting;
- unstable object, map, or set iteration;
- network responses not included in the input snapshot;
- model output;
- race-dependent parallel completion order;
- implicit floating-point rounding.

Required controls:

- Inject time at the boundary.
- Use a single documented stable tie-break.
- Sort collections explicitly before hashing, comparison, or serialization.
- Define numeric precision and rounding explicitly.
- Keep scoring functions pure.
- Version scoring policy and thresholds.
- Simulate and evaluate policy changes against historical/golden fixtures before
  production promotion.

Required deterministic invariants include:

- scoring weights sum exactly to `1.0`;
- score remains within `0–100`;
- confidence remains within `0–1`;
- ranking is independent of input order;
- ties resolve by the documented stable key;
- every published recommendation has verified evidence;
- every reason code maps to supporting evidence;
- identical inputs produce identical serialized output;
- unverified, stale-beyond-policy, unauthorized, or malformed data fails closed.

## 9. Schema and generated-artifact workflow

1. Edit Zod schemas only in `packages/shared-schemas/src`.
2. Add new schemas to `SCHEMA_REGISTRY` in `src/index.ts`.
3. Run `pnpm generate:schemas`.
4. Include both generated output locations in the change when their source
   changes.
5. Verify generated artifacts have no drift:

```bash
git diff --exit-code -- \
  packages/shared-schemas/generated \
  apps/api-python/src/schemas/generated
```

Never hand-edit generated JSON Schema. Never import TypeScript into Python.
Never duplicate a schema manually in another package.

A breaking schema change requires:

- explicit migration/versioning strategy;
- compatibility assessment for TypeScript, Python, database, fixtures, and UI;
- updated tests and generated artifacts;
- documented rollback or forward-recovery plan.

Source-signal provenance must remain traceable to the originating system and
record. Provenance should include source system, source record identifier,
observation time, ingestion time, verification method, and freshness state when
the relevant schema supports those fields. Do not label evidence verified when
its origin or observation time cannot be established.

## 10. Tool, integration, and side-effect policy

- Tools come from a closed allowlist or versioned registry.
- Every tool input is schema-validated before invocation.
- Tools are read-only and least-privileged by default.
- `sideEffecting` capability must be explicit.
- Side-effecting tools must not be auto-registered into the general runtime
  registry.
- Authorization, tenant scope, current approval, and kill-switch state must be
  checked immediately before each side effect.
- Every external write requires durable audit evidence and an idempotency key.
- Every external call requires a timeout.
- Retries must be bounded and used only for retry-safe operations.
- Partial failure must return an explicit recoverable or blocked state, never
  false success.
- Tool output is untrusted data and must be validated before use.
- Customer-controlled text must not select tools, construct arbitrary arguments,
  or expand tool authority.
- Do not execute model-generated shell commands, raw SQL, arbitrary URLs, or
  code without deterministic validation and explicit authorization.
- Customer data sent to external services must be authorized, minimized, and
  redacted where possible.

## 11. Data, security, privacy, and migrations

- Enforce tenant isolation in the database, not only in the UI.
- Every tenant-scoped table requires RLS and cross-tenant negative tests.
- Service-role credentials remain server-only and must never reach browser code,
  logs, prompts, fixtures, or generated artifacts.
- Never log secrets, tokens, complete customer records, or unnecessary PII.
- Apply PII redaction before telemetry reaches any sink.
- Treat CRM fields, activities, notes, emails, uploads, retrieved documents, and
  tool responses as untrusted data.
- Prompt injection must not change rank, policy, tool authority, approval,
  verification, or publication.
- Audit evidence is append-only and records actor, action, decision, reason,
  timestamp, target, policy/version context, and relevant evidence references.
- Database migrations are versioned, reviewed, and tested against upgrade and
  rollback/forward-recovery paths.
- New tables, views, functions, and policies require least-privilege access
  review.
- Data freshness, completeness, and verification quality must affect confidence
  or publication eligibility according to explicit policy.
- Unsupported or ambiguous customer claims must be removed or held for human
  review, never rewritten into certainty.

## 12. Verification strategy and Definition of Done

Use progressive verification to control latency and cost without weakening the
final gate.

### Tier 1 — targeted development checks

Run the smallest relevant package test, typecheck, schema generation, or eval
after each focused change.

### Tier 2 — change-set verification

For the affected workspaces, run applicable lint, build, typecheck, unit tests,
deterministic evals, schema drift, security, and migration checks.

Database migration changes additionally require `pnpm db:lint`, but only through
a repository-pinned Supabase CLI. Do not assume a globally installed CLI. Until
the repository pins that executable, `pnpm db:lint` is not part of the standard
clean-checkout completion gate; migration changes must run it in a controlled
environment that declares the exact CLI version or report the gate as `BLOCKED`.

### Tier 3 — canonical completion gate

A change is complete only when every applicable command below passes:

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
pnpm docker:config
pnpm docker:build
pnpm verify:production
git diff --check
```

`pnpm verify:production` is the machine-readable verifier and must be kept
semantically equivalent to this contract. Until that script includes every
required command above, run the missing commands separately and do not claim
that the script alone represents the complete Definition of Done.

The async judge has two distinct modes:

- **Offline/local judge:** deterministic heuristic fallback is permitted for
  development and CI availability, but it is not evidence that the model judge
  passed.
- **Deployment judge:** when model judging is required, the API key and model
  response are mandatory; timeout, network, authentication, parsing, or model
  failure blocks deployment. A deployment judge result must identify its source
  as the configured model. Silent heuristic fallback is forbidden.

Completion additionally requires:

- no unintended working-tree changes;
- no schema-generation drift;
- no TypeScript, Python, lint, test, eval, security, migration, or container
  failures;
- no runtime/judge coupling;
- no weakened approval, RLS, audit, provenance, or PII controls;
- no demo or mock path enabled in production;
- no direct push to `main`;
- documentation updated for changed contracts or operations.

## 13. Completion evidence format

The executor reports:

1. **Outcome:** what changed and why.
2. **Files:** exact changed files.
3. **Verification:** commands run and pass/fail status.
4. **Evidence:** material test, eval, schema, security, or build results.
5. **Git state:** branch and final working-tree status.
6. **Residual risk:** known limitations, skipped gates, or follow-up work.
7. **Verdict:** `COMPLETE` only when the verifier-owned gates pass; otherwise
   `BLOCKED` with the failing gate.

Never invent token counts, cost, determinism drift, coverage, or performance
metrics. Use measured telemetry or report `n/a`.
