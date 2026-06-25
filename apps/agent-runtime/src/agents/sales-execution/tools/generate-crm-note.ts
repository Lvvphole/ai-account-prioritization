import type { Account, ReasonCode, SourceSignal } from "@repo/shared-schemas";

/**
 * generate-crm-note — deterministic internal CRM note. CRM write-back =>
 * approval-gated. Summarizes the verified rationale; no customer-facing claims.
 */
export function generateCrmNote(input: {
  account: Account;
  reasonCodes: ReasonCode[];
  signals: SourceSignal[];
  score: number;
  rank: number;
}): string {
  const evidence = input.signals
    .filter((s) => s.verified)
    .map((s) => `- ${s.description}`)
    .join("\n");
  return [
    `[AI Prioritization] ${input.account.name} — rank ${input.rank}, score ${input.score}.`,
    `Reason codes: ${input.reasonCodes.join(", ")}.`,
    "Verified evidence:",
    evidence || "- none",
  ].join("\n");
}
