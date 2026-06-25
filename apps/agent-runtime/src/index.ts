import { z } from "zod";
import { runDailyPrioritizationForOwner } from "./agents/orchestrator/orchestrator.agent";
import {
  dailyPrioritizationSchedule,
  runDailyPrioritizationForAllOwners,
} from "./schedules/daily-prioritization.schedule";
import { mcpRegistry } from "./shared-tools/mcp/registry";
import { readAccounts } from "./shared-tools/crm/read-accounts";
import { ORCHESTRATOR_CONTRACT } from "./agents/orchestrator/orchestrator.prompt";

/** Public runtime API. */
export { runDailyPrioritizationForOwner } from "./agents/orchestrator/orchestrator.agent";
export { runDailyPrioritizationForAllOwners, dailyPrioritizationSchedule } from "./schedules/daily-prioritization.schedule";
export { verifyRecommendation } from "./agents/guardrails/guardrail.agent";
export { runGuardrails } from "./agents/orchestrator/orchestrator.guardrails";
export { prioritizeAccounts } from "./agents/account-prioritizer/prioritizer.agent";
export { RUNTIME_CONFIG } from "./config/runtime";
export { getEnv } from "./config/env";
export { mcpRegistry } from "./shared-tools/mcp/registry";
export { createInProcessMcpClient } from "./shared-tools/mcp/client";
export { ORCHESTRATOR_CONTRACT } from "./agents/orchestrator/orchestrator.prompt";
export { resetStore, createSeedStore, type DataStore } from "./shared-tools/database/client";

// Co-located deterministic eval cases (consumed by @repo/testing-evals).
export {
  prioritizerEvalCases,
  type DeterministicEvalCase,
} from "./agents/account-prioritizer/prioritizer.eval";
export { guardrailEvalCases } from "./agents/guardrails/guardrail.eval";

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

/** Demo entrypoint: run the deterministic loop for all owners and summarize. */
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(ORCHESTRATOR_CONTRACT);
  // eslint-disable-next-line no-console
  console.log(`\nSchedule: ${dailyPrioritizationSchedule.name} (${dailyPrioritizationSchedule.cron})\n`);

  const runs = await runDailyPrioritizationForAllOwners({
    now: new Date().toISOString(),
    autoApprove: true,
  });

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
