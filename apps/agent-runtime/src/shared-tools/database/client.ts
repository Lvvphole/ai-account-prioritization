import type {
  Account,
  Activity,
  AnalyticsEvent,
  AuditLogEntry,
  Contact,
  Opportunity,
} from "@repo/shared-schemas";

/**
 * In-memory database client.
 *
 * The runtime degrades gracefully to this store when DATABASE_URL is absent, so
 * the deterministic loop is always runnable in CI and evals without external
 * infrastructure. Swap with a real client behind the same interface in prod.
 */
export interface DataStore {
  accounts: Account[];
  contacts: Contact[];
  opportunities: Opportunity[];
  activities: Activity[];
  auditLog: AuditLogEntry[];
  analytics: AnalyticsEvent[];
}

const ISO = (s: string) => new Date(s).toISOString();

/** Deterministic seed used by the demo run and shared by deterministic evals. */
export function createSeedStore(): DataStore {
  const accounts: Account[] = [
    {
      id: "acc_001",
      name: "Helios Manufacturing",
      domain: "helios-mfg.com",
      ownerId: "rep_alex",
      tier: "strategic",
      lifecycleStage: "open_opportunity",
      industry: "Industrial",
      employeeCount: 4200,
      annualRevenueUsd: 820_000_000,
      openPipelineUsd: 180_000,
      lastContactedAt: ISO("2026-06-02T15:00:00Z"),
      daysSinceLastContact: 23,
      healthScore: 62,
      intentSignals: ["pricing_page_visit", "demo_request"],
      dataQualityFlags: [],
      createdAt: ISO("2025-01-10T00:00:00Z"),
      updatedAt: ISO("2026-06-02T15:00:00Z"),
    },
    {
      id: "acc_002",
      name: "Northwind Retail",
      domain: "northwind.example",
      ownerId: "rep_alex",
      tier: "enterprise",
      lifecycleStage: "renewal",
      industry: "Retail",
      employeeCount: 1200,
      annualRevenueUsd: 240_000_000,
      openPipelineUsd: 60_000,
      lastContactedAt: ISO("2026-06-18T12:00:00Z"),
      daysSinceLastContact: 7,
      healthScore: 48,
      intentSignals: [],
      dataQualityFlags: [],
      createdAt: ISO("2024-09-01T00:00:00Z"),
      updatedAt: ISO("2026-06-18T12:00:00Z"),
    },
    {
      id: "acc_003",
      name: "Cobalt Analytics",
      domain: "cobalt.example",
      ownerId: "rep_alex",
      tier: "mid_market",
      lifecycleStage: "churn_risk",
      industry: "Software",
      employeeCount: 300,
      annualRevenueUsd: 40_000_000,
      openPipelineUsd: 0,
      lastContactedAt: ISO("2026-04-30T09:00:00Z"),
      daysSinceLastContact: 56,
      healthScore: 31,
      intentSignals: ["support_escalation"],
      dataQualityFlags: [],
      createdAt: ISO("2023-05-20T00:00:00Z"),
      updatedAt: ISO("2026-04-30T09:00:00Z"),
    },
    {
      id: "acc_004",
      name: "Pinecrest Logistics",
      domain: "pinecrest.example",
      ownerId: "rep_alex",
      tier: "smb",
      lifecycleStage: "prospect",
      industry: "Logistics",
      employeeCount: 80,
      openPipelineUsd: 0,
      daysSinceLastContact: 41,
      intentSignals: [],
      dataQualityFlags: ["missing_primary_contact"],
      createdAt: ISO("2026-03-15T00:00:00Z"),
      updatedAt: ISO("2026-05-15T00:00:00Z"),
    },
    {
      id: "acc_005",
      name: "Vertex Health Systems",
      domain: "vertexhealth.example",
      ownerId: "rep_sam",
      tier: "strategic",
      lifecycleStage: "open_opportunity",
      industry: "Healthcare",
      employeeCount: 9000,
      annualRevenueUsd: 1_500_000_000,
      openPipelineUsd: 320_000,
      lastContactedAt: ISO("2026-06-20T10:00:00Z"),
      daysSinceLastContact: 5,
      healthScore: 70,
      intentSignals: ["security_review_started", "pricing_page_visit", "exec_meeting_request"],
      dataQualityFlags: [],
      createdAt: ISO("2025-02-01T00:00:00Z"),
      updatedAt: ISO("2026-06-20T10:00:00Z"),
    },
  ];

  const contacts: Contact[] = [
    {
      id: "con_001",
      accountId: "acc_001",
      firstName: "Dana",
      lastName: "Ito",
      title: "VP Operations",
      email: "dana.ito@helios-mfg.com",
      role: "economic_buyer",
      isPrimary: true,
      lastEngagedAt: ISO("2026-06-02T15:00:00Z"),
      createdAt: ISO("2025-01-10T00:00:00Z"),
      updatedAt: ISO("2026-06-02T15:00:00Z"),
    },
    {
      id: "con_002",
      accountId: "acc_002",
      firstName: "Lee",
      lastName: "Okafor",
      title: "Director of IT",
      email: "lee.okafor@northwind.example",
      role: "champion",
      isPrimary: true,
      lastEngagedAt: ISO("2026-06-18T12:00:00Z"),
      createdAt: ISO("2024-09-01T00:00:00Z"),
      updatedAt: ISO("2026-06-18T12:00:00Z"),
    },
    {
      id: "con_003",
      accountId: "acc_003",
      firstName: "Robin",
      lastName: "Vasquez",
      title: "Head of Data",
      email: "robin.vasquez@cobalt.example",
      role: "champion",
      isPrimary: true,
      createdAt: ISO("2023-05-20T00:00:00Z"),
      updatedAt: ISO("2026-04-30T09:00:00Z"),
    },
    {
      id: "con_005",
      accountId: "acc_005",
      firstName: "Morgan",
      lastName: "Bell",
      title: "Chief Information Officer",
      email: "morgan.bell@vertexhealth.example",
      role: "economic_buyer",
      isPrimary: true,
      lastEngagedAt: ISO("2026-06-20T10:00:00Z"),
      createdAt: ISO("2025-02-01T00:00:00Z"),
      updatedAt: ISO("2026-06-20T10:00:00Z"),
    },
  ];

  const opportunities: Opportunity[] = [
    {
      id: "opp_001",
      accountId: "acc_001",
      name: "Helios Plant Rollout",
      stage: "proposal",
      amountUsd: 180_000,
      probability: 0.5,
      closeDate: ISO("2026-08-31T00:00:00Z"),
      isClosed: false,
      isWon: false,
      nextStep: "Send proposal revision",
      createdAt: ISO("2026-03-01T00:00:00Z"),
      updatedAt: ISO("2026-05-10T00:00:00Z"),
    },
    {
      id: "opp_002",
      accountId: "acc_002",
      name: "Northwind Renewal FY26",
      stage: "negotiation",
      amountUsd: 60_000,
      probability: 0.6,
      closeDate: ISO("2026-07-15T00:00:00Z"),
      isClosed: false,
      isWon: false,
      nextStep: "Confirm renewal terms",
      createdAt: ISO("2026-05-01T00:00:00Z"),
      updatedAt: ISO("2026-06-18T12:00:00Z"),
    },
    {
      id: "opp_005",
      accountId: "acc_005",
      name: "Vertex Enterprise Platform",
      stage: "negotiation",
      amountUsd: 320_000,
      probability: 0.65,
      closeDate: ISO("2026-09-30T00:00:00Z"),
      isClosed: false,
      isWon: false,
      nextStep: "Security review follow-up",
      createdAt: ISO("2026-02-15T00:00:00Z"),
      updatedAt: ISO("2026-06-20T10:00:00Z"),
    },
  ];

  const activities: Activity[] = [
    {
      id: "act_001",
      accountId: "acc_001",
      contactId: "con_001",
      type: "meeting",
      subject: "Proposal walkthrough",
      occurredAt: ISO("2026-06-02T15:00:00Z"),
      createdById: "rep_alex",
      verified: true,
    },
    {
      id: "act_002",
      accountId: "acc_001",
      type: "intent_event",
      subject: "Visited pricing page",
      occurredAt: ISO("2026-06-21T08:00:00Z"),
      createdById: "system",
      verified: true,
    },
    {
      id: "act_003",
      accountId: "acc_003",
      type: "intent_event",
      subject: "Support escalation opened",
      occurredAt: ISO("2026-06-19T17:00:00Z"),
      createdById: "system",
      verified: true,
    },
    {
      id: "act_005",
      accountId: "acc_005",
      contactId: "con_005",
      type: "intent_event",
      subject: "Security review started",
      occurredAt: ISO("2026-06-22T09:00:00Z"),
      createdById: "system",
      verified: true,
    },
  ];

  return {
    accounts,
    contacts,
    opportunities,
    activities,
    auditLog: [],
    analytics: [],
  };
}

/** Process-wide store singleton (in-memory). */
let store: DataStore | null = null;

export function getStore(): DataStore {
  if (!store) store = createSeedStore();
  return store;
}

/** Reset the store (used by deterministic evals for isolation). */
export function resetStore(next?: DataStore): DataStore {
  store = next ?? createSeedStore();
  return store;
}
