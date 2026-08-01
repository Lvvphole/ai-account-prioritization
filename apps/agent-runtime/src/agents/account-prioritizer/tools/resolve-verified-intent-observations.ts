import type { Account, Activity } from "@repo/shared-schemas";

export interface VerifiedIntentObservation {
  signalCode: string;
  activity: Activity;
}

const words = (value: string): string[] =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .match(/[\p{L}\p{N}]+/gu) ?? [];

const wordMatches = (expected: string, observed: string): boolean => {
  if (expected === observed) return true;
  // Deterministically tolerate simple inflection/expansion such as
  // visit -> visited, request -> requested, and exec -> executive without
  // allowing short-token prefix collisions.
  if (Math.min(expected.length, observed.length) < 4) return false;
  return expected.startsWith(observed) || observed.startsWith(expected);
};

function activityMatchesSignal(activity: Activity, signalCode: string): boolean {
  const expected = words(signalCode);
  if (expected.length === 0) return false;
  const observed = words(`${activity.subject ?? ""} ${activity.body ?? ""}`);
  if (observed.length === 0) return false;
  return expected.every((token) => observed.some((word) => wordMatches(token, word)));
}

/**
 * Resolve account-level intent codes back to verified intent-event observations.
 * A code without traceable event text is excluded from recommendation authority
 * rather than borrowing another event's id/timestamp. When the same intent was
 * observed more than once, the newest matching verified observation is used.
 */
export function resolveVerifiedIntentObservations(
  account: Pick<Account, "id" | "intentSignals">,
  activities: Activity[],
): VerifiedIntentObservation[] {
  const verifiedIntentEvents = activities.filter(
    (activity) =>
      activity.accountId === account.id &&
      activity.type === "intent_event" &&
      activity.verified,
  );

  return account.intentSignals.flatMap((signalCode) => {
    const matching = verifiedIntentEvents
      .filter((activity) => activityMatchesSignal(activity, signalCode))
      .sort((left, right) => {
        const byTime = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
        return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
      });
    const activity = matching[0];
    return activity ? [{ signalCode, activity }] : [];
  });
}
