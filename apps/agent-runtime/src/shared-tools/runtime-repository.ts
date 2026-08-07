import {
  RecommendationSchema,
  type Account,
  type Activity,
  type AnalyticsEvent,
  type AuditLogEntry,
  type Contact,
  type Opportunity,
  type Recommendation,
} from "@repo/shared-schemas";
import { repository as inMemory } from "./database/repository";
import { isSupabaseConfigured, type RlsContext } from "./supabase/rls-context";
import { createSupabaseRepository } from "./supabase/repository";

/** Deterministic tenant/owner partition used by the daily scheduler. */
export interface OwnerScope {
  ownerId: string;
  /** Absent only for the offline in-memory implementation. */
  workspaceId?: string;
}

/**
 * RuntimeRepository — the single data port the deterministic runtime reads and
 * writes through. It has two implementations selected per run:
 *
 * - in-memory (default): deterministic, offline; used by evals/CI and any run
 *   without an RLS context. This is the contract-mandated fallback.
 * - Supabase: used ONLY when an RLS context is supplied AND Supabase is
 *   configured (env present). Reads honor the explicit workspace scope/RLS;
 *   audit evidence and published recommendations are durable.
 *
 * Methods are async so both implementations share one interface; the in-memory
 * store resolves synchronously underneath, preserving determinism.
 */
export interface RuntimeRepository {
  listAccountsByOwner(ownerId: string): Promise<Account[]>;
  listAllOwners(): Promise<string[]>;
  listOwnerScopes(): Promise<OwnerScope[]>;
  listContactsByAccount(accountId: string): Promise<Contact[]>;
  listOpportunitiesByAccount(accountId: string): Promise<Opportunity[]>;
  listActivitiesByAccount(accountId: string): Promise<Activity[]>;
  appendAudit(entry: AuditLogEntry): Promise<void>;
  appendAnalytics(event: AnalyticsEvent): Promise<void>;
  persistPublishedRecommendations(recommendations: Recommendation[]): Promise<void>;
}

/** Async adapter over the deterministic in-memory store. */
export const inMemoryRepository: RuntimeRepository = {
  async listAccountsByOwner(ownerId) {
    return inMemory.listAccountsByOwner(ownerId);
  },
  async listAllOwners() {
    return inMemory.listAllOwners();
  },
  async listOwnerScopes() {
    return inMemory.listAllOwners().sort().map((ownerId) => ({ ownerId }));
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
  async persistPublishedRecommendations(recommendations) {
    const seen = new Set<string>();
    for (const candidate of recommendations) {
      const recommendation = RecommendationSchema.parse(candidate);
      if (!recommendation.published || recommendation.verification.status !== "passed") {
        throw new Error(
          `Recommendation ${recommendation.id} is not eligible for published persistence.`,
        );
      }
      if (seen.has(recommendation.id)) {
        throw new Error(`Duplicate published recommendation id: ${recommendation.id}.`);
      }
      seen.add(recommendation.id);
    }
    // Offline/eval mode intentionally has no durable production sink. The
    // method still validates the same published DTO contract before returning.
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
