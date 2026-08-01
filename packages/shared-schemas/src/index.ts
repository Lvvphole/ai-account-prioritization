/**
 * @repo/shared-schemas — the single source of truth for domain contracts.
 *
 * TypeScript/Zod is authoritative (Execution Rule #3). JSON Schema artifacts are
 * GENERATED from these definitions (see scripts/generate-json-schemas.ts) and
 * consumed by the Python service (Execution Rule #4). Python never imports TS.
 */
import { z } from "zod";

import { AccountSchema } from "./account";
import { ContactSchema } from "./contact";
import { OpportunitySchema } from "./opportunity";
import { ActivitySchema } from "./activity";
import {
  RecommendationSchema,
  PrioritizationRunSchema,
  SourceSignalSchema,
  NextBestActionSchema,
  VerificationResultSchema,
} from "./recommendation";
import { GeneratedDraftSchema, GeneratedDraftSentenceSchema } from "./generated-draft";
import { FeedbackSchema } from "./feedback";
import {
  AnalyticsEventSchema,
  AuditLogEntrySchema,
} from "./analytics-event";
import { EvalResultSchema, JudgeVerdictSchema } from "./eval-result";
import { WorkspaceSchema, WorkspaceMembershipSchema } from "./workspace";
import {
  DataSourceSchema,
  DataSourceScopeSchema,
  SourceCredentialReferenceSchema,
  SourceFieldMappingSchema,
  SourceMappingVersionSchema,
  SourceSyncCursorSchema,
  WebhookEnvelopeSchema,
  McpSourceConfigSchema,
  ToolPolicySchema,
} from "./source";
import {
  InboundRecordEnvelopeSchema,
  IngestionBatchSchema,
  IngestionFileSchema,
  StagedRecordSchema,
  IngestionFindingSchema,
  ChangeSetSchema,
  ChangeSetItemSchema,
  ImportApprovalSchema,
  ImportCommitSchema,
  ImportRollbackSchema,
  ExternalRecordLinkSchema,
} from "./ingestion";
import {
  ImportLimitsSchema,
  UploadIntentRequestSchema,
  UploadIntentSchema,
  FinalizeUploadRequestSchema,
  ScanVerdictSchema,
  ParseOutcomeSchema,
} from "./csv-import";
import { ImportTemplateSchema } from "./import-template";
import {
  DomainEventSchema,
  TriggerDefinitionSchema,
  TriggerVersionSchema,
  TriggerConditionSchema,
  TriggerActionSchema,
  TriggerExecutionSchema,
  DeadLetterEventSchema,
} from "./trigger";

export * from "./account";
export * from "./contact";
export * from "./opportunity";
export * from "./activity";
export * from "./recommendation";
export * from "./generated-draft";
export * from "./feedback";
export * from "./analytics-event";
export * from "./eval-result";
export * from "./workspace";
export * from "./source";
export * from "./ingestion";
export * from "./ingestion-state-machine";
export * from "./trigger";
export * from "./csv-import";
export * from "./import-template";

/**
 * Registry of every schema that should be emitted as a JSON Schema artifact.
 * The generator iterates this map; adding a schema here is the only step
 * required to publish a new contract to Python.
 */
export const SCHEMA_REGISTRY = {
  Account: AccountSchema,
  Contact: ContactSchema,
  Opportunity: OpportunitySchema,
  Activity: ActivitySchema,
  Recommendation: RecommendationSchema,
  PrioritizationRun: PrioritizationRunSchema,
  SourceSignal: SourceSignalSchema,
  NextBestAction: NextBestActionSchema,
  VerificationResult: VerificationResultSchema,
  GeneratedDraft: GeneratedDraftSchema,
  GeneratedDraftSentence: GeneratedDraftSentenceSchema,
  Feedback: FeedbackSchema,
  AnalyticsEvent: AnalyticsEventSchema,
  AuditLogEntry: AuditLogEntrySchema,
  EvalResult: EvalResultSchema,
  JudgeVerdict: JudgeVerdictSchema,
  Workspace: WorkspaceSchema,
  WorkspaceMembership: WorkspaceMembershipSchema,

  // Source registry.
  DataSource: DataSourceSchema,
  DataSourceScope: DataSourceScopeSchema,
  SourceCredentialReference: SourceCredentialReferenceSchema,
  SourceFieldMapping: SourceFieldMappingSchema,
  SourceMappingVersion: SourceMappingVersionSchema,
  SourceSyncCursor: SourceSyncCursorSchema,
  WebhookEnvelope: WebhookEnvelopeSchema,
  McpSourceConfig: McpSourceConfigSchema,
  ToolPolicy: ToolPolicySchema,

  // Ingestion pipeline.
  InboundRecordEnvelope: InboundRecordEnvelopeSchema,
  IngestionBatch: IngestionBatchSchema,
  IngestionFile: IngestionFileSchema,
  StagedRecord: StagedRecordSchema,
  IngestionFinding: IngestionFindingSchema,
  ChangeSet: ChangeSetSchema,
  ChangeSetItem: ChangeSetItemSchema,
  ImportApproval: ImportApprovalSchema,
  ImportCommit: ImportCommitSchema,
  ImportRollback: ImportRollbackSchema,
  ExternalRecordLink: ExternalRecordLinkSchema,

  // Events and triggers.
  DomainEvent: DomainEventSchema,
  TriggerDefinition: TriggerDefinitionSchema,
  TriggerVersion: TriggerVersionSchema,
  TriggerCondition: TriggerConditionSchema,
  TriggerAction: TriggerActionSchema,
  TriggerExecution: TriggerExecutionSchema,
  DeadLetterEvent: DeadLetterEventSchema,

  // Manual CSV import.
  ImportLimits: ImportLimitsSchema,
  UploadIntentRequest: UploadIntentRequestSchema,
  UploadIntent: UploadIntentSchema,
  FinalizeUploadRequest: FinalizeUploadRequestSchema,
  ScanVerdict: ScanVerdictSchema,
  ParseOutcome: ParseOutcomeSchema,
  ImportTemplate: ImportTemplateSchema,
} satisfies Record<string, z.ZodTypeAny>;

export type SchemaName = keyof typeof SCHEMA_REGISTRY;
