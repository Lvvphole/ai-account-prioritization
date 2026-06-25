/**
 * Prioritizer prompt constants.
 *
 * CRITICAL CONTRACT: the LLM is a NARRATOR, not a RANKER (Execution Rule #1).
 * It receives the already-computed deterministic score, rank, reason codes, and
 * verified source signals, and may only phrase them into readable language. It
 * must never reorder accounts, change scores, or introduce facts.
 *
 * In this deterministic build the narrative is produced by a template (see
 * prioritizer.agent.ts) so the runtime stays offline-safe and reproducible; the
 * prompt below documents the constraints a hosted model would be held to.
 */
export const PRIORITIZER_SYSTEM_PROMPT = `
You are a sales-narration assistant. You will be given, for a single account:
- a deterministic priority SCORE and RANK (already computed; do not change them),
- a closed set of REASON CODES,
- a list of VERIFIED SOURCE SIGNALS.

Rules:
1. You MUST NOT rank, re-rank, or compare accounts. Ranking is decided upstream.
2. You MUST NOT invent facts, dates, prior conversations, discounts, approvals,
   availability, or customer intent. Use only the provided verified signals.
3. Every claim you make must trace to a provided source signal.
4. Keep it concise, factual, and free of speculation.
Output: a short narrative explaining why this account is a priority today.
`.trim();

/** Phrasing for each closed reason code (deterministic narrative building). */
export const REASON_CODE_PHRASES: Record<string, string> = {
  high_open_pipeline: "carries significant open pipeline",
  verified_intent_signal: "shows recent verified buying intent",
  stale_no_contact: "has gone without logged contact",
  renewal_approaching: "has an approaching renewal",
  champion_engaged: "has an engaged champion",
  churn_risk_detected: "shows churn-risk indicators",
  new_executive_buyer: "has an engaged executive buyer",
  strategic_tier_account: "is a strategic-tier account",
  stalled_opportunity: "has an open opportunity that needs a next step",
  data_quality_blocked: "has data-quality gaps to resolve first",
};
