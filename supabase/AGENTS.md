# Supabase Authority Map

This file applies to `supabase/**`. Read the root `AGENTS.md` first.

Use these canonical sources:

- Architecture and ownership: `docs/ARCHITECTURE.md`
- Reliability and temporal authority: `docs/RELIABILITY.md`
- Security and least privilege: `docs/SECURITY.md`
- Verification: `docs/VERIFICATION.md`
- Event-driven process decision: `docs/decisions/ADR-003-event-driven-crm-ingestion-and-notifications.md`

## Local database invariants

### Credential separation

- `service_role` is a producer credential for Phase 1. It can create canonical source evidence, pending outbox work, and requested delivery work.
- `integration_outbox_relay` alone owns outbox publication transitions.
- `notification_delivery_worker` alone owns provider-result transitions.
- `service_role` must not be a member of either capability role and must not receive equivalent update authority.
- Do not restore forbidden authority through a producer-accessible `SECURITY DEFINER` function.

### Tenant reference integrity

Authority-bearing tenant references require same-workspace database constraints. A `workspace_id` column alone is not sufficient.

Preserve these bindings:

```text
account_source_capabilities(account_id, workspace_id) -> accounts(id, workspace_id)
integration_event_outbox(aggregate_id, workspace_id) -> accounts(id, workspace_id)
recommendations(account_id, workspace_id) -> accounts(id, workspace_id)
notification_deliveries(recommendation_id, workspace_id) -> recommendations(id, workspace_id)
```

### Capability temporal authority

- Reject a future `observed_at` before it becomes current durable authority.
- Do not allow observation time to move backward.
- Equal-time replay is idempotent only when source, mapping version, and capability content are unchanged.
- Past snapshots remain readable. The runtime classifies decision-age freshness per account.
- Do not delete or rewrite current authority merely to bypass freshness policy.

### Outbox

- Insert only `pending` work with attempt count zero and no publication evidence.
- Producer credentials cannot claim or publish work.
- Legal transition: `pending -> publishing -> published|failed`, then `failed -> publishing -> dead`.
- Entering `publishing` increments attempt count exactly once.
- `published` and `dead` cannot reopen.

### Delivery ledger

- Insert only `requested` work with no provider-result evidence.
- Delivery creation authority is separate from terminal-result authority.
- Terminal rows cannot return to `requested`.
- Delivery and idempotency identity are immutable.

## Verification

Database authority claims require behavioral migration tests, including permitted paths, forbidden privileges, invalid tenant references, invalid transitions, and temporal replay/admission cases.

Run `pnpm verify:migrations` and all affected gates in `docs/VERIFICATION.md` before completion.
