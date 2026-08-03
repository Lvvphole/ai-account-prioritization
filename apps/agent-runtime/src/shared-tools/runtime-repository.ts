import type {
  Account,
  Activity,
  AnalyticsEvent,
  AuditLogEntry,
  Contact,
  CrmSourceCapabilitySnapshot,
  Opportunity,
} from "@repo/shared-schemas";
import { repository as inMemory } from "./database/repository";
import { isSupabaseConfigured, type RlsContext } from "./supabase/rls-context";
import { createSupabaseRepository } from "./supabase/repository";

/**
 * RuntimeRepository — the single data port the deterministic runtime reads and
 * writes through. It has two implementations selected per run.
 */
export interface RuntimeRepository {
  listAccountsByOwner(ownerId: string): Promise<Account[]>;
  listAllOwners(): Promise<string[]>;
  listContactsByAccount(accountId: string): Promise<Contact[]>;
  listOpportunitiesByAccount(accountId: string): Promise<Opportunity[]>;
  listActivitiesByAccount(accountId: string): Promise<Activity[]>;
  /**
   * Authoritative connector declarations keyed by canonical account ID. Each
   * value also carries source, mapping-version, and observation-time provenance.
   */
  listSourceCapabilitiesByAccountIds(
    accountIds: readonly string[],
  ): Promise<Record<string, CrmSourceCapabilitySnapshot>>;
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
  async listSourceCapabilitiesByAccountIds(_accountIds) {
    // Offline/current-contract eval inputs do not represent connector ingestion.
    return {};
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
 * RLS context is supplied AND Supabase is configured.
 */
export function resolveRepository(ctx?: RlsContext, nowIso?: string): RuntimeRepository {
  if (ctx && isSupabaseConfigured()) {
    return createSupabaseRepository(ctx, nowIso ?? new Date().toISOString());
  }
  return inMemoryRepository;
}
