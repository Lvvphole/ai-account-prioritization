import type { Account } from "@repo/shared-schemas";
import type { AccountContext } from "./prioritizer.policy";
import { scoreAccount, scoreAccounts } from "./tools/score-accounts";
import { rankAccounts } from "./tools/rank-accounts";
import { generateReasonCodes } from "./tools/generate-reason-codes";
import { extractFeatures } from "./prioritizer.policy";

/**
 * Deterministic eval cases for the prioritizer (Sprint 3 exit gate).
 *
 * These are plain functions (NO vitest dependency) so they can be imported and
 * executed by @repo/testing-evals while living co-located with the agent. They
 * assert the hard invariants: determinism, monotonicity, stable ranking, and
 * "the LLM cannot rank" (ranking is a pure function of deterministic scores).
 */
export interface DeterministicEvalCase {
  id: string;
  run: () => { passed: boolean; details?: string };
}

const ISO = "2026-06-25T00:00:00Z";

function account(overrides: Partial<Account>): Account {
  return {
    id: overrides.id ?? "acc_test",
    name: overrides.name ?? "Test Account",
    ownerId: overrides.ownerId ?? "rep_x",
    tier: overrides.tier ?? "mid_market",
    lifecycleStage: overrides.lifecycleStage ?? "open_opportunity",
    openPipelineUsd: overrides.openPipelineUsd ?? 0,
    intentSignals: overrides.intentSignals ?? [],
    dataQualityFlags: overrides.dataQualityFlags ?? [],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function ctx(overrides: Partial<Account>): AccountContext {
  return { account: account(overrides), contacts: [], opportunities: [], activities: [] };
}

export const prioritizerEvalCases: DeterministicEvalCase[] = [
  {
    id: "deterministic_scoring",
    run: () => {
      const c = ctx({ id: "a1", openPipelineUsd: 100_000, intentSignals: ["x"] });
      const s1 = scoreAccount(c).score;
      const s2 = scoreAccount(c).score;
      return { passed: s1 === s2, details: `s1=${s1} s2=${s2}` };
    },
  },
  {
    id: "monotonic_pipeline",
    run: () => {
      const low = scoreAccount(ctx({ id: "a1", openPipelineUsd: 10_000 })).score;
      const high = scoreAccount(ctx({ id: "a1", openPipelineUsd: 200_000 })).score;
      return { passed: high > low, details: `low=${low} high=${high}` };
    },
  },
  {
    id: "rank_independent_of_input_order",
    run: () => {
      const a = ctx({ id: "a", openPipelineUsd: 200_000, tier: "strategic" });
      const b = ctx({ id: "b", openPipelineUsd: 50_000, tier: "smb" });
      const order1 = rankAccounts(scoreAccounts([a, b])).map((r) => r.accountId);
      const order2 = rankAccounts(scoreAccounts([b, a])).map((r) => r.accountId);
      const same = JSON.stringify(order1) === JSON.stringify(order2);
      return { passed: same, details: `o1=${order1} o2=${order2}` };
    },
  },
  {
    id: "stable_tiebreak_by_account_id",
    run: () => {
      const a = ctx({ id: "z_acc", tier: "mid_market", lifecycleStage: "prospect" });
      const b = ctx({ id: "a_acc", tier: "mid_market", lifecycleStage: "prospect" });
      const ranked = rankAccounts(scoreAccounts([a, b]));
      const first = ranked[0];
      return {
        passed: first?.accountId === "a_acc",
        details: `first=${first?.accountId}`,
      };
    },
  },
  {
    id: "min_one_reason_code",
    run: () => {
      const c = ctx({ id: "a1", tier: "smb", lifecycleStage: "dormant", openPipelineUsd: 0 });
      const codes = generateReasonCodes(c, extractFeatures(c));
      return { passed: codes.length >= 1, details: `codes=${codes.join(",")}` };
    },
  },
  {
    id: "confidence_within_bounds",
    run: () => {
      const c = ctx({ id: "a1", dataQualityFlags: ["missing_primary_contact"] });
      const conf = scoreAccount(c).confidence;
      return { passed: conf >= 0 && conf <= 1, details: `conf=${conf}` };
    },
  },
];
