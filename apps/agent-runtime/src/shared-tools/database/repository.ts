import type {
  Account,
  Activity,
  AuditLogEntry,
  AnalyticsEvent,
  Contact,
  Opportunity,
} from "@repo/shared-schemas";
import { getStore } from "./client";

/**
 * Repository — typed, read-mostly accessors over the data store. Centralizes
 * data access so the rest of the runtime never touches the raw store.
 */
export const repository = {
  listAccountsByOwner(ownerId: string): Account[] {
    return getStore().accounts.filter((a) => a.ownerId === ownerId);
  },
  listAllOwners(): string[] {
    return [...new Set(getStore().accounts.map((a) => a.ownerId))].sort();
  },
  listContactsByAccount(accountId: string): Contact[] {
    return getStore().contacts.filter((c) => c.accountId === accountId);
  },
  listOpportunitiesByAccount(accountId: string): Opportunity[] {
    return getStore().opportunities.filter((o) => o.accountId === accountId);
  },
  listActivitiesByAccount(accountId: string): Activity[] {
    return getStore().activities.filter((a) => a.accountId === accountId);
  },
  appendAudit(entry: AuditLogEntry): void {
    getStore().auditLog.push(entry);
  },
  appendAnalytics(event: AnalyticsEvent): void {
    getStore().analytics.push(event);
  },
};

export type Repository = typeof repository;
