import { z } from "zod";
import { runDailyPrioritizationForOwner } from "./agents/orchestrator/orchestrator.agent";
import {
  buildDailyPrioritizationEntrypointOptions,
  dailyPrioritizationSchedule,
  runDailyPrioritizationForAllOwners,
} from "./schedules/daily-prioritization.schedule";
import { mcpRegistry } from "./shared-tools/mcp/registry";
import { readAccounts } from "./shared-tools/crm/read-accounts";
import { ORCHESTRATOR_CONTRACT } from "./agents/orchestrator/orchestrator.prompt";

/** Public runtime API. */
export { runDailyPrioritizationForOwner } from "./agents/orchestrator/orchestrator.agent";
export {
  buildDailyPrioritizationEntrypointOptions,
  runDailyPrioritizationForAllOwners,
  dailyPrioritizationSchedule,
  DAILY_PRIORITIZATION_SERVICE_ACTOR_ID,
} from "./schedules/daily-prioritization.schedule";
export { verifyRecommendation } from "./agents/guardrails/guardrail.agent";
export { runGuardrails } from "./agents/orchestrator/orchestrator.guardrails";
export { prioritizeAccounts } from "./agents/account-prioritizer/prioritizer.agent";
export { RUNTIME_CONFIG } from "./config/runtime";
export { getEnv } from "./config/env";
export { mcpRegistry } from "./shared-tools/mcp/registry";
export { createInProcessMcpClient } from "./shared-tools/mcp/client";
export { ORCHESTRATOR_CONTRACT } from "./agents/orchestrator/orchestrator.prompt";
export { resetStore, createSeedStore, type DataStore } from "./shared-tools/database/client";
export {
  attachActionDraft,
  attachHybridActionDraft,
  createRuntimeDraftRunBudget,
  estimateRuntimeModelInputTokensUpperBound,
  type HybridDraftOptions,
  type HybridDraftOutcome,
  type HybridDraftResult,
  type RuntimeDraftRunBudget,
} from "./agents/sales-execution/execution.agent";
export { buildVerifiedDraftContext } from "./agents/sales-execution/build-draft-context";
export {
  DRAFT_GROUNDING_RULES_VERSION,
  validateDraftGrounding,
  renderGroundedDraft,
} from "./agents/sales-execution/validate-draft-grounding";
export {
  RUNTIME_DRAFT_POLICY_VERSION,
  runtimeDraftingPolicyFromEnv,
  type RuntimeDraftingPolicy,
} from "./agents/sales-execution/execution.policy";
export {
  RUNTIME_DRAFT_PROMPT_HASH,
  RUNTIME_DRAFT_PROMPT_VERSION,
} from "./agents/sales-execution/execution.prompt";
export {
  anthropicRuntimeModelClient,
  RuntimeModelError,
  type RuntimeModelClient,
  type RuntimeModelRequest,
  type RuntimeModelResult,
  type RuntimeModelTelemetry,
} from "./inference/runtime-model";

// Supabase wiring (Sprint 4). The runtime stays on the in-memory store unless a
// run supplies an RLS context AND Supabase is configured.
export {
  resolveRepository,
  inMemoryRepository,
  type RuntimeRepository,
} from "./shared-tools/runtime-repository";
export {
  isSupabaseConfigured,
  actorIdFor,
  type RlsContext,
  type AppRole,
} from "./shared-tools/supabase/rls-context";
export { createSupabaseRepository } from "./shared-tools/supabase/repository";

// Co-located deterministic eval cases (consumed by @repo/testing-evals).
export {
  prioritizerEvalCases,
  type DeterministicEvalCase,
} from "./agents/account-prioritizer/prioritizer.eval";
export { guardrailEvalCases } from "./agents/guardrails/guardrail.eval";
export { parseCsvStream, type ParseOptions, type RowHandler } from "./ingestion/csv-parser";
export {
  evaluateScanGate,
  assertScanAllows,
  runSecurityScan,
  ScanBlockedError,
  type MalwareScanner,
  type ScanGateOptions,
  type ScanBlock,
} from "./ingestion/scanner";
export {
  normalizeRow,
  applyTransform,
  classifyTrust,
  computeRowHash,
  type NormalizedRow,
  type TransformFailure,
} from "./ingestion/normalization";
export {
  validateBatch,
  dispositionFor,
  DEFAULT_ANOMALY_THRESHOLDS,
  type ValidationContext,
  type ValidationResult,
  type ValidatedRow,
  type RowFinding,
  type AnomalyThresholds,
} from "./ingestion/validation";
export {
  buildChangeSet,
  assessApproval,
  type ChangeSetPreview,
  type ChangeSetItemPreview,
  type OperationalSnapshot,
  type ApprovalRequirement,
} from "./ingestion/change-set";
export {
  planCommit,
  assertCommitPlanSafe,
  planRollback,
  CommitRefusedError,
  DEFAULT_ROLLBACK_WINDOW,
  type CommitPlan,
  type CommitPlanEntry,
  type RollbackPlan,
} from "./ingestion/commit";
export {
  CrmSourceCapabilitiesSchema,
  FeatureStatusSchema,
  resolveFeatureModes,
  unavailableFeature,
  type CrmSourceCapabilities,
  type FeatureStatus,
  type FeatureValue,
} from "./ingestion/source-capabilities";
export {
  affectedFeaturesForEvent,
  coalesceAccountEvents,
  type AccountEvent,
  type AccountEventType,
  type AccountRecomputeWork,
} from "./events/account-events";
export {
  createNotificationJob,
  nextNotificationAttemptAt,
  notificationIdempotencyKey,
  type CreateNotificationJobInput,
  type NotificationChannel,
  type NotificationJob,
  type NotificationStatus,
} from "./notifications/notification-job";

/**
 * Register read-only runtime tools on the MCP registry. Side-effecting tools
 * (CRM write-back, send) are deliberately NOT auto-registered here; they remain
 * approval-gated and are invoked only through the orchestrator's verified path.
 */
mcpRegistry.register({
  name: "crm.read_accounts",
  description: "Read accounts owned by a sales rep.",
  sideEffecting: false,
  inputSchema: z.object({ ownerId: z.string().min(1) }),
  handler: ({ ownerId }) => readAccounts(ownerId),
});

/** Container/CLI entrypoint for the daily prioritization worker. */
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(ORCHESTRATOR_CONTRACT);
  // eslint-disable-next-line no-console
  console.log(`\nSchedule: ${dailyPrioritizationSchedule.name} (${dailyPrioritizationSchedule.cron})\n`);

  const runs = await runDailyPrioritizationForAllOwners(
    buildDailyPrioritizationEntrypointOptions(new Date().toISOString()),
  );

  for (const run of runs) {
    // eslint-disable-next-line no-console
    console.log(
      `Owner ${run.ownerId}: ${run.recommendations.length} published, ${run.blockedCount} blocked, ${run.totalAccountsConsidered} considered.`,
    );
    for (const rec of run.recommendations) {
      // eslint-disable-next-line no-console
      console.log(
        `  #${rec.rank} ${rec.accountId} score=${rec.score} action=${rec.nextBestAction.type} reasons=[${rec.reasonCodes.join(", ")}]`,
      );
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
