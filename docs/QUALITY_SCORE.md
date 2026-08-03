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
| CRM capability provenance | yellow | Temporal authority must be repaired as one coherent invariant. |
| Temporal authority | red | Stale evidence must hold per account; future timestamps must be rejected before durable authority; decision clocks require explicit zones. |
| Transactional outbox authority | green | Keep producer and relay credentials separate. |
| Delivery authority and idempotency | green | Keep creator and provider-result credentials separate. |
| Tenant reference integrity | green | Preserve same-workspace database constraints. |
| Durable workflow implementation | yellow | Selected by ADR-003; implementation belongs to the next bounded delivery. |
| Knowledge-base legibility | yellow | Root `AGENTS.md` is being reduced to a map and mechanical knowledge verification is being added. |
| Verification discipline | yellow | Replace finding-by-finding repair with class-level design repair and one final review gate. |

## Scoring rule

Do not derive a numeric quality percentage from subjective judgment.

Use measured ratios only when telemetry defines the numerator, denominator, unit, and collection method. Otherwise use the categorical state above.

## Update rule

Update this document when a domain changes state or a new merge-blocking architectural gap is accepted.

Do not add individual review comments here. Record temporary review details in the active execution plan.
