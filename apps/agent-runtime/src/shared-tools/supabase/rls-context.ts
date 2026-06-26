import { getEnv } from "../../config/env";

/**
 * RLS context — who a runtime read/write executes as against Supabase.
 *
 * The orchestrator runs either:
 * - as a signed-in user ("user"): Postgres Row Level Security is enforced via the
 *   user's access token, so a rep only ever reads their own accounts; or
 * - as a trusted background actor ("service"): the daily scheduler/orchestrator
 *   reads with the service-role client (RLS bypassed) using an explicit owner
 *   filter, and records a system actor label (text) in audit evidence.
 *
 * When NO context is supplied the runtime stays on the deterministic, offline
 * in-memory store (evals/CI). See `resolveRepository`.
 */
export type AppRole = "rep" | "manager" | "admin";

export type RlsContext =
  | { kind: "user"; userId: string; role: AppRole; accessToken: string }
  | { kind: "service"; actorId: string };

/**
 * True when the runtime has the credentials to reach Supabase at all. The
 * service-role key is required because audit-evidence inserts always bypass RLS
 * (audit_evidence has no INSERT policy — writes go through the service role).
 */
export function isSupabaseConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Audit actor label for a context. `audit_evidence.actor_id` is `text`, so a
 * user UUID or a system label like "orchestrator" are both valid — no fake
 * UUIDs are ever synthesized.
 */
export function actorIdFor(ctx: RlsContext): string {
  return ctx.kind === "user" ? ctx.userId : ctx.actorId;
}
