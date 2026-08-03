# Security

Status: canonical
Owner: security
Verification: security checks, migration tests, and review

## Purpose

This document defines trust boundaries, credentials, tenant isolation, and model-security rules.

## Trust model

Treat these inputs as untrusted data:

- CRM fields;
- notes and emails;
- uploads and retrieved documents;
- webhook payloads;
- tool responses;
- model output.

Untrusted data cannot change score, rank, action authority, permissions, approval, verification, workflow authority, or publication authority.

## Least privilege

Use separate credentials for separate authorities.

For the event-driven path:

```text
source producer
  -> create canonical source evidence and pending work

integration_outbox_relay
  -> advance outbox publication state

notification_delivery_worker
  -> record provider delivery results
```

A shared producer credential must not gain relay or terminal-delivery authority.

Do not provide a producer-accessible `SECURITY DEFINER` bypass that restores the forbidden authority.

## Tenant isolation

Tenant ownership must be enforced in PostgreSQL, not only in application filters.

Authority-bearing references must use same-workspace constraints where applicable.

Required negative tests include:

- cross-workspace source capability reference;
- cross-workspace outbox account reference;
- cross-workspace recommendation reference;
- cross-workspace delivery reference.

RLS remains required for tenant-scoped data even when a composite foreign key also enforces reference integrity.

## Approval boundary

Customer-facing sends and CRM write-backs require human approval.

A workflow resume signal is not approval evidence. After resumption, read the current authoritative approval record before the external side effect.

Synthetic approval is forbidden in production.

## Model boundary

The runtime model:

- receives minimum authorized context;
- receives no general side-effecting tool registry;
- cannot set authoritative recommendation fields;
- cannot authorize publication;
- cannot treat customer-controlled text as instructions;
- cannot bypass deterministic grounding or guardrails.

Prompt injection must not change control flow or authority.

## Secrets and PII

- Keep service-role and provider credentials server-only.
- Do not log secrets or tokens.
- Do not put secrets in prompts, fixtures, generated artifacts, or audit text.
- Redact unnecessary PII before telemetry or model-provider transmission.
- Minimize provider payloads to the fields required for the bounded task.

## Side effects

Every side effect requires:

- explicit authorization;
- deterministic idempotency;
- audit evidence;
- a bounded retry owner;
- a terminal outcome or explicit failure state.

Do not let two components own retries for the same side effect.

## Database migration review

New tables, functions, roles, grants, RLS policies, and triggers require least-privilege review.

Migration tests must prove permitted and forbidden behavior. DDL inspection alone is insufficient.

## Verification

Run the security and migration gates required by `docs/VERIFICATION.md`.

A security finding remains merge-blocking until the exact current head contains both the fix and the relevant negative regression.
