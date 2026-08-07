import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRecommendationFollowupRequest,
  parseRecommendationFollowupState,
} from "./recommendation-followup-contract";

const workspaceId = "aaaaaaaa-0000-0000-0000-000000000001";
const eventId = "bbbbbbbb-0000-0000-0000-000000000002";

test("accepts bounded feedback, outcome, and explicit unknown requests", () => {
  assert.equal(
    parseRecommendationFollowupRequest({
      workspaceId,
      recommendationId: "rec-1",
      kind: "feedback",
      code: "accepted",
      expectedEventId: null,
    }).code,
    "accepted",
  );

  assert.equal(
    parseRecommendationFollowupRequest({
      workspaceId,
      recommendationId: "rec-1",
      kind: "outcome",
      code: "meeting_booked",
      expectedEventId: eventId,
    }).expectedEventId,
    eventId,
  );

  assert.equal(
    parseRecommendationFollowupRequest({
      workspaceId,
      recommendationId: "rec-1",
      kind: "unknown",
      code: "unknown",
      expectedEventId: eventId,
    }).kind,
    "unknown",
  );
});

test("rejects widened request shapes and invalid kind/code combinations", () => {
  assert.throws(() =>
    parseRecommendationFollowupRequest({
      workspaceId,
      recommendationId: "rec-1",
      kind: "outcome",
      code: "accepted",
      expectedEventId: null,
    }),
  );

  assert.throws(() =>
    parseRecommendationFollowupRequest({
      workspaceId,
      recommendationId: "rec-1",
      kind: "feedback",
      code: "accepted",
      expectedEventId: null,
      accountId: "not-authorized-browser-input",
    }),
  );
});

test("accepts only deterministic none or recorded result shapes", () => {
  assert.deepEqual(
    parseRecommendationFollowupState({
      status: "none",
      kind: null,
      code: null,
      eventId: null,
      recordedAt: null,
      replayed: false,
    }),
    {
      status: "none",
      kind: null,
      code: null,
      eventId: null,
      recordedAt: null,
      replayed: false,
    },
  );

  assert.equal(
    parseRecommendationFollowupState({
      status: "recorded",
      kind: "outcome",
      code: "closed_won",
      eventId,
      recordedAt: "2026-08-07T16:45:00.000Z",
      replayed: false,
    }).status,
    "recorded",
  );

  assert.throws(() =>
    parseRecommendationFollowupState({
      status: "recorded",
      kind: "outcome",
      code: "made_up",
      eventId,
      recordedAt: "2026-08-07T16:45:00.000Z",
      replayed: false,
    }),
  );
});
