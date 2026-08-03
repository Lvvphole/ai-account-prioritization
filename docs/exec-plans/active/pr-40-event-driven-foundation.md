# PR #40 — Event-Driven Foundation Completion Plan

Status: active
Owner: engineering
Verification: `docs/VERIFICATION.md`

## Goal

Complete Phase 1 of the event-driven decision and action-support architecture without adding another orchestration platform or custom workflow engine.

## Desired state

PR #40 contains a small, coherent foundation:

- canonical CRM capability evidence;
- deterministic feature authority;
- exact and traceable derived pipeline;
- transactional outbox;
- delivery ledger;
- tenant-bound references;
- separated publication and delivery credentials;
- repository knowledge that is concise, discoverable, and mechanically checked;
- no open authority, determinism, security, tenancy, or durable-evidence review finding.

## Contract

Keep:

- deterministic domain authority;
- Supabase business authority;
- transactional outbox boundary;
- ADR-003 selection of Vercel Workflow SDK for the next delivery;
- human approval for customer-facing or CRM-write actions;
- deterministic verification and template fallback.

Do not add in this PR:

- Vercel Workflow SDK dependency;
- live Salesforce or HubSpot webhook;
- live email provider;
- Kafka;
- another agent framework;
- another generic retry scheduler;
- a custom workflow state machine.

## Baseline

PR #40 entered a repeated review-repair loop. Several valid findings came from the same authority classes after earlier local repairs.

The current accepted root defect class is **temporal authority**:

- stale capability evidence is treated as a repository exception instead of a per-account held state;
- future capability evidence can enter durable authority and block later valid updates;
- a zone-less injected decision clock can change freshness behavior by host timezone.

The PR is in draft state while this design-level repair is in progress.

## Requirements

1. Root `AGENTS.md` is a short repository map, not the permanent implementation manual.
2. Architecture, reliability, security, verification, planning, and quality knowledge have separate canonical files.
3. CI mechanically checks the knowledge structure.
4. Authority-bearing timestamps require an explicit zone.
5. Future capability timestamps are rejected before they become current durable authority.
6. Durable capability updates remain monotonic.
7. Freshness is classified per account at the decision boundary.
8. A stale, future, or missing capability snapshot holds only the affected account and writes failed-gate evidence.
9. Unrelated accounts continue through reconciliation.
10. One temporal-authority regression suite covers the complete defect class.

## Design decision

Use one temporal-authority pipeline:

```text
source observation
  -> canonical offset-bearing instant validation
  -> database admission check
  -> monotonic durable storage
  -> per-account freshness classification
  -> fresh: decision eligible
     stale/future/missing: held plus audit evidence
```

The repository loads structurally valid snapshots. It does not abort a batch because ordinary business evidence is stale.

## Build plan

1. Reduce root `AGENTS.md` and create canonical knowledge documents.
2. Add `pnpm verify:knowledge` and CI enforcement.
3. Implement one temporal-authority classifier with explicit-zone timestamp validation.
4. Remove freshness policy throws from the Supabase repository read path.
5. Reject future capability observations at the database boundary.
6. Classify missing/stale/future snapshots per account in the orchestrator.
7. Audit and count held accounts without drafting or publishing them.
8. Add class-level temporal regressions, including one stale account beside one fresh account.
9. Run targeted gates, then full required gates.
10. Request one fresh independent review only after all local evidence is green.

## Review-loop rule

If the next independent review finds another significant temporal-authority defect, do not patch the reported line first. Return to this plan and the `docs/RELIABILITY.md` invariant.

A finding from a different defect class is classified separately.

## Exit condition

PR #40 can leave draft state only when:

- the temporal-authority design is implemented;
- `pnpm verify:knowledge` passes;
- required CI, Security, Evals, migration, schema, and build gates pass on one exact head;
- no unresolved P0/P1 exists;
- no unresolved authority/determinism/security/tenancy/side-effect/durable-evidence P2 exists;
- the PR description matches the exact head;
- one independent review of the stable head is complete.

## Decision log

- Selected repository knowledge split instead of expanding root `AGENTS.md`.
- Selected design-level temporal-authority repair instead of three finding-specific patches.
- Kept Vercel Workflow SDK out of Phase 1 implementation.
- Kept PR #40 in draft during architecture compression and remediation.
