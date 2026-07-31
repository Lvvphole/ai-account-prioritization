import type {
  ChangeSet,
  ChangeSetItem,
  DataSource,
  DeadLetterEvent,
  DomainEvent,
  ExternalRecordLink,
  ImportApproval,
  ImportCommit,
  ImportRollback,
  IngestionBatch,
  IngestionFile,
  IngestionFinding,
  IngestionState,
  RecordDisposition,
  SourceFieldMapping,
  SourceMappingVersion,
  StagedRecord,
  TriggerDefinition,
  TriggerExecution,
  TriggerVersion,
} from "@repo/shared-schemas";
import type { Actor } from "@repo/security";

/**
 * Persistence ports for the ingestion pipeline.
 *
 * Split by what the caller is allowed to do, not by what is convenient to
 * group. A parser holds `StagingRepository` and therefore has no method that
 * writes an account. The commit service holds `CommitRepository`, whose one
 * write method demands an approval. There is no interface that offers both a
 * raw payload and an operational write.
 *
 * Every method takes an `Actor` and every method is workspace-scoped through
 * it. RLS enforces the same predicate in the database; these signatures make it
 * impossible to write a query that forgot to ask.
 */

/** Paging that cannot be turned into an unbounded read. */
export interface Page {
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------- registry -- */

export interface SourceRepository {
  listSources(actor: Actor): Promise<DataSource[]>;
  getSource(actor: Actor, sourceId: string): Promise<DataSource | null>;
  createSource(
    actor: Actor,
    source: Omit<DataSource, "id" | "createdAt">,
  ): Promise<DataSource>;
  /** State moves are validated by the caller before they arrive here. */
  updateSourceState(
    actor: Actor,
    sourceId: string,
    state: DataSource["state"],
  ): Promise<void>;

  listMappingVersions(actor: Actor, sourceId: string): Promise<SourceMappingVersion[]>;
  getMappings(actor: Actor, mappingVersionId: string): Promise<SourceFieldMapping[]>;
  /**
   * Publishing supersedes the previous version atomically. A source is never
   * without a mapping mid-publish, and a published version is never edited.
   */
  publishMappingVersion(actor: Actor, mappingVersionId: string): Promise<void>;
}

/* -------------------------------------------------------------- staging -- */

/**
 * The pipeline's own storage. Nothing here can reach an operational table, so a
 * parsing or mapping bug cannot corrupt product data.
 */
export interface StagingRepository {
  createBatch(
    actor: Actor,
    batch: Omit<IngestionBatch, "id" | "createdAt">,
  ): Promise<IngestionBatch>;
  getBatch(actor: Actor, batchId: string): Promise<IngestionBatch | null>;
  /**
   * Moves a batch's state. Implementations reject a transition the state
   * machine does not allow and record audit evidence for the refusal, so an
   * invalid move fails closed at the persistence boundary too.
   */
  transitionBatch(
    actor: Actor,
    batchId: string,
    from: IngestionState,
    to: IngestionState,
  ): Promise<void>;

  recordFile(actor: Actor, file: Omit<IngestionFile, "id">): Promise<IngestionFile>;

  insertStagedRecords(
    actor: Actor,
    records: Omit<StagedRecord, "id" | "createdAt">[],
  ): Promise<number>;
  listStagedRecords(
    actor: Actor,
    batchId: string,
    disposition: RecordDisposition | null,
    page: Page,
  ): Promise<StagedRecord[]>;
  setDisposition(
    actor: Actor,
    stagedRecordId: string,
    disposition: RecordDisposition,
  ): Promise<void>;

  addFindings(
    actor: Actor,
    findings: Omit<IngestionFinding, "id" | "createdAt">[],
  ): Promise<number>;
  listFindings(actor: Actor, batchId: string, page: Page): Promise<IngestionFinding[]>;
  /**
   * Resolving a finding always demands a reason. A hard block cannot be
   * resolved at all; implementations refuse it rather than accepting a reason
   * and ignoring it.
   */
  resolveFinding(
    actor: Actor,
    findingId: string,
    disposition: IngestionFinding["disposition"],
    reason: string,
  ): Promise<void>;

  saveChangeSet(
    actor: Actor,
    changeSet: Omit<ChangeSet, "id" | "createdAt">,
    items: Omit<ChangeSetItem, "id" | "changeSetId">[],
  ): Promise<ChangeSet>;
  getChangeSet(actor: Actor, batchId: string): Promise<ChangeSet | null>;
  listChangeSetItems(
    actor: Actor,
    changeSetId: string,
    page: Page,
  ): Promise<ChangeSetItem[]>;
}

/* --------------------------------------------------------------- commit -- */

/**
 * The only port that writes product data.
 *
 * `applyCommit` takes the approval as an argument because a commit without one
 * should be unrepresentable, not merely rejected. It runs the operational
 * writes, the external-record links, and the domain events in one transaction,
 * so the product can never hold a committed change that raised no event
 * (spec section 15.3).
 */
export interface CommitRepository {
  recordApproval(
    actor: Actor,
    approval: Omit<ImportApproval, "id" | "approvedAt">,
  ): Promise<ImportApproval>;

  applyCommit(
    actor: Actor,
    input: {
      batchId: string;
      changeSetId: string;
      approvalId: string;
    },
  ): Promise<ImportCommit>;

  getCommit(actor: Actor, commitId: string): Promise<ImportCommit | null>;

  /**
   * Compensating write. The original commit row is never edited or deleted, so
   * the history of what was applied stays intact (append-only, section 15.3).
   */
  requestRollback(
    actor: Actor,
    input: { originalCommitId: string; businessReason: string },
  ): Promise<ImportRollback>;
  applyRollback(actor: Actor, rollbackId: string): Promise<ImportRollback>;

  upsertExternalLinks(
    actor: Actor,
    links: Omit<ExternalRecordLink, "id">[],
  ): Promise<number>;
  findInternalRecordId(
    actor: Actor,
    sourceId: string,
    objectType: ExternalRecordLink["objectType"],
    externalId: string,
  ): Promise<string | null>;
}

/* ------------------------------------------------------- events/triggers -- */

export interface DomainEventRepository {
  /**
   * Called inside the same transaction as the operational mutation. Never a
   * separate write, so the event and the change succeed or fail together.
   */
  emit(actor: Actor, events: Omit<DomainEvent, "id" | "recordedAt">[]): Promise<number>;
  claimPending(actor: Actor, limit: number): Promise<DomainEvent[]>;
  markProcessed(actor: Actor, eventId: string, state: DomainEvent["state"]): Promise<void>;
  /** Idempotency for webhook sources. Section 10.4. */
  findByExternalEventId(
    actor: Actor,
    sourceId: string,
    externalEventId: string,
  ): Promise<DomainEvent | null>;
}

export interface TriggerRepository {
  listTriggers(actor: Actor): Promise<TriggerDefinition[]>;
  getActiveVersions(actor: Actor, eventType: DomainEvent["eventType"]): Promise<TriggerVersion[]>;
  /** A published version is immutable. Implementations reject an update to one. */
  publishVersion(
    actor: Actor,
    triggerVersionId: string,
    publishReason: string,
  ): Promise<TriggerVersion>;

  recordExecution(
    actor: Actor,
    execution: Omit<TriggerExecution, "id">,
  ): Promise<TriggerExecution>;
  completeExecution(
    actor: Actor,
    executionId: string,
    result: Pick<
      TriggerExecution,
      "state" | "actionsRun" | "affectedAccountIds" | "prioritizationRunId" | "errorCode" | "errorMessage"
    >,
  ): Promise<void>;

  /** Executions in the cooldown window for one account. Section 12.5. */
  countRecentExecutions(
    actor: Actor,
    triggerId: string,
    accountId: string,
    sinceIso: string,
  ): Promise<number>;
}

export interface DeadLetterRepository {
  record(
    actor: Actor,
    entry: Omit<DeadLetterEvent, "id" | "createdAt">,
  ): Promise<DeadLetterEvent>;
  listOpen(actor: Actor, page: Page): Promise<DeadLetterEvent[]>;
  /** A replay preserves the original event and creates a new execution. */
  markReplayed(
    actor: Actor,
    deadLetterId: string,
    replayExecutionId: string,
  ): Promise<void>;
  discard(actor: Actor, deadLetterId: string, reason: string): Promise<void>;
}

/* --------------------------------------------------------------- secrets -- */

/**
 * Credential values never travel through the repositories above, so a leak of
 * ingestion rows leaks no secret. A caller receives a reference and asks the
 * provider to use it.
 */
export interface SecretProvider {
  /** Resolves a reference to a value in memory for the duration of one call. */
  withSecret<T>(
    actor: Actor,
    providerRef: string,
    use: (secret: string) => Promise<T>,
  ): Promise<T>;
  rotate(actor: Actor, providerRef: string): Promise<{ fingerprint: string }>;
  revoke(actor: Actor, providerRef: string): Promise<void>;
}
