# Supabase Authority Contract

This file applies to `supabase/**`. The root `AGENTS.md` and accepted ADRs remain authoritative. This file makes their database boundary rules executable and local.

## Non-negotiable authority boundaries

- `service_role` is a producer credential for this Phase 1 path. It can create canonical source evidence, pending outbox work, and requested delivery work. It must not own relay publication transitions or terminal provider-result transitions.
- `integration_outbox_relay` is the only database capability role that can advance outbox publication state. `service_role` must not be a member of this role and must not have equivalent `UPDATE` privileges.
- `notification_delivery_worker` is the only database capability role that can record provider delivery results. `service_role` must not be a member of this role and must not have equivalent `UPDATE` privileges.
- Do not bypass these separations with a `SECURITY DEFINER` function that is executable by `service_role` or another producer credential.
- Dedicated capability roles are `NOLOGIN`. Production runtime credentials that need these capabilities must be provisioned separately. Do not grant the capability roles to shared backend credentials.

## Tenant reference integrity

A `workspace_id` column is not sufficient tenant isolation. Every tenant-owned reference that can affect authority must be enforced with a same-workspace database constraint.

Required Phase 1 bindings:

```text
account_source_capabilities(account_id, workspace_id)
  -> accounts(id, workspace_id)

recommendations(account_id, workspace_id)
  -> accounts(id, workspace_id)

integration_event_outbox(aggregate_id, workspace_id)
  -> accounts(id, workspace_id)

notification_deliveries(recommendation_id, workspace_id)
  -> recommendations(id, workspace_id)
```

Cross-workspace and nonexistent references must fail at the database boundary, including under backend roles.

## Capability snapshot freshness

`account_source_capabilities` is the current authoritative snapshot.

- `observed_at` must never move backward.
- An equal-time replay may be idempotent only when source, mapping version, and capability content are unchanged.
- An older or conflicting equal-time observation must not replace current authority.
- Enforce freshness in PostgreSQL. Do not rely on event arrival order in application code.

## Outbox state contract

Insert state:

```text
status = pending
publication_attempt_count = 0
no lock evidence
no workflow evidence
no publication evidence
no error evidence
```

Transition state:

```text
pending -> publishing -> published | failed
failed  -> publishing -> dead
```

Rules:

- `published` and `dead` are terminal.
- Entering `publishing` from `pending` or `failed` increments `publication_attempt_count` by exactly one.
- The attempt count must not change on any other transition.
- `published` requires workflow-run and publication-time evidence.
- `failed` and `dead` require stable error evidence.
- Source-adapter credentials can insert pending rows but cannot claim, publish, fail, or kill them.

## Delivery state contract

Insert state:

```text
status = requested
no provider result
no sent evidence
no failure evidence
```

Rules:

- Delivery creation authority is separate from provider-result authority.
- Only the delivery worker can transition a requested row to a terminal result.
- Terminal rows cannot return to `requested`.
- Delivery identity and idempotency identity are immutable.
- A delivery must reference an existing recommendation in the same workspace.

## Verification requirement

Database claims require behavioral migration tests. Structural DDL inspection alone is insufficient.

For each authority boundary, test at least:

- one permitted path;
- one forbidden role/privilege path;
- one cross-tenant or invalid-reference path when applicable;
- one invalid state transition;
- one replay/order/freshness case when applicable.

Run `scripts/verify-migrations.sh` before declaring the database change complete.