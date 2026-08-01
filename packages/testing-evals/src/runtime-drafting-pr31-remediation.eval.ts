import { describe, expect, it } from "vitest";
import {
  attachHybridActionDraft,
  createSeedStore,
  resetStore,
  runDailyPrioritizationForOwner,
  type RuntimeDraftingPolicy,
  type RuntimeModelClient,
} from "agent-runtime";
import type { Account, Recommendation } from "@repo/shared-schemas";

const ISO = "2026-08-01T09:15:00Z";

const account: Account = {
  id: "acc_pr31_remediation",
  name: "Acme Manufacturing",
  ownerId: "rep_pr31",
  tier: "strategic",
  lifecycleStage: "open_opportunity",
  openPipelineUsd: 50_000,
  intentSignals: [],
  dataQualityFlags: [],
  createdAt: ISO,
  updatedAt: ISO,
};

const recommendation: Recommendation = {
  id: "rec_pr31_remediation",
  runId: "run_pr31_remediation",
  accountId: account.id,
  ownerId: account.ownerId,
  score: 80,
  rank: 1,
  confidence: 0.9,
  reasonCodes: ["high_open_pipeline"],
  reasonNarrative: "Acme Manufacturing is a current priority.",
  sourceSignals: [
    {
      kind: "account",
      refId: account.id,
      description: "Open pipeline of $50,000.",
      verified: true,
    },
  ],
  nextBestAction: {
    type: "call",
    customerFacing: true,
    crmWriteBack: false,
    objective: "Review the verified pipeline.",
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
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
  ...overrides,
});

describe("PR #31 Codex remediation", () => {
  it("rejects unsafe injected policies before budgets, concurrency, or model invocation", async () => {
    let calls = 0;
    const client: RuntimeModelClient = {
      async generate() {
        calls += 1;
        throw new Error("must not execute");
      },
    };

    await expect(
      attachHybridActionDraft(recommendation, context, {
        policy: policy({ maxConcurrent: Number.POSITIVE_INFINITY }),
        modelClient: client,
        now: ISO,
        beforeModelInvoke: async () => {},
      }),
    ).rejects.toThrow("Invalid runtime drafting policy maxConcurrent: Infinity");

    await expect(
      attachHybridActionDraft(recommendation, context, {
        policy: policy({ model: undefined }),
        modelClient: client,
        now: ISO,
        beforeModelInvoke: async () => {},
      }),
    ).rejects.toThrow("requires a non-empty apiKey and model identity");

    expect(calls).toBe(0);
  });

  it("blocks the built-in provider path when the run only has ephemeral audit storage", async () => {
    const store = resetStore(createSeedStore());

    const run = await runDailyPrioritizationForOwner("rep_alex", {
      now: ISO,
      autoApprove: true,
      drafting: {
        policy: policy({ maxEvidenceAgeDays: 3650, maxRunTokens: 100000 }),
      },
    });

    const auditBoundaryBlocks = store.auditLog.filter(
      (entry) =>
        entry.action === "runtime_draft" &&
        entry.evidence.draftSource === "held" &&
        entry.evidence.failureCode === "DRAFT_AUDIT_START_FAILED",
    );
    const invocationStarts = store.auditLog.filter(
      (entry) => entry.action === "runtime_draft_invocation_start",
    );

    expect(auditBoundaryBlocks.length).toBeGreaterThan(0);
    expect(invocationStarts).toHaveLength(0);
    expect(run.blockedCount).toBeGreaterThan(0);
  });

  it("keeps rejected model citations separate from template-fallback citations", async () => {
    const fabricatedText = "Customer committed to renew immediately.";
    const client: RuntimeModelClient = {
      async generate() {
        return {
          output: {
            schemaVersion: "1.0",
            actionType: "call",
            sentences: [
              {
                text: fabricatedText,
                sourceSignalIds: [account.id],
              },
            ],
          },
          telemetry: {
            provider: "anthropic",
            model: "pinned-test-model",
            latencyMs: 1,
            inputTokens: 20,
            outputTokens: 10,
          },
        };
      },
    };

    const result = await attachHybridActionDraft(recommendation, context, {
      policy: policy(),
      modelClient: client,
      now: ISO,
      beforeModelInvoke: async () => {},
    });

    expect(result.outcome.source).toBe("template_fallback");
    expect(result.outcome.groundingValidation).toBe("failed");
    expect(result.outcome.modelCandidateClaimCitations).toEqual([
      {
        text: fabricatedText,
        sourceSignalIds: [account.id],
      },
    ]);
    expect(result.outcome.claimCitations).toEqual([
      {
        text: "Open pipeline of $50,000.",
        sourceSignalIds: [account.id],
      },
    ]);
    expect(result.outcome.claimCitations).not.toEqual(
      result.outcome.modelCandidateClaimCitations,
    );
  });
});
