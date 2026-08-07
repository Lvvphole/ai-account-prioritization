import type { PrioritizationRun } from "@repo/shared-schemas";
import { getEnv, type Env } from "../config/env";
import { DAILY_PRIORITIZATION_CRON } from "../config/runtime";
import { runDailyPrioritizationForOwner, type RunOptions } from "../agents/orchestrator/orchestrator.agent";
import { resolveRepository } from "../shared-tools/runtime-repository";
import { isSupabaseConfigured } from "../shared-tools/supabase/rls-context";

/**
 * Daily prioritization schedule.
 *
 * Declares the cron cadence and a runner that partitions production work by
 * workspace and owner before it invokes the deterministic orchestrator. The
 * scheduler is intentionally thin. Logic and gating remain in the orchestrator.
 * Durable publication occurs only after the orchestrator returns a verified
 * published set.
 */
export const dailyPrioritizationSchedule = {
  name: "daily-prioritization",
  cron: DAILY_PRIORITIZATION_CRON,
  description: "Generate the verified daily account action plan for every rep.",
} as const;

export const DAILY_PRIORITIZATION_SERVICE_ACTOR_ID = "daily_prioritization_scheduler";

type EntrypointEnv = Pick<
  Env,
  "NODE_ENV" | "REQUIRE_HUMAN_APPROVAL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
>;

/**
 * Build the checked container/CLI entrypoint options. Production always uses a
 * trusted service RLS context backed by durable Supabase storage and never uses
 * synthetic auto-approval. Missing production durability is a startup failure.
 */
export function buildDailyPrioritizationEntrypointOptions(
  now: string,
  env: EntrypointEnv = getEnv(),
): RunOptions {
  if (env.NODE_ENV !== "production") {
    return { now, autoApprove: true };
  }
  if (env.REQUIRE_HUMAN_APPROVAL !== true) {
    throw new Error("Production daily prioritization requires human approval.");
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Production daily prioritization requires durable Supabase configuration.");
  }
  return {
    now,
    rlsContext: {
      kind: "service",
      actorId: DAILY_PRIORITIZATION_SERVICE_ACTOR_ID,
    },
  };
}

function assertProductionRunOptions(opts: RunOptions): void {
  const env = getEnv();
  if (env.NODE_ENV !== "production") return;
  if (opts.autoApprove === true) {
    throw new Error("Synthetic auto-approval is forbidden in production.");
  }
  if (!opts.rlsContext || opts.rlsContext.kind !== "service") {
    throw new Error("Production daily prioritization requires a service RLS context.");
  }
  if (!isSupabaseConfigured()) {
    throw new Error("Production daily prioritization requires durable Supabase configuration.");
  }
}

export async function runDailyPrioritizationForAllOwners(
  opts: RunOptions = {},
): Promise<PrioritizationRun[]> {
  assertProductionRunOptions(opts);

  // The discovery repository may be an unscoped service-role reader, but it may
  // enumerate only workspace/owner identities. Canonical account reads fail
  // closed until a workspace is added to the RLS context below.
  const discoveryRepo = resolveRepository(opts.rlsContext, opts.now);
  const scopes = await discoveryRepo.listOwnerScopes();
  const runs: PrioritizationRun[] = [];

  for (const scope of scopes) {
    const scopedOptions: RunOptions = scope.workspaceId
      ? {
          ...opts,
          rlsContext: opts.rlsContext
            ? { ...opts.rlsContext, workspaceId: scope.workspaceId }
            : undefined,
        }
      : opts;

    const scopedRepo = resolveRepository(scopedOptions.rlsContext, scopedOptions.now);
    const run = await runDailyPrioritizationForOwner(scope.ownerId, scopedOptions);

    // The canonical daily entrypoint does not surface a completed owner run
    // until its verified published recommendations are durable. Repository/DB
    // verification fails closed on tenant, owner, replay, and gate mismatch.
    await scopedRepo.persistPublishedRecommendations(run.recommendations);
    runs.push(run);
  }
  return runs;
}
