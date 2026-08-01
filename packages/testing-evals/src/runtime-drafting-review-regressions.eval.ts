import { describe, expect, it } from "vitest";
import {
  attachHybridActionDraft,
  buildVerifiedDraftContext,
  createSeedStore,
  resetStore,
  runDailyPrioritizationForOwner,
  validateDraftGrounding,
  type RuntimeDraftingPolicy,
} from "agent-runtime";
import {
  GeneratedDraftSchema,
  type Account,
  type Recommendation,
} from "@repo/shared-schemas";

const ISO = "2026-08-01T06:45:00Z";

const account: Account = {
  id: "acc_review_regression",
  name: "Acme Manufacturing",
  ownerId: "rep_review",
  tier: "strategic",
  lifecycleStage: "open_opportunity",
  openPipelineUsd: 50_000,
  intentSignals: [],
  dataQualityFlags: [],
  createdAt: ISO,
  updatedAt: ISO,
};

const recommendation: Recommendation = {
  id: "rec_review_regression",
  runId: "run_review_regression",
  accountId: account.id,
  ownerId: account.ownerId,
  score: 80,
  rank: 1,
  confidence: 0.9,
  reasonCodes: ["high_open_pipeline"],
  reasonNarrative: "Acme Manufacturing is a current priority.",
  sourceSignals: [
    {
      kind: "intent",
      refId: "sig_preferences",
      description: "Alpha is not preferred; Beta is preferred.",
      verified: true,
    },
  ],
  nextBestAction: {
    type: "call",
    customerFacing: true,
    crmWriteBack: false,
    objective: "Review the verified customer preference.",
  },
  verification: {
    status: "pending",
    schemaValid: false,
    guardrailsPassed: false,
    sourceSignalsVerified: false,
    permissionGranted: false,
    failedGates: [],
    checkedAt: ISO,
  },
  approvalStatus: "pending_approval",
  published: false,
  createdAt: ISO,
};

const context = {
  account,
  contacts: [],
  opportunities: [],
  activities: [],
};

const policy = (overrides: Partial<RuntimeDraftingPolicy> = {}): RuntimeDraftingPolicy => ({
  enabled: false,
  provider: "anthropic",
  apiKey: "secret-that-must-never-be-audited",
  model: "pinned-test-model",
  timeoutMs: 1234,
  maxTokens: 200,
  maxInputTokens: 3000,
  maxSignals: 5,
  maxConcurrent: 2,
  maxRunTokens: 10000,
  maxAttempts: 1,
  fallback: "template",
  ...overrides,
});

describe("runtime drafting Codex review regressions", () => {
  it("rejects relationship rearrangement even when token membership and global polarity match", () => {
    const verified = buildVerifiedDraftContext(recommendation, context);
    const draft = GeneratedDraftSchema.parse({
      schemaVersion: "1.0",
      actionType: "call",
      sentences: [
        {
          text: "Beta is not preferred; Alpha is preferred.",
          sourceSignalIds: ["sig_preferences"],
        },
      ],
    });

    const result = validateDraftGrounding(draft, verified);
    expect(result.passed).toBe(false);
    expect(result.failedGates).toContain("DRAFT_RELATIONSHIP_MISMATCH");
  });

  it("records a non-secret effective policy snapshot and a value-sensitive hash on every outcome", async () => {
    const first = await attachHybridActionDraft(recommendation, context, {
      policy: policy(),
    });
    const second = await attachHybridActionDraft(recommendation, context, {
      policy: policy({ timeoutMs: 4321 }),
    });

    expect(first.outcome.source).toBe("template");
    expect(first.outcome.effectivePolicy).toMatchObject({
      enabled: false,
      provider: "anthropic",
      model: "pinned-test-model",
      timeoutMs: 1234,
      maxTokens: 200,
      maxInputTokens: 3000,
      maxSignals: 5,
      maxConcurrent: 2,
      maxRunTokens: 10000,
      maxAttempts: 1,
      fallback: "template",
    });
    expect("apiKey" in first.outcome.effectivePolicy).toBe(false);
    expect(first.outcome.effectivePolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.outcome.effectivePolicyHash).not.toBe(first.outcome.effectivePolicyHash);
  });

  it("persists deterministic template provenance and effective policy in durable audit evidence", async () => {
    const store = resetStore(createSeedStore());
    await runDailyPrioritizationForOwner("rep_alex", {
      now: ISO,
      autoApprove: true,
      drafting: { policy: policy() },
    });

    const draftAudits = store.auditLog.filter((entry) => entry.action === "runtime_draft");
    expect(draftAudits.length).toBeGreaterThan(0);

    for (const entry of draftAudits) {
      expect(entry.evidence.draftSource).toBe("template");
      expect(entry.evidence.fallbackVersion).toBe("deterministic-template-v1");
      expect(entry.evidence.effectivePolicyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.evidence.effectivePolicy).toMatchObject({
        enabled: false,
        timeoutMs: 1234,
        maxTokens: 200,
        maxInputTokens: 3000,
        maxSignals: 5,
        maxConcurrent: 2,
        maxRunTokens: 10000,
        fallback: "template",
      });
      expect(
        "apiKey" in (entry.evidence.effectivePolicy as Record<string, unknown>),
      ).toBe(false);
    }
  });
});
