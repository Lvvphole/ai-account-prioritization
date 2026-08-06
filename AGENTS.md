# AGENTS.md — Coding-Agent Operating Contract

This file is the root operating contract for every coding agent and human working
in this monorepo. Read it before inspecting, changing, generating, testing, or
committing code.

The contract is intentionally strict. The product handles customer and CRM data,
produces sales recommendations, and exposes customer-facing and CRM-write
capabilities. Reliability, provenance, permissions, bounded model authority, and
reproducibility take priority over unbounded agent autonomy.

## 0. Product in one sentence

Turn messy B2B CRM/account data into a **verified daily sales action plan** using
a deterministic authority envelope around bounded probabilistic What and How,
with deterministic verification and human approval for protected side effects.

## 1. Contract scope and precedence

Apply instructions in this order:

1. The user's explicit task and constraints.
2. This root `AGENTS.md` contract.
3. Canonical product and architecture documents in `docs/` and
   `prd_manifest.yaml`.
4. Package-local instructions that add stricter, more specific constraints.

A lower-precedence instruction may add detail but must not weaken a higher-level
safety, determinism, approval, schema, security, grounding, authority, or
verification rule.

When requirements conflict, stop and report the conflict. Do not silently choose
the easier interpretation. Do not invent missing requirements or expand scope
merely to make a gate pass.

## 2. Non-negotiable product and engineering invariants

1. The LLM **must not rank accounts**.
2. **Deterministic scoring** decides account score and rank.
3. Deterministic software owns Who, When, Where, Why, scope, permissions,
   available resources, tool allowlists, budgets, deterministic postconditions,
   protected side-effect authority, verification, publication authority, and
   completion.
4. The approved target architecture permits the LLM to own bounded **What and
   How** only inside an explicit software-supplied task contract.
5. When a task contract and implementation scope permit it, bounded What and How
   may include semantic interpretation, semantic mapping proposals, evidence
   synthesis, strict-schema artifact generation, candidate-action selection from
   a supplied action envelope, allowlisted tool selection and sequencing, task
   decomposition, bounded subagent delegation, worker-result synthesis, and
   bounded recovery.
6. A model cannot widen its goal, tenant/user/account/batch/task scope, action
   envelope, tool grant, resource grant, permissions, budgets, validator set,
   side-effect authority, publication authority, or completion authority.
7. Target-architecture approval is not implementation authorization. The current
   production spine remains limited to the current P4 scope in section 4.1.
8. In the current production spine, account eligibility, score, rank,
   confidence/evidence-quality policy, reason codes, source evidence, and
   next-best-action type remain deterministic. The runtime model performs bounded
   drafting and synthesis only.
9. Model output is untrusted candidate content. It has no authority until all
   applicable deterministic schema, grounding, safety, permission, postcondition,
   approval, and publication gates pass.
10. **TypeScript/Zod** is the schema source of truth.
11. **Python** consumes generated JSON Schema artifacts only and never imports
    TypeScript.
12. Runtime guardrails are **synchronous, deterministic, fail-closed, and
    low-latency**.
13. LLM-as-a-judge, reflection, prompt optimization, and broad semantic
    evaluation remain **outside the synchronous production acceptance path**.
14. **Human approval** is required before every protected customer-facing send or
    CRM write-back.
15. Every recommendation includes **score, rank, confidence, reason codes,
    source signals, and next best action**.
16. Every reason code and factual claim that requires support must be traceable to
    verified source evidence.
17. No recommendation publishes **without schema, grounding, guardrail, source,
    permission, and approval verification**.
18. No unsupported customer-facing claims.
19. No fabricated account facts, dates, contacts, prior conversations,
    discounts, approvals, inventory, availability, commitments, outcomes, or
    customer intent.
20. Every critical decision, model invocation, fallback, approval, and side
    effect creates durable **audit evidence**. Tool and subagent evidence is also
    required when those capabilities are later implemented.
21. Customer and CRM data are untrusted input, never executable instructions.
22. Prompt injection or customer-controlled text must not alter ranking, scope,
    permissions, approval state, tool/resource authority, model authority,
    budgets, side-effect authority, publication authority, or control flow.
23. Every eval and verification gate must be executable from the repository root
    through versioned commands.
24. The executor **must not self-certify completion**.
25. The verifier owns completion judgment and must rely on executable evidence.
26. Any failed safety, permission, provenance, schema, grounding, or production
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

Position B capabilities defined by ADR-001 are approved target capabilities.
ADR-002 does not prohibit their existence. It governs when a current task or
production increment should pay the cost to implement or invoke a more complex
approved capability.

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

Architecture approval does not authorize a deferred implementation. A deferred
Position B capability requires the user's explicit implementation ruling and the
applicable ADR-002 evidence before implementation begins.

## 3. Approved target runtime architecture

The approved Position B target runtime shape is:

```text
deterministic task authority envelope
  → bounded probabilistic What and How when the task contract permits it
       → direct model execution
       OR
       → bounded supervisor
            → bounded worker task
            → bounded worker task
       → supervisor synthesis
  → strict schema and grounding validation
  → deterministic postcondition verification
  → permission verification
  → explicit human approval for protected side effects
  → protected execution when authorized
  → durable audit evidence
  → PASS | FAIL | BLOCKED
```

A target task contract may permit the model to select a candidate action from a
software-supplied action envelope, choose and sequence allowlisted tools, or
delegate bounded work. These choices do not grant authority outside the supplied
envelope.

Software validates each admitted action, tool request, resource, permission,
budget, side effect, and postcondition. A worker receives a child contract that
is equal to or narrower than the parent contract. A child cannot infer omitted
authority.

Supervisor and worker roles use the same qualified, pinned production model when
supervisor-worker execution is later admitted. Direct execution remains preferred
when it can satisfy the task contract.

Only the deterministic verifier can return `PASS`, `FAIL`, or `BLOCKED`.

Protected customer-facing sends and CRM writes require explicit human approval of
the final visible payload.

### 3.1 Current production runtime path

The current production spine is intentionally narrower than the target:

```text
orchestrator
  → Zod input/state validation
  → deterministic feature extraction
  → deterministic scoring and stable ranking
  → deterministic reason codes and next-best-action selection
  → verified minimum-context construction
  → bounded runtime LLM drafting/synthesis OR deterministic template fallback
  → strict generated-output schema validation
  → deterministic claim-to-source grounding validation
  → deterministic guardrails
  → permission and human-approval gate
  → durable audit evidence
  → analytics/observability
  → publish or hold
```

Current next-best-action selection remains deterministic. The current runtime
model does not have general tool orchestration, side-effecting tools, or
supervisor-worker fan-out.

The deterministic template path remains the required fail-safe for the current
spine. Fallback use must be explicit, observable, auditable, and subject to the
same publish gates. Never silently replace a required model-backed operation with
a heuristic and report it as a model result.

A failed gate must produce a held or blocked result with explicit failed-gate
codes and audit evidence. It must never degrade into implicit approval, partial
publication, or silent success.

## 4. Probabilistic task contract

Before any model-assisted task executes, deterministic software must supply the
applicable authority envelope:

- goal;
- authorized inputs;
- tenant, user, batch, account, and task scope;
- allowed action envelope;
- allowlisted tools;
- allowed resources;
- strict output schema;
- deterministic postconditions;
- token, call, time, retry, worker, delegation, and concurrency budgets as
  applicable;
- human-approval requirement; and
- terminal states `PASS | FAIL | BLOCKED`.

A task does not gain authority because a contract field is unused or omitted. The
model cannot infer an omitted tool, action, resource, permission, or budget.

When an implemented task permits model tool use, software validates tool identity,
arguments, scope, resource identifiers, permissions, remaining budgets, and
side-effect class before every invocation.

When an implemented task permits delegation, each child contract must be equal to
or narrower than the parent contract. The supervisor and workers cannot certify
completion.

Model-generated output remains untrusted candidate data until deterministic
postconditions pass.

### 4.1 P4 — Provider-Neutral Model Boundary, Variance Control, and Qualification

The full Position B architecture is approved. It is **not** the required
implementation scope of the current production spine.

P4 is optional. The application must be able to complete the full daily path with
the deterministic fallback when the model is disabled, unavailable, or fails
verification.

Authorized current-spine P4 work is limited to:

1. Refactor `RuntimeModelClient` into a provider-neutral boundary.
2. Remove Anthropic-specific types from the common policy.
3. Support provider-native constrained output, including Structured Outputs or
   `output_config.format` when supported.
4. Normalize reasoning or effort configuration without claiming that providers
   expose identical controls.
5. Remove hard-coded `temperature: 0` from Claude-5-compatible requests.
6. Preserve full prompt, schema, policy, and model identity in audit evidence.
7. Build offline cross-model k-run qualification.
8. Admit only one qualified production configuration at a time.
9. Keep deterministic template fallback or hold as the fail-safe.
10. Prove both production acceptance profiles below.

Explicitly deferred from the current production spine:

- model-controlled candidate-action selection;
- a capability resolver driven by model-selected What;
- general tool orchestration, workflows, or side-effecting model tools;
- supervisor-worker fan-out or subagent delegation;
- multi-model routing or majority voting;
- a second action ontology beyond the current deterministic set; and
- production caching infrastructure.

These deferred capabilities remain approved under the target architecture. Do not
implement them as part of current P4. A later implementation requires a new
explicit user ruling and the applicable ADR-002 admission evidence.

**Acceptance A — deterministic baseline:** AI is disabled. The production-shaped
daily spine must pass end to end.

**Acceptance B — single qualified model:** the same spine runs with the one
qualified production model configuration. Model success or safe fallback must
never alter tenant, owner, account, score, rank, reason codes, permissions,
approval state, publication authority, side-effect authority, or completion
authority.

### 4.2 Current runtime model contract

For the current production-spine P4 path:

- The current deterministic prioritization envelope is complete before bounded
  drafting or synthesis.
- The input context contains only the minimum authorized, verified information
  required for the task.
- Customer-controlled text is clearly delimited as data and cannot provide
  executable instructions to the model.
- Provider, model, effective configuration, prompt, schema, policy, and grounding
  versions are recorded.
- The call has externally enforced timeout, token, and attempt limits.
- Use provider-native constrained output when supported by the qualified
  configuration. Do not claim providers expose identical controls.
- Output must parse through the canonical Zod schema.
- Every factual generated claim that requires support cites allowed source-signal
  IDs supplied in the input context.
- Every cited source exists, is verified, is fresh enough for the action, and
  supports the claim.
- The current deterministic next-best-action type and other protected current
  authority fields remain unchanged.
- Failure produces an explicit held state or deterministic template fallback; it
  never grants publication authority.

Do not hard-code `temperature: 0` into Claude-5-compatible requests merely to
claim determinism. Provider controls must follow the qualified provider contract.
Generated prose is not assumed to be bit-identical.

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
- If runtime model work is enabled, provider credentials, model identity,
  effective model configuration, prompt version, output schema, timeout, token
  cap, and fallback policy must be explicit and valid at startup.
- A provider failure may use only the configured deterministic template fallback
  or hold the recommendation. It may not switch providers or models silently.
- Only one qualified production model configuration is active at a time.
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
- Identify whether the task changes runtime behavior, target architecture,
  current implementation scope, model authority, prompts, schemas, permissions,
  data, infrastructure, or deployment.
- Distinguish an approved target capability from an implementation-authorized
  capability before planning work.

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
- Do not add a deferred Position B capability unless the user explicitly
  authorizes its implementation and ADR-002 permits the mechanism.

### Execute

- Modify only files required by the contract.
- Keep deterministic ranking and high-consequence authority model-independent.
- Keep model integration bounded behind typed interfaces and explicit task
  contracts.
- Use direct execution when it is sufficient. Use supervisor-worker execution
  only when it is inside the authorized implementation scope.
- Add or update tests with behavior changes.
- Update canonical documentation when interfaces, invariants, operations, model
  boundaries, implementation scope, or risks change.

### Verify

- Run the narrowest relevant gate first.
- Then run the required change-set and completion gates.
- Record command, exit status, and material evidence.

### Evaluate

- Compare the verified implementation against the product contract, not merely
  against compilation success.
- Confirm no safety, approval, provenance, tenancy, deterministic-ranking,
  authority-envelope, runtime/judge, or implementation-scope boundary was
  weakened.

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
2. Validate each finding against the current authority hierarchy, approved target
   architecture, and separately authorized implementation scope. Classify the
   finding as valid, partially valid, invalid, duplicate, outdated, or out of
   scope. Do not modify code merely because a reviewer requested it.
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
9. If a requested fix conflicts with a higher-priority invariant or explicit user
   ruling, stop and report the conflict rather than silently reverting the
   architecture or expanding implementation scope.

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
| Position B authority decision | `docs/decisions/ADR-001-hybrid-runtime-drafting.md` |
| Harness economics | `docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md` |
| Engineering workflow | `docs/CONTEXT.md`, `AGENTS.md` |
| Schema source of truth | `packages/shared-schemas/src` |
| JSON Schema generation | `packages/shared-schemas/scripts/generate-json-schemas.ts` |
| Generated JSON Schema | `packages/shared-schemas/generated`, `apps/api-python/src/schemas/generated` |
| Hybrid runtime | `apps/agent-runtime/src` |
| Deterministic scoring | `apps/agent-runtime/src/agents/account-prioritizer` |
| Current runtime drafting/synthesis | `apps/agent-runtime/src/agents/sales-execution` |
| Runtime model adapter | `apps/agent-runtime/src/inference` |
| Runtime configuration | `apps/agent-runtime/src/config` |
| Runtime prompts | co-located `*.prompt.ts` files under the owning agent |
| Grounding validation | `apps/agent-runtime/src/agents/sales-execution/validate-draft-grounding.ts` |
| Deterministic draft fallback | `apps/agent-runtime/src/agents/sales-execution/tools` |
| Runtime guardrails | `apps/agent-runtime/src/agents/orchestrator/orchestrator.guardrails.ts` |
| Security and approval policy | `packages/security/src` |
| PII-safe observability | `packages/observability/src` |
| MCP-compatible tool registry | `apps/agent-runtime/src/shared-tools/mcp` |
| Supabase persistence/RLS | `supabase/`, `packages/supabase-client`, runtime repository adapters |
| Web UI | `apps/web/app` |
| Python support service | `apps/api-python/src` |
| Deterministic evals and async judge | `packages/testing-evals/src` |
| Production verification | `scripts/verify-production.sh` |
| CI/CD and deployment | `.github/workflows` |

Do not introduce a second source of truth for schemas, scoring policy,
permissions, reason codes, prompt identity, model policy, current implementation
scope, or environment configuration.

## 9. Determinism and behavioral reliability contract

### 9.1 Current-spine deterministic authority envelope

Given identical:

- source-data snapshot;
- policy and runtime configuration version;
- schema version;
- injected clock;
- code revision;

The current production spine must produce byte-identical authoritative outputs
for:

- extracted features;
- scores;
- ranks;
- confidence or deterministic evidence-quality output;
- reason codes;
- source-signal references;
- next-best-action type; and
- approval requirement.

These current-spine fields are complete before bounded drafting/synthesis and
cannot be changed by model output.

Deterministic current-spine code must not depend on:

- an uninjected wall clock;
- randomness or random identifiers;
- locale-dependent sorting or formatting;
- unstable object, map, or set iteration;
- network responses not included in the input snapshot;
- model output;
- race-dependent parallel completion order; or
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
- identical inputs produce identical serialized current-spine authority
  envelopes; and
- unverified, stale-beyond-policy, unauthorized, or malformed source data fails
  closed before it can influence authoritative prioritization.

### 9.2 Target Position B action and tool envelopes

A future task that receives explicit implementation authorization may make a
probabilistic candidate-action or tool-sequencing choice. The candidate choice is
not required to be byte-identical.

The following remain deterministic for such a task:

- supplied goal and scope;
- allowed action envelope;
- tool and resource grant;
- permissions;
- budgets and stop conditions;
- required schema and postconditions;
- protected side-effect authorization;
- approval requirement;
- verification and publication authority; and
- final `PASS | FAIL | BLOCKED` result for identical task inputs, candidate
  artifacts, tool results, approvals, policies, clock, and code revision.

Do not apply this target rule to the current production spine as implementation
authorization. Current next-best-action selection remains deterministic.

### 9.3 Deterministic gate result

Given identical:

- applicable authority envelope;
- candidate model output or deterministic fallback;
- applicable tool results;
- schema, grounding, guardrail, permission, and approval policy versions;
- approval state;
- injected clock; and
- code revision;

The deterministic verifier must produce byte-identical outputs for all applicable
schema, grounding, guardrail, permission, approval, postcondition, publish/hold,
and failed-gate results.

The model cannot set or override these values. Different candidate outputs may
legitimately produce different deterministic gate results.

### 9.4 Probabilistic generation and qualification envelope

Generated wording and reasoning are not required to be byte-identical across
provider calls.

Do not assume that `temperature: 0`, a seed, or similarly named provider controls
prove determinism. Use the qualified provider's supported controls and record the
effective configuration.

For identical verified current-spine input, every accepted generated draft must
satisfy these behavioral invariants:

- canonical output schema passes;
- current deterministic recommendation fields are unchanged;
- no unsupported or fabricated claim appears;
- every factual claim that requires support maps to verified source-signal IDs;
- no prompt injection changes instructions or authority;
- latency, token, attempt, and cost budgets are enforced from authoritative
  configuration and measured telemetry where available;
- model, provider, effective configuration, prompt, schema, policy, and fallback
  versions are recorded;
- any failure produces an explicit fallback or held state; and
- final publication remains a deterministic verifier decision.

P4 qualification may compare multiple provider/model configurations offline by
repeated k-runs. Production admits only one qualified configuration at a time.

Never invent token counts, cost, determinism drift, or provider equivalence when
telemetry or authoritative provider behavior is unavailable.

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

Generated model-output schemas must distinguish software-owned authority fields
from model-generated candidate fields. A model response must never be parsed
directly into authoritative state without deterministic reconciliation and the
applicable postconditions.

Source-signal provenance must remain traceable to the originating system and
record. Provenance should include source system, source record identifier,
observation time, ingestion time, verification method, and freshness state when
the relevant schema supports those fields. Do not label evidence verified when
its origin or observation time cannot be established.

## 11. Tool, integration, and side-effect policy

The approved target architecture permits bounded model tool use. Current P4 does
not implement general tool orchestration or side-effecting model tools.

For any tool capability that is explicitly admitted later:

- Tools come from a closed allowlist or versioned registry supplied by software.
- Every tool input is schema-validated before invocation.
- Tools are read-only and least-privileged by default.
- `sideEffecting` capability must be explicit.
- Side-effecting tools must not be auto-registered into a general runtime
  registry.
- Authorization, tenant scope, current approval, resource grant, remaining
  budget, and kill-switch state must be checked immediately before each side
  effect.
- Every external write requires durable audit evidence and an idempotency key.
- Every external call requires a timeout.
- Retries must be bounded and used only for retry-safe operations.
- Partial failure must return an explicit recoverable or blocked state, never
  false success.
- Tool and model output are untrusted data and must be validated before use.
- Customer-controlled text must not create tools, expand the allowlist, construct
  arbitrary unauthorized arguments, alter prompts, or expand tool/model
  authority.
- Do not execute model-generated shell commands, raw SQL, arbitrary URLs, or
  code without deterministic validation and explicit authorization.
- Customer data sent to external services must be authorized, minimized, and
  redacted where possible.

Protected side effects require explicit human approval of the final visible
payload. A model cannot approve its own tool call or payload.

Do not implement general tool orchestration, workflows, or side-effecting model
tools as part of current P4.

## 12. Data, security, privacy, and migrations

- Enforce tenant isolation in the database, not only in the UI.
- Every tenant-scoped table requires RLS and cross-tenant negative tests.
- Service-role credentials remain server-only and must never reach browser code,
  logs, prompts, fixtures, or generated artifacts.
- Never log secrets, tokens, complete customer records, or unnecessary PII.
- Apply PII redaction before telemetry reaches any sink or model provider.
- Treat CRM fields, activities, notes, emails, uploads, retrieved documents, and
  tool responses as untrusted data.
- The approved target may use a model to propose semantic field mappings or
  interpret ambiguous source text. Source authentication, quarantine, security
  decisions, schema validation, row disposition, canonical commit, provenance,
  and authoritative CRM state remain deterministic.
- A model-generated mapping proposal never makes a source row authoritative.
- Prompt injection must not change rank, policy, scope, tools/resources,
  permissions, budgets, approval, verification, publication, or protected
  side-effect authority.
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

Current P4 runtime-generation changes must first run targeted tests for:

- output-schema enforcement;
- claim-to-source grounding;
- current deterministic authority-field immutability;
- prompt-injection resistance;
- timeout and token limits;
- deterministic template fallback;
- approval and publication separation;
- provider-neutral policy/configuration behavior;
- provider-native constrained-output handling where supported;
- effective prompt/schema/policy/model identity evidence; and
- deterministic-baseline and single-qualified-model acceptance profiles where
  the change reaches those boundaries.

A change that introduces candidate-action selection, general tool orchestration,
or supervisor-worker fan-out is out of scope for current P4 unless the user has
issued a new explicit implementation ruling and ADR-002 admission is satisfied.

### Tier 2 — change-set verification

For the affected workspaces, run applicable lint, build, typecheck, unit tests,
deterministic evals, generative evals, schema drift, security, and migration
checks.

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
- no model ability to widen the applicable deterministic authority envelope or
  set the deterministic gate result;
- no current-P4 implementation of a deferred Position B capability without new
  explicit authorization;
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
