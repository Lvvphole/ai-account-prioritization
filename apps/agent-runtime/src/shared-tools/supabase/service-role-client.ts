import {
  createServiceRoleClient,
  type TypedSupabaseClient,
} from "@repo/supabase-client";

/**
 * Service-role Supabase client for trusted runtime writes/background reads.
 *
 * BYPASSES RLS — used ONLY by the agent runtime to (a) insert immutable audit
 * evidence (audit_evidence has no INSERT policy) and (b) read source signals in
 * "service" mode (background scheduler) with an explicit owner filter. Never
 * exposed to the browser and never bound to a user-supplied token.
 */
export function getServiceRoleClient(): TypedSupabaseClient {
  return createServiceRoleClient();
}
