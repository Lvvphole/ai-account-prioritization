import type {
  Account,
  Activity,
  AnalyticsEvent,
  AuditLogEntry,
  Contact,
  Opportunity,
} from "@repo/shared-schemas";
import { repository as inMemory } from "./database/repository";
import { isSupabaseConfigured, type RlsContext } from "./supabase/rls-context";
import { createSupabaseRepository } from "./supabase/repository";

/**
 * RuntimeRepository — the single data port the deterministic runtime reads and
 * writes through. It has two implementations selected per run:
 *
 * - in-memory (default): deterministic, offline; used by evals/CI and any run
 *   without an RLS context. This is the contract-mandated fallback.
 * - Supabase: used ONLY when an RLS context is supplied AND Supabase is
 *   configured (env present). Reads honor RLS; audit evidence is durable.
 *
 * Methods are async so both implementations share one interface; the in-memory
 * store resolves synchronously underneath, preserving determinism.
 */
export interface RuntimeRepository {
  listAccountsByOwner(ownerId: string): Promise<Account[]>;
  listAllOwners(): Promise<string[]>;
  listContactsByAccount(accountId: string): Promise<Contact[]>;
  listOpportunitiesByAccount(accountId: string): Promise<Opportunity[]>;
  listActivitiesByAccount(accountId: string): Promise<Activity[]>;
  appendAudit(entry: AuditLogEntry): Promise<void>;
  appendAnalytics(event: AnalyticsEvent): Promise<void>;
}

/** Async adapter over the deterministic in-memory store. */
export const inMemoryRepository: RuntimeRepository = {
  async listAccountsByOwner(ownerId) {
    return inMemory.listAccountsByOwner(ownerId);
  },
  async listAllOwners() {
    return inMemory.listAllOwners();
  },
  async listContactsByAccount(accountId) {
    return inMemory.listContactsByAccount(accountId);
  },
  async listOpportunitiesByAccount(accountId) {
    return inMemory.listOpportunitiesByAccount(accountId);
  },
  async listActivitiesByAccount(accountId) {
    return inMemory.listActivitiesByAccount(accountId);
  },
  async appendAudit(entry) {
    inMemory.appendAudit(entry);
  },
  async appendAnalytics(event) {
    inMemory.appendAnalytics(event);
  },
};

/**
 * Resolve the repository for a run. Falls back to the in-memory store unless an
 * RLS context is supplied AND Supabase is configured — so evals/CI and any
 * context-less run stay offline and deterministic by construction.
 *
 * `nowIso` anchors Supabase's derived staleness (days since last contact); the
 * in-memory implementation ignores it.
 */
export function resolveRepository(ctx?: RlsContext, nowIso?: string): RuntimeRepository {
  if (ctx && isSupabaseConfigured()) {
    return createSupabaseRepository(ctx, nowIso ?? new Date().toISOString());
  }
  return inMemoryRepository;
}
