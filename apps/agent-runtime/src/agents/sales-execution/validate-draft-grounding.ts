import type { GeneratedDraft } from "@repo/shared-schemas";
import type { VerifiedDraftContext, VerifiedDraftSignal } from "./build-draft-context";

export const DRAFT_GROUNDING_RULES_VERSION = "draft-grounding-v2";

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
 * ids supplied to the model, preserve action authority, and receive full lexical
 * and numeric support from every cited source id. Multiple verified signals may
 * share one source-record id; all descriptions for that id are preserved. This
 * intentionally rejects paraphrases containing unsupported factual tokens rather
 * than allowing unsupported content to be diluted by a support ratio.
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

    const claimNumbers = numericTokens(sentence.text);

    for (const group of citedGroups) {
      if (!group) continue;
      const evidenceText = group.map((item) => item.description).join(" ");
      const evidenceTokens = new Set(significantTokens(evidenceText));

      if (claimTokens.some((token) => !evidenceTokens.has(token))) {
        failures.add("DRAFT_CLAIM_NOT_GROUNDED");
      }

      const evidenceNumbers = new Set(numericTokens(evidenceText));
      if (claimNumbers.some((token) => !evidenceNumbers.has(token))) {
        failures.add("DRAFT_UNSUPPORTED_NUMBER");
      }
    }
  }

  return { passed: failures.size === 0, failedGates: [...failures].sort() };
}

export const renderGroundedDraft = (draft: GeneratedDraft): string =>
  draft.sentences.map((sentence) => sentence.text.trim()).join(" ");
