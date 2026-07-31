/**
 * Admin control-plane data.
 *
 * The administrative surface is an operations console, not a settings page: it
 * has to answer "is production healthy", "why did this recommendation happen",
 * and "what changes when I publish this". These shapes model that.
 *
 * The deterministic scorer and the generative drafter are modelled separately
 * on purpose. They fail differently, are measured differently, and roll back
 * differently, so they never share a screen or a release.
 */

export type Health = "healthy" | "degraded" | "failed";
export type ChangeState =
  | "draft"
  | "evaluating"
  | "approved"
  | "scheduled"
  | "live"
  | "paused"
  | "rolled_back";

/* ------------------------------------------------------------------ header */

export interface SystemState {
  environment: "Development" | "Staging" | "Production";
  policyVersion: string;
  promptVersion: string;
  lastRunAt: string;
  health: Health;
  recommendationsPaused: boolean;
  sendsPaused: boolean;
  activeIncidents: number;
}

export const SYSTEM: SystemState = {
  environment: "Production",
  policyVersion: "v12",
  promptVersion: "draft-2026.06.3",
  lastRunAt: "2:02 PM",
  health: "healthy",
  recommendationsPaused: false,
  sendsPaused: false,
  activeIncidents: 1,
};

/* ------------------------------------------------------- overview: health */

export interface Metric {
  label: string;
  value: string;
  delta?: string;
  tone?: "good" | "warn" | "bad";
  hint?: string;
}

export const OPERATIONAL_HEALTH: Metric[] = [
  { label: "CRM Sync Health", value: "Degraded", tone: "warn", hint: "HubSpot lagging 42m" },
  { label: "Accounts Evaluated", value: "1,284", delta: "+36 vs yesterday" },
  { label: "Signals Verified", value: "99.2%", tone: "good", hint: "31 rejected unverified" },
  { label: "Recommendations", value: "412", delta: "+18" },
  { label: "Guardrail Holds", value: "9", tone: "warn", hint: "2 awaiting review" },
  { label: "Run Failures", value: "1", tone: "bad", hint: "run_2026_06_25_0400" },
  { label: "Processing Latency", value: "3m 41s", hint: "p95 across the run" },
];

export const EFFECTIVENESS: Metric[] = [
  { label: "Rep Action Rate", value: "68%", delta: "+6 pts", tone: "good" },
  { label: "Acceptance Rate", value: "74%", delta: "+3 pts", tone: "good" },
  { label: "Dismissal Rate", value: "19%", delta: "−2 pts" },
  { label: "Override Rate", value: "7%", hint: "Rep changed the action" },
  { label: "Time to First Action", value: "41m", delta: "−12m", tone: "good" },
  { label: "Stage Movement", value: "23%", hint: "Opportunities advanced in 14d" },
  { label: "Renewal Saves", value: "11", hint: "At-risk renewals retained" },
  { label: "Lift vs Control", value: "+14%", tone: "good", hint: "Holdout cohort, 30d" },
];

export interface AttentionItem {
  label: string;
  count: number;
  href: string;
  tone: "warn" | "bad" | "good";
}

export const ATTENTION_QUEUE: AttentionItem[] = [
  { label: "Failed data sources", count: 1, href: "/admin/data", tone: "bad" },
  { label: "Stale fields", count: 4, href: "/admin/data", tone: "warn" },
  { label: "Held recommendations", count: 9, href: "/admin/guardrails", tone: "warn" },
  { label: "Failed evaluations", count: 2, href: "/admin/evals", tone: "bad" },
  { label: "Pending production changes", count: 1, href: "/admin/policy", tone: "warn" },
  { label: "Active incidents", count: 1, href: "/admin/audit", tone: "bad" },
  { label: "Unreviewed rep corrections", count: 12, href: "/admin/drafting", tone: "warn" },
];

/* ------------------------------------------------ data and integrations */

export interface Integration {
  id: string;
  name: string;
  status: Health;
  lastSync: string;
  lagMinutes: number;
  recordsProcessed: number;
  recordsRejected: number;
  missingRequiredFields: string[];
  duplicateRatePct: number;
  apiErrorRatePct: number;
  scope: string;
  owner: string;
  dependentRecommendations: number;
}

export const INTEGRATIONS: Integration[] = [
  {
    id: "salesforce",
    name: "Salesforce",
    status: "healthy",
    lastSync: "2:01 PM",
    lagMinutes: 3,
    recordsProcessed: 8412,
    recordsRejected: 27,
    missingRequiredFields: [],
    duplicateRatePct: 0.4,
    apiErrorRatePct: 0.1,
    scope: "read: Account, Contact, Opportunity, Task",
    owner: "RevOps · Dana Whitfield",
    dependentRecommendations: 6,
  },
  {
    id: "hubspot",
    name: "HubSpot Marketing",
    status: "degraded",
    lastSync: "1:20 PM",
    lagMinutes: 42,
    recordsProcessed: 1930,
    recordsRejected: 61,
    missingRequiredFields: ["contact.email_permission"],
    duplicateRatePct: 2.8,
    apiErrorRatePct: 4.2,
    scope: "read: Contact, EmailEvent",
    owner: "Marketing Ops · Sam Ito",
    dependentRecommendations: 3,
  },
  {
    id: "product_telemetry",
    name: "Product Telemetry",
    status: "failed",
    lastSync: "Yesterday 11:48 PM",
    lagMinutes: 874,
    recordsProcessed: 0,
    recordsRejected: 0,
    missingRequiredFields: ["event.account_id", "event.occurred_at"],
    duplicateRatePct: 0,
    apiErrorRatePct: 100,
    scope: "read: UsageEvent",
    owner: "Platform · Rae Nkemdirim",
    dependentRecommendations: 0,
  },
];

/** Recommendation -> Signal -> Source record -> Integration run. */
export interface LineageHop {
  layer: string;
  ref: string;
  detail: string;
}

export const LINEAGE_EXAMPLE: LineageHop[] = [
  { layer: "Recommendation", ref: "rec_1", detail: "Helios Manufacturing · rank 1 · score 73.63" },
  { layer: "Signal", ref: "sig_acc_001_pipeline", detail: "Open pipeline of $180,000 · verified" },
  { layer: "Source record", ref: "Account/0016000000ABCDE", detail: "Salesforce · OpenPipelineUsd" },
  { layer: "Integration run", ref: "sync_2026_06_25_1401", detail: "Salesforce · 8,412 records · 2:01 PM" },
];

/* -------------------------------------------------------- decision policy */

export interface PolicyFactor {
  factor: string;
  weight: number;
  trigger: string;
  maxContribution: number;
}

export const POLICY_FACTORS: PolicyFactor[] = [
  { factor: "Open pipeline", weight: 25, trigger: "Greater than $50,000", maxContribution: 25 },
  { factor: "Verified intent", weight: 20, trigger: "Event within 14 days", maxContribution: 20 },
  { factor: "Renewal proximity", weight: 15, trigger: "Renewal within 90 days", maxContribution: 15 },
  { factor: "Account tier", weight: 15, trigger: "Enterprise or Mid-market", maxContribution: 15 },
  { factor: "Contact inactivity", weight: 15, trigger: "No contact for 14 days", maxContribution: 15 },
  { factor: "Account health", weight: 10, trigger: "Health below 40", maxContribution: 10 },
];

export const POLICY_RULES: { label: string; value: string }[] = [
  { label: "Hard exclusions", value: "Closed-lost within 30 days · legal hold · opted out of contact" },
  { label: "Negative weights", value: "−10 when an open support escalation is unresolved" },
  { label: "Segment rules", value: "SMB requires 2+ verified signals to publish" },
  { label: "Account caps", value: "Max 3 recommendations per account per 7 days" },
  { label: "Duplicate signals", value: "Same signal kind collapses to the highest-value instance" },
  { label: "Minimum evidence", value: "1 verified signal; unverified evidence fails closed" },
  { label: "Tie-breaking", value: "Higher confidence, then larger revenue, then account id" },
  { label: "Priority bands", value: "High ≥ 65 · Medium 45–64 · Standard < 45" },
];

export interface PolicyVersion {
  version: string;
  state: ChangeState;
  owner: string;
  rationale: string;
  evalResult: string;
  approver: string;
  effective: string;
  rollbackTarget: string;
}

export const POLICY_VERSIONS: PolicyVersion[] = [
  {
    version: "v13",
    state: "evaluating",
    owner: "Dana Whitfield",
    rationale: "Raise renewal proximity so at-risk ARR outranks cold pipeline.",
    evalResult: "Running · 18 of 23 checks",
    approver: "—",
    effective: "—",
    rollbackTarget: "v12",
  },
  {
    version: "v12",
    state: "live",
    owner: "Dana Whitfield",
    rationale: "Add contact inactivity at 15% after Q1 churn review.",
    evalResult: "23 of 23 passed",
    approver: "Priya Raman",
    effective: "12 Jun 2026",
    rollbackTarget: "v11",
  },
  {
    version: "v11",
    state: "rolled_back",
    owner: "Sam Ito",
    rationale: "Trial of intent weighting at 30%.",
    evalResult: "21 of 23 passed · 2 regressions",
    approver: "Dana Whitfield",
    effective: "04 Jun 2026",
    rollbackTarget: "v10",
  },
];

/** What changes if the draft policy is published. */
export interface SimulationRow {
  account: string;
  owner: string;
  currentRank: number | "—";
  proposedRank: number | "—";
  revenue: number;
  change: "enters" | "leaves" | "up" | "down" | "same";
}

export const POLICY_SIMULATION: SimulationRow[] = [
  { account: "Larkspur Financial", owner: "Priya Raman", currentRank: 2, proposedRank: 1, revenue: 240000, change: "up" },
  { account: "Helios Manufacturing", owner: "Alex Rivera", currentRank: 1, proposedRank: 2, revenue: 180000, change: "down" },
  { account: "Bluepeak Energy", owner: "Marco Silva", currentRank: 7, proposedRank: 4, revenue: 30000, change: "up" },
  { account: "Tidewater Foods", owner: "Marco Silva", currentRank: "—", proposedRank: 6, revenue: 12000, change: "enters" },
  { account: "Vertex Health Systems", owner: "Marco Silva", currentRank: 3, proposedRank: 8, revenue: 95000, change: "down" },
];

export const SIMULATION_SUMMARY: Metric[] = [
  { label: "Accounts Re-ranked", value: "38 of 1,284" },
  { label: "Entering Top 25", value: "6", tone: "warn" },
  { label: "Leaving Top 25", value: "6" },
  { label: "Revenue Moved", value: "$412K" },
  { label: "Guardrail Holds", value: "9 → 11", tone: "warn" },
  { label: "Territory Concentration", value: "West +18%", tone: "warn", hint: "Check for skew" },
];

/* ----------------------------------------------------------- AI drafting */

export const DRAFTING_CONFIG: { label: string; value: string }[] = [
  { label: "Provider and model", value: "Anthropic · claude-sonnet-4-5" },
  { label: "Prompt template version", value: "draft-2026.06.3" },
  { label: "Structured output schema", value: "NextBestActionSchema (Zod, strict)" },
  { label: "Permitted evidence fields", value: "account.name, pipeline, renewal date, verified intent, health score" },
  { label: "Allowed action types", value: "send_email · call · schedule_meeting · log_research_note" },
  { label: "Approved channels", value: "Email draft only. No auto-send, no SMS, no social." },
  { label: "Tone and style", value: "Direct, specific, no superlatives, max 120 words" },
  { label: "Prohibited claims", value: "Pricing commitments · roadmap dates · competitor comparisons" },
  { label: "Sensitive data rules", value: "PII redacted before prompt; no health or payment fields" },
  { label: "Tool permissions", value: "Read verified signals only. No CRM write, no send." },
  { label: "Human approval", value: "Required for every customer-facing draft and CRM write" },
  { label: "Retry and fallback", value: "2 retries on schema failure, then no_action_hold" },
];

export const DRAFTING_EVALS: Metric[] = [
  { label: "Evidence Groundedness", value: "97.4%", tone: "good", hint: "Claims traceable to a verified signal" },
  { label: "Unsupported Claims", value: "0.9%", tone: "warn", hint: "Target below 1%" },
  { label: "Schema Validity", value: "99.8%", tone: "good" },
  { label: "Sensitive Data Leakage", value: "0", tone: "good" },
  { label: "Policy Compliance", value: "99.1%", tone: "good" },
  { label: "Correct Contact Usage", value: "98.6%", tone: "good" },
  { label: "Draft Edit Distance", value: "18%", hint: "Median rep edit before sending" },
  { label: "Approval Rate", value: "86%" },
  { label: "Top Rejection Reason", value: "Tone too formal", hint: "31% of rejections" },
  { label: "Latency (p95)", value: "2.4s" },
  { label: "Cost per Draft", value: "$0.004" },
];

/* -------------------------------------------------- evals and experiments */

export interface EvalSuite {
  name: string;
  kind: "deterministic" | "generative";
  passed: number;
  total: number;
  lastRun: string;
  status: Health;
}

export const EVAL_SUITES: EvalSuite[] = [
  { name: "Scoring determinism", kind: "deterministic", passed: 6, total: 6, lastRun: "2:02 PM", status: "healthy" },
  { name: "Ranking regression (golden set)", kind: "deterministic", passed: 9, total: 9, lastRun: "2:02 PM", status: "healthy" },
  { name: "Guardrail fail-closed", kind: "deterministic", passed: 8, total: 8, lastRun: "2:02 PM", status: "healthy" },
  { name: "Draft groundedness (LLM judge)", kind: "generative", passed: 46, total: 48, lastRun: "1:40 PM", status: "degraded" },
  { name: "Prohibited claim detection", kind: "generative", passed: 23, total: 24, lastRun: "1:40 PM", status: "degraded" },
];

export interface Experiment {
  name: string;
  state: ChangeState;
  cohort: string;
  metric: string;
  control: string;
  variant: string;
  lift: string;
  significance: string;
}

export const EXPERIMENTS: Experiment[] = [
  {
    name: "Renewal proximity weight 15% → 20%",
    state: "live",
    cohort: "30% of reps",
    metric: "Renewal saves per 100 accounts",
    control: "8.1",
    variant: "9.3",
    lift: "+14%",
    significance: "p = 0.03",
  },
  {
    name: "Shorter email drafts (80 word cap)",
    state: "evaluating",
    cohort: "15% of reps",
    metric: "Reply rate",
    control: "11.2%",
    variant: "11.6%",
    lift: "+3.6%",
    significance: "p = 0.21 · not significant",
  },
];

/* ------------------------------------------------ guardrails and approvals */

export interface Hold {
  id: string;
  account: string;
  accountId: string;
  owner: string;
  proposedAction: string;
  failedRule: string;
  explanation: string;
  evidence: string;
  severity: "low" | "medium" | "high";
  recommendedResolution: string;
  reviewer: string;
  heldFor: string;
  status: "open" | "escalated" | "resolved";
}

export const HOLDS: Hold[] = [
  {
    id: "hold_1",
    account: "Pinecrest Logistics",
    accountId: "acc_004",
    owner: "Alex Rivera",
    proposedAction: "Send email",
    failedRule: "confidence_below_floor",
    explanation:
      "Confidence 0.14 is under the 0.2 publish floor, so the recommendation was never shown to the rep.",
    evidence: "1 verified signal · account health only",
    severity: "medium",
    recommendedResolution: "Wait for the next sync; a second signal will likely clear the floor.",
    reviewer: "Unassigned",
    heldFor: "2h 14m",
    status: "open",
  },
  {
    id: "hold_2",
    account: "Tidewater Foods",
    accountId: "acc_009",
    owner: "Marco Silva",
    proposedAction: "Send email",
    failedRule: "communication_permission_unavailable",
    explanation:
      "A draft was generated, but the selected contact has no verified email permission on record.",
    evidence: "2 verified signals · contact permission missing from HubSpot",
    severity: "high",
    recommendedResolution: "Fix the HubSpot permission mapping, or switch the action to a call.",
    reviewer: "Dana Whitfield",
    heldFor: "6h 02m",
    status: "escalated",
  },
  {
    id: "hold_3",
    account: "Quarry Software",
    accountId: "acc_007",
    owner: "Priya Raman",
    proposedAction: "CRM write-back",
    failedRule: "data_quality_blocked",
    explanation: "Owner id missing on two source records, so evidence could not be verified.",
    evidence: "0 verified signals",
    severity: "high",
    recommendedResolution: "Reprocess the Salesforce sync after the owner backfill.",
    reviewer: "Unassigned",
    heldFor: "1d 3h",
    status: "open",
  },
];

/* ----------------------------------------------------- runs and inspector */

export interface ScoreContribution {
  factor: string;
  raw: string;
  weight: number;
  contribution: number;
}

export interface RunRecord {
  id: string;
  startedAt: string;
  environment: string;
  dataSnapshot: string;
  policyVersion: string;
  promptVersion: string;
  accountsEvaluated: number;
  published: number;
  held: number;
  status: Health;
  durationSec: number;
}

export const RUNS: RunRecord[] = [
  {
    id: "run_2026_06_25_1400",
    startedAt: "25 Jun 2:00 PM",
    environment: "Production",
    dataSnapshot: "snap_1401",
    policyVersion: "v12",
    promptVersion: "draft-2026.06.3",
    accountsEvaluated: 1284,
    published: 412,
    held: 9,
    status: "healthy",
    durationSec: 221,
  },
  {
    id: "run_2026_06_25_0800",
    startedAt: "25 Jun 8:00 AM",
    environment: "Production",
    dataSnapshot: "snap_0801",
    policyVersion: "v12",
    promptVersion: "draft-2026.06.2",
    accountsEvaluated: 1281,
    published: 408,
    held: 7,
    status: "healthy",
    durationSec: 214,
  },
  {
    id: "run_2026_06_25_0400",
    startedAt: "25 Jun 4:00 AM",
    environment: "Production",
    dataSnapshot: "snap_0401",
    policyVersion: "v12",
    promptVersion: "draft-2026.06.2",
    accountsEvaluated: 0,
    published: 0,
    held: 0,
    status: "failed",
    durationSec: 12,
  },
];

/** One decision, reconstructed end to end. */
export const INSPECTED = {
  runId: "run_2026_06_25_1400",
  recommendationId: "rec_1",
  account: "Helios Manufacturing",
  accountId: "acc_001",
  owner: "Alex Rivera",
  policyVersion: "v12",
  promptVersion: "draft-2026.06.3",
  dataSnapshot: "snap_1401",
  finalScore: 73.63,
  finalRank: 1,
  confidence: 0.83,
  contributions: [
    { factor: "Open pipeline", raw: "$180,000", weight: 25, contribution: 25 },
    { factor: "Verified intent", raw: "pricing_page_visit, 2d ago", weight: 20, contribution: 20 },
    { factor: "Account tier", raw: "Enterprise", weight: 15, contribution: 15 },
    { factor: "Contact inactivity", raw: "9 days", weight: 15, contribution: 0 },
    { factor: "Renewal proximity", raw: "No renewal within 90d", weight: 15, contribution: 0 },
    { factor: "Account health", raw: "72", weight: 10, contribution: 0 },
  ] as ScoreContribution[],
  reasonCodes: ["high_open_pipeline", "verified_intent_signal", "stalled_opportunity"],
  guardrails: [
    { gate: "Schema valid", result: "pass" },
    { gate: "Source signals verified", result: "pass" },
    { gate: "Permission granted", result: "pass" },
    { gate: "Confidence floor", result: "pass" },
    { gate: "Prohibited claims", result: "pass" },
  ],
  approvals: [{ actor: "Alex Rivera", decision: "approved", at: "25 Jun 2:14 PM" }],
  crmWrites: [] as { target: string; at: string }[],
  outcome: "Email sent by rep · opportunity advanced to negotiation on 27 Jun",
};

/* ------------------------------------------------------------ users, audit */

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "Rep" | "Manager" | "Admin" | "Auditor";
  team: string;
  accountAccess: string;
  lastActive: string;
}

export const USERS: AdminUser[] = [
  { id: "u1", name: "Alex Rivera", email: "alex@example.com", role: "Rep", team: "West Enterprise", accountAccess: "Own book (3)", lastActive: "2:31 PM" },
  { id: "u2", name: "Priya Raman", email: "priya@example.com", role: "Rep", team: "East Mid-market", accountAccess: "Own book (2)", lastActive: "1:58 PM" },
  { id: "u3", name: "Marco Silva", email: "marco@example.com", role: "Rep", team: "West Mid-market", accountAccess: "Own book (2)", lastActive: "12:40 PM" },
  { id: "u4", name: "Dana Whitfield", email: "dana@example.com", role: "Admin", team: "RevOps", accountAccess: "All accounts", lastActive: "2:29 PM" },
  { id: "u5", name: "Jordan Ford", email: "jordan@example.com", role: "Manager", team: "West", accountAccess: "West territory", lastActive: "11:04 AM" },
  { id: "u6", name: "Compliance Bot", email: "audit@example.com", role: "Auditor", team: "Risk", accountAccess: "Audit read-only", lastActive: "2:00 PM" },
];

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export const AUDIT_EVENTS: AuditEvent[] = [
  { id: "a1", at: "25 Jun 2:14 PM", actor: "Alex Rivera", action: "approve_customer_action", target: "rec_1", detail: "Approved email draft for Helios Manufacturing" },
  { id: "a2", at: "25 Jun 2:02 PM", actor: "system", action: "publish_recommendation", target: "run_2026_06_25_1400", detail: "412 published, 9 held" },
  { id: "a3", at: "25 Jun 2:02 PM", actor: "system", action: "block_recommendation", target: "acc_004", detail: "confidence_below_floor (0.14 < 0.20)" },
  { id: "a4", at: "25 Jun 9:31 AM", actor: "Dana Whitfield", action: "create_policy_draft", target: "policy v13", detail: "Renewal proximity 15% → 20%" },
  { id: "a5", at: "24 Jun 4:12 PM", actor: "Dana Whitfield", action: "rollback_policy", target: "policy v11 → v12", detail: "2 ranking regressions in golden set" },
];

export interface Incident {
  id: string;
  title: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  state: "open" | "mitigated" | "closed";
  opened: string;
  owner: string;
  impact: string;
}

export const INCIDENTS: Incident[] = [
  {
    id: "INC-104",
    title: "Product telemetry connector failing authentication",
    severity: "SEV2",
    state: "open",
    opened: "24 Jun 11:48 PM",
    owner: "Rae Nkemdirim",
    impact: "Usage signals unavailable. No recommendations depend on them, so scoring is unaffected.",
  },
  {
    id: "INC-103",
    title: "04:00 run failed on snapshot timeout",
    severity: "SEV3",
    state: "mitigated",
    opened: "25 Jun 4:00 AM",
    owner: "Platform on-call",
    impact: "One run skipped. The 08:00 run covered the same accounts.",
  },
];

/* ------------------------------------------------------------ environments */

export interface EnvRow {
  name: string;
  policyVersion: string;
  promptVersion: string;
  lastRelease: string;
  status: ChangeState;
  autoPublish: boolean;
}

export const ENVIRONMENTS: EnvRow[] = [
  { name: "Production", policyVersion: "v12", promptVersion: "draft-2026.06.3", lastRelease: "12 Jun 2026", status: "live", autoPublish: false },
  { name: "Staging", policyVersion: "v13", promptVersion: "draft-2026.06.4", lastRelease: "25 Jun 2026", status: "evaluating", autoPublish: true },
  { name: "Development", policyVersion: "v13", promptVersion: "draft-2026.06.4", lastRelease: "25 Jun 2026", status: "draft", autoPublish: true },
];
