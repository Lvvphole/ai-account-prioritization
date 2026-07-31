import type { NextBestAction } from "./types";

/**
 * Presentation helpers. These turn the runtime's machine-shaped contract
 * (snake_case enums, raw scores) into labels a rep can read at a glance —
 * without changing any of the underlying values.
 */

/** Action type union, derived from the schema so it can't drift. */
type NextBestActionType = NextBestAction["type"];

const ACTION_LABEL: Record<NextBestActionType, string> = {
  send_email: "Email",
  call: "Call",
  schedule_meeting: "Meeting",
  log_research_note: "Research",
  request_intro: "Intro",
  escalate_to_manager: "Escalate",
  no_action_hold: "Hold",
};

const ACTION_ICON: Record<NextBestActionType, string> = {
  send_email: "✉",
  call: "☎",
  schedule_meeting: "▤",
  log_research_note: "✎",
  request_intro: "⇄",
  escalate_to_manager: "▲",
  no_action_hold: "—",
};

export function actionLabel(type: NextBestActionType): string {
  return ACTION_LABEL[type] ?? type;
}

export function actionIcon(type: NextBestActionType): string {
  return ACTION_ICON[type] ?? "•";
}

/** `high_open_pipeline` → `High open pipeline`. */
export function humanizeCode(code: string): string {
  const spaced = code.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface PriorityTier {
  label: string;
  tone: "high" | "medium" | "low";
}

/** Bucket a 0–100 deterministic score into a tier a human can act on. */
export function priorityTier(score: number): PriorityTier {
  if (score >= 65) return { label: "High priority", tone: "high" };
  if (score >= 45) return { label: "Medium priority", tone: "medium" };
  return { label: "Standard", tone: "low" };
}

export function formatUsd(amount: number): string {
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${amount}`;
}

/**
 * Evidence confidence: how complete and verified the supporting data is.
 *
 * Deliberately NOT rendered as a bare percentage beside the priority score.
 * Two adjacent numbers ("73.6" and "83%") read as a calibrated likelihood of
 * winning the account, which this system does not compute. Priority score
 * compares accounts with each other; evidence confidence describes the data
 * underneath. Neither is a win probability.
 */
export interface EvidenceBand {
  label: string;
  tone: "high" | "medium" | "low";
}

export function evidenceBand(confidence: number): EvidenceBand {
  if (confidence >= 0.75) return { label: "High evidence confidence", tone: "high" };
  if (confidence >= 0.5) return { label: "Medium evidence confidence", tone: "medium" };
  return { label: "Limited evidence", tone: "low" };
}

/** The one-line disclaimer that keeps the two numbers from being conflated. */
export const NOT_A_WIN_PROBABILITY =
  "Priority ranks accounts against each other. Evidence confidence describes the data behind the rank. Neither is a probability of winning the account.";
