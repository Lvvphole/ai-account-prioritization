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

const RELATION_FILLERS = new Set(["a", "an", "the"]);
const ACTION_SUFFIXES = new Set([
  "visit",
  "visited",
  "request",
  "requested",
  "start",
  "started",
  "open",
  "opened",
  "submit",
  "submitted",
  "download",
  "downloaded",
  "view",
  "viewed",
  "click",
  "clicked",
  "complete",
  "completed",
  "begin",
  "began",
  "initiate",
  "initiated",
]);
const NEGATING_TERMS = new Set([
  "no",
  "not",
  "never",
  "without",
  "cannot",
  "cant",
  "didnt",
  "doesnt",
  "isnt",
  "wasnt",
  "wont",
  "cancelled",
  "canceled",
  "aborted",
  "rejected",
  "declined",
]);

const wordMatches = (expected: string, observed: string): boolean => {
  if (expected === observed) return true;
  // Deterministically tolerate simple inflection/expansion such as
  // visit -> visited, request -> requested, and exec -> executive without
  // allowing short-token prefix collisions.
  if (Math.min(expected.length, observed.length) < 4) return false;
  return expected.startsWith(observed) || observed.startsWith(expected);
};

const containsSequence = (expected: string[], observed: string[]): boolean => {
  if (expected.length === 0 || expected.length > observed.length) return false;
  for (let start = 0; start <= observed.length - expected.length; start += 1) {
    if (
      expected.every((token, offset) =>
        wordMatches(token, observed[start + offset] ?? ""),
      )
    ) {
      return true;
    }
  }
  return false;
};

const relationshipVariants = (expected: string[]): string[][] => {
  const variants = [expected];
  const last = expected.at(-1);
  // Structured signal codes commonly use object_then_action ordering while
  // human event subjects use action_then_object (pricing_page_visit ->
  // "Visited pricing page"). Permit only that bounded action-suffix rotation;
  // do not accept arbitrary token permutations.
  if (expected.length > 1 && last && ACTION_SUFFIXES.has(last)) {
    variants.push([last, ...expected.slice(0, -1)]);
  }
  return variants;
};

const fieldEncodesSignalRelationship = (value: string, signalCode: string): boolean => {
  const expected = words(signalCode);
  if (expected.length === 0) return false;

  const rawObserved = words(value);
  if (rawObserved.length === 0 || rawObserved.some((word) => NEGATING_TERMS.has(word))) {
    return false;
  }
  const observed = rawObserved.filter((word) => !RELATION_FILLERS.has(word));
  return relationshipVariants(expected).some((variant) =>
    containsSequence(variant, observed),
  );
};

const compareOrdinal = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function activityMatchesSignal(activity: Activity, signalCode: string): boolean {
  // A complete intent relationship must be encoded within one source field.
  // Never combine unrelated subject/body tokens into a synthetic observation.
  return [activity.subject, activity.body].some(
    (field) => typeof field === "string" && fieldEncodesSignalRelationship(field, signalCode),
  );
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
        return byTime !== 0 ? byTime : compareOrdinal(left.id, right.id);
      });
    const activity = matching[0];
    return activity ? [{ signalCode, activity }] : [];
  });
}
