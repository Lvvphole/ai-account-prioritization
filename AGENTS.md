# AGENTS.md — Coding-Agent Operating Contract

This file is the root operating contract for every coding agent and human working
in this monorepo. Read it before inspecting, changing, generating, testing, or
committing code.

The contract is intentionally strict. The product handles customer and CRM data,
produces sales recommendations, and exposes customer-facing and CRM-write
capabilities. Reliability, provenance, permissions, bounded model authority, and
reproducibility take priority over agent autonomy.

## 0. Product in one sentence

Turn messy B2B CRM/account data into a **verified event-driven sales decision and
action-support system with scheduled reconciliation**, using a deterministic
decision core and, when enabled, a constrained runtime LLM for grounded signal
synthesis and action drafting.

## 1. Contract scope and precedence

Apply instructions in this order:

1. The user's explicit task and constraints.
2. This root `AGENTS.md` contract.
3. Canonical product and architecture documents in `docs/` and
   `prd_manifest.yaml`.
4. Package-local instructions that add stricter, more specific constraints.

A lower-precedence instruction may add detail but must not weaken a higher-level
safety, determinism, approval, schema, security, grounding, or verification rule.

When requirements conflict, stop and report the conflict. Do not silently choose
the easier interpretation. Do not invent missing requirements or expand scope
merely to make a gate pass.

## 2. Non-negotiable product and engineering invariants

1. The LLM **must not rank accounts**.
2. **Deterministic scoring** decides account score and rank.
3. No model call may set or directly mutate score, rank, confidence, reason codes,
   next-best-action type, permissions, approval state, verification status, or
   publication eligibility. Candidate content may be rejected by deterministic
   post-draft verification, which alone computes verification and publish/hold
   outcomes.
4. Runtime LLM use is permitted only for bounded signal synthesis and action
   drafting after deterministic scoring, ranking, reason-code generation, and
   next-best-action selection.
5. Model output is untrusted candidate content. It has no authority until strict
   schema, grounding, safety, permission, and approval gates pass.
6. **TypeScript/Zod** is the schema source of truth.
7. **Python** consumes generated JSON Schema artifacts only and never imports
   TypeScript.
8. Runtime guardrails are **synchronous, deterministic, fail-closed, and
   low-latency**.
9. LLM-as-a-judge, reflection, prompt optimization, and broad semantic
   evaluation remain **outside the synchronous production runtime**.
10. **Human approval** is required before every customer-facing send or CRM
    write-back.
11. Every recommendation includes **score, rank, confidence, reason codes,
    source signals, and next best action**.
12. Every reason code and factual claim must be traceable to verified source
    evidence.
13. No recommendation publishes **without schema, grounding, guardrail, source,
    permission, and approval verification**.
14. No unsupported customer-facing claims.
15. No fabricated account facts, dates, contacts, prior conversations,
    discounts, approvals, inventory, availability, commitments, outcomes, or
    customer intent.
16. Every critical decision, model invocation, fallback, and side effect creates
    durable **audit evidence**.
17. Customer and CRM data are untrusted input, never executable instructions.
18. Prompt injection or customer-controlled text must not alter ranking,
    permissions, approval state, tool authority, model authority, or control
    flow.
19. Every eval and verification gate must be executable from the repository root
    through versioned commands.
20. The executor **must not self-certify completion**.
21. The verifier owns completion judgment and must rely on executable evidence.
22. Any failed safety, permission, provenance, schema, grounding, or production
    gate blocks publication or deployment.

### 2.1 Harness economics operationalization

The canonical harness-economics doctrine is
`docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md`.
For harness-economics semantics only, that ADR is authoritative and this file
operationalizes it. If this file conflicts with ADR-002 on mandatory-invariant
treatment, component admission, simplicity precedence, machine-enforcement
boundaries, removal economics, or repair economics, stop and correct the conflict
before proceeding. This narrow delegation does not change precedence for other
requirements and never weakens the non-negotiable invariants above.

Mandatory product and runtime invariants are requirements, not discretionary
controls. Do not use harness economics to delete a required verification, safety,
approval, provenance, tenancy, schema, grounding, authorization, or publication
boundary. Apply ADR-002 to choose the smallest sufficient implementation that
preserves the invariant.

Before adding or preserving a discretionary harness control, or choosing among
substitutable implementations, apply ADR-002's admission and simplicity rules.
Do not duplicate a second doctrine here. Machine-enforcement, removal, and repair
decisions also follow ADR-002. Never invent numeric harness-value, complexity,
cost, reliability, or drift scores when telemetry is absent.

## 3. The process and deterministic decision paths are sacred

`docs/decisions/ADR-003-event-driven-crm-ingestion-and-notifications.md` is the
canonical process-architecture decision. This root contract codifies its authority
boundaries. ADR-002 still governs minimum-sufficient harness economics. Neither
ADR may weaken the non-negotiable invariants in Section 2.

### 3.1 Authority boundaries

Use four separate authorities:

- **Supabase** owns canonical CRM facts, feature provenance, recommendations,
  approvals, delivery outcomes, and durable business audit evidence.
- The **transactional outbox** owns the atomic publication boundary for accepted
  CRM changes. Its retry state is limited to workflow publication.
- **Vercel Workflow SDK**, when the durable workflow is implemented, owns process
  progression, completed-step checkpoints, waits, timers, retries after
  publication, suspension and resumption, workflow failure state, workflow-version
  binding, and operational execution traces.
- **Deterministic domain policy** owns feature availability, scoring, rank, reason
  codes, next-best-action authority, verification, and publish/hold decisions.

Do not move one authority into another subsystem. Workflow state is not business
state. An event can wake a workflow, but it cannot authorize a side effect. An
application table must not become a general workflow engine. Until the Workflow
SDK delivery is implemented, do not emulate it with a custom process-state
machine or retry scheduler.

### 3.2 Production process path

The event fast path and the scheduled reconciliation path must converge on the
same deterministic domain policy:

```text
CRM webhook OR scheduled reconciliation
  → source adapter + capability declaration
  → canonical CRM write + transactional outbox event
  → outbox relay starts durable account-action workflow
  → load authoritative account snapshot
  → coalesce relevant source events
  → derive only supported features
  → deterministic decision path
  → hold, internal delivery, or human-approval wait
  → re-read authoritative approval after resume
  → idempotent external action
  → persist outcome + durable audit evidence
```

The weekday daily run is the reconciliation and recovery path. Event processing
is the fast path. Both paths must use the same domain policy. The current Phase 1
foundation does not add the Workflow SDK dependency or a live CRM webhook.

### 3.3 Deterministic decision path

The decision path remains framework-independent and sacred:

```text
Zod input/state validation
  → deterministic feature extraction
  → deterministic scoring and stable ranking
  → deterministic reason codes and next-best-action selection
  → verified minimum-context construction
  → constrained runtime LLM drafting OR explicit deterministic template fallback
  → strict generated-output schema validation
  → deterministic claim-to-source grounding validation
  → deterministic guardrails
  → permission and human-approval evaluation
  → durable audit evidence
  → analytics/observability
  → publish or hold
```

A model call may occur only in the bounded drafting stage. The model receives no
side-effecting tools and cannot modify authoritative recommendation fields.
Generated content is never trusted merely because the provider returned it.

The deterministic template path remains the required fallback until the runtime
model path is fully implemented and verified. Fallback use must be explicit,
observable, auditable, and subject to the same publish gates. Never silently
replace a required model-backed operation with a heuristic and report it as a
model result.

A customer-facing action can suspend in the process path while it waits for human
approval. After resume, the process must re-read the authoritative approval from
Supabase immediately before the side effect. Workflow resume state is not approval
evidence.

A failed gate must produce a held or blocked result with explicit failed-gate
codes and audit evidence. It must never degrade into implicit approval, partial
publication, or silent success.

## 4. Runtime LLM generation contract

Runtime generation is allowed only when all of the following are true:

- The pre-draft deterministic authority envelope is complete and immutable.
- The input context contains only the minimum authorized, verified information
  required for the draft.
- Customer-controlled text is clearly delimited as data and cannot provide
  instructions to the model.
- The model, prompt, schema, policy, and grounding-rule versions are pinned and
  recorded.
- The call has a fixed timeout, token cap, and maximum attempt count.
- The drafter has no general tool registry and no side-effecting capabilities.
- Output must parse through the canonical Zod schema.
- Every factual generated claim cites one or more source-signal IDs supplied in
  the input context.
- Every cited source exists, is verified, is fresh enough for the action, and
  supports the claim.
- The action type and all pre-draft authoritative fields remain unchanged.
- Failure produces an explicit held state or an approved deterministic template
  fallback; it never grants publication authority.

The runtime model may decide **how to express** a verified recommendation. It may
not decide **who is prioritized, why they are prioritized, which action is
authorized, or whether the result may publish**.

## 5. Environment boundaries

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
- If runtime LLM drafting is enabled, provider credentials, model identity,
  prompt version, output schema, timeout, token cap, and fallback policy must be
  explicit and valid at startup.
- A provider failure may use only the configured deterministic template fallback
  or hold the recommendation. It may not switch providers or models silently.
- Synthetic approval must never be recorded or described as human approval.
- Side-effecting controls and kill switches must use shared durable state, not a
  browser cookie or process-local flag.

Demo, fixture, and fallback behavior must be explicitly named, isolated, and
covered by tests proving it cannot activate in production outside its approved
policy.

## 6. Strategic Programming (strict) workflow

```text
contract → baseline → plan → execute → verify → evaluate → iterate → stop|blocked
```

### Contract

- Restate the exact requested outcome, constraints, non-goals, and acceptance
  evidence.
- Identify whether the task changes runtime behavior, model authority, prompts,
  schemas, permissions, data, infrastructure, or deployment.

### Baseline

- Inspect `git status`, relevant files, tests, schemas, prompts, and current
  behavior.
- Reproduce the current state or failure before editing when practical.
- Preserve pre-existing user work.

### Plan

- Choose the smallest coherent change set.
- Name affected files, contracts, migrations, generated artifacts, prompts,
  model configuration, and targeted verification commands.
- Prefer one clear implementation path over speculative alternatives.

### Execute

- Modify only files required by the contract.
- Keep the deterministic decision core pure and model-independent.
- Keep model integration bounded behind typed interfaces.
- Add or update tests with behavior changes.
- Update canonical documentation when interfaces, invariants, operations, model
  boundaries, or risks change.

### Verify

- Run the narrowest relevant gate first.
- Then run the required change-set and completion gates.
- Record command, exit status, and material evidence.

### Evaluate

- Compare the verified implementation against the product contract, not merely
  against compilation success.
- Confirm no safety, approval, provenance, tenancy, deterministic-decision,
  runtime-generation, or runtime/judge boundary was weakened.

### Iterate

- Follow ADR-002 repair economics; there is no universal numeric repair count.
- Fix only the evidenced failure. Do not rerun an identical failed command
  without a relevant change or materially new diagnostic evidence.
- A local defect receives the smallest coherent local repair, followed by the
  narrowest relevant verification.
- If the same failure persists and targeted verification produces materially new
  diagnostic evidence that identifies a specific, bounded, non-speculative
  correction, and no explicitly justified bound has been reached, apply the next
  smallest coherent repair and verify again. Every additional repair requires
  fresh evidence that materially narrows the diagnosis.
- If materially new diagnostic evidence is exhausted, or an explicitly justified
  bound has been reached, stop and report `BLOCKED`. Do not repeat an unchanged
  repair or continue speculative fix-forward.
- If a repair exposes a new significant defect class caused by the same control
  mechanism, stop local fix-forward and reassess, reduce, or redesign the
  mechanism before another local repair.
- Repeated significant harness defects from the same mechanism are evidence about
  the harness architecture itself. The governing response is
  `STOP → REDUCE OR REDESIGN → VERIFY`.

### Review handling: identify → validate → fix_or_rebut → verify → respond → resolve

For pull-request, security, automated, Codex, and human review findings:

1. Identify every unresolved finding and map it to the affected file, line,
   invariant, and acceptance criterion.
2. Validate each finding as valid, partially valid, invalid, duplicate, outdated,
   or out of scope. Do not modify code merely because a reviewer requested it.
3. Apply the smallest coherent fix to valid findings. Rebut invalid portions with
   evidence. Track out-of-scope work without expanding the change set.
4. Run the narrowest relevant verification first, followed by all affected
   change-set gates.
5. Reply with the change, commit or diff reference, and verification evidence.
6. Resolve only when the concern is corrected or conclusively answered.
7. The executor may resolve an individual thread after producing evidence, but
   the verifier retains final completion judgment.
8. Do not dismiss, hide, or resolve a finding merely to obtain a clean review
   state.
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

## 7. Repository and Git safety

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

## 8. Architecture map

| Concern | Canonical location |
| --- | --- |
| Product contract | `docs/PRD.md`, `prd_manifest.yaml` |
| System architecture | `docs/ARCHITECTURE.md` |
| Architecture decisions | `docs/decisions/` |
| Harness economics | `docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md` |
| Event-driven process architecture | `docs/decisions/ADR-003-event-driven-crm-ingestion-and-notifications.md` |
| Engineering workflow | `docs/CONTEXT.md`, `AGENTS.md` |
| Schema source of truth | `packages/shared-schemas/src` |
| CRM capability contract | `packages/shared-schemas/src/source-capabilities.ts` |
| JSON Schema generation | `packages/shared-schemas/scripts/generate-json-schemas.ts` |
| Generated JSON Schema | `packages/shared-schemas/generated`, `apps/api-python/src/schemas/generated` |
| Hybrid runtime | `apps/agent-runtime/src` |
| CRM capability resolution | `apps/agent-runtime/src/ingestion/source-capabilities.ts` |
| Account-event routing/coalescing | `apps/agent-runtime/src/events/account-events.ts` |
| Deterministic scoring | `apps/agent-runtime/src/agents/account-prioritizer` |
| Runtime generation | `apps/agent-runtime/src/agents/sales-execution` |
| Runtime model adapter | `apps/agent-runtime/src/inference` |
| Runtime configuration | `apps/agent-runtime/src/config` |
| Runtime prompts | co-located `*.prompt.ts` files under the owning agent |
| Grounding validation | `apps/agent-runtime/src/agents/sales-execution/validate-draft-grounding.ts` |
| Deterministic draft fallback | `apps/agent-runtime/src/agents/sales-execution/tools` |
| Runtime guardrails | `apps/agent-runtime/src/agents/orchestrator/orchestrator.guardrails.ts` |
| Security and approval policy | `packages/security/src` |
| PII-safe observability | `packages/observability/src` |
| MCP-compatible tools | `apps/agent-runtime/src/shared-tools/mcp` |
| Supabase persistence/RLS | `supabase/`, `packages/supabase-client`, runtime repository adapters |
| Transactional outbox and delivery ledger | `supabase/migrations/0017_event_outbox_and_notification_jobs.sql` |
| Notification delivery contract | `apps/agent-runtime/src/notifications/notification-job.ts` |
| Durable process authority | Vercel Workflow SDK, bounded by ADR-003; implementation is a later delivery |
| Web UI | `apps/web/app` |
| Python support service | `apps/api-python/src` |
| Deterministic evals and async judge | `packages/testing-evals/src` |
| Trajectory regression | `packages/testing-evals/src/trajectory-prioritization.eval.ts` |
| Production verification | `scripts/verify-production.sh` |
| CI/CD and deployment | `.github/workflows` |

Do not introduce a second source of truth for schemas, scoring policy,
permissions, reason codes, prompt identity, model policy, environment
configuration, business state, approval state, or workflow process state.

## 9. Determinism and behavioral reliability contract

### 9.1 Pre-draft deterministic authority envelope

Given identical:

- source-data snapshot;
- policy and runtime configuration version;
- schema version;
- injected clock;
- code revision;

The system must produce byte-identical pre-draft authoritative outputs for:

- extracted features;
- scores;
- ranks;
- confidence;
- reason codes;
- source-signal references;
- next-best-action type;
- approval requirement.

This envelope is complete before model generation and cannot be changed by model
output.

Deterministic pre-draft code must not depend on:

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
- every reason code maps to supporting evidence;
- identical inputs produce identical serialized pre-draft authority envelopes;
- unverified, stale-beyond-policy, unauthorized, or malformed source data fails
  closed before drafting.

### 9.2 Post-draft deterministic gate result

Given identical:

- pre-draft authority envelope;
- candidate model draft or deterministic fallback draft;
- schema, grounding, guardrail, permission, and approval policy versions;
- approval state;
- injected clock;
- code revision;

The deterministic verifier must produce byte-identical outputs for:

- generated-output schema result;
- claim-grounding result;
- guardrail result;
- permission and approval result;
- verification outcome;
- publish/hold decision;
- explicit failed-gate codes.

The model cannot set or override these values. Its candidate draft is untrusted
input to the verifier. Different candidate drafts may legitimately produce
different deterministic gate results.

### 9.3 Probabilistic generation envelope

Generated wording is not required to be byte-identical across provider calls.
Pinned model, temperature zero, fixed prompts, and seeds reduce variation but do
not prove bit identity.

For identical verified input, every accepted generated draft must instead satisfy
these behavioral invariants:

- canonical output schema passes;
- pre-draft authoritative recommendation fields are unchanged;
- no unsupported or fabricated claim appears;
- every factual claim maps to verified source-signal IDs;
- no prompt injection changes instructions or authority;
- no tool or side effect is available to the drafter;
- latency, token, attempt, and cost budgets are enforced from measured telemetry;
- model, prompt, schema, policy, and fallback versions are recorded;
- any failure produces an explicit fallback or held state;
- final publication remains a deterministic post-draft verifier decision.

## 10. Schema and generated-artifact workflow

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

Generated draft schemas must distinguish authoritative deterministic fields from
model-generated candidate fields. A model response must never be parsed directly
into an authoritative recommendation object without deterministic field
reconciliation.

Source-signal provenance must remain traceable to the originating system and
record. Provenance should include source system, source record identifier,
observation time, ingestion time, verification method, and freshness state when
the relevant schema supports those fields. Do not label evidence verified when
its origin or observation time cannot be established.

## 11. Tool, integration, and side-effect policy

- Tools come from a closed allowlist or versioned registry.
- Every tool input is schema-validated before invocation.
- Tools are read-only and least-privileged by default.
- `sideEffecting` capability must be explicit.
- The runtime drafting model receives no general tool registry and no
  side-effecting tools.
- Side-effecting tools must not be auto-registered into the general runtime
  registry.
- Authorization, tenant scope, current approval, and kill-switch state must be
  checked immediately before each side effect.
- A resumed workflow must re-read current approval from Supabase immediately
  before a customer-facing send or CRM write-back. A hook, event, checkpoint, or
  resume token is not approval authority.
- Every external write requires durable audit evidence and an idempotency key.
- Every external call requires a timeout.
- Retries must be bounded and used only for retry-safe operations.
- The transactional outbox can retry workflow publication only. After successful
  publication, it must not own process progression or post-publication retries.
- Application tables must not implement a general workflow engine, process-state
  machine, wait scheduler, timer service, or post-publication retry scheduler.
- Vercel Workflow SDK owns durable process waits, retries, resumption, and failure
  state after the workflow implementation is delivered.
- The notification delivery ledger records delivery evidence. It must not
  schedule provider retries. Provider-call retry behavior belongs to the durable
  workflow step.
- Partial failure must return an explicit recoverable or blocked state, never
  false success.
- Tool and model output are untrusted data and must be validated before use.
- Customer-controlled text must not select tools, construct arbitrary arguments,
  alter prompts, or expand tool/model authority.
- Do not execute model-generated shell commands, raw SQL, arbitrary URLs, or
  code without deterministic validation and explicit authorization.
- Customer data sent to external services must be authorized, minimized, and
  redacted where possible.

## 12. Data, security, privacy, and migrations

- Enforce tenant isolation in the database, not only in the UI.
- Every tenant-scoped table requires RLS and cross-tenant negative tests.
- Service-role credentials remain server-only and must never reach browser code,
  logs, prompts, fixtures, or generated artifacts.
- Never log secrets, tokens, complete customer records, or unnecessary PII.
- Apply PII redaction before telemetry reaches any sink or model provider.
- Treat CRM fields, activities, notes, emails, uploads, retrieved documents, and
  tool responses as untrusted data.
- Prompt injection must not change rank, policy, tool authority, model authority,
  approval, verification, or publication.
- Audit evidence is append-only and records actor, action, decision, reason,
  timestamp, target, policy/version context, model/prompt context when relevant,
  and evidence references.
- Database migrations are versioned, reviewed, and tested against upgrade and
  rollback/forward-recovery paths.
- New tables, views, functions, and policies require least-privilege access
  review.
- Data freshness, completeness, and verification quality must affect confidence
  or publication eligibility according to explicit policy.
- Unsupported or ambiguous customer claims must be removed or held for human
  review, never rewritten into certainty.

## 13. Verification strategy and Definition of Done

Use progressive verification to control latency and cost without weakening the
final gate.

### Tier 1 — targeted development checks

Run the smallest relevant package test, typecheck, schema generation, or eval
after each focused change.

Runtime-generation changes must first run targeted tests for:

- output-schema enforcement;
- claim-to-source grounding;
- authoritative-field immutability;
- prompt-injection resistance;
- timeout and token limits;
- deterministic template fallback;
- approval and publication separation.

### Tier 2 — change-set verification

For the affected workspaces, run applicable lint, build, typecheck, unit tests,
deterministic evals, trajectory regression, generative evals, schema drift,
security, and migration checks.

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
pnpm test:trajectory
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
- no runtime-generation/judge coupling;
- no model authority over the pre-draft deterministic authority envelope or the
  post-draft deterministic gate result;
- no weakened approval, RLS, audit, provenance, grounding, or PII controls;
- no demo or mock path enabled in production;
- no direct push to `main`;
- documentation updated for changed contracts or operations.

## 14. Completion evidence format

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
