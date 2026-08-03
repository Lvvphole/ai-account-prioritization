# Design Documents Index

Status: canonical
Owner: architecture
Verification: `pnpm verify:knowledge`

Use this index to find stable design knowledge. Temporary implementation state belongs in `docs/exec-plans/active/`.

| Document | Purpose | Status |
| --- | --- | --- |
| `core-beliefs.md` | Stable engineering beliefs | canonical |
| `../ARCHITECTURE.md` | System and authority map | canonical |
| `../RELIABILITY.md` | Determinism, temporal authority, recovery | canonical |
| `../SECURITY.md` | Trust and privilege boundaries | canonical |
| `../VERIFICATION.md` | Completion and review-loop gates | canonical |
| `../decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md` | Harness economics | accepted |
| `../decisions/ADR-003-event-driven-crm-ingestion-and-notifications.md` | Event-driven process architecture | accepted |

## Verification status rule

A design document can be `canonical` only when:

- its owner is named;
- its scope is clear;
- current code does not knowingly contradict it;
- required executable verification is named;
- superseded content is removed or linked as historical context.

Do not put current commit SHAs, review-thread status, or temporary remediation notes in canonical design documents.
