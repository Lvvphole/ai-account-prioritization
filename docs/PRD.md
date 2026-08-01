# PRD — AI Account Prioritization Agent for B2B Sales Teams

## Problem

B2B reps drown in noisy CRM data and waste prime selling hours deciding *who* to
contact. Existing AI tools often hallucinate facts, cannot show their work, and
act without sufficient guardrails, so reps do not trust them.

## Product

A daily hybrid AI agent that turns messy CRM/account data into a **verified daily
action plan**. A deterministic pre-draft authority layer decides account priority,
action type, permissions, and approval requirements. A constrained runtime LLM
may synthesize verified evidence and draft personalized action content. A
separate deterministic post-draft verifier and human approval retain final
publication authority.

For each account a rep should act on, the product answers:

1. **Which** accounts to contact first through deterministic ranking.
2. **Why** each account matters through closed-set reason codes and verified
   evidence.
3. **What** action to take next through deterministic policy.
4. **How** to express that action through a grounded AI-assisted draft or
   deterministic template fallback.
5. **What evidence** supports every factual claim.
6. **Whether** the candidate passed schema, grounding, guardrail, permission,
   approval, and evaluation gates.

## Users

- **Rep** — sees a ranked priority list with evidence and next-best actions;
  reviews and approves customer-facing or CRM-write drafts.
- **Manager** — sees coverage gaps, held recommendations, failed gates, and
  fallback/model health.
- **Admin** — inspects deterministic scoring policy separately from model,
  prompt, schema, grounding, and rollout configuration.

## Product boundary

### Pre-draft deterministic authority

TypeScript owns and freezes before generation:

- feature extraction
- score and rank
- confidence
- reason codes
- verified source references
- next-best-action type
- permissions and approval requirements

### Runtime AI capability

The runtime LLM may only:

- summarize verified account signals
- draft an email, call objective, meeting objective, or CRM note
- tailor wording to the verified account context and selected action
- return structured claims with supporting source IDs

The runtime LLM may not score, rank, select tools, change the action, approve,
verify, publish, send, or write to the CRM.

### Post-draft deterministic verification

TypeScript receives the candidate model draft or deterministic fallback as
untrusted input and computes:

- generated-output schema result
- claim-grounding result
- guardrail result
- permission and approval result
- verification outcome
- publish or hold decision
- explicit failed-gate codes

The model cannot set or override these values. Different candidate drafts may
legitimately produce different deterministic gate results.

## Hard product invariants

- The **LLM never ranks**; deterministic scoring decides priority.
- No model output changes a pre-draft authoritative recommendation field.
- Every recommendation carries **score, rank, confidence, reason codes, source
  signals, and next best action**.
- Every generated factual claim maps to verified source evidence.
- Model output is untrusted candidate content until deterministic verification
  passes.
- Nothing publishes **without schema, grounding, guardrail, source, permission,
  and approval verification**.
- **Human approval** is required for customer-facing sends and CRM write-back.
- **No fabricated** facts, dates, conversations, discounts, approvals,
  availability, commitments, outcomes, or customer intent.
- Runtime generation has no side-effecting tools.
- Model, prompt, schema, policy, token, latency, and fallback metadata are
  auditable.
- Every critical action, model invocation, fallback, and publish/block decision
  creates durable audit evidence.

## Loop

```text
DISCOVER → PLAN → EXECUTE → VERIFY → ITERATE → PUBLISH | HOLD
```

Where:

- **DISCOVER** reads and verifies CRM signals.
- **PLAN** deterministically scores, ranks, explains, selects the action type,
  and freezes the pre-draft authority envelope.
- **EXECUTE** creates a grounded model draft or deterministic template fallback.
- **VERIFY** enforces schema, claim grounding, guardrails, source validity,
  permission, and approval and computes the post-draft gate result.
- **ITERATE** performs only bounded, policy-authorized repair or fallback.
- **PUBLISH | HOLD** is a deterministic terminal decision for the candidate that
  was verified.

## Functional requirements for hybrid drafting

1. Construct a minimum verified context packet for one recommendation.
2. Invoke one pinned model through a typed adapter with fixed timeout, token cap,
   and attempt limit.
3. Require strict structured output.
4. Require every factual claim to include supporting source-signal IDs.
5. Reject unknown, unverified, stale-beyond-policy, or non-supporting references.
6. Reconcile generated output without allowing pre-draft authoritative-field
   mutation.
7. Preserve the deterministic template generator as an explicit fallback.
8. Record whether the accepted draft came from the model or fallback.
9. Hold rather than publish when neither path passes verification.
10. Keep the asynchronous LLM judge outside the runtime path.

## Acceptance criteria

The hybrid runtime is ready for production only when:

- identical source inputs and policy versions produce identical pre-draft scores,
  ranks, confidence, reason codes, source references, action types, permissions,
  and approval requirements;
- given the same pre-draft envelope, candidate or fallback draft, gate policies,
  approval state, clock, and code revision, the verifier produces identical
  schema, grounding, guardrail, verification, failed-gate, and publish/hold
  results;
- generated drafts always parse through the canonical schema;
- all accepted factual claims resolve to verified supporting evidence;
- prompt injection in CRM text cannot alter instructions, authority, or control
  flow;
- the model has no tool or side-effect access;
- provider timeout, invalid output, or grounding failure invokes the configured
  fallback or held state;
- customer-facing and CRM-write actions still require human approval;
- measured latency, token, and cost budgets are enforced;
- deterministic evals, implemented generative evals, security tests, and
  deployment judge gates pass.

## Success metrics

Measured after the runtime and web workspace are connected:

- percentage of published recommendations accepted or actioned by reps;
- time to first action each morning;
- draft acceptance rate without manual rewrite;
- grounding-pass rate;
- deterministic fallback rate;
- model failure and held-recommendation rate;
- unsupported-claim incidents, target zero;
- percentage of high-value accounts touched within SLA;
- p50/p95 runtime drafting latency and measured token cost.

Do not claim these values until production telemetry exists.

## Non-goals

- The model does not autonomously rank accounts.
- The model does not choose or expand tool authority.
- The agent does not autonomously send customer messages or write to the CRM
  without human approval.
- The runtime model does not self-evaluate or authorize publication.
- The Python service does not rank accounts or control the runtime.
- The product does not claim byte-identical generated prose across provider
  calls.

## Delivery status

- **Shipped baseline:** deterministic ranking, reason codes, template drafting,
  guardrails, approval, audit, and asynchronous judge evaluation.
- **Approved architecture:** bounded runtime LLM drafting with deterministic
  post-draft verification and fallback.
- **Next production work:** connect runtime persistence to the web application,
  then implement the model adapter, generated-draft schema, grounding validator,
  telemetry, runtime-generation evals, and rollout gates.
