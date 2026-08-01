import type { GeneratedDraft } from "@repo/shared-schemas";
import type { VerifiedDraftContext, VerifiedDraftSignal } from "./build-draft-context";

export const DRAFT_GROUNDING_RULES_VERSION = "draft-grounding-v7";

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

const GROUPED_NUMERIC_PATTERN =
  /\p{Sc}?\p{N}{1,3}(?:,\p{N}{3})+(?:\.\p{N}+)?%?/gu;
const TOKEN_PATTERN =
  /\p{Sc}?\p{N}{1,3}(?:,\p{N}{3})+(?:\.\p{N}+)?%?|\p{Sc}?\p{N}+(?:\.\p{N}+)?%?|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/giu;
const NUMERIC_TOKEN_PATTERN = /^\p{Sc}?\p{N}+(?:\.\p{N}+)?%?$/u;

const canonicalToken = (token: string): string => {
  const lowered = token.toLowerCase().replace(/[’']/g, "");
  if (NUMERIC_TOKEN_PATTERN.test(lowered.replace(/,/g, ""))) {
    return lowered.replace(/,/g, "");
  }
  return lowered;
};

/**
 * Canonical lexical sequence used only for deterministic failure diagnostics.
 * Exact support is decided from the complete normalized description below so
 * punctuation, symbols, emoji, and other entity-bearing characters cannot be
 * discarded by tokenization.
 */
const canonicalTokens = (value: string): string[] =>
  (value.match(TOKEN_PATTERN) ?? []).map(canonicalToken);

const canonicalDescription = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(GROUPED_NUMERIC_PATTERN, (token) => token.replace(/,/g, ""))
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

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
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((token, index) => token === sortedRight[index]);
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
 * description under EVERY cited source id. Normalization is intentionally
 * narrow: Unicode compatibility form, case, apostrophe style, whitespace, and
 * grouped numeric separators. Meaning-bearing punctuation, symbols, emoji,
 * modality, negation, entity relationships, and numeric values remain part of
 * the exact evidence contract.
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

    const claimCanonical = canonicalDescription(sentence.text);
    const claimTokens = canonicalTokens(sentence.text);
    const claimNumbers = numericTokens(sentence.text);
    if (claimCanonical.length === 0 || claimTokens.length === 0) {
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
        const evidenceCanonical = canonicalDescription(signal.description);
        const evidenceTokens = canonicalTokens(signal.description);
        const evidenceNumbers = new Set(numericTokens(signal.description));
        const numbersMatch = claimNumbers.every((token) => evidenceNumbers.has(token));
        numericSupported ||= numbersMatch;

        if (claimCanonical === evidenceCanonical) {
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
