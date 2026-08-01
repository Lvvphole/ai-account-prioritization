import type { GeneratedDraft } from "@repo/shared-schemas";
import type { VerifiedDraftContext } from "./build-draft-context";

export interface DraftGroundingResult {
  passed: boolean;
  failedGates: string[];
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
  "you",
  "your",
]);

const significantTokens = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9$%.-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

const numericTokens = (value: string): string[] =>
  value.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];

/**
 * Conservative deterministic grounding check. A sentence must cite only source
 * ids supplied to the model, preserve action authority, keep every number inside
 * cited evidence, and have high lexical support from that evidence. This may
 * reject useful paraphrases; safety takes precedence over recall.
 */
export function validateDraftGrounding(
  draft: GeneratedDraft,
  context: VerifiedDraftContext,
): DraftGroundingResult {
  const failures = new Set<string>();

  if (draft.actionType !== context.actionType) {
    failures.add("DRAFT_ACTION_MUTATION");
  }

  const signalById = new Map(context.signals.map((signal) => [signal.id, signal]));

  for (const sentence of draft.sentences) {
    const cited = sentence.sourceSignalIds
      .map((id) => signalById.get(id))
      .filter((value): value is NonNullable<typeof value> => value !== undefined);

    if (cited.length !== sentence.sourceSignalIds.length || cited.length === 0) {
      failures.add("DRAFT_UNKNOWN_SOURCE_REFERENCE");
      continue;
    }

    const evidenceText = cited.map((item) => item.description).join(" ");
    const evidenceTokens = new Set(significantTokens(evidenceText));
    const claimTokens = significantTokens(sentence.text);
    const unsupported = claimTokens.filter((token) => !evidenceTokens.has(token));
    const supportRatio =
      claimTokens.length === 0 ? 0 : (claimTokens.length - unsupported.length) / claimTokens.length;

    if (supportRatio < 0.8) {
      failures.add("DRAFT_CLAIM_NOT_GROUNDED");
    }

    const evidenceNumbers = new Set(numericTokens(evidenceText));
    if (numericTokens(sentence.text).some((token) => !evidenceNumbers.has(token))) {
      failures.add("DRAFT_UNSUPPORTED_NUMBER");
    }
  }

  return { passed: failures.size === 0, failedGates: [...failures].sort() };
}

export const renderGroundedDraft = (draft: GeneratedDraft): string =>
  draft.sentences.map((sentence) => sentence.text.trim()).join(" ");
