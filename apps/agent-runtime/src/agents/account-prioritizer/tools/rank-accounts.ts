import { RUNTIME_CONFIG } from "../../../config/runtime";
import type { ScoredAccount } from "./score-accounts";

/**
 * rank-accounts — DETERMINISTIC ranking (Execution Rules #1, #2).
 *
 * Stable ordering: by score descending, ties broken by accountId ascending so
 * the rank is fully reproducible and never depends on input order or the LLM.
 */
export interface RankedAccount extends ScoredAccount {
  rank: number;
}

export function rankAccounts(scored: ScoredAccount[]): RankedAccount[] {
  const sorted = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
  });

  const limited = sorted.slice(0, RUNTIME_CONFIG.maxRecommendations);
  return limited.map((s, i) => ({ ...s, rank: i + 1 }));
}
