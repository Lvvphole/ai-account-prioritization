/**
 * @repo/supabase-client — typed Supabase clients + generated DB types.
 *
 * Ownership (Execution Rules #4-#8): Supabase owns persistence, auth, and RLS;
 * this package exposes typed clients and the generated `Database` types. The Zod
 * application schemas (@repo/shared-schemas) remain the runtime DTO source of
 * truth and are intentionally separate from these DB row types.
 */
export { createBrowserSupabaseClient } from "./browser";
export { createServerSupabaseClient } from "./server";
export { createSsrServerClient, type SsrCookieAdapter } from "./ssr";
export { createServiceRoleClient, __resetServiceRoleClient } from "./service-role";
export { getUser, requireUser, getAppRole, type AppRole } from "./auth";

export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
} from "./database.types";

export type { TypedSupabaseClient } from "./browser";
