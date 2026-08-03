# Quality Score

Status: canonical
Owner: engineering
Verification: current repository evidence

## Purpose

This document tracks gaps by product and architecture domain. It is not a substitute for CI or review evidence.

Use three states:

- `green`: implemented and verified;
- `yellow`: implemented in part or verification is incomplete;
- `red`: merge-blocking defect or missing required capability.

## Current architecture quality

| Domain | State | Current gap |
| --- | --- | --- |
| Deterministic scoring and ranking | green | Maintain trajectory and authority regressions. |
| Bounded model authority | green | Runtime generation remains constrained to candidate language. |
| CRM capability provenance | green | Preserve one provenance-bearing capability authority for scoring and audit. |
| Temporal authority | yellow | Coherent repair and deterministic/migration gates pass; independent review of the stable head remains. |
| Transactional outbox authority | green | Keep producer and relay credentials separate. |
| Delivery authority and idempotency | green | Keep creator and provider-result credentials separate. |
| Tenant reference integrity | green | Preserve same-workspace database constraints. |
| Durable workflow implementation | yellow | Selected by ADR-003; implementation belongs to the next bounded delivery. |
| Knowledge-base legibility | green | Root `AGENTS.md` is a bounded map and `pnpm verify:knowledge` is enforced in CI. |
| Verification discipline | yellow | Class-level repair is enforced; one independent review of the stable head remains. |

## Scoring rule

Do not derive a numeric quality percentage from subjective judgment.

Use measured ratios only when telemetry defines the numerator, denominator, unit, and collection method. Otherwise use the categorical state above.

## Update rule

Update this document when a domain changes state or a new merge-blocking architectural gap is accepted.

Do not add individual review comments here. Record temporary review details in the active execution plan.
