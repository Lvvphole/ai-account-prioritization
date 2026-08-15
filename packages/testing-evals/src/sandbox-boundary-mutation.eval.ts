import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachHybridActionDraft,
  runtimeModelClientForProvider,
  sandboxedAnthropicRuntimeModelClient,
  type RuntimeDraftingPolicy,
  type RuntimeModelClient,
} from "agent-runtime";
import type { Account, Recommendation } from "@repo/shared-schemas";

const ISO = "2026-08-15T12:00:00Z";

const account: Account = {
  id: "acc_sandbox_mutation",
  name: "Sandbox Mutation Account",
  ownerId: "rep_sandbox_mutation",
  tier: "strategic",
  lifecycleStage: "open_opportunity",
  openPipelineUsd: 50_000,
  intentSignals: [],
  dataQualityFlags: [],
  createdAt: ISO,
  updatedAt: ISO,
};

const recommendation: Recommendation = {
  id: "rec_sandbox_mutation",
  runId: "run_sandbox_mutation",
  accountId: account.id,
  ownerId: account.ownerId,
  score: 80,
  rank: 1,
  confidence: 0.9,
  reasonCodes: ["high_open_pipeline"],
  reasonNarrative: "Sandbox Mutation Account is a current priority.",
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
    objective: "Review the verified opportunity.",
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

const policy: RuntimeDraftingPolicy = {
  enabled: true,
  provider: "anthropic",
  apiKey: "provider-key-not-for-audit",
  model: "pinned-test-model",
  timeoutMs: 1_000,
  maxTokens: 200,
  maxInputTokens: 3_000,
  maxSignals: 5,
  maxConcurrent: 2,
  maxRunTokens: 10_000,
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
  reasoningEffort: "provider_default",
  outputFormat: "json_schema",
};

const resultFrom = async (client: RuntimeModelClient) =>
  attachHybridActionDraft(
    recommendation,
    {
      account,
      contacts: [],
      opportunities: [],
      activities: [],
    },
    {
      policy,
      modelClient: client,
      now: ISO,
      beforeModelInvoke: async () => {},
    },
  );

describe("PR2 sandbox isolation mutation matrix", () => {
  it("kills bypass-sandbox and direct-Claude-fallback registry mutations", () => {
    expect(runtimeModelClientForProvider("anthropic")).toBe(
      sandboxedAnthropicRuntimeModelClient,
    );
  });

  it("kills removal of Vercel auth pass-through from the Acceptance B Turbo task", () => {
    const turboPath = resolve(__dirname, "../../../turbo.json");
    const parsed = JSON.parse(readFileSync(turboPath, "utf8")) as unknown;
    expect(parsed).toBeTypeOf("object");
    expect(parsed).not.toBeNull();
    const tasks = (parsed as { tasks?: unknown }).tasks;
    expect(tasks).toBeTypeOf("object");
    expect(tasks).not.toBeNull();
    const acceptanceB = (
      tasks as Record<string, { passThroughEnv?: unknown }>
    )["test:acceptance:b"];
    expect(acceptanceB).toBeDefined();
    expect(acceptanceB?.passThroughEnv).toEqual(
      expect.arrayContaining([
        "VERCEL_OIDC_TOKEN",
        "VERCEL_TEAM_ID",
        "VERCEL_PROJECT_ID",
        "VERCEL_TOKEN",
      ]),
    );
  });

  it("kills a model attempt to mutate deterministic rank", async () => {
    const client: RuntimeModelClient = {
      async generate() {
        return {
          output: {
            schemaVersion: "1.0",
            actionType: "call",
            sentences: [
              {
                text: "Open pipeline of $50,000.",
                sourceSignalIds: [account.id],
              },
            ],
            rank: 999,
          },
          telemetry: {
            provider: "anthropic",
            model: "pinned-test-model",
            latencyMs: 1,
          },
        };
      },
    };

    const result = await resultFrom(client);
    expect(result.outcome.failureCode).toBe("DRAFT_SCHEMA_INVALID");
    expect(result.recommendation.rank).toBe(recommendation.rank);
    expect(result.recommendation.score).toBe(recommendation.score);
  });

  it("kills a model attempt to mutate the deterministic next-best-action type", async () => {
    const client: RuntimeModelClient = {
      async generate() {
        return {
          output: {
            schemaVersion: "1.0",
            actionType: "send_email",
            sentences: [
              {
                text: "Open pipeline of $50,000.",
                sourceSignalIds: [account.id],
              },
            ],
          },
          telemetry: {
            provider: "anthropic",
            model: "pinned-test-model",
            latencyMs: 1,
          },
        };
      },
    };

    const result = await resultFrom(client);
    expect(result.outcome.failureCode).toBe("DRAFT_ACTION_MUTATION");
    expect(result.recommendation.nextBestAction.type).toBe(
      recommendation.nextBestAction.type,
    );
  });
});
