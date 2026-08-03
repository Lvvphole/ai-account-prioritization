# Agent Runtime Map

This file applies to `apps/agent-runtime/**`. Read the root `AGENTS.md` first.

Use these canonical sources instead of expanding this file:

- Architecture and authority: `docs/ARCHITECTURE.md`
- Reliability, temporal authority, exact money, ordering, recovery: `docs/RELIABILITY.md`
- Security and trust boundaries: `docs/SECURITY.md`
- Verification and review loop: `docs/VERIFICATION.md`
- Event-driven process decision: `docs/decisions/ADR-003-event-driven-crm-ingestion-and-notifications.md`

## Local runtime invariants

- Keep deterministic scoring, ranking, reason codes, next-best-action authority, and verification model-independent.
- Model output is untrusted candidate language. It cannot mutate authoritative recommendation fields.
- Every authoritative reason requires direct supporting source evidence.
- A feature is `derived` only when a versioned deterministic derivation exists and its contributing source records are traceable.
- Use one capability authority for scoring and durable evidence. Reject competing declarations.
- Preserve exact source money before JavaScript number conversion. Aggregate authoritative money in exact minor units.
- Canonicalize unordered source collections with explicit ordinal ordering before they affect authority or durable evidence.
- Do not use locale-dependent formatting or sorting in authority-bearing serialization.
- Keep deterministic candidate recommendation IDs separate from persisted recommendation UUIDs.

## Temporal authority

Follow `docs/RELIABILITY.md`.

- Authority-bearing clocks require an explicit `Z` or numeric UTC offset.
- Repository reads return structurally valid capability snapshots. They do not abort reconciliation because a snapshot is ordinarily stale.
- Freshness is classified per account at the deterministic decision boundary.
- Missing, stale, or future capability authority holds only the affected account and records a failed-gate result.
- Do not draft, approve, verify, or publish an account that failed temporal authority.

## Verification

For a runtime behavior change, run the narrowest deterministic test first and then the affected gates in `docs/VERIFICATION.md`.

If an independent review finds another significant defect from the same mechanism, stop line-by-line repair and return to the governing design invariant before changing more code.
