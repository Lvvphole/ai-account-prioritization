import type {
  Account,
  Activity,
  AnalyticsEvent,
  AuditLogEntry,
  Contact,
  CrmSourceCapabilitySnapshot,
  Opportunity,
} from "@repo/shared-schemas";
import {
  AccountSchema,
  ActivitySchema,
  ContactSchema,
  CrmSourceCapabilitySnapshotSchema,
  OpportunitySchema,
} from "@repo/shared-schemas";
import type { Json, Tables, TypedSupabaseClient } from "@repo/supabase-client";
import type { RuntimeRepository } from "../runtime-repository";
import { createRuntimeClient } from "./client";
import { getServiceRoleClient } from "./service-role-client";
import type { RlsContext } from "./rls-context";

/** Normalize a Postgres timestamptz to canonical UTC. */
const iso = (s: string): string => new Date(s).toISOString();

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

type OpportunityRowWithExactAmount = Tables<"opportunities"> & {
  amount_usd_exact: string;
};

function toOpportunity(row: OpportunityRowWithExactAmount): Opportunity {
  return OpportunitySchema.parse({
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    stage: row.stage,
    amountUsd: row.amount_usd,
    amountUsdExact: row.amount_usd_exact,
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

function unwrap<T>(
  what: string,
  res: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (res.error) throw new Error(`Supabase ${what} failed: ${res.error.message}`);
  return res.data ?? [];
}

const PAGE_SIZE = 1000;
const FILTER_CHUNK_SIZE = 200;

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
      const rows = await fetchAllRows<OpportunityRowWithExactAmount>(
        "read opportunities",
        (from, to) =>
          read
            .from("opportunities")
            .select("*,amount_usd_exact:amount_usd::text")
            .eq("account_id", accountId)
            .range(from, to) as unknown as PromiseLike<{
              data: OpportunityRowWithExactAmount[] | null;
              error: { message: string } | null;
            }>,
      );
      return rows.map(toOpportunity);
    },

    async listActivitiesByAccount(accountId) {
      const rows = await fetchAllRows<Tables<"activities">>("read activities", (from, to) =>
        read.from("activities").select("*").eq("account_id", accountId).range(from, to),
      );
      return rows.map(toActivity);
    },

    async listSourceCapabilitiesByAccountIds(accountIds) {
      if (accountIds.length === 0) return {};

      const service = getServiceRoleClient();
      const rows: Tables<"account_source_capabilities">[] = [];
      for (let offset = 0; offset < accountIds.length; offset += FILTER_CHUNK_SIZE) {
        const chunk = accountIds.slice(offset, offset + FILTER_CHUNK_SIZE);
        rows.push(
          ...(await fetchAllRows<Tables<"account_source_capabilities">>(
            "read account source capabilities",
            (from, to) =>
              service
                .from("account_source_capabilities")
                .select("*")
                .in("account_id", chunk)
                .range(from, to),
          )),
        );
      }

      const snapshots: Record<string, CrmSourceCapabilitySnapshot> = {};
      for (const row of rows) {
        try {
          const snapshot = CrmSourceCapabilitySnapshotSchema.parse({
            ...(row.capabilities as Record<string, unknown>),
            source: row.source,
            mappingVersion: row.mapping_version,
            observedAt: iso(row.observed_at),
          });
          snapshots[row.account_id] = snapshot;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown schema error";
          throw new Error(
            `Supabase account source capability snapshot invalid for ${row.account_id}: ${message}`,
          );
        }
      }
      return snapshots;
    },

    async appendAudit(entry: AuditLogEntry) {
      const service = getServiceRoleClient();
      const { error } = await service.from("audit_evidence").insert({
        run_id: entry.runId ?? null,
        account_id: entry.accountId ?? null,
        actor_id: entry.actorId,
        action: entry.action,
        decision: entry.decision,
        reason: entry.reason,
        evidence: entry.evidence as unknown as Json,
        occurred_at: entry.occurredAt,
      });
      if (error) throw new Error(`Supabase write audit_evidence failed: ${error.message}`);
    },

    async appendAnalytics(_event: AnalyticsEvent) {
      // Analytics persistence is owned by the observability sprint.
    },
  };
}
