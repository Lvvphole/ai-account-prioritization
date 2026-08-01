import { describe, expect, it } from "vitest";
import {
  attachHybridActionDraft,
  type RuntimeDraftingPolicy,
  type RuntimeModelClient,
} from "agent-runtime";
import type { Account, Recommendation } from "@repo/shared-schemas";

const NOW = "2026-08-01T09:00:00Z";

const policyWithoutFreshness = (): RuntimeDraftingPolicy => ({
  enabled: true,
  provider: "anthropic",
  apiKey: "test-key",
  model: "pinned-test-model",
  timeoutMs: 1000,
  maxTokens: 200,
  maxInputTokens: 4000,
  maxSignals: 6,
  maxConcurrent: 2,
  maxRunTokens: 20000,
  maxAttempts: 1,
  fallback: "template",
});

const recommendationFor = (account: Account): Recommendation => ({
  id: `rec_${account.id}`,
  runId: "run_review_round_7",
  accountId: account.id,
  ownerId: account.ownerId,
  score: 80,
  rank: 1,
  confidence: 0.9,
  reasonCodes: ["high_open_pipeline"],
  reasonNarrative: `${account.name} is a current priority.`,
  sourceSignals: [
    {
      kind: "account",
      refId: account.id,
      description: `Open pipeline of $${account.openPipelineUsd}.`,
      verified: true,
    },
  ],
  nextBestAction: {
    type: "call",
    customerFacing: true,
    crmWriteBack: false,
    objective: "Review the open opportunity.",
  },
  verification: {
    status: "pending",
    schemaValid: false,
    guardrailsPassed: false,
    sourceSignalsVerified: false,
    permissionGranted: false,
    failedGates: [],
    checkedAt: NOW,
  },
  approvalStatus: "pending_approval",
  published: false,
  createdAt: NOW,
});

const accountAt = (updatedAt: string): Account => ({
  id: "acc_review_round_7",
  name: "Acme Manufacturing",
  ownerId: "rep_review_round_7",
  tier: "strategic",
  lifecycleStage: "open_opportunity",
  openPipelineUsd: 50_000,
  intentSignals: [],
  dataQualityFlags: [],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt,
});

describe("runtime drafting freshness and durable-audit boundary", () => {
  it("applies the default evidence-age limit when an injected policy omits it", async () => {
    const account = accountAt("2026-01-01T00:00:00Z");
    const rec = recommendationFor(account);
    let calls = 0;
    const client: RuntimeModelClient = {
      async generate() {
        calls += 1;
        throw new Error("provider must not be called for stale evidence");
      },
    };

    const result = await attachHybridActionDraft(
      rec,
      { account, contacts: [], opportunities: [], activities: [] },
      {
        policy: policyWithoutFreshness(),
        modelClient: client,
        now: NOW,
      },
    );

    expect(result.outcome.source).toBe("held");
    expect(result.outcome.failureCode).toBe("DRAFT_CONTEXT_STALE_SIGNAL");
    expect(result.outcome.effectivePolicy.maxEvidenceAgeDays).toBe(90);
    expect(calls).toBe(0);
  });

  it("fails closed before any model client when durable invocation-start auditing is absent", async () => {
    const account = accountAt(NOW);
    const rec = recommendationFor(account);
    let calls = 0;
    const client: RuntimeModelClient = {
      async generate() {
        calls += 1;
        throw new Error("model client must not run without durable invocation audit");
      },
    };

    const result = await attachHybridActionDraft(
      rec,
      { account, contacts: [], opportunities: [], activities: [] },
      {
        policy: policyWithoutFreshness(),
        modelClient: client,
        now: NOW,
      },
    );

    expect(result.outcome.source).toBe("held");
    expect(result.outcome.failureCode).toBe("DRAFT_AUDIT_START_REQUIRED");
    expect(result.recommendation.nextBestAction.draft).toBeUndefined();
    expect(calls).toBe(0);
  });
});
