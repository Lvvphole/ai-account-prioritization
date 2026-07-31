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
