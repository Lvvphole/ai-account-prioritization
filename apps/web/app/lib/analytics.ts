import type { Recommendation } from "./types";
import { MOCK_BLOCKED, accountProfile, repName } from "./mock-data";
import { actionLabel, humanizeCode, pipelineValue } from "./display";

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
  const pipeline = recs.reduce((sum, r) => sum + pipelineValue(r), 0);
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
      pipeline: owned.reduce((sum, r) => sum + pipelineValue(r), 0),
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

export interface TriggerRow {
  code: string;
  label: string;
  count: number;
  total: number;
  /** Fraction of accounts in the run that fired this code. */
  share: number;
}

/** What is actually driving today's list, by reason code. */
export function triggerBreakdown(recs: Recommendation[]): TriggerRow[] {
  const counts = new Map<string, number>();
  for (const rec of recs) {
    for (const code of rec.reasonCodes) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  // Share is out of the accounts in the run, not out of the most common code,
  // so a full bar means "every account fired this".
  const total = Math.max(1, recs.length);
  return [...counts.entries()]
    .map(([code, count]) => ({
      code,
      label: humanizeCode(code),
      count,
      total: recs.length,
      share: count / total,
    }))
    .sort((a, b) => b.count - a.count);
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
      pipeline_usd: pipelineValue(rec),
      approval_status: rec.approvalStatus,
      verification: rec.verification.status,
      run_id: rec.runId,
      created_at: rec.createdAt,
    };
  });
}
