import type { CanonicalObjectType, SourceKind } from "@repo/shared-schemas";

/**
 * The source adapter contract (secure-ingestion spec, section 9).
 *
 * An adapter talks to a remote system and returns raw records. That is all it
 * does. It cannot rank, publish, write recommendations, or mutate CRM records,
 * and this file is where that limitation is made structural rather than
 * advisory:
 *
 * - `SourceContext` carries no repository, no database client and no Supabase
 *   handle, so adapter code has nothing to call. The exit gate for Epic 1 is
 *   "no operational CRM table can be reached from a source adapter directly",
 *   and the cheapest way to guarantee that is to hand the adapter no reference
 *   it could reach a table through.
 * - Every method returns data. None returns a persistence result, so an adapter
 *   cannot report having stored anything.
 * - Credentials appear as an opaque reference. The adapter asks the host to use
 *   it; the value never enters adapter memory or adapter output.
 */

/** Per-call limits. The host sets these; the adapter cannot raise them. */
export interface AdapterLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRecords: number;
  retryBudget: number;
}

/**
 * Everything an adapter is given for one call.
 *
 * Deliberately narrow. If a future adapter appears to need a database handle,
 * the work belongs in the ingestion service instead.
 */
export interface SourceContext {
  workspaceId: string;
  sourceId: string;
  /** Ties adapter activity to audit evidence. Section 9. */
  correlationId: string;
  /** Opaque pointer resolved by the host's secret provider, never the secret. */
  credentialRef: string;
  limits: AdapterLimits;
  /** Host-controlled cancellation. */
  signal?: AbortSignal;
}

export interface ConnectionTestResult {
  ok: boolean;
  /** Scopes the remote actually granted, which may be fewer than requested. */
  grantedScopes: string[];
  /** Present only on failure. Redacted, no credential material. */
  errorCode?: string;
  errorMessage?: string;
  latencyMs: number;
}

/** One field the remote system reports, before any mapping decision. */
export interface DiscoveredField {
  name: string;
  /** The remote's own type name, kept verbatim for the mapping UI. */
  remoteType: string;
  nullable: boolean;
  /** True when the remote marks it as containing personal data. */
  declaredPii: boolean;
  sampleCount: number;
}

export interface DiscoveredObject {
  remoteName: string;
  /** Null when the adapter cannot say. An administrator decides in the wizard. */
  suggestedObjectType: CanonicalObjectType | null;
  fields: DiscoveredField[];
}

export interface DiscoveredSourceSchema {
  objects: DiscoveredObject[];
  discoveredAt: string;
}

export interface SampleRequest {
  objectType: CanonicalObjectType;
  /** Capped by `AdapterLimits.maxRecords` regardless of what is asked for. */
  limit: number;
}

/**
 * What an adapter returns: untrusted, unmapped, unvalidated.
 *
 * `fields` is `unknown`-valued on purpose. Nothing downstream may read a value
 * out of here without going through mapping and validation first.
 */
export interface RawSourceRecord {
  objectType: CanonicalObjectType;
  externalId: string;
  externalParentId?: string;
  fields: Record<string, unknown>;
  /** Reported by the remote. Never trusted as an ordering key on its own. */
  remoteUpdatedAt?: string;
  sourceRecordUrl?: string;
  externalEventId?: string;
}

export interface SourceCursor {
  objectType: CanonicalObjectType;
  value: string;
}

export interface SourceChangePage {
  records: RawSourceRecord[];
  /** Null when the source has no more changes. */
  nextCursor: SourceCursor | null;
  /** True when the adapter stopped at a limit rather than at the end. */
  truncated: boolean;
}

/**
 * A full or windowed re-read used to catch changes a webhook never delivered.
 * Section 10.5.
 */
export interface ReconciliationRequest {
  objectType: CanonicalObjectType;
  since: string;
  until: string;
}

export interface ReconciliationResult {
  records: RawSourceRecord[];
  /** External IDs the remote no longer returns, for deletion review. */
  missingExternalIds: string[];
  completedAt: string;
}

export interface SourceAdapter {
  readonly kind: SourceKind;

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
