# ADR-003: Event-Driven CRM Ingestion and Notifications

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owners:** Product and architecture

## Context

The application currently runs as a daily decision-support workflow. The scorer also accepts enrichment fields, such as `healthScore`, that many CRMs do not supply. Missing enrichment must not become invented data.

CRM changes, scheduled reconciliation, and notification delivery have different execution needs. Kafka is an event-stream platform. It is not a scheduler or an email job runner. Adding Kafka before event volume and replay requirements justify it would add cost and failure surface without proportional value.

## Decision

Use this path:

```text
CRM webhook or scheduled pull
  → source adapter and capability declaration
  → canonical CRM record
  → transactional Postgres outbox event
  → durable worker with idempotency, retry, and dead-letter state
  → account-level event coalescing
  → recompute only affected account features
  → verified recommendation
  → approval policy
  → idempotent in-app or email notification job
```

Keep the weekday daily run as the reconciliation path. Event processing is the fast path.

## Data contract

Classify input fields as:

1. Native CRM facts, such as accounts, contacts, opportunities, and activities.
2. Configured CRM facts, such as account tier and lifecycle stage.
3. Deterministically derived features, such as staleness and pipeline totals.
4. Optional external enrichment, such as intent or account health.

Each connector declares its capabilities. A feature can be `observed`, `derived`, or `unavailable`. The scorer removes unavailable feature weights and renormalizes the remaining weights. It does not invent a neutral health score or maximal staleness.

## Event processing controls

- Use `(workspace_id, source, source_event_id)` as the event idempotency boundary.
- Store the normalized write and outbox event in one transaction.
- Coalesce webhook bursts by workspace and account before recomputation.
- Keep all source event ids as audit evidence.
- Use bounded retries and a terminal `dead` state.
- Do not send customer-facing email without the existing approval gate.
- Use a stable notification idempotency key to prevent duplicate delivery.

## Kafka admission rule

Do not add Kafka now. Add it behind the outbox boundary only when measured requirements show at least one of these conditions:

- The managed queue cannot support required event volume.
- Multiple independent systems must consume the same ordered stream.
- Long-window replay is a product requirement.
- Strict partition ordering is required at scale.
- An enterprise customer requires Kafka integration.

## Consequences

### Positive

- Common CRM data can enter the product without vendor-specific health fields.
- Missing evidence remains explicit.
- Webhook events update affected accounts without full-book recomputation.
- The daily schedule detects missed events and repairs drift.
- Notification delivery has retry, idempotency, and terminal failure states.
- Kafka remains an optional transport, not a premature platform dependency.

### Costs and risks

- A durable worker must claim and process outbox rows.
- Source adapters must maintain field mappings and capability declarations.
- Derived health requires a separate versioned formula before it can be enabled.
- Operators need metrics for queue lag, retries, dead events, and delivery failures.

## Implementation sequence

1. Make optional feature availability explicit in scoring.
2. Add connector capability and feature-provenance contracts.
3. Add the transactional outbox and notification job tables.
4. Add account-event routing, coalescing, and idempotent notification contracts.
5. Connect CRM webhook adapters to the outbox.
6. Add the durable worker and provider-specific email adapter.
7. Add operational metrics and dead-letter recovery.
8. Evaluate Kafka only against the admission rule.
