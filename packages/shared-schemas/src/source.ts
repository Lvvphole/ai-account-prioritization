import { z } from "zod";

/**
 * Source registry contracts (secure-ingestion spec, sections 6, 8.2, 10, 11).
 *
 * A source is the authenticated origin of inbound data. It never writes
 * operational CRM tables: everything it produces enters the canonical ingestion
 * pipeline as raw records first.
 *
 * Every object here rejects unknown keys. Source payloads are attacker-influenced
 * even when the source itself is authenticated, so silently accepting an extra
 * field is how unvalidated data reaches the product.
 */

export const SourceKind = z.enum(["csv", "webhook", "native_crm", "mcp"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const SourceProvider = z.enum([
  "salesforce",
  "hubspot",
  "generic_webhook",
  "remote_mcp",
  "manual_csv",
]);
export type SourceProvider = z.infer<typeof SourceProvider>;

/** Section 6.2. A source moves through these and only these states. */
export const SourceState = z.enum([
  "not_configured",
  "connecting",
  "testing",
  "backfilling",
  "healthy",
  "degraded",
  "failed",
  "paused",
  "revoked",
]);
export type SourceState = z.infer<typeof SourceState>;

/** Canonical objects a source may supply. Section 6.3 step 4. */
export const CanonicalObjectType = z.enum([
  "account",
  "contact",
  "opportunity",
  "activity",
  "intent_signal",
  "account_health",
  "contract",
]);
export type CanonicalObjectType = z.infer<typeof CanonicalObjectType>;

export const DataSourceSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string().min(1).max(200),
    provider: SourceProvider,
    kind: SourceKind,
    state: SourceState,
    /** Objects the administrator enabled. Empty until step 4 of the wizard. */
    enabledObjects: z.array(CanonicalObjectType).max(7),
    /** Published mapping version in force. Null until a mapping is published. */
    activeMappingVersionId: z.string().uuid().nullable(),
    ownerLabel: z.string().min(1).max(200),
    lastEventAt: z.string().datetime().nullable(),
    lastSuccessfulSyncAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type DataSource = z.infer<typeof DataSourceSchema>;

/**
 * A requested permission. V1 connections are read-only, so `write` is modelled
 * in order to be rejected rather than omitted and silently permitted.
 */
export const DataSourceScopeSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    scope: z.string().min(1).max(200),
    access: z.enum(["read", "write"]),
    objectType: CanonicalObjectType.nullable(),
    businessReason: z.string().min(1).max(500),
    /** True when this scope could reach a customer. Section 6.3 step 3. */
    customerFacing: z.boolean(),
    approvedAt: z.string().datetime().nullable(),
    approvedBy: z.string().uuid().nullable(),
  })
  .strict();
export type DataSourceScope = z.infer<typeof DataSourceScopeSchema>;

/**
 * A reference to a secret, never the secret.
 *
 * Section 16.2: the value lives in an approved secret manager. Nothing here can
 * return it, so a leak of this row does not leak the credential.
 */
export const SourceCredentialReferenceSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    credentialType: z.enum(["oauth", "hmac_signing_secret", "bearer_token"]),
    /** Opaque pointer into the secret provider. */
    providerRef: z.string().min(1).max(500),
    /** Non-secret fingerprint, safe to display for identification. */
    fingerprint: z.string().regex(/^[a-f0-9]{16}$/),
    createdAt: z.string().datetime(),
    rotatedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
  })
  .strict();
export type SourceCredentialReference = z.infer<typeof SourceCredentialReferenceSchema>;

/** Section 6.3 step 5. Every source field gets one of these, never nothing. */
export const FieldMappingDisposition = z.enum([
  "mapped",
  "explicitly_ignored",
  "quarantined",
]);
export type FieldMappingDisposition = z.infer<typeof FieldMappingDisposition>;

/** Deterministic, closed-set transformations. No user-authored code. */
export const FieldTransform = z.enum([
  "none",
  "trim",
  "lowercase",
  "uppercase",
  "parse_iso_date",
  "parse_decimal",
  "parse_integer",
  "parse_boolean",
  "normalize_currency_usd",
]);
export type FieldTransform = z.infer<typeof FieldTransform>;

export const SourceFieldMappingSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    mappingVersionId: z.string().uuid(),
    objectType: CanonicalObjectType,
    sourceField: z.string().min(1).max(255),
    /** Null when the disposition is not `mapped`. */
    canonicalField: z.string().min(1).max(255).nullable(),
    disposition: FieldMappingDisposition,
    transform: FieldTransform,
    required: z.boolean(),
    /** Advisory only. An administrator still decides. Section 6.3 step 5. */
    suggestionConfidence: z.number().min(0).max(1).nullable(),
    warning: z.string().max(500).nullable(),
  })
  .strict()
  .refine(
    (m) => (m.disposition === "mapped") === (m.canonicalField !== null),
    { message: "canonicalField is required exactly when disposition is 'mapped'" },
  );
export type SourceFieldMapping = z.infer<typeof SourceFieldMappingSchema>;

export const SourceMappingVersionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    version: z.number().int().positive(),
    state: z.enum(["draft", "validated", "published", "superseded"]),
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
  })
  .strict();
export type SourceMappingVersion = z.infer<typeof SourceMappingVersionSchema>;

/** Where a pull-based source resumed from. Section 10.5. */
export const SourceSyncCursorSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    objectType: CanonicalObjectType,
    cursor: z.string().max(1000),
    lastReconciledAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type SourceSyncCursor = z.infer<typeof SourceSyncCursorSchema>;

/* -------------------------------------------------------------- webhook -- */

/** Section 10.2. Parsed only after signature and workspace checks pass. */
export const WebhookEnvelopeSchema = z
  .object({
    eventId: z.string().min(1).max(255),
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    eventType: z.string().min(1).max(100),
    occurredAt: z.string().datetime(),
    schemaVersion: z.string().min(1).max(50),
    record: z
      .object({
        objectType: CanonicalObjectType,
        externalId: z.string().min(1).max(255),
        accountExternalId: z.string().min(1).max(255).optional(),
        changedFields: z
          .record(
            z
              .object({
                previous: z.unknown(),
                current: z.unknown(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
  })
  .strict();
export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;

/* ------------------------------------------------------------------ MCP -- */

/**
 * Section 11.3. V1 permits read-only tools only, and `risk` is a literal so a
 * side-effecting tool cannot be described by this contract at all.
 */
export const ToolPolicySchema = z
  .object({
    toolName: z.string().min(1),
    risk: z.literal("read_only"),
    allowedRoles: z.array(z.enum(["admin", "service"])).min(1),
    workspaceScoped: z.literal(true),
    timeoutMs: z.number().int().min(100).max(60_000),
    maxInputBytes: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
    auditable: z.literal(true),
    /** Discovered tools arrive disabled and stay so until approved. */
    enabled: z.boolean(),
  })
  .strict();
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

export const McpSourceConfigSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    endpointUrl: z.string().url(),
    /** Pinned after negotiation so a server cannot downgrade it later. */
    protocolVersion: z.string().min(1).max(50),
    authorizationServer: z.string().url().nullable(),
    resourceMetadataUrl: z.string().url().nullable(),
    approvedTools: z.array(ToolPolicySchema).max(100),
    connectTimeoutMs: z.number().int().min(100).max(60_000),
    readTimeoutMs: z.number().int().min(100).max(60_000),
    maxOutputBytes: z.number().int().positive(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type McpSourceConfig = z.infer<typeof McpSourceConfigSchema>;
