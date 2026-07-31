import type { Recommendation } from "./types";
import { MOCK_BLOCKED, accountProfile, accountValue, repName } from "./mock-data";
import { actionLabel, humanizeCode } from "./display";

/**
 * Manager-view rollups. Every figure here is derived from the same published
 * recommendations the reps see, so the coverage report cannot drift from the
 * run it describes.
 */

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export interface TeamTotals {
  accounts: number;
  pipeline: number;
  held: number;
  gated: number;
  avgConfidence: number;
  awaitingApproval: number;
}

export function teamTotals(recs: Recommendation[]): TeamTotals {
  const pipeline = recs.reduce((sum, r) => sum + accountValue(r.accountId), 0);
  const gated = recs.filter(
    (r) => r.nextBestAction.customerFacing || r.nextBestAction.crmWriteBack,
  ).length;
  const confidence = recs.reduce((sum, r) => sum + r.confidence, 0);
  return {
    accounts: recs.length,
    pipeline,
    held: MOCK_BLOCKED.length,
    gated,
    avgConfidence: recs.length ? confidence / recs.length : 0,
    awaitingApproval: recs.filter((r) => r.approvalStatus === "pending_approval").length,
  };
}

export interface RepRow {
  ownerId: string;
  name: string;
  accounts: number;
  pipeline: number;
  avgScore: number;
  avgConfidence: number;
  topAction: string;
  awaitingApproval: number;
  held: number;
}

export function repRollup(recs: Recommendation[]): RepRow[] {
  const byOwner = new Map<string, Recommendation[]>();
  for (const rec of recs) {
    const list = byOwner.get(rec.ownerId) ?? [];
    list.push(rec);
    byOwner.set(rec.ownerId, list);
  }

  const rows: RepRow[] = [...byOwner.entries()].map(([ownerId, owned]) => {
    const counts = new Map<string, number>();
    for (const r of owned) {
      const label = actionLabel(r.nextBestAction.type);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const topAction =
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

    return {
      ownerId,
      name: repName(ownerId),
      accounts: owned.length,
      pipeline: owned.reduce((sum, r) => sum + accountValue(r.accountId), 0),
      // Rounded here so the exported file carries clean numbers rather than
      // float artifacts like 0.7350000000000001.
      avgScore: round(owned.reduce((sum, r) => sum + r.score, 0) / owned.length, 2),
      avgConfidence: round(
        owned.reduce((sum, r) => sum + r.confidence, 0) / owned.length,
        3,
      ),
      topAction,
      awaitingApproval: owned.filter((r) => r.approvalStatus === "pending_approval").length,
      held: MOCK_BLOCKED.filter((b) => b.ownerId === ownerId).length,
    };
  });

  return rows.sort((a, b) => b.pipeline - a.pipeline);
}

/**
 * Signals that mean booked revenue is exposed to churn or non-renewal. An
 * account carrying any of these is revenue at risk; the rest is open pipeline.
 * Counting reason codes said nothing a manager could act on — splitting the
 * money into the two motions they already manage does.
 */
const AT_RISK_CODES = new Set([
  "churn_risk_detected",
  "renewal_approaching",
  "stale_no_contact",
  "data_quality_blocked",
]);

export type RevenueBucket = "atRisk" | "pipeline";

export function revenueBucket(rec: Recommendation): RevenueBucket {
  return rec.reasonCodes.some((c) => AT_RISK_CODES.has(c)) ? "atRisk" : "pipeline";
}

export interface RevenueItem {
  id: string;
  accountId: string;
  name: string;
  owner: string;
  value: number;
  drivers: string[];
}

export interface RevenueSplit {
  total: number;
  atRisk: { value: number; items: RevenueItem[] };
  pipeline: { value: number; items: RevenueItem[] };
}

/**
 * Revenue at risk vs open pipeline. Each account lands in exactly one bucket
 * and contributes its value once, so the two figures add to the total and the
 * split can be read as a share.
 */
export function revenueSplit(recs: Recommendation[]): RevenueSplit {
  const buckets: Record<RevenueBucket, RevenueItem[]> = { atRisk: [], pipeline: [] };

  for (const rec of recs) {
    const group = revenueBucket(rec);
    const relevant =
      group === "atRisk"
        ? rec.reasonCodes.filter((c) => AT_RISK_CODES.has(c))
        : rec.reasonCodes;
    buckets[group].push({
      id: rec.id,
      accountId: rec.accountId,
      name: accountProfile(rec.accountId)?.name ?? rec.accountId,
      owner: repName(rec.ownerId),
      value: accountValue(rec.accountId),
      drivers: relevant.map(humanizeCode),
    });
  }

  const sum = (items: RevenueItem[]) => items.reduce((t, i) => t + i.value, 0);
  const byValue = (a: RevenueItem, b: RevenueItem) => b.value - a.value;

  return {
    total: sum(buckets.atRisk) + sum(buckets.pipeline),
    atRisk: { value: sum(buckets.atRisk), items: buckets.atRisk.sort(byValue) },
    pipeline: { value: sum(buckets.pipeline), items: buckets.pipeline.sort(byValue) },
  };
}

/** Flat, self-describing rows for CSV / JSON export. */
export function exportRows(recs: Recommendation[]): Record<string, string | number>[] {
  return recs.map((rec) => {
    const profile = accountProfile(rec.accountId);
    return {
      rank: rec.rank,
      account_id: rec.accountId,
      account_name: profile?.name ?? rec.accountId,
      industry: profile?.industry ?? "",
      tier: profile?.tier ?? "",
      owner_id: rec.ownerId,
      owner_name: repName(rec.ownerId),
      score: rec.score,
      confidence: rec.confidence,
      reason_codes: rec.reasonCodes.join("|"),
      next_action: rec.nextBestAction.type,
      objective: rec.nextBestAction.objective,
      revenue_usd: accountValue(rec.accountId),
      approval_status: rec.approvalStatus,
      // Evidence travels with the row. A downloaded recommendation that cannot
      // be substantiated is just an assertion.
      evidence_count: rec.sourceSignals.length,
      evidence_verified: rec.sourceSignals.filter((s) => s.verified).length,
      evidence: rec.sourceSignals
        .map((s) => `${s.kind}:${s.refId}:${s.description}${s.verified ? "" : " (UNVERIFIED)"}`)
        .join(" | "),
      verification: rec.verification.status,
      run_id: rec.runId,
      created_at: rec.createdAt,
    };
  });
}
