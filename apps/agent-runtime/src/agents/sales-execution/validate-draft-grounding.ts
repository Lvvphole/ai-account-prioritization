import type { GeneratedDraft } from "@repo/shared-schemas";
import type { VerifiedDraftContext, VerifiedDraftSignal } from "./build-draft-context";

export const DRAFT_GROUNDING_RULES_VERSION = "draft-grounding-v5";

export interface DraftGroundingResult {
  passed: boolean;
  failedGates: string[];
}

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

const TOKEN_PATTERN =
  /\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\$?\d+(?:\.\d+)?%?|[a-z0-9]+(?:['’][a-z0-9]+)?/gi;
const NUMERIC_TOKEN_PATTERN = /^\$?\d+(?:\.\d+)?%?$/;

const canonicalToken = (token: string): string => {
  const lowered = token.toLowerCase().replace(/[’']/g, "");
  if (NUMERIC_TOKEN_PATTERN.test(lowered.replace(/,/g, ""))) {
    return lowered.replace(/,/g, "");
  }
  return lowered;
};

/**
 * Canonical lexical sequence used for fail-closed semantic grounding.
 * Function words are deliberately retained because modality and relationship
 * words such as "may", "over", and "by" can change the meaning of a claim.
 * Grouped numeric values are tokenized atomically (`$50,000` -> `$50000`).
 */
const canonicalTokens = (value: string): string[] =>
  (value.match(TOKEN_PATTERN) ?? []).map(canonicalToken);

const numericTokens = (value: string): string[] =>
  canonicalTokens(value).filter((token) => NUMERIC_TOKEN_PATTERN.test(token));

const withoutNegation = (tokens: string[]): string[] =>
  tokens.filter((token) => !NEGATION_TOKENS.has(token));

const hasNegation = (tokens: string[]): boolean =>
  tokens.some((token) => NEGATION_TOKENS.has(token));

const sameSequence = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((token, index) => token === right[index]);

const sameMultiset = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  return [...left].sort().every((token, index) => token === [...right].sort()[index]);
};

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
 * Conservative deterministic grounding check.
 *
 * A generated factual sentence must preserve one complete verified evidence
 * description after canonical punctuation/amount normalization under EVERY cited
 * source id. The model may select and order verified facts, but it may not omit,
 * substitute, reorder, or paraphrase factual tokens. This intentionally trades
 * linguistic freedom for deterministic semantic safety: modality, negation,
 * entity relationships, function words, and numeric values remain coupled to
 * the source statement instead of being validated as an unordered token bag.
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

    const claimTokens = canonicalTokens(sentence.text);
    const claimNumbers = numericTokens(sentence.text);
    if (claimTokens.length === 0) {
      failures.add("DRAFT_CLAIM_NOT_GROUNDED");
      continue;
    }

    for (const group of citedGroups) {
      if (!group) continue;

      let exactSupported = false;
      let numericSupported = claimNumbers.length === 0;
      let polarityMismatch = false;
      let relationshipMismatch = false;

      for (const signal of group) {
        const evidenceTokens = canonicalTokens(signal.description);
        const evidenceNumbers = new Set(numericTokens(signal.description));
        const numbersMatch = claimNumbers.every((token) => evidenceNumbers.has(token));
        numericSupported ||= numbersMatch;

        if (sameSequence(claimTokens, evidenceTokens)) {
          exactSupported = true;
          break;
        }

        if (
          numbersMatch &&
          sameSequence(withoutNegation(claimTokens), withoutNegation(evidenceTokens)) &&
          hasNegation(claimTokens) !== hasNegation(evidenceTokens)
        ) {
          polarityMismatch = true;
        }

        if (
          numbersMatch &&
          hasNegation(claimTokens) === hasNegation(evidenceTokens) &&
          sameMultiset(claimTokens, evidenceTokens) &&
          !sameSequence(claimTokens, evidenceTokens)
        ) {
          relationshipMismatch = true;
        }
      }

      if (exactSupported) continue;
      if (!numericSupported) {
        failures.add("DRAFT_UNSUPPORTED_NUMBER");
      } else if (polarityMismatch) {
        failures.add("DRAFT_POLARITY_MISMATCH");
      } else if (relationshipMismatch) {
        failures.add("DRAFT_RELATIONSHIP_MISMATCH");
      } else {
        failures.add("DRAFT_CLAIM_NOT_GROUNDED");
      }
    }
  }

  return { passed: failures.size === 0, failedGates: [...failures].sort() };
}

export const renderGroundedDraft = (draft: GeneratedDraft): string =>
  draft.sentences.map((sentence) => sentence.text.trim()).join(" ");
