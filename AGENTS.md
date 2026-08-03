# AGENTS.md — Repository Map

This file is the entry point for coding agents and humans. Keep it short. Use it as a map to the repository knowledge base. Do not turn it into a full operating manual.

## 1. Precedence

Apply instructions in this order:

1. The user's explicit task and constraints.
2. This root `AGENTS.md`.
3. Accepted ADRs and canonical documents linked below for their stated domain.
4. Package-local `AGENTS.md` files for stricter local rules.
5. Code comments and implementation notes.

A lower-level source can add detail. It cannot weaken a higher-level safety, determinism, approval, schema, security, grounding, or verification rule. If two authoritative sources conflict, stop and report the conflict.

## 2. Product contract

Build an event-driven decision and action-support system with bounded automation and scheduled reconciliation.

Non-negotiable invariants:

- The LLM never ranks accounts or owns score, rank, reason codes, action authority, approval, verification, or publication.
- Deterministic TypeScript owns feature availability, scoring, ranking, reasons, next-best-action authority, and post-draft verification.
- Runtime model output is untrusted candidate content.
- Every authoritative reason and factual claim requires verified source evidence.
- Unsupported or unavailable CRM data must not become fabricated defaults.
- Customer-facing sends and CRM write-backs require human approval.
- A resumed workflow must re-read current approval before a side effect.
- External side effects require deterministic idempotency.
- Runtime safety and authority gates fail closed.
- TypeScript/Zod is the schema source of truth. Python consumes generated schemas.
- Audit evidence must preserve the policy, source, model, prompt, schema, and derivation versions that affected authority.
- The executor does not self-certify completion.

## 3. Required repository knowledge

Read only the documents required for the task.

| Concern | Canonical source |
| --- | --- |
| Product requirements | `docs/PRD.md`, `prd_manifest.yaml` |
| System and authority architecture | `docs/ARCHITECTURE.md` |
| Stable engineering beliefs | `docs/design-docs/core-beliefs.md` |
| Design-document index | `docs/design-docs/index.md` |
| Harness economics | `docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md` |
| Event-driven process architecture | `docs/decisions/ADR-003-event-driven-crm-ingestion-and-notifications.md` |
| Verification and review gates | `docs/VERIFICATION.md` |
| Reliability and deterministic behavior | `docs/RELIABILITY.md` |
| Security and trust boundaries | `docs/SECURITY.md` |
| Planning rules and execution plans | `docs/PLANS.md` |
| Current quality gaps | `docs/QUALITY_SCORE.md` |
| Runtime-specific rules | `apps/agent-runtime/AGENTS.md` |
| Database-specific rules | `supabase/AGENTS.md` |
| Shared schemas | `packages/shared-schemas/src` |
| Tests and evals | `packages/testing-evals` |

Do not copy the full contents of these documents into this file.

## 4. Work loop

Use one path:

```text
contract → baseline → requirements → design → plan → build → review_loop → deploy → monitor → stop_or_loop
```

For a complex or cross-boundary change, create or update an execution plan under `docs/exec-plans/active/` before implementation.

Before a code change:

- read the applicable canonical documents;
- reproduce or measure the baseline when practical;
- identify the authority boundary that owns the behavior;
- choose the smallest coherent change.

During a review loop:

- classify each finding before editing;
- fix the governing defect class, not only the reported line;
- if a new significant finding belongs to the same defect class, stop local patching and return to design;
- add one class-level deterministic regression where the behavior is machine-checkable;
- do not add finding-specific rules, commit hashes, or current PR status to `AGENTS.md`;
- request a new independent review only after the design invariant and affected regressions are complete.

## 5. Completion gate

Follow `docs/VERIFICATION.md`.

At minimum:

- run the narrowest relevant checks first;
- run `pnpm verify:knowledge`;
- run all required affected CI gates;
- verify generated artifacts are synchronized;
- verify no required check is cancelled, skipped, missing, or still running;
- keep the merge gate closed for unresolved P0/P1 findings or unresolved P2 findings that affect authority, determinism, security, tenancy, side effects, or durable evidence.

Green CI is evidence. It is not architectural certification.

## 6. Repository safety

- Work on a non-`main` branch.
- Preserve pre-existing user work.
- Do not use destructive Git commands on user work.
- Do not push, merge, close, delete, or change repository settings unless the user requested that action.
- Never push directly to `main`.

## 7. Knowledge-base discipline

Repository-local, versioned artifacts are the system of record for agent work.

- Keep this file at or below 140 lines.
- Put architecture in `docs/ARCHITECTURE.md` and accepted ADRs.
- Put verification and review-loop policy in `docs/VERIFICATION.md`.
- Put reliability and deterministic invariants in `docs/RELIABILITY.md`.
- Put security controls in `docs/SECURITY.md`.
- Put active implementation state in execution plans, not permanent policy files.
- Update the canonical source instead of duplicating a rule in several files.
- Run the knowledge-base verifier after knowledge changes.
