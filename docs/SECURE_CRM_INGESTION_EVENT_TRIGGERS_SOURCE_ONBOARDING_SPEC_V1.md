# Secure CRM Ingestion, Event Triggers, and Source Onboarding Specification v1

**Product:** AI Account Prioritization Agent for B2B Sales Teams  
**Repository:** `Lvvphole/ai-account-prioritization`  
**Implementation target:** Claude Code  
**Artifact status:** Historical/domain specification; implementation sequencing superseded by the current production-spine authority  
**Date:** 2026-07-31  
**Authority alignment:** 2026-08-06  
**Canonical destination in repository:** `docs/SECURE_CRM_INGESTION_EVENT_TRIGGERS_SOURCE_ONBOARDING_SPEC_V1.md`

---

## 0. Authority and current-scope status

This specification preserves domain requirements and already-adopted security, tenancy, provenance, quarantine, validation, and ingestion invariants. It does not override `AGENTS.md`, ADR-001, ADR-002, `docs/PRD.md`, `docs/ARCHITECTURE.md`, or `prd_manifest.yaml`.

The approved Position B target architecture permits bounded model assistance with semantic interpretation and field-mapping proposals when an explicit task contract permits it. A model proposal never makes source data authoritative. Source authentication, quarantine, security decisions, schema validation, row disposition, canonical commit, provenance, and authoritative CRM state remain deterministic.

The event-driven ingestion, trigger orchestration, remote MCP ingestion, generalized connector sequencing, and worker architecture described below are not the current production-spine implementation plan. They remain historical or future domain design unless a later explicit ruling admits them under the current product plan and ADR-002.

Current production-spine P4 remains limited to the provider-neutral model boundary, provider-native constrained output, normalized reasoning or effort configuration, full prompt/schema/policy/model identity evidence, offline cross-model k-run qualification, one qualified production configuration at a time, deterministic fallback or hold, and the two production acceptance profiles defined in the current authority documents.

No statement in this historical specification authorizes model-controlled candidate-action selection, general tool orchestration, supervisor-worker fan-out, multi-model routing or voting, a second action ontology, production caching, event-driven ingestion, or remote MCP ingestion as current production-spine work.

---

## 1. Executive decision

The next product increment is a secure, observable data-ingress control plane that lets an authorized administrator:

1. Connect a CRM or remote MCP source.
2. Upload CRM data manually through a constrained CSV workflow.
3. Map external fields to canonical product schemas.
4. Preview, validate, quarantine, approve, and commit changes.
5. Configure closed-set event triggers.
6. Recompute only affected accounts after accepted data changes.
7. Trace every recommendation to the exact source event or imported row.
8. Pause, replay, reconcile, or roll back ingestion without weakening the deterministic ranking and human-approval invariants.

The implementation must establish **one canonical ingestion boundary** for every source:

```text
Native CRM | Signed Webhook/API | Remote MCP | Manual CSV
                              ↓
                    Authenticate source
                              ↓
                       Quarantine input
                              ↓
              Scan → parse → normalize → validate
                              ↓
             Map fields → resolve identity → deduplicate
                              ↓
                  Preview deterministic change set
                              ↓
                       Authorized commit
                              ↓
                      Emit domain events
                              ↓
                 Recompute affected accounts
                              ↓
               Existing verification and approval gates
                              ↓
                    Publish and audit evidence
```

No source may write directly to `accounts`, `contacts`, `opportunities`, `activities`, recommendations, or scoring configuration.

---

## 2. Repository baseline

This specification extends, but does not replace, the repository operating contract.

### 2.1 Existing invariants that remain unchanged

The implementation must preserve the following rules from `AGENTS.md`, `docs/PRD.md`, and `docs/ARCHITECTURE.md`:

- The LLM never ranks accounts.
- Deterministic scoring decides rank.
- Deterministic software owns the authority envelope, including scope, permissions, resources, budgets, postconditions, protected side effects, verification, publication, and completion.
- Bounded semantic mapping proposals can be model-assisted only when a current task contract and implementation scope permit them; deterministic validation and commit retain authority.
- TypeScript/Zod is the schema source of truth.
- Python consumes generated JSON Schema only.
- Runtime guardrails remain synchronous and deterministic.
- The LLM judge remains asynchronous and outside runtime acceptance authority.
- Human approval remains mandatory before customer-facing sends or CRM write-back.
- No recommendation publishes without verification.
- Unsupported or fabricated claims remain prohibited.
- Every critical action creates audit evidence.
- The executor does not self-certify; the verifier owns completion.
- A failed verification gate stops implementation progress until reported and repaired.

### 2.2 Current product gap

The current `/admin/data` page is a source-health presentation shell. It exposes buttons such as “Test connection,” “Field mappings,” “Rejected records,” and “Reprocess sync,” but it does not yet implement the connected workflows.

The current MCP layer is an in-process MCP-compatible registry. It does not yet provide an authenticated remote transport, durable source connection, source onboarding, event subscription, or ingestion boundary.

The current Zod registry covers the operating CRM and recommendation domain. It does not yet contain contracts for sources, mappings, ingestion batches, staged records, domain events, triggers, quarantine findings, or commit results.

The current RBAC matrix does not yet distinguish data-source administration, imports, trigger management, quarantine review, or source-secret management.

---

## 3. Product goal and outcome

### 3.1 Goal

Enable trustworthy CRM data to enter the product through connected or manual sources without allowing malformed, malicious, cross-workspace, replayed, unsupported, or materially anomalous records to influence account ranking.

### 3.2 Desired user outcome

An administrator can connect or upload a CRM dataset and answer:

- What source produced this data?
- Is the source authenticated?
- What objects and permissions are enabled?
- What fields map to the canonical model?
- Which records are valid, warned, quarantined, or rejected?
- What production data will change?
- Which account ranks may change?
- Who approved the commit?
- Can the change be reversed?
- Which source event or row produced a recommendation?

### 3.3 Product success measures

| Measure | Target | Unit | Direction |
|---|---:|---|---|
| Inbound records with workspace, source, external ID, schema version, and payload hash | 100 | percent | increase |
| Invalid records explicitly quarantined or rejected | 100 | percent | increase |
| Ingestion paths writing directly to operational CRM tables | 0 | paths | decrease |
| Unknown columns silently accepted | 0 | columns | decrease |
| Duplicate processing for the same source event ID | 0 | committed duplicates | decrease |
| Committed imports with change set, audit entry, and rollback reference | 100 | percent | increase |
| Recommendations published from quarantined or unverified data | 0 | recommendations | decrease |
| Webhook acknowledgement after durable receipt | ≤ 2 | seconds p95 | decrease |
| Accepted single-record event available for affected-account processing | ≤ 60 | seconds p95 | decrease |
| CSV batch of 100,000 rows processed or failed with an explicit status | ≤ 15 | minutes p95 | decrease |

The product must not report these measures as achieved until production telemetry measures them.

---

## 4. Scope

### 4.1 In scope for v1

- Workspace boundary and workspace-scoped ingestion.
- Source registry.
- Source onboarding wizard.
- Generic signed webhook/API source.
- Remote MCP read-only source connection.
- Manual UTF-8 CSV import.
- Field mapping and reusable mapping versions.
- Raw input quarantine.
- Deterministic parsing, normalization, and validation.
- Record-level security findings.
- Identity resolution and duplicate detection.
- Dry-run change preview.
- Authorized commit and compensating rollback.
- Durable domain events.
- Closed-set event-trigger builder.
- Debounce, cooldown, idempotency, retry, and dead-letter handling.
- Incremental affected-account prioritization.
- Audit, lineage, metrics, and operational UI.
- Deterministic security and ingestion evals.
- Updated repository documentation and manifest.

### 4.2 Deferred from v1

- Autonomous CRM write-back.
- Autonomous customer communication.
- Arbitrary user-authored JavaScript, SQL, regular expressions, or JSONPath in triggers.
- XLS, XLSX, XLSM, ZIP, PDF, XML, or arbitrary binary upload.
- Bulk deletion through imports.
- Bidirectional CRM sync.
- Side-effecting remote MCP tools.
- Unreviewed automatic field mapping.
- Model-generated security decisions.
- LLM-based ranking, trigger execution, or source validation.
- A marketplace of third-party connectors.
- Guaranteed real-time processing.
- Cross-region replication.

### 4.3 Native connector sequencing

The canonical architecture must support native Salesforce and HubSpot adapters, but v1 implementation order is:

1. Secure CSV import.
2. Generic signed webhook/API.
3. Remote MCP read-only source.
4. First native CRM adapter after the canonical pipeline is verified.

No adapter may introduce a source-specific shortcut around the canonical ingestion pipeline.

---

## 5. Personas and permissions

### 5.1 Personas

**Administrator**
- Connects sources.
- Approves requested scopes.
- Creates mappings and trigger definitions.
- Uploads files.
- Reviews previews.
- Commits or rejects batches.
- Pauses or resumes sources.
- Rotates or revokes source credentials.
- Reviews quarantine findings.
- Replays failed events.
- Initiates rollback.

**Manager**
- Reads source health and team-impact summaries.
- Reads committed imports, trigger executions, and quarantine summaries.
- Cannot connect sources, see credentials, change mappings, commit imports, or edit triggers.

**Representative**
- Does not access the ingestion control plane.
- Continues to see only workspace- and ownership-scoped account recommendations.

**Service actor**
- Processes accepted batches and events.
- Has no browser login.
- Uses narrowly scoped server credentials.
- Cannot bypass hard validation, tenant boundaries, or required audit writes.

### 5.2 Required RBAC capabilities

Add the following capabilities to `packages/security/src/rbac.ts`:

```ts
type IngestionCapability =
  | "view_data_sources"
  | "manage_data_sources"
  | "manage_source_credentials"
  | "view_ingestion_batches"
  | "create_manual_import"
  | "commit_manual_import"
  | "review_quarantine"
  | "approve_ingestion_exception"
  | "view_field_mappings"
  | "manage_field_mappings"
  | "view_event_triggers"
  | "manage_event_triggers"
  | "replay_ingestion_event"
  | "rollback_ingestion_commit";
```

Grant rules:

| Capability group | Rep | Manager | Admin | Service actor |
|---|---:|---:|---:|---:|
| View source health and batch summaries | No | Yes | Yes | No |
| Manage sources, mappings, triggers | No | No | Yes | No |
| Upload and commit CSV | No | No | Yes | No |
| Review quarantine | No | Read summary | Yes | No |
| Read source credentials | No | No | No | No |
| Rotate/revoke credentials | No | No | Yes | No |
| Process accepted batches/events | No | No | No | Yes |
| Write audit evidence | No | No | No | Yes |

Source secrets must never be returned to any browser after creation.

---

## 6. Information architecture and routes

Retain the top-level `Data & Integrations` admin section. Replace the single static page with nested operational routes.

```text
/admin/data
/admin/data/sources
/admin/data/sources/new
/admin/data/sources/[sourceId]
/admin/data/sources/[sourceId]/mappings
/admin/data/sources/[sourceId]/events
/admin/data/imports
/admin/data/imports/new
/admin/data/imports/[batchId]
/admin/data/triggers
/admin/data/triggers/new
/admin/data/triggers/[triggerId]
/admin/data/quarantine
/admin/data/quarantine/[findingId]
/admin/data/runs
/admin/data/runs/[runId]
```

### 6.1 `/admin/data`

Purpose: operating summary.

Required content:

- Sources by state.
- Events received in the selected period.
- Pending batches.
- Quarantined records.
- Dead-letter events.
- Last successful reconciliation.
- Source lag.
- Affected recommendations.
- Open security findings.
- Primary actions:
  - Connect source.
  - Upload CSV.
  - Create trigger.
  - Review quarantine.

The page must clearly distinguish sample data from live telemetry. Sample mode must never display production-like values without a visible “sample” label.

### 6.2 `/admin/data/sources`

Required source-card fields:

- Source name and provider.
- Connection method.
- Workspace.
- Status.
- Authentication status.
- Approved scopes.
- Enabled objects.
- Mapping version.
- Last event.
- Last successful sync.
- Reconciliation cursor.
- Backlog.
- Rejected records.
- Credential expiry or rotation date.
- Source owner.
- Number of dependent recommendations.

Source states:

```text
not_configured
connecting
testing
backfilling
healthy
degraded
failed
paused
revoked
```

Available actions depend on state and capability:

```text
Test connection
View scopes
View mappings
Run reconciliation
View events
Pause source
Resume source
Rotate credentials
Revoke source
```

### 6.3 Source onboarding wizard

The source wizard must preserve its draft between steps and require explicit activation.

#### Step 1: Choose source type

- Salesforce.
- HubSpot.
- Generic webhook/API.
- Remote MCP.
- Manual CSV.

#### Step 2: Authenticate

**OAuth source**
- Display connected organization and authenticated identity.
- Persist only encrypted secret references.
- Never expose access or refresh tokens to client JavaScript.
- Require explicit reconnection after revoked or expired authorization.

**Webhook/API source**
- Generate a source-specific endpoint.
- Generate a signing secret once.
- Show the secret only at creation.
- Require a signed test event before activation.

**Remote MCP source**
- HTTPS endpoint only outside local development.
- Discover protected-resource and authorization metadata.
- Complete OAuth authorization.
- Pin the negotiated protocol version.
- Discover tools and resources.
- Require an explicit allowlist before activation.

#### Step 3: Review permissions

Display:

- Requested scope.
- Business reason.
- Data objects exposed.
- Read versus write.
- Retention effect.
- Whether customer-facing action is possible.

V1 source connections are read-only. Any requested write scope is rejected.

#### Step 4: Select source objects

Initial canonical source objects:

```text
account
contact
opportunity
activity
intent_signal
account_health
contract
```

#### Step 5: Map fields

Every source field must be:

```text
mapped
explicitly_ignored
quarantined
```

No field may be silently accepted.

The interface must show:

- Source field.
- Canonical field.
- Source type.
- Canonical type.
- Sample value.
- Transformation.
- Required status.
- Mapping warning.
- Mapping confidence as advisory only.
- Final administrator decision.

A later explicitly admitted model-assisted mapping flow may propose a mapping or advisory confidence. Deterministic schema validation and the authorized mapping decision remain authoritative.

#### Step 6: Preview records

Show a redacted sample after normalization.

The preview must not call the ranking runtime and must not write operational records.

#### Step 7: Validate and dry run

Show:

- Valid rows.
- Warnings.
- Quarantined rows.
- Rejected rows.
- Duplicates.
- Unknown owners.
- Unknown external account references.
- Schema drift.
- Material anomalies.
- Expected operational changes.
- Expected account-rank impact.

#### Step 8: Activate

Administrator selects:

- Backfill window.
- Event mode.
- Reconciliation schedule.
- Alert recipients.
- Raw-input retention policy.
- Whether trigger processing begins immediately after backfill.

Activation requires an audit event.

---

## 7. Manual CSV import UX

### 7.1 Supported format

V1 supports:

- UTF-8 CSV only.
- One canonical object type per file, or the versioned combined template.
- Maximum file size: 10 MB by default.
- Maximum rows: 100,000 by default.
- Maximum columns: 200 by default.
- Maximum decoded cell length: 32,768 characters by default.
- Maximum processing duration: 15 minutes by default.

All limits are server-configured and displayed before upload.

CSV has no authoritative magic signature. Therefore, validation must rely on the complete control set rather than a single signature check:

- `.csv` extension allowlist.
- Advisory MIME validation.
- UTF-8 decoding.
- No NUL bytes.
- Restricted control characters.
- Bounded row, column, and cell counts.
- Consistent delimiter structure.
- Streaming parser.
- No formula execution.
- No archive or decompression path.

### 7.2 Import workflow

#### Step 1: Choose import type

```text
Accounts
Contacts
Opportunities
Activities
Intent signals
Account health
Combined CRM template
```

#### Step 2: Download template

The template contains:

- Canonical column names.
- Required columns.
- Valid enums.
- Date formats.
- Currency rules.
- Maximum lengths.
- External ID requirements.
- Example rows.
- Version identifier.

#### Step 3: Create upload intent

The browser requests an upload intent.

The server:

1. Checks workspace membership and capability.
2. Creates an `ingestion_batch` in `awaiting_upload`.
3. Generates a private server-controlled object path.
4. Returns a short-lived signed upload URL.
5. Writes an audit event.

The client uploads directly to a private quarantine bucket. The raw filename is recorded only as metadata; the storage filename is server-generated.

#### Step 4: Finalize upload

The browser calls finalize with the batch ID.

The server verifies:

- Object belongs to the batch and workspace.
- Object path was server-generated.
- Object size is within limits.
- Upload is not already finalized.
- Request is idempotent.

The batch moves to `security_scanning`.

#### Step 5: Security scan

Visible checks:

```text
Authorization passed
Workspace binding passed
Object ownership passed
Size limits passed
Text-format checks passed
Malware scan passed
Parser-safety checks passed
```

Production behavior is fail-closed. If no approved scanning provider is configured, the production batch cannot move to parsing.

#### Step 6: Parse and map

The worker:

- Streams the file.
- Rejects malformed CSV.
- Does not evaluate formulas.
- Applies a versioned mapping.
- Creates a staged record per row.
- Captures the source row number.
- Computes a stable row hash.
- Never writes operational CRM tables.

#### Step 7: Validate

Each row receives one final disposition:

```text
ready
warning
quarantined
rejected
duplicate
```

`warning` rows can commit unless a selected policy elevates the warning. `quarantined` and `rejected` rows cannot commit.

#### Step 8: Review deterministic change set

Required change summary:

- New records.
- Updated records.
- Unchanged records.
- Ownership changes.
- Referential failures.
- Duplicate records.
- Pipeline amount increase.
- Pipeline amount decrease.
- Accounts entering the top-N preview.
- Accounts leaving the top-N preview.
- New guardrail holds predicted.
- Source and territory concentration changes.

Rank impact preview must use the deterministic scorer against a temporary snapshot. It must not publish recommendations.

#### Step 9: Commit

Commit requires:

- Batch name.
- Business reason.
- Mapping version.
- Explicit administrator confirmation.
- Optional second approval when a configurable risk threshold is crossed.

Hard second-approval defaults:

- More than 10,000 operational records changed.
- More than 10 percent of workspace accounts changed.
- More than 5 percent of account owners changed.
- More than $10,000,000 absolute pipeline delta.
- Any cross-workspace reference attempt.
- Any hard security finding: commit remains prohibited rather than approvable.

#### Step 10: Results

The completion page shows:

```text
File
→ Ingestion batch
→ Staged records
→ Commit
→ Domain events
→ Prioritization runs
→ Recommendations
→ Audit evidence
```

### 7.3 Import rollback

Imports do not support delete in v1.

A commit stores before-and-after snapshots for every changed field. Rollback:

- Requires admin capability and business reason.
- Creates a compensating commit.
- Never deletes or rewrites the original audit evidence.
- Emits compensating domain events.
- Re-runs affected accounts.
- Is unavailable after the configured rollback window unless an incident approver authorizes it.
- Must detect and report conflicts when records changed after the original commit.

---

## 8. Canonical ingestion domain

### 8.1 Ingestion state machine

```text
draft
→ awaiting_upload | awaiting_auth
→ received
→ security_scanning
→ parsing
→ mapping
→ validating
→ ready_for_review
→ awaiting_approval
→ committing
→ committed
→ processing_events
→ completed
```

Terminal or exceptional states:

```text
rejected
quarantined
failed
cancelled
rolled_back
partially_rolled_back
```

Invalid state transitions fail closed and create audit evidence.

### 8.2 Required Zod schemas

Create `packages/shared-schemas/src/ingestion.ts` and register every public contract in `SCHEMA_REGISTRY`.

Required schemas:

```text
WorkspaceSchema
WorkspaceMembershipSchema
DataSourceSchema
DataSourceScopeSchema
SourceCredentialReferenceSchema
SourceFieldMappingSchema
SourceMappingVersionSchema
IngestionBatchSchema
IngestionFileSchema
StagedRecordSchema
IngestionFindingSchema
ChangeSetSchema
ChangeSetItemSchema
ImportApprovalSchema
ImportCommitSchema
ImportRollbackSchema
ExternalRecordLinkSchema
DomainEventSchema
TriggerDefinitionSchema
TriggerConditionSchema
TriggerActionSchema
TriggerExecutionSchema
DeadLetterEventSchema
WebhookEnvelopeSchema
McpSourceConfigSchema
```

All object schemas must use strict unknown-key rejection unless a raw payload wrapper explicitly captures unknown source data in quarantine storage.

### 8.3 Canonical inbound envelope

```ts
export const InboundRecordEnvelopeSchema = z.object({
  workspaceId: z.string().uuid(),
  sourceId: z.string().uuid(),
  batchId: z.string().uuid(),
  objectType: z.enum([
    "account",
    "contact",
    "opportunity",
    "activity",
    "intent_signal",
    "account_health",
    "contract",
  ]),
  externalId: z.string().min(1).max(255),
  externalParentId: z.string().min(1).max(255).optional(),
  schemaVersion: z.string().min(1).max(50),
  occurredAt: z.string().datetime().optional(),
  receivedAt: z.string().datetime(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRowNumber: z.number().int().positive().optional(),
  normalizedPayload: z.record(z.unknown()),
  provenance: z.object({
    sourceType: z.enum(["csv", "webhook", "native_crm", "mcp"]),
    sourceRecordUrl: z.string().url().optional(),
    syncCursor: z.string().max(1000).optional(),
    externalEventId: z.string().max(255).optional(),
  }).strict(),
}).strict();
```

The raw payload is stored outside the canonical operational object and is never sent to a scorer. Model use is permitted only under the active authority and implementation-scope contract.

### 8.4 Trust classification

Every staged field receives one trust classification:

```text
verified_structured
unverified_structured
untrusted_text
derived_deterministic
blocked
```

Rules:

- The scorer may consume only `verified_structured` and approved `derived_deterministic` fields.
- Free-form notes, email bodies, activity bodies, and imported descriptions default to `untrusted_text`.
- `untrusted_text` never becomes a source signal merely because it exists in an authenticated CRM.
- Prompt-like instructions inside CRM fields are treated as data, never as commands.
- Model-visible source data must be explicitly permitted, minimized, redacted where required, and bounded by the active task contract.

---

## 9. Source adapter contract

Create an adapter boundary independent of the runtime repository.

```ts
export interface SourceAdapter {
  readonly kind: "csv" | "webhook" | "native_crm" | "mcp";

  testConnection(ctx: SourceContext): Promise<ConnectionTestResult>;
  discoverSchema(ctx: SourceContext): Promise<DiscoveredSourceSchema>;
  readSample(ctx: SourceContext, request: SampleRequest): Promise<RawSourceRecord[]>;
  readChanges(
    ctx: SourceContext,
    cursor: SourceCursor | null,
    limit: number,
  ): Promise<SourceChangePage>;
  reconcile(
    ctx: SourceContext,
    request: ReconciliationRequest,
  ): Promise<ReconciliationResult>;
}
```

Constraints:

- Adapters return raw source records only.
- Adapters cannot rank, publish, write recommendations, or mutate CRM records.
- Adapters do not write operational product tables.
- All adapter output passes through the canonical ingestion service.
- Each call has a timeout, maximum response size, retry budget, and audit correlation ID.
- Redirects are disabled by default and only allowed to pre-approved hosts.
- Source URLs are server validated to prevent SSRF.
- Secrets are referenced by ID, never included in adapter output.

---

## 10. Webhook and API ingestion

### 10.1 Endpoint

```http
POST /api/v1/events/crm/{sourceId}
Authorization: Bearer <scoped-token>
Idempotency-Key: <unique-event-id>
X-Event-Timestamp: <ISO-8601>
X-Event-Signature: sha256=<hex>
Content-Type: application/json
```

### 10.2 Event envelope

```json
{
  "eventId": "evt_01928",
  "workspaceId": "00000000-0000-0000-0000-000000000001",
  "sourceId": "00000000-0000-0000-0000-000000000002",
  "eventType": "opportunity.stage_changed",
  "occurredAt": "2026-07-31T20:42:05Z",
  "schemaVersion": "1.0",
  "record": {
    "objectType": "opportunity",
    "externalId": "006xx000001ABC",
    "accountExternalId": "001xx000001XYZ",
    "changedFields": {
      "stage": {
        "previous": "discovery",
        "current": "negotiation"
      }
    }
  }
}
```

### 10.3 Verification order

1. Resolve the source from the path.
2. Verify source is active and belongs to the workspace in the envelope.
3. Enforce request byte limit before parsing.
4. Verify timestamp tolerance.
5. Verify HMAC over the unmodified request bytes using constant-time comparison.
6. Verify bearer credential scope.
7. Verify idempotency key and external event ID.
8. Parse strict schema.
9. Store durable receipt.
10. Return `202 Accepted`.
11. Process asynchronously.

An invalid signature, workspace mismatch, stale timestamp, revoked source, reused event ID with a different hash, or malformed schema is rejected before any domain mutation.

### 10.4 Idempotency

Unique constraint:

```text
(workspace_id, source_id, external_event_id)
```

Behavior:

- Same ID and same hash: return the original receipt status.
- Same ID and different hash: reject as a replay/collision security finding.
- Processing retry: reuse the same durable event record.
- Domain event commit: exactly one logical commit despite at-least-once delivery.

### 10.5 Reliability

Use:

- Signed push events for low latency.
- Configurable delta pull, default every 15 minutes.
- Configurable full reconciliation, default nightly.
- Durable retry with bounded exponential backoff.
- Dead-letter after the configured attempt limit.
- Manual replay from the admin UI.
- Cursor and reconciliation audit history.

---

## 11. Remote MCP source

### 11.1 Purpose

Remote MCP is a read-only source integration boundary. It does not replace the product’s event store, trigger engine, schema validation, or audit system.

### 11.2 Connection requirements

- HTTPS outside local development.
- OAuth-based protected resource authorization.
- Protected-resource metadata discovery.
- Authorization-server discovery.
- Resource-specific access tokens.
- Protocol-version pinning.
- Source endpoint allowlist or administrator-approved hostname.
- DNS and IP validation to block local, link-local, metadata, and private-network SSRF targets unless explicitly configured for a private deployment.
- Connection and read timeouts.
- Maximum tool output bytes.
- Explicit administrator approval of discovered tools and resources.

### 11.3 V1 MCP policy

V1 permits read-only MCP operations.

Proposed tool policy:

```ts
export const ToolPolicySchema = z.object({
  toolName: z.string().min(1),
  risk: z.literal("read_only"),
  allowedRoles: z.array(z.enum(["admin", "service"])).min(1),
  workspaceScoped: z.literal(true),
  timeoutMs: z.number().int().min(100).max(60_000),
  maxInputBytes: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(),
  auditable: z.literal(true),
  enabled: z.boolean(),
}).strict();
```

Discovered tools are disabled until explicitly approved.

### 11.4 MCP result handling

Every result must:

1. Pass the declared output schema.
2. Stay within output limits.
3. Be bound to the active workspace and source.
4. Be stored as raw quarantined source data.
5. Pass mapping and canonical validation.
6. Pass identity, duplicate, and anomaly checks.
7. Create staged records.
8. Commit only through the same review or trusted automated-commit policy used by other sources.
9. Emit domain events only after commit.

Remote data is never trusted merely because the MCP server is authenticated.

---

## 12. Event triggers

### 12.1 Trigger builder

The UI exposes a closed, typed builder:

```text
WHEN
[Opportunity] [stage changes] [to Negotiation]

AND
[Amount] [is at least] [$50,000]

FOR
[Enterprise accounts]

THEN
[Recompute affected account]

IF RESULT CHANGES
[Top-25 membership or rank by at least 5 positions]

NOTIFY
[Account owner]

DEBOUNCE
[5 minutes]

COOLDOWN
[10 minutes per account]
```

Administrators cannot enter arbitrary executable code.

### 12.2 Supported trigger events

```text
account.created
account.updated
account.owner_changed
contact.created
contact.updated
contact.opted_out
opportunity.created
opportunity.updated
opportunity.stage_changed
opportunity.amount_changed
opportunity.stalled
activity.created
intent.detected
account_health.updated
account_health.threshold_crossed
renewal.window_entered
sync.completed
manual_import.committed
manual_import.rolled_back
```

### 12.3 Supported condition operators

```text
equals
not_equals
in
not_in
greater_than
greater_than_or_equal
less_than
less_than_or_equal
changed
changed_from
changed_to
exists
not_exists
within_days
```

Only schema-declared fields may be selected.

### 12.4 Supported trigger actions

V1 actions:

```text
recompute_affected_account
recompute_owner_book
create_manager_attention_item
hold_recommendation
notify_admin
notify_manager
notify_account_owner
start_delta_reconciliation
```

Prohibited v1 actions:

```text
send_customer_message
write_to_crm
change_scoring_policy
approve_recommendation
delete_record
invoke_arbitrary_tool
execute_code
```

### 12.5 Trigger execution semantics

- Trigger definitions are versioned.
- Publishing a trigger requires admin capability and reason.
- Every execution references the trigger version.
- Debounce aggregates rapid events for the same account.
- Cooldown prevents repeated notifications or recomputation.
- Maximum executions per source and workspace are enforced.
- Failed actions retry within budget.
- Exhausted failures go to dead letter.
- Replays preserve the original event and create a new execution record.
- A trigger cannot mutate its own definition.

### 12.6 Incremental prioritization

Add a runtime method:

```ts
runPrioritizationForAffectedAccounts(
  workspaceId: string,
  accountIds: string[],
  opts: RunOptions,
): Promise<PrioritizationRun>;
```

Requirements:

- Deduplicate account IDs.
- Enforce workspace scope.
- Load only committed, non-quarantined canonical records.
- Use the existing deterministic scoring path.
- Preserve stable tie-breaking.
- Recompute the owner’s relative ranking when an affected account’s rank changes.
- Preserve all existing verification, approval, audit, and publication gates.
- Never auto-approve customer-facing action.

---

## 13. Quarantine and findings

### 13.1 Finding classes

```text
file_security
authentication
authorization
workspace_boundary
schema
mapping
identity
referential_integrity
duplicate
replay
resource_limit
data_anomaly
untrusted_text
prompt_injection_pattern
credential
malware
system_error
```

### 13.2 Severity

```text
info
warning
high
critical
```

### 13.3 Disposition

```text
open
corrected
ignored_with_reason
rejected_record
rejected_batch
hard_block
```

### 13.4 Hard blocks

The following cannot be overridden:

- Forged or invalid source signature.
- Cross-workspace record reference.
- Malware detection.
- Executable or archive content in a CSV-only flow.
- Revoked source credential.
- Payload exceeding hard resource limits.
- Event ID reuse with a different payload hash.
- Attempt to map into a protected field.
- Attempt to change scoring configuration through source data.
- Attempt to approve or send customer action through source data.

### 13.5 Review UI

Each finding shows:

- Severity.
- Finding class.
- Source and batch.
- Row or event ID.
- Canonical field.
- Redacted value.
- Rule ID.
- Explanation.
- Downstream impact.
- Allowed actions.
- Reviewer.
- Resolution reason.
- Audit reference.

Allowed actions:

```text
Fix mapping
Correct staged value
Reject row
Reject batch
Approve documented warning
Download rejected rows
Open incident
```

Corrected staged values preserve original value hashes and full audit lineage.

---

## 14. Data validation and poisoning controls

Schema-valid data can still be malicious or wrong. Validation occurs at five layers.

### 14.1 Layer 1: Transport and file controls

- Authorization.
- Workspace binding.
- Size and rate limits.
- HMAC or OAuth verification.
- UTF-8 and parser checks.
- Malware scan.
- Private storage.
- Generated object names.
- No archive expansion.

### 14.2 Layer 2: Schema controls

- Strict Zod parsing.
- Unknown-key rejection.
- Enum validation.
- Length limits.
- Number ranges.
- Date parsing.
- Array limits.
- Required fields.
- JSON depth limit.

### 14.3 Layer 3: Referential controls

- Source external ID uniqueness.
- Parent account existence.
- Owner membership in the same workspace.
- Contact and opportunity linkage.
- Mapping version existence.
- Canonical object and field allowlist.

### 14.4 Layer 4: Historical anomaly controls

Deterministic configurable rules:

- Absolute and percentage pipeline deltas.
- Account count spikes.
- Owner reassignment spikes.
- Sudden health-score shifts.
- Future or implausibly old dates.
- Duplicate intent events.
- Excessive text growth.
- Currency or unit mismatch.
- Record-volume divergence from prior runs.

An anomaly creates a warning or quarantine finding according to policy. It never silently changes scoring.

### 14.5 Layer 5: Trust controls

- Only verified structured fields reach scoring.
- Untrusted free text is excluded from source-signal generation.
- Source data cannot encode system instructions.
- Source data cannot select tools or expand a model tool grant.
- Source data cannot alter policy, scope, permissions, budgets, approvals, publication, or environment state.
- Derived signals are generated only by deterministic code with versioned rules.

---

## 15. Database design

### 15.1 Phase 0: workspace boundary

Add:

```text
workspaces
workspace_memberships
```

Add `workspace_id` to every tenant-scoped table, including:

```text
accounts
contacts
opportunities
activities
recommendations
audit_evidence
eval_results
observability_events
```

Migration behavior:

- Create one default workspace for existing demo data.
- Backfill existing rows.
- Add `NOT NULL` only after backfill.
- Replace global manager/admin scope with membership in the active workspace.
- Keep `profiles` for user identity; use `workspace_memberships.role` as the authoritative tenant-scoped role.
- Add compound foreign keys or explicit checks where necessary to prevent cross-workspace parent references.

Multi-customer production deployment is blocked until workspace-scoped RLS passes security evals.

### 15.2 New ingestion tables

```text
data_sources
source_credentials
source_scopes
source_field_mappings
source_mapping_versions
source_sync_cursors

ingestion_batches
ingestion_files
staged_records
ingestion_findings
change_sets
change_set_items
import_approvals
import_commits
import_commit_items
import_rollbacks

external_record_links
domain_events
trigger_definitions
trigger_versions
trigger_executions
dead_letter_events
```

### 15.3 Required invariants

- Every row is workspace-scoped.
- Raw payloads are not stored in operational CRM tables.
- Credential values are not stored in browser-readable tables.
- `external_record_links` has a unique source/external-ID key.
- `domain_events` has a unique source/external-event-ID key when supplied.
- `import_commits` and `audit_evidence` are append-only.
- Trigger versions are immutable after publication.
- Operational records include the last accepted provenance reference.
- A staged record references its batch, mapping version, row or event, payload hash, and disposition.
- An operational mutation and its domain-event creation occur in one transaction.

### 15.4 Migration plan

Proposed migrations:

```text
0007_workspaces_and_memberships.sql
0008_workspace_backfill_and_rls.sql
0009_data_sources_and_mappings.sql
0010_ingestion_batches_and_quarantine.sql
0011_import_commits_and_external_links.sql
0012_domain_events_and_triggers.sql
0013_ingestion_rls_and_append_only_guards.sql
0014_ingestion_storage_policies.sql
```

Use repository numbering based on the highest migration present at implementation time. Claude Code must inspect the actual migration directory before naming files.

---

## 16. Storage and secrets

### 16.1 Storage buckets

Private buckets:

```text
ingestion-quarantine
ingestion-rejected
ingestion-reports
```

Rules:

- No public access.
- Signed upload and download URLs expire quickly.
- Storage paths are server-generated and workspace-prefixed.
- Browser cannot list a workspace bucket.
- Raw files remain quarantined until scan completion.
- Raw retention defaults to 7 days.
- Rejected-row report retention defaults to 30 days.
- Retention is configurable and audited.

### 16.2 Credentials

Store only:

- Secret-provider reference.
- Source.
- Workspace.
- Credential type.
- Creation time.
- Rotation time.
- Expiry.
- Revocation status.
- Non-secret fingerprint.

Production secret values live in an approved secret manager or encrypted server-side store. They are never logged, returned, placed in audit payloads, or exposed through RLS.

---

## 17. API surface

### 17.1 Admin source API

```text
GET    /api/admin/data/sources
POST   /api/admin/data/sources
GET    /api/admin/data/sources/{sourceId}
PATCH  /api/admin/data/sources/{sourceId}
POST   /api/admin/data/sources/{sourceId}/test
POST   /api/admin/data/sources/{sourceId}/pause
POST   /api/admin/data/sources/{sourceId}/resume
POST   /api/admin/data/sources/{sourceId}/reconcile
POST   /api/admin/data/sources/{sourceId}/rotate
POST   /api/admin/data/sources/{sourceId}/revoke
```

### 17.2 Mapping API

```text
GET    /api/admin/data/sources/{sourceId}/mappings
POST   /api/admin/data/sources/{sourceId}/mappings
POST   /api/admin/data/mappings/{mappingId}/validate
POST   /api/admin/data/mappings/{mappingId}/publish
```

### 17.3 Import API

```text
POST   /api/admin/data/imports/upload-intent
POST   /api/admin/data/imports/{batchId}/finalize
GET    /api/admin/data/imports/{batchId}
POST   /api/admin/data/imports/{batchId}/map
POST   /api/admin/data/imports/{batchId}/validate
POST   /api/admin/data/imports/{batchId}/preview
POST   /api/admin/data/imports/{batchId}/approve
POST   /api/admin/data/imports/{batchId}/commit
POST   /api/admin/data/imports/{batchId}/rollback
GET    /api/admin/data/imports/{batchId}/rejected-report
```

### 17.4 Trigger API

```text
GET    /api/admin/data/triggers
POST   /api/admin/data/triggers
GET    /api/admin/data/triggers/{triggerId}
POST   /api/admin/data/triggers/{triggerId}/simulate
POST   /api/admin/data/triggers/{triggerId}/publish
POST   /api/admin/data/triggers/{triggerId}/pause
POST   /api/admin/data/triggers/{triggerId}/resume
GET    /api/admin/data/triggers/{triggerId}/executions
```

### 17.5 Event operations

```text
POST   /api/v1/events/crm/{sourceId}
GET    /api/admin/data/events/{eventId}
POST   /api/admin/data/events/{eventId}/replay
GET    /api/admin/data/dead-letter
POST   /api/admin/data/dead-letter/{eventId}/replay
```

Every state-changing endpoint requires:

- Authenticated actor.
- Workspace scope.
- Capability check.
- CSRF protection where browser initiated.
- Idempotency key.
- Strict request schema.
- Audit correlation ID.
- Audit entry.
- Stable error codes.

---

## 18. Worker and processing architecture

Create a TypeScript ingestion worker workspace:

```text
apps/ingestion-worker
```

Responsibilities:

- Claim pending batches and events.
- Run security scanning adapter.
- Parse CSV streams.
- Normalize and validate records.
- Generate findings.
- Create deterministic change sets.
- Commit approved changes transactionally.
- Emit domain events.
- Evaluate triggers.
- Start affected-account prioritization.
- Retry transient failures.
- Move exhausted failures to dead letter.
- Emit PII-safe metrics.

The web application must not perform long-running parsing or batch commits in the request lifecycle.

A database-backed queue is acceptable for v1 if it provides:

- Transactional claims.
- `FOR UPDATE SKIP LOCKED` or equivalent.
- Lease expiry.
- Attempt count.
- Scheduled retry time.
- Dead-letter transition.
- Idempotent handlers.

---

## 19. Audit and lineage

### 19.1 Audited actions

At minimum:

```text
source.created
source.tested
source.activated
source.paused
source.resumed
source.credentials_rotated
source.revoked
mapping.created
mapping.validated
mapping.published
import.upload_intent_created
import.file_received
import.scan_completed
import.validation_completed
import.approved
import.committed
import.rollback_requested
import.rolled_back
finding.created
finding.resolved
trigger.created
trigger.simulated
trigger.published
trigger.paused
trigger.resumed
event.received
event.rejected
event.processed
event.dead_lettered
event.replayed
prioritization.affected_accounts_started
```

### 19.2 Lineage chain

The UI must resolve:

```text
Recommendation
→ Prioritization run
→ Domain event
→ Import commit or source sync
→ Staged record
→ Source record or CSV row
→ Ingestion batch
→ Source
```

No lineage hop may be invented in the web layer. Provenance must travel in schemas and durable records.

### 19.3 PII-safe logs

Logs and metrics may include:

- Workspace surrogate ID.
- Source ID.
- Batch ID.
- Event ID.
- Rule ID.
- Counts.
- Durations.
- Status.
- Payload hash.

Logs must not include:

- Credentials.
- Raw file content.
- Email bodies.
- Contact names or emails.
- Free-form CRM notes.
- Unredacted source payloads.

---

## 20. Error model

Use stable machine-readable error codes.

Examples:

```text
INGEST_AUTH_REQUIRED
INGEST_CAPABILITY_DENIED
INGEST_WORKSPACE_MISMATCH
INGEST_SOURCE_REVOKED
INGEST_SIGNATURE_INVALID
INGEST_TIMESTAMP_OUT_OF_RANGE
INGEST_IDEMPOTENCY_COLLISION
INGEST_FILE_TYPE_REJECTED
INGEST_FILE_TOO_LARGE
INGEST_MALWARE_DETECTED
INGEST_CSV_MALFORMED
INGEST_ROW_LIMIT_EXCEEDED
INGEST_SCHEMA_INVALID
INGEST_MAPPING_INCOMPLETE
INGEST_EXTERNAL_ID_DUPLICATE
INGEST_PARENT_NOT_FOUND
INGEST_OWNER_NOT_IN_WORKSPACE
INGEST_ANOMALY_QUARANTINED
INGEST_HARD_BLOCK
INGEST_COMMIT_CONFLICT
INGEST_ROLLBACK_CONFLICT
INGEST_MCP_TOOL_NOT_APPROVED
INGEST_MCP_OUTPUT_LIMIT
INGEST_MCP_SCHEMA_INVALID
INGEST_EVENT_DEAD_LETTERED
```

User-facing errors explain:

- What failed.
- Whether anything was written.
- Which rows or events were affected.
- Whether the administrator can correct and retry.
- The audit or support reference.

Never expose stack traces or secrets.

---

## 21. Security requirements

### 21.1 File upload

- Allowlist CSV only.
- Validate authorization before issuing upload intent.
- Use private storage and server-generated object names.
- Enforce byte, row, column, cell, time, and concurrency limits.
- Treat MIME as advisory, not authoritative.
- Reject NUL bytes and invalid UTF-8.
- Use a streaming parser.
- Do not expand archives.
- Scan before parsing.
- Fail closed in production when the scanner is unavailable.
- Never serve raw uploads from a public application path.
- Quarantine all raw input.
- Preserve file hash and scan result.
- Apply formula-injection detection to string cells and preserve export neutralization.

### 21.2 API and webhook

- TLS.
- OAuth or scoped bearer credential.
- HMAC signature over raw bytes.
- Constant-time comparison.
- Timestamp tolerance.
- Idempotency.
- Replay detection.
- Payload size limit.
- Request rate limit.
- Per-source execution quota.
- Strict schema.
- Timeouts.
- Bounded retries.
- No blind redirects.
- SSRF-resistant source configuration.
- Dead-letter queue.
- Secret rotation and revocation.

### 21.3 MCP

- OAuth authorization and resource metadata discovery.
- HTTPS.
- Protocol-version pinning.
- Endpoint and network validation.
- Explicit tool/resource allowlist.
- Read-only tools in v1.
- Input and output schemas.
- Output size and timeout limits.
- Workspace binding.
- No automatic approval of newly discovered tools.
- No direct database or runtime authority.
- Full audit trail.

### 21.4 Multi-tenancy

- Workspace ID on every tenant-scoped row.
- Workspace membership checked in process and database.
- RLS for every new table.
- Parent-child workspace consistency.
- No global manager access across unrelated workspaces.
- Service-role functions require explicit workspace arguments and verify them.
- Security evals attempt cross-workspace reads, writes, event injection, mapping access, file access, and replay.

### 21.5 Data poisoning and prompt injection

- Authenticated source data remains untrusted.
- Strict ranges alone are insufficient; historical anomaly rules are required.
- Raw free text never reaches deterministic scoring.
- Source content cannot change instructions, tool/resource grants, policy, scope, permissions, budgets, approvals, publication, or side-effect authority.
- Suspicious prompt-like text is classified and excluded, not obeyed.
- No LLM security decision may override deterministic hard blocks.

---

## 22. Testing and evals

### 22.1 Unit tests

Required test groups:

```text
shared-schemas ingestion contracts
RBAC ingestion capabilities
workspace scoping helpers
CSV parser limits
mapping transformations
record normalization
payload hashing
idempotency
HMAC verification
timestamp tolerance
duplicate detection
external ID resolution
anomaly rules
state transitions
trigger condition evaluation
trigger debounce and cooldown
MCP tool policy
rollback conflict detection
```

### 22.2 Integration tests

- Upload intent through committed batch.
- Malicious or malformed upload through quarantine.
- Signed webhook through affected-account run.
- Duplicate webhook delivery.
- Event collision with different hash.
- Dead-letter and replay.
- Mapping version publish and use.
- Source pause and resume.
- Remote MCP mocked discovery, read, validation, and rejection.
- Commit transaction creates operational updates and domain events atomically.
- Rollback creates compensating events.
- Workspace RLS across all new tables and storage objects.

### 22.3 Adversarial fixtures

At minimum:

```text
.csv.exe filename
spoofed MIME
NUL-byte payload
invalid UTF-8
oversized file
oversized row
too many columns
deep JSON
CSV formula payload
malformed quotes
duplicate external IDs
cross-workspace parent ID
unknown owner
negative money
NaN or infinity
extreme pipeline spike
future event timestamp
stale signed event
invalid HMAC
replayed event
same event ID with altered body
SSRF endpoint to localhost
SSRF endpoint to metadata IP
MCP tool added after approval
MCP oversized output
MCP invalid output schema
CRM note containing system instructions
source payload requesting policy change
source payload requesting customer send
```

### 22.4 Golden evals

Add deterministic golden cases proving:

- Same committed input produces byte-identical normalized records and equivalent domain events.
- Same affected-account event produces the same ranking result.
- Quarantined input produces no operational mutation and no published recommendation.
- An import commit and its rollback produce the expected reversible operational state while preserving immutable audit history.
- Replayed events do not duplicate changes.
- Cross-workspace input is always denied.

### 22.5 Commands

Add Turborepo commands:

```bash
pnpm test:ingestion
pnpm test:ingestion-security
pnpm verify:ingestion
```

`pnpm verify:production` must include the ingestion verification suite.

The existing gates remain mandatory:

```bash
pnpm install
pnpm generate:schemas
pnpm build
pnpm typecheck
pnpm test:evals
```

---

## 23. UX acceptance criteria

### 23.1 Source onboarding

- Admin can complete a source wizard without leaving the admin control plane.
- Requested permissions are visible before authorization.
- Read-only status is explicit.
- Test connection returns a durable result.
- Activation is impossible before auth, mapping, sample validation, and audit completion.
- Revoked sources cannot receive or process new data.

### 23.2 Manual import

- Upload constraints are visible before file selection.
- Progress survives page refresh.
- No operational records change before commit.
- Counts for ready, warning, quarantined, rejected, and duplicate rows reconcile to total parsed rows.
- Admin can inspect and download rejected rows.
- Change preview shows both data and ranking impact.
- Commit requires explicit confirmation and reason.
- Completion shows full lineage.
- Rollback availability and conflict status are visible.

### 23.3 Event triggers

- Trigger builder exposes only approved fields, operators, and actions.
- Simulation shows which historical events would have matched.
- Published version is immutable.
- Pausing a trigger does not delete it.
- Execution detail shows event, matched conditions, action, result, retry state, and audit reference.
- Cooldown and debounce behavior are visible.

### 23.4 Quarantine

- Critical findings are visually distinct.
- Hard blocks do not expose an override action.
- Correctable findings explain the required resolution.
- Every resolution requires reason and audit evidence.
- Corrected values retain original lineage.

### 23.5 Accessibility

- Keyboard-complete wizard and tables.
- Visible focus states.
- Semantic labels and descriptions.
- Status not communicated by color alone.
- Progress announcements through appropriate ARIA live regions.
- Confirmation dialogs identify the scope and consequence of the action.
- Tables support readable mobile overflow without hiding critical status.

---

## 24. File-level implementation map

Claude Code must inspect the repository before creating files, but the intended shape is:

```text
packages/shared-schemas/src/
  ingestion.ts
  source.ts
  trigger.ts
  workspace.ts
  index.ts

packages/security/src/
  rbac.ts
  ingestion.ts
  webhook.ts
  mcp-policy.ts
  index.ts

apps/agent-runtime/src/
  ingestion/
    ingestion.service.ts
    ingestion.state.ts
    normalization.ts
    validation.ts
    anomaly-rules.ts
    change-set.ts
    commit.ts
    rollback.ts
  events/
    domain-event.service.ts
    event-processor.ts
    trigger-evaluator.ts
    dead-letter.ts
  shared-tools/mcp/
    registry.ts
    client.ts
    remote-client.ts
    authorization.ts
    network-policy.ts
  agents/orchestrator/
    affected-account-runner.ts

apps/ingestion-worker/
  package.json
  src/index.ts
  src/batch-worker.ts
  src/event-worker.ts
  src/scanning/
  src/parsing/
  src/queue/

apps/web/app/admin/data/
  layout.tsx
  page.tsx
  sources/
  imports/
  triggers/
  quarantine/
  runs/

apps/web/app/api/
  admin/data/
  v1/events/crm/[sourceId]/

supabase/migrations/
  workspace migrations
  source and mapping migrations
  ingestion and quarantine migrations
  domain event and trigger migrations
  RLS and storage migrations

packages/testing-evals/src/
  ingestion/
  ingestion-security/
  fixtures/
```

Update:

```text
AGENTS.md
docs/PRD.md
docs/ARCHITECTURE.md
README.md
prd_manifest.yaml
infra/compose.yaml
package.json
turbo.json
scripts/verify-production.sh
```

---

## 25. Delivery plan

This delivery plan is historical. It is not the current production-spine sequence unless a later explicit ruling reactivates the relevant epic.

### Epic 0: Contract and workspace boundary

Deliver:

- New specification committed to `docs/`.
- Workspace schemas and migrations.
- Membership-scoped RBAC and RLS.
- Backfill for existing demo data.
- Cross-workspace security evals.

Exit gate:

- All existing tests pass.
- New workspace RLS tests pass.
- Existing rep, manager, and admin experiences remain functional.
- No unrelated customer can be accessed by manager/admin role.

### Epic 1: Canonical ingestion schemas and persistence

Deliver:

- Zod ingestion contracts.
- Generated JSON Schema.
- Source, mapping, batch, staging, finding, change-set, commit, event, trigger, and dead-letter tables.
- RLS and append-only guards.
- Repository/service interfaces.

Exit gate:

- Schema generation passes.
- State transition tests pass.
- No operational CRM table can be reached from a source adapter directly.

### Epic 2: Secure CSV pipeline

Deliver:

- Upload intent.
- Private quarantine storage.
- Scanner interface.
- Streaming CSV parser.
- Mapping.
- Validation and findings.
- Change preview.
- Authorized commit.
- Rollback.
- Import UI.

Exit gate:

- Adversarial upload suite passes.
- 100,000-row fixture stays within configured resource limits.
- No rejected or quarantined row reaches operational tables.
- Full import lineage is visible.

### Epic 3: Domain events and trigger engine

Deliver:

- Domain event store.
- Trigger schemas and builder.
- Deterministic evaluator.
- Debounce, cooldown, retry, and dead-letter.
- Affected-account prioritization.
- Trigger UI and execution detail.

Exit gate:

- Replayed events are idempotent.
- Trigger simulation matches deterministic fixtures.
- No trigger can invoke a prohibited action.

### Epic 4: Generic signed webhook/API

Deliver:

- Source creation and test.
- HMAC verification.
- Timestamp and replay controls.
- Durable `202` receipt.
- Async processing.
- Delta reconciliation seam.
- Event operations UI.

Exit gate:

- Forged, stale, oversized, duplicate, and cross-workspace events pass expected denial tests.
- Accepted events produce one logical commit.

### Epic 5: Remote MCP read-only source

Deliver:

- Remote client.
- OAuth discovery/authorization seam.
- Protocol pinning.
- SSRF-resistant endpoint validation.
- Tool and resource discovery.
- Explicit allowlist.
- Output validation and limits.
- Source onboarding UI.

Exit gate:

- Unapproved, changed, oversized, invalid, or side-effecting tools are denied.
- MCP output cannot bypass staging or validation.
- No side-effecting MCP tool is enabled.

### Epic 6: Operations, telemetry, and documentation

Deliver:

- Live source health.
- Batch and event metrics.
- Quarantine queue.
- Dead-letter replay.
- Pause/resume.
- Reconciliation controls.
- PII-safe observability.
- Updated docs and production verification.

Exit gate:

- Admin page no longer relies on sample integration data when persistence is configured.
- Every control either works against durable state or is explicitly hidden.
- `pnpm verify:production` includes ingestion.

---

## 26. Definition of done

The historical increment is complete only when:

1. Every inbound source uses the canonical ingestion boundary.
2. All tenant-scoped data has enforced workspace isolation.
3. No raw source payload reaches scoring.
4. No quarantined or rejected record mutates operational data.
5. No source adapter has direct operational-table write authority.
6. CSV upload is constrained, scanned, streamed, and auditable.
7. Webhooks are signed, bounded, idempotent, and replay-resistant.
8. Remote MCP is authenticated, read-only, allowlisted, bounded, and routed through ingestion.
9. Trigger definitions are closed-set, versioned, simulatable, and auditable.
10. Accepted changes emit domain events transactionally.
11. Affected-account prioritization preserves existing deterministic and approval gates.
12. Rollback is compensating, conflict-aware, and auditable.
13. Source health, quarantine, imports, triggers, and event runs use durable data.
14. Adversarial ingestion tests pass.
15. Existing runtime, guardrail, schema, security, and judge boundaries are not weakened.
16. The verifier reports every required command passing.
17. No direct push to `main` occurs.
18. The final PR includes migration notes, threat-model summary, screenshots, test evidence, and rollback instructions.

This historical Definition of Done does not replace the current production-spine Definition of Done in `docs/PRD.md` and `docs/ARCHITECTURE.md`.

---

## 27. Claude Code execution contract

Use this section only if a later explicit ruling reactivates this historical delivery plan.

```text
You are implementing Secure CRM Ingestion, Event Triggers, and Source Onboarding v1
in the repository Lvvphole/ai-account-prioritization.

Authoritative documents, in order:
1. AGENTS.md
2. docs/decisions/ADR-001-hybrid-runtime-drafting.md
3. docs/decisions/ADR-002-harness-economics-and-minimum-sufficient-control.md
4. docs/PRD.md
5. docs/ARCHITECTURE.md
6. prd_manifest.yaml
7. docs/SECURE_CRM_INGESTION_EVENT_TRIGGERS_SOURCE_ONBOARDING_SPEC_V1.md

Operating rules:
- Read AGENTS.md before changing code.
- Preserve every existing deterministic ranking, verification, human approval,
  audit, schema-generation, and runtime/judge separation invariant.
- Treat Position B as the approved target architecture, but do not infer current
  implementation authorization from target-architecture approval.
- Model-assisted semantic mapping can only propose bounded mappings under an
  explicitly authorized task contract; deterministic validation and canonical
  commit retain authority.
- Do not implement model-controlled candidate-action selection, general tool
  orchestration, supervisor-worker fan-out, multi-model routing or voting,
  production caching, or any other deferred current-P4 capability without a new
  explicit ruling.
- Do not implement source-specific shortcuts around the canonical ingestion pipeline.
- Do not write directly to main.
- Create a feature branch.
- Begin in plan mode and inspect the repository before proposing file changes.
- Implement only an epic that the current product plan explicitly authorizes.
- After each authorized increment, run the smallest relevant verification suite.
- Run the applicable full Definition of Done gates before requesting review.
- The executor does not self-certify. Produce evidence for a separate verifier.
- If a verification command fails, stop, report the exact failing gate, and repair
  from evidence before continuing.
- Do not claim a UI control is working unless it writes durable state and the
  downstream service consults that state.
- Do not display sample telemetry as live.
- Do not weaken RLS, RBAC, approval, or source verification to make tests pass.
- Do not add an LLM call to ranking, trigger evaluation, runtime guardrails,
  source authentication, canonical commit authority, or security decisions.

Historical implementation order if separately reactivated:
Epic 0: workspace boundary
Epic 1: canonical ingestion contracts and persistence
Epic 2: secure CSV pipeline
Epic 3: domain events and trigger engine
Epic 4: signed webhook/API
Epic 5: remote MCP read-only source
Epic 6: operations, telemetry, and documentation

Historical final commands:
pnpm install
pnpm generate:schemas
pnpm build
pnpm typecheck
pnpm test
pnpm test:evals
pnpm test:ingestion
pnpm test:ingestion-security
pnpm verify:ingestion
pnpm verify:production

Final handoff must contain:
- Branch and commit range.
- Files created and changed.
- Database migrations and rollback procedure.
- Security controls implemented.
- Threat cases tested.
- Commands executed with results.
- Screenshots or route evidence for every new admin workflow.
- Known limitations.
- Explicit verifier status: not self-certified.
```

---

## 28. Reference standards

Implementation should align with:

- OWASP File Upload Cheat Sheet.
- OWASP API Security Top 10 2023, especially authorization, unrestricted resource consumption, SSRF, and unsafe consumption of APIs.
- Current Model Context Protocol transport and authorization specifications.
- Existing repository `AGENTS.md`, ADR-001, ADR-002, `docs/ARCHITECTURE.md`, `docs/PRD.md`, and schema-generation contract.

These sources guide controls. The current authority hierarchy and executable repository tests define acceptance for this product.
