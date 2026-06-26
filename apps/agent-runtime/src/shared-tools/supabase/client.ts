import {
  createServerSupabaseClient,
  type TypedSupabaseClient,
} from "@repo/supabase-client";
import type { RlsContext } from "./rls-context";

/**
 * RLS-aware Supabase client for a runtime read.
 *
 * In "user" mode the client carries the signed-in user's access token, so
 * Postgres RLS evaluates as that user (a rep sees only their accounts; a manager
 * sees their team's). This client NEVER uses the service-role key — privileged,
 * RLS-bypassing access is confined to `service-role-client.ts`.
 */
export function createRuntimeClient(ctx: RlsContext): TypedSupabaseClient {
  return ctx.kind === "user"
    ? createServerSupabaseClient(ctx.accessToken)
    : createServerSupabaseClient();
}
