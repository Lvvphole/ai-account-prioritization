import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOMMENDATION_FOLLOWUP_CONTRACT_VERSION,
  RecommendationOutcomeCodeSchema,
} from "@repo/shared-schemas";
import {
  OUTCOME_CODES,
  parseRecommendationFollowupRequest,
  parseRecommendationFollowupState,
  recommendationFollowupRpcStatus,
} from "./recommendation-followup-contract";

const workspaceId = "aaaaaaaa-0000-0000-0000-000000000001";
const eventId = "bbbbbbbb-0000-0000-0000-000000000002";

test("uses the canonical shared follow-up contract and outcome vocabulary", () => {
  assert.equal(RECOMMENDATION_FOLLOWUP_CONTRACT_VERSION, "recommendation-followup/v1");
  assert.deepEqual(OUTCOME_CODES, RecommendationOutcomeCodeSchema.options);
});

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

test("reserves HTTP 409 for stale follow-up conflicts", () => {
  assert.equal(recommendationFollowupRpcStatus("40001"), 409);
  assert.equal(recommendationFollowupRpcStatus("42501"), 403);
  assert.equal(recommendationFollowupRpcStatus("P0002"), 404);
  assert.equal(recommendationFollowupRpcStatus("22023"), 400);
  assert.equal(recommendationFollowupRpcStatus("57014"), 500);
  assert.equal(recommendationFollowupRpcStatus(undefined), 500);
});
