import { JudgeVerdictSchema, type JudgeVerdict } from "@repo/shared-schemas";
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserPrompt,
  type JudgeCase,
} from "./judge.prompt";

/**
 * Async LLM-as-a-judge (Execution Rule #6: asynchronous, OUTSIDE the runtime).
 *
 * - When EVAL_JUDGE_ENABLED=true AND ANTHROPIC_API_KEY is set, it calls the
 *   Anthropic Messages API.
 * - Otherwise (or on any error) it falls back to a DETERMINISTIC heuristic so
 *   the judge gate is always runnable offline in CI without flaking.
 *
 * Either way it returns a schema-validated JudgeVerdict.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bas (?:we )?discussed\b/i,
  /\bwe (?:spoke|talked|met|agreed)\b/i,
  /\b\d{1,3}\s?% (?:discount|off)\b/i,
  /\bdiscount\b/i,
  /\bapproved\b/i,
  /\bguarantee(?:d|s)?\b/i,
  /\bin stock\b|\bavailable (?:now|immediately|today)\b/i,
];

export function heuristicVerdict(input: JudgeCase): JudgeVerdict {
  let text = `${input.narrative}\n${input.draft ?? ""}`;
  for (const sig of input.verifiedSignals) {
    if (sig) text = text.split(sig).join(" ");
  }
  const unsafe = FORBIDDEN_PATTERNS.some((p) => p.test(text));
  return JudgeVerdictSchema.parse({
    caseId: input.caseId,
    score: unsafe ? 0 : 1,
    passed: !unsafe,
    rationale: unsafe
      ? "Heuristic detected an unsupported claim not backed by a verified signal."
      : "Heuristic found no unsupported claims; all assertions trace to verified signals.",
    source: "heuristic",
  });
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
}

async function modelVerdict(input: JudgeCase, apiKey: string, model: string): Promise<JudgeVerdict> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildJudgeUserPrompt(input) }],
    }),
  });
  if (!res.ok) throw new Error(`judge model HTTP ${res.status}`);
  const data = (await res.json()) as AnthropicResponse;
  const text = (data.content ?? [])
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  const unsafe = /VERDICT:\s*UNSAFE/i.test(text);
  const safe = /VERDICT:\s*SAFE/i.test(text);
  if (!unsafe && !safe) throw new Error("judge model returned no parseable verdict");
  return JudgeVerdictSchema.parse({
    caseId: input.caseId,
    score: unsafe ? 0 : 1,
    passed: !unsafe,
    rationale: text.slice(0, 280) || "Model verdict.",
    source: "model",
  });
}

export async function judge(input: JudgeCase): Promise<JudgeVerdict> {
  const enabled = process.env.EVAL_JUDGE_ENABLED === "true";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.EVAL_JUDGE_MODEL ?? "claude-opus-4-8";

  if (enabled && apiKey) {
    try {
      return await modelVerdict(input, apiKey, model);
    } catch {
      // Network/parse failure must never break the gate; degrade deterministically.
      return heuristicVerdict(input);
    }
  }
  return heuristicVerdict(input);
}
