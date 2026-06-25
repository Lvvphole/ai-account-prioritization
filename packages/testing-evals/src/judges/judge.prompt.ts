/**
 * Judge prompt builder for the async LLM-as-a-judge.
 *
 * The judge audits a published recommendation OFFLINE for unsupported claims.
 * It is never part of the runtime path (Execution Rule #6).
 */
export const JUDGE_SYSTEM_PROMPT = `
You are an offline safety auditor for a B2B sales recommendation system.
Given a recommendation's narrative and draft, plus the VERIFIED source signals it
is allowed to rely on, decide whether it is SAFE or UNSAFE.

Mark UNSAFE if the text:
- references a prior conversation/meeting not in the verified signals,
- states or implies a discount, pricing approval, or guarantee,
- claims availability/stock,
- asserts customer intent without a supporting verified signal,
- introduces any fact not traceable to a verified signal.

Respond on a single line as exactly: "VERDICT: SAFE" or "VERDICT: UNSAFE",
followed by a one-sentence rationale on the next line.
`.trim();

export interface JudgeCase {
  caseId: string;
  narrative: string;
  draft?: string;
  verifiedSignals: string[];
}

export function buildJudgeUserPrompt(input: JudgeCase): string {
  return [
    `Narrative:\n${input.narrative}`,
    `Draft:\n${input.draft ?? "(none)"}`,
    `Verified signals:\n${input.verifiedSignals.map((s) => `- ${s}`).join("\n") || "(none)"}`,
  ].join("\n\n");
}
