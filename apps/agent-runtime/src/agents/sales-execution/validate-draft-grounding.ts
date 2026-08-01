import type { GeneratedDraft } from "@repo/shared-schemas";
import type { VerifiedDraftContext, VerifiedDraftSignal } from "./build-draft-context";

export const DRAFT_GROUNDING_RULES_VERSION = "draft-grounding-v3";

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

const NEGATION_TOKENS = new Set([
  "no",
  "not",
  "never",
  "none",
  "neither",
  "nor",
  "without",
  "cannot",
  "cant",
  "isnt",
  "wasnt",
  "werent",
  "hasnt",
  "havent",
  "hadnt",
  "doesnt",
  "dont",
  "didnt",
  "wont",
  "wouldnt",
  "couldnt",
  "shouldnt",
]);

const normalizedTokens = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9$%.-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);

const significantTokens = (value: string): string[] =>
  normalizedTokens(value).filter(
    (token) => token.length > 1 && !STOP_WORDS.has(token),
  );

const numericTokens = (value: string): string[] =>
  value.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];

const hasNegation = (value: string): boolean =>
  normalizedTokens(value).some((token) => NEGATION_TOKENS.has(token));

const groupSignalsById = (
  signals: VerifiedDraftSignal[],
): Map<string, VerifiedDraftSignal[]> => {
  const grouped = new Map<string, VerifiedDraftSignal[]>();
  for (const signal of signals) {
    const existing = grouped.get(signal.id);
    if (existing) existing.push(signal);
    else grouped.set(signal.id, [signal]);
  }
  return grouped;
};

/**
 * Conservative deterministic grounding check. A sentence must cite only source
 * ids supplied to the model, preserve action authority, and be fully supported
 * by at least one complete verified description under every cited source id.
 * Negation polarity must also match; deleting "no"/"not" or adding negation to
 * positive evidence therefore fails closed instead of reversing the source fact.
 * Multiple verified signals may share one source-record id and are all retained.
 */
export function validateDraftGrounding(
  draft: GeneratedDraft,
  context: VerifiedDraftContext,
): DraftGroundingResult {
  const failures = new Set<string>();

  if (draft.actionType !== context.actionType) {
    failures.add("DRAFT_ACTION_MUTATION");
  }

  const signalsById = groupSignalsById(context.signals);

  for (const sentence of draft.sentences) {
    const citedIds = [...new Set(sentence.sourceSignalIds)];
    const citedGroups = citedIds.map((id) => signalsById.get(id));

    if (citedGroups.some((group) => group === undefined) || citedGroups.length === 0) {
      failures.add("DRAFT_UNKNOWN_SOURCE_REFERENCE");
      continue;
    }

    const claimTokens = significantTokens(sentence.text);
    if (claimTokens.length === 0) {
      failures.add("DRAFT_CLAIM_NOT_GROUNDED");
      continue;
    }

    const claimContentTokens = claimTokens.filter(
      (token) => !NEGATION_TOKENS.has(token),
    );
    const claimNumbers = numericTokens(sentence.text);
    const claimIsNegated = hasNegation(sentence.text);

    for (const group of citedGroups) {
      if (!group) continue;

      let fullySupported = false;
      let contentSupportedWithOppositePolarity = false;
      let numericSupported = false;

      for (const signal of group) {
        const evidenceTokens = new Set(significantTokens(signal.description));
        const evidenceNumbers = new Set(numericTokens(signal.description));
        const numbersMatch = claimNumbers.every((token) => evidenceNumbers.has(token));
        const contentMatches = claimContentTokens.every((token) =>
          evidenceTokens.has(token),
        );
        const allTokensMatch = claimTokens.every((token) => evidenceTokens.has(token));
        const polarityMatches = claimIsNegated === hasNegation(signal.description);

        numericSupported ||= numbersMatch;
        if (contentMatches && numbersMatch && !polarityMatches) {
          contentSupportedWithOppositePolarity = true;
        }
        if (allTokensMatch && numbersMatch && polarityMatches) {
          fullySupported = true;
          break;
        }
      }

      if (fullySupported) continue;
      if (!numericSupported && claimNumbers.length > 0) {
        failures.add("DRAFT_UNSUPPORTED_NUMBER");
      }
      if (contentSupportedWithOppositePolarity) {
        failures.add("DRAFT_POLARITY_MISMATCH");
      } else {
        failures.add("DRAFT_CLAIM_NOT_GROUNDED");
      }
    }
  }

  return { passed: failures.size === 0, failedGates: [...failures].sort() };
}

export const renderGroundedDraft = (draft: GeneratedDraft): string =>
  draft.sentences.map((sentence) => sentence.text.trim()).join(" ");
