import type {
  Account,
  Activity,
  AnalyticsEvent,
  AuditLogEntry,
  Contact,
  Opportunity,
} from "@repo/shared-schemas";
import {
  AccountSchema,
  ActivitySchema,
  ContactSchema,
  OpportunitySchema,
} from "@repo/shared-schemas";
import type { Json, Tables, TypedSupabaseClient } from "@repo/supabase-client";
import type { RuntimeRepository } from "../runtime-repository";
import { createRuntimeClient } from "./client";
import { getServiceRoleClient } from "./service-role-client";
import type { RlsContext } from "./rls-context";

/**
 * Supabase-backed runtime repository.
 *
 * Reads source signals through an RLS-aware client (user mode) or the
 * service-role client (background/service mode) and writes immutable audit
 * evidence to `audit_evidence` via the service role. DB rows (snake_case,
 * UUIDs, timestamptz) are mapped into the Zod application schemas, which remain
 * the runtime's DTO source of truth.
 *
 * This implementation is used ONLY when an RLS context is supplied AND Supabase
 * is configured; otherwise the runtime stays on the in-memory store. See
 * `resolveRepository`.
 */

/** Normalize a Postgres timestamptz (e.g. `+00:00`) to a Zod `.datetime()` (Z). */
const iso = (s: string): string => new Date(s).toISOString();

/** Whole days elapsed between two timestamps, clamped non-negative. */
function daysBetween(from: string, nowIso: string): number {
  const ms = Date.parse(nowIso) - Date.parse(from);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function toAccount(row: Tables<"accounts">, nowIso: string): Account {
  return AccountSchema.parse({
    id: row.id,
    name: row.name,
    domain: row.domain ?? undefined,
    ownerId: row.owner_id,
    tier: row.tier,
    lifecycleStage: row.lifecycle_stage,
    industry: row.industry ?? undefined,
    employeeCount: row.employee_count ?? undefined,
    annualRevenueUsd: row.annual_revenue_usd ?? undefined,
    openPipelineUsd: row.open_pipeline_usd,
    lastContactedAt: row.last_contacted_at ? iso(row.last_contacted_at) : undefined,
    // Derived staleness (not a stored column). Absent contact => left undefined
    // so the scorer applies its worst-case default deterministically.
    daysSinceLastContact: row.last_contacted_at
      ? daysBetween(row.last_contacted_at, nowIso)
      : undefined,
    healthScore: row.health_score ?? undefined,
    intentSignals: row.intent_signals,
    dataQualityFlags: row.data_quality_flags,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  } satisfies Account);
}

function toContact(row: Tables<"contacts">): Contact {
  return ContactSchema.parse({
    id: row.id,
    accountId: row.account_id,
    firstName: row.first_name,
    lastName: row.last_name,
    title: row.title ?? undefined,
    email: row.email ?? undefined,
    role: row.role,
    isPrimary: row.is_primary,
    lastEngagedAt: row.last_engaged_at ? iso(row.last_engaged_at) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  } satisfies Contact);
}

function toOpportunity(row: Tables<"opportunities">): Opportunity {
  return OpportunitySchema.parse({
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    stage: row.stage,
    amountUsd: row.amount_usd,
    probability: row.probability,
    closeDate: row.close_date ? iso(row.close_date) : undefined,
    isClosed: row.is_closed,
    isWon: row.is_won,
    nextStep: row.next_step ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  } satisfies Opportunity);
}

function toActivity(row: Tables<"activities">): Activity {
  return ActivitySchema.parse({
    id: row.id,
    accountId: row.account_id,
    contactId: row.contact_id ?? undefined,
    type: row.type,
    subject: row.subject ?? undefined,
    body: row.body ?? undefined,
    occurredAt: iso(row.occurred_at),
    createdById: row.created_by_id,
    verified: row.verified,
  } satisfies Activity);
}

/** Throw a contextual error on a Postgrest failure; otherwise return rows. */
function unwrap<T>(
  what: string,
  res: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (res.error) throw new Error(`Supabase ${what} failed: ${res.error.message}`);
  return res.data ?? [];
}

/**
 * Supabase/PostgREST caps every response at `max_rows` (supabase/config.toml =
 * 1000), so a single unbounded select silently truncates large result sets.
 * Page through with explicit ranges until a short page signals the end, so the
 * runtime never scores/ranks/fans-out over a truncated subset.
 *
 * PAGE_SIZE must stay <= the server's max_rows; a larger value would be capped
 * server-side, return < PAGE_SIZE, and stop the loop before all rows are read.
 */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  what: string,
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = unwrap<T>(what, await page(from, from + PAGE_SIZE - 1));
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

export function createSupabaseRepository(
  ctx: RlsContext,
  nowIso: string,
): RuntimeRepository {
  // Reads: user mode honors RLS via the user's token; service mode uses the
  // service-role client with an explicit owner filter (RLS bypassed by design).
  const read: TypedSupabaseClient =
    ctx.kind === "user" ? createRuntimeClient(ctx) : getServiceRoleClient();

  return {
    async listAccountsByOwner(ownerId) {
      const rows = await fetchAllRows<Tables<"accounts">>("read accounts", (from, to) =>
        read.from("accounts").select("*").eq("owner_id", ownerId).range(from, to),
      );
      return rows.map((r) => toAccount(r, nowIso));
    },

    async listAllOwners() {
      const rows = await fetchAllRows<Pick<Tables<"accounts">, "owner_id">>(
        "read owners",
        (from, to) => read.from("accounts").select("owner_id").range(from, to),
      );
      return [...new Set(rows.map((r) => r.owner_id))].sort();
    },

    async listContactsByAccount(accountId) {
      const rows = await fetchAllRows<Tables<"contacts">>("read contacts", (from, to) =>
        read.from("contacts").select("*").eq("account_id", accountId).range(from, to),
      );
      return rows.map(toContact);
    },

    async listOpportunitiesByAccount(accountId) {
      const rows = await fetchAllRows<Tables<"opportunities">>(
        "read opportunities",
        (from, to) =>
          read
            .from("opportunities")
            .select("*")
            .eq("account_id", accountId)
            .range(from, to),
      );
      return rows.map(toOpportunity);
    },

    async listActivitiesByAccount(accountId) {
      const rows = await fetchAllRows<Tables<"activities">>("read activities", (from, to) =>
        read.from("activities").select("*").eq("account_id", accountId).range(from, to),
      );
      return rows.map(toActivity);
    },

    async appendAudit(entry: AuditLogEntry) {
      // Writes ALWAYS go through the service role: audit_evidence has no INSERT
      // policy, and the trail must be written regardless of the caller's RLS
      // scope. The id is left to the DB (gen_random_uuid) — no synthetic UUIDs.
      const service = getServiceRoleClient();
      const { error } = await service.from("audit_evidence").insert({
        run_id: entry.runId ?? null,
        account_id: entry.accountId ?? null,
        actor_id: entry.actorId,
        action: entry.action,
        decision: entry.decision,
        reason: entry.reason,
        // evidence is JSON-serializable by the AuditLogEntry Zod contract.
        evidence: entry.evidence as unknown as Json,
        occurred_at: entry.occurredAt,
      });
      if (error) throw new Error(`Supabase write audit_evidence failed: ${error.message}`);
    },

    async appendAnalytics(_event: AnalyticsEvent) {
      // Analytics persistence (observability_events) is owned by the
      // observability sprint. No-op here so Supabase mode never blocks on a
      // table this sprint does not own.
    },
  };
}
