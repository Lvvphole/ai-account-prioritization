import type { PrioritizationRun } from "@repo/shared-schemas";
import { DAILY_PRIORITIZATION_CRON } from "../config/runtime";
import { runDailyPrioritizationForOwner, type RunOptions } from "../agents/orchestrator/orchestrator.agent";
import { repository } from "../shared-tools/database/repository";

/**
 * Daily prioritization schedule.
 *
 * Declares the cron cadence and a runner that fans out the deterministic
 * orchestrator across every owning rep. The scheduler is intentionally a thin
 * wrapper — all logic and gating live in the orchestrator.
 */
export const dailyPrioritizationSchedule = {
  name: "daily-prioritization",
  cron: DAILY_PRIORITIZATION_CRON,
  description: "Generate the verified daily account action plan for every rep.",
} as const;

export async function runDailyPrioritizationForAllOwners(
  opts: RunOptions = {},
): Promise<PrioritizationRun[]> {
  const owners = repository.listAllOwners();
  const runs: PrioritizationRun[] = [];
  for (const ownerId of owners) {
    runs.push(await runDailyPrioritizationForOwner(ownerId, opts));
  }
  return runs;
}
