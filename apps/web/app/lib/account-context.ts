/**
 * Customer-workspace context.
 *
 * The ranked list answers "what should I do". This module carries everything
 * needed to answer the other three questions a rep actually has: why should I
 * do it, can I trust it, and what happens next.
 *
 * Signal provenance lives here rather than on the recommendation because a rep
 * inspecting evidence needs the source system, the source record and when it
 * was observed — not just the sentence describing it.
 */

/* ------------------------------------------------------------- provenance */

export interface SignalProvenance {
  /** Matches SourceSignal.refId on the recommendation. */
  refId: string;
  sourceSystem: string;
  sourceRecord: string;
  observed: string;
  /** Verified against the source record, or derived from other verified facts. */
  basis: "verified" | "derived";
}

const PROVENANCE: SignalProvenance[] = [
  { refId: "acc_001", sourceSystem: "Salesforce", sourceRecord: "Account/0016000000ABCDE", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "act_002", sourceSystem: "First-party web", sourceRecord: "Event/evt_88213", observed: "2 hours ago", basis: "verified" },
  { refId: "acc_003", sourceSystem: "Salesforce", sourceRecord: "Account/0016000000CDEFG", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "acc_005", sourceSystem: "Salesforce", sourceRecord: "Account/0016000000HIJKL", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "acc_006", sourceSystem: "Salesforce", sourceRecord: "Account/0016000000MNOPQ", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "acc_007", sourceSystem: "Salesforce", sourceRecord: "Account/0016000000RSTUV", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "acc_008", sourceSystem: "Salesforce", sourceRecord: "Account/0016000000WXYZA", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "act_011", sourceSystem: "First-party web", sourceRecord: "Event/evt_91044", observed: "Yesterday, 4:12 PM", basis: "verified" },
  { refId: "opp_002", sourceSystem: "Salesforce", sourceRecord: "Opportunity/0066000000BCDEF", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "opp_006", sourceSystem: "Salesforce", sourceRecord: "Opportunity/0066000000GHIJK", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "opp_007", sourceSystem: "Salesforce", sourceRecord: "Opportunity/0066000000LMNOP", observed: "Today, 2:01 PM", basis: "verified" },
  { refId: "opp_008", sourceSystem: "Salesforce", sourceRecord: "Opportunity/0066000000QRSTU", observed: "Today, 2:01 PM", basis: "verified" },
];

const DERIVED_FALLBACK: Omit<SignalProvenance, "refId"> = {
  sourceSystem: "Derived",
  sourceRecord: "CRM stage + activity history",
  observed: "Today, 2:02 PM",
  basis: "derived",
};

export function provenanceFor(refId: string): SignalProvenance {
  return PROVENANCE.find((p) => p.refId === refId) ?? { refId, ...DERIVED_FALLBACK };
}

/* -------------------------------------------------------- workflow state */

/**
 * Where a rep has taken a recommendation. Distinct from approvalStatus, which
 * is the safety gate: an approved recommendation can still be unworked.
 */
export type WorkflowState =
  | "not_started"
  | "drafted"
  | "approved"
  | "completed"
  | "dismissed";

export const WORKFLOW_LABEL: Record<WorkflowState, string> = {
  not_started: "Not started",
  drafted: "Drafted",
  approved: "Approved",
  completed: "Completed",
  dismissed: "Dismissed",
};

export interface WorkspaceMeta {
  workflow: WorkflowState;
  freshness: string;
  /** Communication or coverage restriction that limits what may be done. */
  restriction?: string;
}

const WORKSPACE: Record<string, WorkspaceMeta> = {
  acc_001: { workflow: "drafted", freshness: "Updated 18 minutes ago" },
  acc_006: { workflow: "not_started", freshness: "Updated 22 minutes ago" },
  acc_005: { workflow: "not_started", freshness: "Updated 41 minutes ago" },
  acc_003: { workflow: "approved", freshness: "Updated 18 minutes ago" },
  acc_007: { workflow: "not_started", freshness: "Updated 1 hour ago" },
  acc_002: { workflow: "completed", freshness: "Updated 3 hours ago" },
  acc_008: {
    workflow: "dismissed",
    freshness: "Updated 2 hours ago",
    restriction: "Marketing email suppression active until 12 Jul",
  },
};

export function workspaceMeta(accountId: string): WorkspaceMeta {
  return WORKSPACE[accountId] ?? { workflow: "not_started", freshness: "Updated today" };
}

/* ---------------------------------------------------------- account context */

export interface Contact {
  name: string;
  title: string;
  decisionMaker: boolean;
  lastEngaged: string;
  emailPermission: boolean;
}

export interface TimelineEntry {
  when: string;
  kind: "activity" | "opportunity" | "contract" | "support" | "recommendation";
  detail: string;
}

export interface AccountContext {
  contract: {
    renewalDate: string;
    termMonths: number;
    seats: number;
    products: string;
    arrUsd: number;
  };
  contacts: Contact[];
  timeline: TimelineEntry[];
  openSupport: string[];
  priorRecommendations: { when: string; action: string; outcome: string }[];
  exclusions: string[];
}

const CONTEXT: Record<string, AccountContext> = {
  acc_001: {
    contract: {
      renewalDate: "14 Mar 2027",
      termMonths: 12,
      seats: 240,
      products: "Core platform, Analytics add-on",
      arrUsd: 310000,
    },
    contacts: [
      { name: "Dana Osei", title: "VP Operations", decisionMaker: true, lastEngaged: "9 days ago", emailPermission: true },
      { name: "Ravi Menon", title: "Plant Systems Lead", decisionMaker: false, lastEngaged: "3 weeks ago", emailPermission: true },
      { name: "Chen Liu", title: "Procurement", decisionMaker: false, lastEngaged: "Never", emailPermission: false },
    ],
    timeline: [
      { when: "2 hours ago", kind: "activity", detail: "Pricing page visit from dana.osei@ (first-party web event)" },
      { when: "9 days ago", kind: "activity", detail: "Discovery call with Dana Osei · 32 minutes" },
      { when: "21 days ago", kind: "opportunity", detail: "Opportunity \"Helios Line 3 Expansion\" entered Proposal, unchanged since" },
      { when: "6 weeks ago", kind: "recommendation", detail: "Recommended email · sent · reply received in 2 days" },
    ],
    openSupport: [],
    priorRecommendations: [
      { when: "6 weeks ago", action: "Send email", outcome: "Sent · reply in 2 days · opportunity created" },
      { when: "3 months ago", action: "Schedule meeting", outcome: "Meeting booked · advanced to discovery" },
    ],
    exclusions: [],
  },
  acc_003: {
    contract: {
      renewalDate: "30 Sep 2026",
      termMonths: 12,
      seats: 45,
      products: "Core platform",
      arrUsd: 85000,
    },
    contacts: [
      { name: "Marta Reyes", title: "Director of Data", decisionMaker: true, lastEngaged: "56 days ago", emailPermission: true },
      { name: "Owen Blake", title: "Analytics Manager", decisionMaker: false, lastEngaged: "4 months ago", emailPermission: true },
    ],
    timeline: [
      { when: "Today", kind: "support", detail: "Health score fell to 31 (below the 40 churn-risk threshold)" },
      { when: "11 days ago", kind: "support", detail: "Escalation opened: report latency on scheduled exports" },
      { when: "56 days ago", kind: "activity", detail: "Last logged contact · email, no reply" },
    ],
    openSupport: ["ESC-2291 · Report latency on scheduled exports · 11 days open"],
    priorRecommendations: [
      { when: "5 weeks ago", action: "Send email", outcome: "Sent · no reply" },
    ],
    exclusions: [],
  },
  acc_008: {
    contract: {
      renewalDate: "09 Aug 2026",
      termMonths: 12,
      seats: 30,
      products: "Core platform",
      arrUsd: 30000,
    },
    contacts: [
      { name: "Priya Shah", title: "Operations Manager", decisionMaker: true, lastEngaged: "18 days ago", emailPermission: false },
    ],
    timeline: [
      { when: "Today", kind: "contract", detail: "Renewal in 45 days" },
      { when: "18 days ago", kind: "activity", detail: "Support call · billing question" },
    ],
    openSupport: [],
    priorRecommendations: [],
    exclusions: ["Marketing email suppression active until 12 Jul"],
  },
};

const EMPTY_CONTEXT: AccountContext = {
  contract: { renewalDate: "—", termMonths: 12, seats: 0, products: "Core platform", arrUsd: 0 },
  contacts: [],
  timeline: [],
  openSupport: [],
  priorRecommendations: [],
  exclusions: [],
};

export function accountContext(accountId: string): AccountContext {
  return CONTEXT[accountId] ?? EMPTY_CONTEXT;
}

/* ------------------------------------------------------------- outcomes */

/**
 * Outcome data. Without it the product can rank accounts but cannot show
 * whether the ranking improved anything, which is the category most often
 * missing from systems like this.
 */
export interface OutcomeRecord {
  accountId: string;
  recommendedAt: string;
  action: string;
  outcome:
    | "meeting_booked"
    | "opportunity_advanced"
    | "renewal_completed"
    | "expansion"
    | "closed_won"
    | "closed_lost"
    | "churned"
    | "no_response";
  valueUsd: number;
  daysToOutcome: number;
}

export const OUTCOMES: OutcomeRecord[] = [
  { accountId: "acc_001", recommendedAt: "6 weeks ago", action: "Send email", outcome: "opportunity_advanced", valueUsd: 180000, daysToOutcome: 2 },
  { accountId: "acc_002", recommendedAt: "5 weeks ago", action: "Schedule meeting", outcome: "renewal_completed", valueUsd: 60000, daysToOutcome: 9 },
  { accountId: "acc_005", recommendedAt: "7 weeks ago", action: "Call", outcome: "meeting_booked", valueUsd: 95000, daysToOutcome: 1 },
  { accountId: "acc_003", recommendedAt: "5 weeks ago", action: "Send email", outcome: "no_response", valueUsd: 0, daysToOutcome: 14 },
  { accountId: "acc_007", recommendedAt: "9 weeks ago", action: "Send email", outcome: "expansion", valueUsd: 45000, daysToOutcome: 21 },
];

export const OUTCOME_LABEL: Record<OutcomeRecord["outcome"], string> = {
  meeting_booked: "Meeting booked",
  opportunity_advanced: "Opportunity advanced",
  renewal_completed: "Renewal completed",
  expansion: "Expansion",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
  churned: "Churned",
  no_response: "No response",
};

/* ------------------------------------------------------------- feedback */

/**
 * Feedback reasons, each paired with what it actually changes. Telling a user
 * their input "helps improve the model" without saying when or how is not
 * meaningful consent.
 */
export const FEEDBACK_REASONS: { reason: string; effect: string }[] = [
  { reason: "Signal is incorrect", effect: "Holds this recommendation and opens a data-quality review on the source record." },
  { reason: "Already contacted", effect: "Marks this one complete and suppresses the account for 7 days." },
  { reason: "Action is not appropriate", effect: "Changes this recommendation only. Counted in the next policy review." },
  { reason: "Wrong contact or channel", effect: "Changes this recommendation and updates contact preference for the account." },
  { reason: "Timing is wrong", effect: "Snoozes the account for a period you choose." },
  { reason: "Account should be excluded", effect: "Enters an approval queue. An admin applies the exclusion." },
  { reason: "This produced an outcome", effect: "Records the outcome against the recommendation and feeds effectiveness reporting." },
];
