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
import { FeedbackSchema } from "./feedback";
import {
  AnalyticsEventSchema,
  AuditLogEntrySchema,
} from "./analytics-event";
import { EvalResultSchema, JudgeVerdictSchema } from "./eval-result";

export * from "./account";
export * from "./contact";
export * from "./opportunity";
export * from "./activity";
export * from "./recommendation";
export * from "./feedback";
export * from "./analytics-event";
export * from "./eval-result";

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
  Feedback: FeedbackSchema,
  AnalyticsEvent: AnalyticsEventSchema,
  AuditLogEntry: AuditLogEntrySchema,
  EvalResult: EvalResultSchema,
  JudgeVerdict: JudgeVerdictSchema,
} satisfies Record<string, z.ZodTypeAny>;

export type SchemaName = keyof typeof SCHEMA_REGISTRY;
