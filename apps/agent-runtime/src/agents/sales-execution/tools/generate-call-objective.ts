import type { Account, SourceSignal } from "@repo/shared-schemas";

/**
 * generate-call-objective — deterministic call prep text built only from
 * verified signals. No fabricated context (Rule #11). Internal-facing (the
 * objective is for the rep, not the customer).
 */
export function generateCallObjective(input: {
  account: Account;
  objective: string;
  signals: SourceSignal[];
}): string {
  const verified = input.signals.filter((s) => s.verified);
  const evidence =
    verified.length > 0
      ? verified.map((s) => `- ${s.description}`).join("\n")
      : "- No additional verified context on file.";
  return [
    `Call objective for ${input.account.name}:`,
    input.objective,
    "",
    "Verified context to reference:",
    evidence,
  ].join("\n");
}
