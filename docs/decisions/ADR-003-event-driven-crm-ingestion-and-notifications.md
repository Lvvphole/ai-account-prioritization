# ADR-003: Event-Driven CRM Ingestion and Durable Account-Action Orchestration

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owners:** Product and architecture

## Context

The application starts from CRM facts and produces verified sales recommendations. The target state is an event-driven decision and action-support system with bounded automation.

Many CRMs do not supply enrichment fields such as account health. Missing enrichment must stay unavailable. The runtime must not create replacement facts.

CRM events, business decisions, human approval, and external delivery have different responsibilities. An event log does not own a long-running business process. A database job table must not become a custom workflow engine.

`Practical Process Automation` separates event communication from process orchestration. It also treats durable state, waiting, retries, human work, and process visibility as workflow-engine responsibilities. Vercel Workflow SDK provides durable TypeScript workflows, retryable steps, suspension and resumption, hooks for external events, and execution observability. The application already uses TypeScript and Vercel. This gives the smallest sufficient orchestration layer for the current requirements.

## Decision

Use four explicit authorities:

```text
Supabase
  → canonical business facts, source-capability evidence, approvals, outcomes, and audit evidence

Transactional outbox
  → atomic publication boundary for accepted CRM changes

Vercel Workflow SDK
  → durable process execution, steps, waits, retries, and operational traces

Deterministic domain policy
  → feature availability, scoring, rank, reasons, action authority, and verification
```

Use this runtime path after the workflow implementation is delivered:

```text
CRM webhook or scheduled reconciliation
  → source adapter and capability declaration
  → canonical CRM write + capability snapshot + transactional outbox event
  → outbox relay starts one durable account-action workflow
  → load authoritative account snapshot and capability evidence
  → coalesce relevant source events
  → derive only supported features
  → deterministic score, rank, reasons, and action
  → bounded draft generation when permitted
  → deterministic verification
  → hold, internal delivery, or human approval wait
  → re-read authoritative approval after resume
  → idempotent external action
  → persist outcome and audit evidence
```

Keep the weekday daily run as the reconciliation path. Event processing is the fast path. Both paths must use the same domain policy and the same authoritative capability evidence.

Do not add the Workflow SDK dependency in this PR. This PR defines the boundary and persistence foundation. A later PR implements the durable process.

## Data contract

Classify input fields as follows:

1. Native CRM facts, such as accounts, contacts, opportunities, and activities.
2. Configured CRM facts, such as account tier and lifecycle stage.
3. Deterministically derived features with an implemented and versioned formula, such as pipeline totals.
4. Optional external enrichment, such as intent or account health.

Each connector declares its capabilities. A feature can be `observed`, `derived`, or `unavailable`.

Persist the current authoritative declaration per canonical account in `account_source_capabilities`. Store the workspace, source, capability object, source-mapping version, and observation time. The database must enforce that the capability row and its canonical account have the same `(account_id, workspace_id)` binding. Durable prioritization loads this evidence from Supabase and fails closed when any account has no valid declaration.

The scorer removes unavailable feature weights and renormalizes the remaining weights. It does not create a neutral health score. It does not treat missing contact history as maximal staleness.

A feature can be `derived` only when the repository contains a versioned deterministic derivation that actually produces the authoritative value. Activity or email availability alone does not define account staleness, so connector-aware staleness remains `unavailable` until a versioned last-contact derivation exists. The same rule applies to intent, renewal-derived lifecycle, and health.

Pipeline derivation version `open-opportunity-sum-usd-cents-v2` sorts open canonical opportunities by stable opportunity ID, validates each canonical USD amount from its decimal representation to at most two fractional digits, converts it to exact integer cents, sums exact minor units, and only then converts the total to dollars. The precision rule is independent of amount magnitude. Values finer than one cent and unsafe totals fail closed. Database row order and floating-point addition order therefore cannot change score, reasons, or action authority.

Every connector-aware recommendation whose pipeline feature is derived must carry the pipeline derivation version in its pre-draft source evidence. Durable audit evidence must preserve the recommendation source evidence or the explicit derivation version so a replay can identify the formula that authorized the decision.

## Tenant reference integrity

A `workspace_id` column does not by itself prove tenant ownership. Every tenant-owned reference that can affect authority must be bound at the database boundary to the referenced object's workspace.

For this Phase 1 path, the required reference chain is:

```text
account_source_capabilities(account_id, workspace_id)
  → accounts(id, workspace_id)

recommendations(account_id, workspace_id)
  → accounts(id, workspace_id)

integration_event_outbox(aggregate_id, workspace_id)
  → accounts(id, workspace_id)

notification_deliveries(recommendation_id, workspace_id)
  → recommendations(id, workspace_id)
```

Cross-workspace and nonexistent references must fail at the database constraint boundary, including when `service_role` is used.

## Process contract

### Business authority

Supabase is the source of truth for:

- canonical CRM records;
- source capability and feature provenance;
- recommendations;
- approvals;
- delivery outcomes;
- durable business audit evidence.

Workflow state is not the business source of truth.

### Process authority

Vercel Workflow SDK will own:

- process progression;
- completed-step checkpoints;
- waits and timers;
- retryable step execution;
- workflow failure state;
- workflow-version binding;
- operational execution traces.

Do not implement a second retry scheduler or general process-state machine in application tables.

### Event and command semantics

Events describe completed facts. Examples are `crm.account.updated`, `recommendation.created`, `approval.granted`, and `notification.sent`.

Commands request work. Examples are `recompute_account`, `request_approval`, `send_notification`, and `record_outcome`.

An event can wake a workflow. It cannot authorize a customer-facing side effect.

### Transactional publication

Store an accepted canonical CRM change, its current capability evidence, and its outbox event in the same ingestion transaction when those records change together.

The outbox relay can retry publication to the workflow runtime. It does not own the account-action process after publication succeeds.

### Human approval

A customer-facing send or CRM write-back requires durable approval evidence.

A workflow hook can resume a waiting process. The hook is not approval authority. After the workflow resumes, it must read the current approval record from Supabase before it performs the side effect.

### Idempotent side effects

Every external side effect requires a deterministic idempotency key. Retry must not create duplicate email, CRM writes, or notifications.

### Version binding

Each process execution must record the applicable workflow deployment, policy version, scoring version, schema version, source mapping version, deterministic derivation versions that affected authority, and model or prompt identity when model drafting occurs.

## Outbox controls

- Use `(workspace_id, source, source_event_id)` as the source-event idempotency boundary.
- Bind `(aggregate_id, workspace_id)` to the canonical account `(id, workspace_id)`.
- Keep source-qualified event identifiers as audit evidence.
- Coalesce webhook bursts by workspace and account before recomputation.
- Use explicit ordinal ordering for durable event and evidence collections.
- Keep bounded retry and terminal failure state only for outbox publication.
- Permit only `pending → publishing → published|failed` and `failed → publishing|dead` progression.
- Never reopen `published` or `dead` rows.
- Never decrease the publication-attempt count.
- Require a workflow run identifier and publication timestamp before `published` is valid.
- Record a stable error code for `failed` and `dead` states.
- Source-adapter inserts must start in `pending` state. Publication status and publication evidence are not insert authority.

## Delivery ledger controls

The database stores delivery evidence. It does not schedule delivery retries.

The delivery ledger records:

- workspace;
- recipient;
- recommendation;
- channel;
- idempotency key;
- workflow run identifier;
- delivery status;
- provider message identifier when available;
- request, success, and failure timestamps;
- stable failure code when delivery fails.

Bind `(recommendation_id, workspace_id)` to the authoritative recommendation `(id, workspace_id)`. A delivery cannot cite a recommendation from another tenant or a recommendation that does not exist.

Delivery identity and idempotency columns are immutable to application code. Terminal delivery rows are immutable and cannot return to `requested`.

A new ledger row must start in `requested` state without terminal provider, success, or failure evidence. Application insert authority excludes terminal-state columns. Terminal evidence can be established only through the guarded update transition from the requested row.

The Workflow SDK step owns retry behavior for the provider call.

## Kafka admission rule

Do not add Kafka now. Add it behind the outbox boundary only when measured requirements show at least one of these conditions:

- The selected transport cannot support the required event volume.
- Multiple independent systems must consume the same ordered stream.
- Long-window replay is a product requirement.
- Strict partition ordering is required at scale.
- An enterprise customer requires Kafka integration.

## Framework isolation

Keep scoring, verification, schemas, source mapping, approval policy, and business rules independent of Workflow SDK types.

The future workflow calls domain functions through a thin adapter. This permits a runtime change without rewriting business authority.

Do not add another orchestration platform unless Vercel Workflow SDK fails a documented production requirement.

## Consequences

### Positive

- Common CRM data can enter the product without vendor-specific health fields.
- Missing evidence remains explicit.
- Durable runs cannot silently treat normalized defaults as connector evidence.
- Tenant-owned authority references cannot cross workspace boundaries silently.
- Webhook events can update affected accounts without full-book recomputation.
- Daily reconciliation can detect missed events and repair drift.
- The outbox preserves atomic publication without becoming the process engine.
- The database keeps durable business evidence without duplicating workflow runtime state.
- Human approval can wait without a custom polling system.
- Kafka remains an optional transport.
- The architecture reuses the existing Vercel and TypeScript platform.

### Costs and risks

- The outbox relay still requires a small publication component.
- Source adapters must maintain field mappings and durable capability declarations.
- Existing durable accounts need valid capability snapshots before connector-aware prioritization can run; absence fails closed rather than guessing.
- Staleness, derived health, renewal-derived lifecycle, and activity-derived intent require separate versioned formulas before they can be enabled.
- Workflow SDK becomes an infrastructure dependency when the durable process is implemented.
- Operators still need business audit views in Supabase and workflow execution views in Vercel.

## Phase 1 scope

This PR must deliver only the foundation:

1. Explicit optional-feature availability.
2. Connector capability, provenance, durable capability-snapshot, and same-workspace authority contracts.
3. Transactional outbox persistence with retry-safe publication-state and account-reference controls.
4. Delivery-ledger persistence with same-workspace recommendation binding and without generic retry scheduling.
5. Deterministic event routing, evidence ordering, coalescing, and idempotency.
6. Versioned deterministic pipeline derivation with exact minor-unit aggregation and durable provenance.
7. Reconciliation of trajectory eval contracts with the intentional scoring change.
8. Passing CI, security, migration, build, schema, and eval gates.

This PR must not add a live CRM webhook, Workflow SDK dependency, provider-specific email adapter, Kafka, or another orchestration framework.

## Next delivery

The next PR will implement one `accountActionWorkflow` with Vercel Workflow SDK. It will use durable steps for external work and a bounded approval wait for customer-facing actions.

## References

- Bernd Ruecker, *Practical Process Automation*, O'Reilly Media. See the sections on orchestration, event-driven architecture, workflow engines, human tasks, and reliable distributed communication.
- Dimitri Fontaine, *The Art of PostgreSQL*. See SQL-as-code, constraints, transactions, regression testing, and concurrency control.
- Martin Fowler et al., *Patterns of Enterprise Application Architecture*. See persistence, transaction, repository, and enterprise data boundaries.
- Chris Richardson, *Microservices Patterns*. See transactional outbox, transactional messaging, duplicate-message handling, and audit logging.
- Bill Karwin, *SQL Antipatterns*. See Keyless Entry and Rounding Errors.
- Vercel Workflow SDK: https://vercel.com/docs/workflow
- Vercel guidance for durable workflows and human approval: https://vercel.com/kb/guide/human-in-the-loop-with-chat-sdk-and-workflow-sdk
