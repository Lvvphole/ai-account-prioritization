import type { Recommendation } from "@repo/shared-schemas";
import type { AccountContext } from "../account-prioritizer/prioritizer.policy";

export const DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS = 90;
const MS_PER_DAY = 86_400_000;

export interface VerifiedDraftSignal {
  id: string;
  kind: Recommendation["sourceSignals"][number]["kind"];
  description: string;
}

/**
 * Not exported. `VerifiedDraftContext` carries no `verified` flag or timestamp
 * of its own — by design, per the minimum-context requirement, it must not
 * carry enough to let a consumer re-derive freshness from raw account data.
 * That means the verified/fresh guarantee has nowhere to be rechecked once
 * built; it can only be established once, here, and then trusted. This brand
 * makes that literal: only this module can produce a value of the type, so a
 * future caller cannot hand-construct a `VerifiedDraftContext` and skip
 * `assertFreshSelectedEvidence`/the unverified-signal check below. Object
 * spread (`{ ...verified, signals: subset }`, used to trim a context to a
 * token budget) still works, since the brand travels with the spread.
 *
 * Type-only: `declare const` emits no runtime value, so the branded property
 * is never actually constructed with a computed key — it exists only for the
 * type checker. `buildVerifiedDraftContext` asserts it in with `as`, exactly
 * once, at the single legitimate construction site.
 */
declare const VERIFIED_DRAFT_CONTEXT_BRAND: unique symbol;

export interface VerifiedDraftContext {
  readonly [VERIFIED_DRAFT_CONTEXT_BRAND]: true;
  recommendationId: string;
  accountId: string;
  accountName: string;
  actionType: Recommendation["nextBestAction"]["type"];
  objective: string;
  signals: VerifiedDraftSignal[];
}

export interface DraftContextLimits {
  maxSignals?: number;
  /** Injected deterministic clock. Defaults to the recommendation creation time. */
  now?: string;
  /** Maximum evidence age. Omission uses the fail-closed runtime default. */
  maxEvidenceAgeDays?: number;
}

const ACTION_SIGNAL_PRIORITY: Record<
  Recommendation["nextBestAction"]["type"],
  Recommendation["sourceSignals"][number]["kind"][]
> = {
  call: ["opportunity", "intent", "activity", "contact", "account", "derived"],
  schedule_meeting: ["opportunity", "intent", "activity", "contact", "account", "derived"],
  send_email: ["opportunity", "intent", "activity", "contact", "account", "derived"],
  log_research_note: ["derived", "account", "opportunity", "intent", "activity", "contact"],
  request_intro: ["contact", "activity", "account", "opportunity", "intent", "derived"],
  escalate_to_manager: ["derived", "account", "opportunity", "activity", "intent", "contact"],
  no_action_hold: ["derived", "account", "opportunity", "intent", "activity", "contact"],
};

const sourceObservedAt = (
  signal: Recommendation["sourceSignals"][number],
  ctx: AccountContext,
): string | undefined => {
  switch (signal.kind) {
    case "account":
    case "derived":
      return signal.refId === ctx.account.id ? ctx.account.updatedAt : undefined;
    case "contact":
      return ctx.contacts.find((contact) => contact.id === signal.refId)?.updatedAt;
    case "opportunity":
      return ctx.opportunities.find((opportunity) => opportunity.id === signal.refId)?.updatedAt;
    case "activity":
    case "intent":
      return ctx.activities.find((activity) => activity.id === signal.refId)?.occurredAt;
    default:
      return undefined;
  }
};

const assertFreshSelectedEvidence = (
  signal: Recommendation["sourceSignals"][number],
  ctx: AccountContext,
  now: string,
  maxEvidenceAgeDays: number,
): void => {
  const observedAt = sourceObservedAt(signal, ctx);
  if (!observedAt) {
    throw new Error("DRAFT_CONTEXT_SOURCE_UNRESOLVED");
  }

  const ageMs = Date.parse(now) - Date.parse(observedAt);
  if (!Number.isFinite(ageMs)) {
    throw new Error("DRAFT_CONTEXT_SOURCE_TIME_INVALID");
  }
  if (ageMs < 0) {
    throw new Error("DRAFT_CONTEXT_FUTURE_SIGNAL");
  }
  if (ageMs > maxEvidenceAgeDays * MS_PER_DAY) {
    throw new Error("DRAFT_CONTEXT_STALE_SIGNAL");
  }
};

/**
 * Build the minimum model-visible packet. Raw contacts, activities, opportunity
 * objects, notes, emails, and other unneeded CRM fields are deliberately omitted.
 * Verified evidence is stably prioritized for the authorized action and can be
 * capped before any model request is constructed. Every selected signal is
 * resolved back to its source record and must be neither future-dated nor older
 * than the supplied freshness policy or the fail-closed 90-day default.
 */
export function buildVerifiedDraftContext(
  rec: Recommendation,
  ctx: AccountContext,
  limits: DraftContextLimits = {},
): VerifiedDraftContext {
  if (rec.sourceSignals.length === 0 || rec.sourceSignals.some((signal) => !signal.verified)) {
    throw new Error("DRAFT_CONTEXT_UNVERIFIED_SIGNAL");
  }

  const priorities = ACTION_SIGNAL_PRIORITY[rec.nextBestAction.type];
  const maxSignals = limits.maxSignals ?? rec.sourceSignals.length;
  const now = limits.now ?? rec.createdAt;
  const maxEvidenceAgeDays =
    limits.maxEvidenceAgeDays ?? DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS;
  const selected = rec.sourceSignals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => {
      const priorityDelta = priorities.indexOf(a.signal.kind) - priorities.indexOf(b.signal.kind);
      return priorityDelta !== 0 ? priorityDelta : a.index - b.index;
    })
    .slice(0, maxSignals);

  if (selected.length === 0) {
    throw new Error("DRAFT_CONTEXT_UNVERIFIED_SIGNAL");
  }

  for (const { signal } of selected) {
    assertFreshSelectedEvidence(signal, ctx, now, maxEvidenceAgeDays);
  }

  const signals = selected.map(({ signal }) => ({
    id: signal.refId,
    kind: signal.kind,
    description: signal.description,
  }));

  return {
    recommendationId: rec.id,
    accountId: rec.accountId,
    accountName: ctx.account.name,
    actionType: rec.nextBestAction.type,
    objective: rec.nextBestAction.objective,
    signals,
  } as VerifiedDraftContext;
}
