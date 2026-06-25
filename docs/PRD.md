# PRD — AI Account Prioritization Agent for B2B Sales Teams

## Problem

B2B reps drown in noisy CRM data and waste prime selling hours deciding *who* to
contact. Existing "AI" tools hallucinate facts, can't show their work, and act
without guardrails — so reps don't trust them.

## Product

A daily agent that turns messy CRM/account data into a **verified daily action
plan**. For each account a rep should act on, the product answers:

1. **Which** accounts to contact first (deterministic rank).
2. **Why** each account matters (closed-set reason codes + narrative).
3. **What** action to take next (next best action).
4. **What evidence** supports it (verified source signals).
5. **Whether** it passed safety, schema, permission, and eval gates.

## Users

- **Rep** — sees a ranked priority list with reason codes, evidence, and the next
  best action; approves customer-facing actions.
- **Manager** — sees coverage gaps and recommendations held by the safety gates.
- **Admin** — inspects the deterministic scoring configuration.

## Hard product invariants

- The **LLM never ranks**; deterministic scoring decides priority.
- Every recommendation carries **score, confidence, reason codes, source
  signals, next best action**.
- Nothing publishes **without verification**.
- **Human approval** is required for customer-facing sends and CRM write-back.
- **No fabricated** facts, dates, conversations, discounts, approvals,
  availability, or intent.
- Every critical action is **audited**.

## Loop

```
DISCOVER → PLAN → EXECUTE → VERIFY → ITERATE → (PUBLISH)
```

## Success metrics (illustrative)

- % of published recommendations accepted/actioned by reps.
- Time-to-first-action each morning.
- Zero unsupported-claim incidents (guardrail + judge).
- Coverage: % of high-value accounts touched within SLA.

## Non-goals

- The agent does not autonomously send customer messages or write to the CRM
  without human approval.
- The Python service is a support service; it does not rank or control the
  runtime.
