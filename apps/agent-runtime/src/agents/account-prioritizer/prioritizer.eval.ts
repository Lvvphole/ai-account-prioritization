import type { Account } from "@repo/shared-schemas";
import type { AccountContext } from "./prioritizer.policy";
import { scoreAccount, scoreAccounts } from "./tools/score-accounts";
import { rankAccounts } from "./tools/rank-accounts";
import { generateReasonCodes } from "./tools/generate-reason-codes";
import { selectNextBestAction } from "./tools/select-next-best-action";
import { computeConfidence, extractFeatures } from "./prioritizer.policy";

/**
 * Deterministic eval cases for the prioritizer (Sprint 3 exit gate).
 *
 * These are plain functions (NO vitest dependency) so they can be imported and
 * executed by @repo/testing-evals while living co-located with the agent. They
 * assert the hard invariants: determinism, evidence availability, monotonicity,
 * stable ranking, and "the LLM cannot rank".
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
    id: "missing_health_is_unavailable_not_neutral",
    run: () => {
      const base = {
        id: "a1",
        tier: "strategic" as const,
        lifecycleStage: "churn_risk" as const,
        openPipelineUsd: 250_000,
        daysSinceLastContact: 30,
      };
      const missing = scoreAccount(ctx(base));
      const inventedNeutral = scoreAccount(ctx({ ...base, healthScore: 50 }));
      return {
        passed:
          missing.features.availability.healthRisk === false &&
          missing.features.healthRisk === 0 &&
          missing.score > inventedNeutral.score,
        details: `missing=${missing.score} neutral=${inventedNeutral.score}`,
      };
    },
  },
  {
    id: "missing_contact_history_is_not_maximal_staleness",
    run: () => {
      const features = extractFeatures(ctx({ id: "a1" }));
      return {
        passed: features.availability.staleness === false && features.staleness === 0,
        details: `available=${features.availability.staleness} value=${features.staleness}`,
      };
    },
  },
  {
    id: "connector_modes_remove_unsupported_default_features",
    run: () => {
      const featureModes = {
        pipeline: "derived",
        intent: "unavailable",
        staleness: "unavailable",
        tier: "unavailable",
        lifecycle: "unavailable",
        healthRisk: "unavailable",
      } as const;
      const highDefaults: AccountContext = {
        ...ctx({
          id: "a_high",
          openPipelineUsd: 100_000,
          tier: "strategic",
          lifecycleStage: "churn_risk",
          daysSinceLastContact: 365,
          healthScore: 0,
        }),
        featureModes,
      };
      const lowDefaults: AccountContext = {
        ...ctx({
          id: "a_low",
          openPipelineUsd: 100_000,
          tier: "smb",
          lifecycleStage: "prospect",
          daysSinceLastContact: 0,
          healthScore: 100,
        }),
        featureModes,
      };
      const high = scoreAccount(highDefaults);
      const low = scoreAccount(lowDefaults);
      const codes = generateReasonCodes(highDefaults, high.features);
      return {
        passed:
          high.score === low.score &&
          high.features.availability.pipeline === true &&
          high.features.availability.intent === false &&
          high.features.availability.staleness === false &&
          high.features.availability.tier === false &&
          high.features.availability.lifecycle === false &&
          high.features.availability.healthRisk === false &&
          !codes.includes("strategic_tier_account") &&
          !codes.includes("churn_risk_detected") &&
          !codes.includes("stale_no_contact"),
        details: `high=${high.score} low=${low.score} codes=${codes.join(",")}`,
      };
    },
  },
  {
    id: "optional_health_does_not_reduce_confidence",
    run: () => {
      const base = ctx({
        id: "a1",
        employeeCount: 100,
        annualRevenueUsd: 1_000_000,
        daysSinceLastContact: 5,
      });
      const withHealth = {
        ...base,
        account: { ...base.account, healthScore: 70 },
      };
      const without = computeConfidence(base);
      const present = computeConfidence(withHealth);
      return { passed: without === present, details: `without=${without} with=${present}` };
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
    id: "low_signal_account_uses_neutral_hold",
    run: () => {
      const c = ctx({
        id: "a1",
        tier: "smb",
        lifecycleStage: "prospect",
        openPipelineUsd: 0,
        employeeCount: 25,
        annualRevenueUsd: 500_000,
        daysSinceLastContact: 1,
        healthScore: 90,
      });
      const codes = generateReasonCodes(c, extractFeatures(c));
      const action = selectNextBestAction(c, codes, 1, 0.6);
      return {
        passed:
          codes.length === 1 &&
          codes[0] === "no_qualifying_signal" &&
          action.type === "no_action_hold" &&
          action.customerFacing === false &&
          action.crmWriteBack === false,
        details: `codes=${codes.join(",")} action=${action.type}`,
      };
    },
  },
  {
    id: "actual_data_quality_flags_remain_blocked",
    run: () => {
      const c = ctx({
        id: "a1",
        tier: "smb",
        lifecycleStage: "prospect",
        dataQualityFlags: ["missing_primary_contact"],
      });
      const codes = generateReasonCodes(c, extractFeatures(c));
      const action = selectNextBestAction(c, codes, 1, 0.6);
      return {
        passed:
          codes.includes("data_quality_blocked") &&
          !codes.includes("no_qualifying_signal") &&
          action.type === "log_research_note" &&
          action.crmWriteBack === true,
        details: `codes=${codes.join(",")} action=${action.type}`,
      };
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
