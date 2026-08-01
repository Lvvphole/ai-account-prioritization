import { describe, expect, it } from "vitest";
import {
  attachHybridActionDraft,
  buildDailyPrioritizationEntrypointOptions,
  createSeedStore,
  prioritizeAccounts,
  resetStore,
  runDailyPrioritizationForOwner,
  type RuntimeDraftingPolicy,
  type RuntimeModelClient,
} from "agent-runtime";
import type {
  Account,
  Activity,
  Opportunity,
  Recommendation,
} from "@repo/shared-schemas";

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

  it("resolves each intent code to its own verified observation and excludes untraceable intent authority", () => {
    const intentAccount: Account = {
      ...account,
      id: "acc_intent_mapping",
      ownerId: "rep_intent_mapping",
      openPipelineUsd: 0,
      intentSignals: ["pricing_page_visit", "demo_request"],
    };
    const activities: Activity[] = [
      {
        id: "act_pricing_old",
        accountId: intentAccount.id,
        type: "intent_event",
        subject: "Visited pricing page",
        occurredAt: "2026-01-01T00:00:00Z",
        createdById: "system",
        verified: true,
      },
      {
        id: "act_demo_recent",
        accountId: intentAccount.id,
        type: "intent_event",
        subject: "Demo requested",
        occurredAt: ISO,
        createdById: "system",
        verified: true,
      },
    ];

    const mapped = prioritizeAccounts({
      runId: "run_intent_mapping",
      createdAt: ISO,
      contexts: [
        {
          account: intentAccount,
          contacts: [],
          opportunities: [],
          activities,
        },
      ],
    })[0];
    const mappedIntents = mapped?.sourceSignals.filter((signal) => signal.kind === "intent") ?? [];
    expect(mappedIntents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refId: "act_pricing_old",
          description: "Verified intent signal: pricing_page_visit.",
          verified: true,
        }),
        expect.objectContaining({
          refId: "act_demo_recent",
          description: "Verified intent signal: demo_request.",
          verified: true,
        }),
      ]),
    );

    const untraceableAccount: Account = {
      ...intentAccount,
      id: "acc_untraceable_intent",
      intentSignals: ["exec_meeting_request"],
    };
    const unrelatedActivity: Activity = {
      id: "act_unrelated_recent",
      accountId: untraceableAccount.id,
      type: "intent_event",
      subject: "Demo requested",
      occurredAt: ISO,
      createdById: "system",
      verified: true,
    };
    const unmatched = prioritizeAccounts({
      runId: "run_unmatched_intent",
      createdAt: ISO,
      contexts: [
        {
          account: untraceableAccount,
          contacts: [],
          opportunities: [],
          activities: [unrelatedActivity],
        },
      ],
    })[0];
    const noIntent = prioritizeAccounts({
      runId: "run_no_intent",
      createdAt: ISO,
      contexts: [
        {
          account: { ...untraceableAccount, intentSignals: [] },
          contacts: [],
          opportunities: [],
          activities: [unrelatedActivity],
        },
      ],
    })[0];

    expect(unmatched?.sourceSignals.some((signal) => signal.kind === "intent")).toBe(false);
    expect(unmatched?.reasonCodes).not.toContain("verified_intent_signal");
    expect(unmatched?.score).toBe(noIntent?.score);
  });

  it("does not synthesize an intent relationship across unrelated subject and body tokens", () => {
    const relationshipAccount: Account = {
      ...account,
      id: "acc_intent_relationship",
      ownerId: "rep_intent_relationship",
      openPipelineUsd: 0,
      tier: "smb",
      lifecycleStage: "prospect",
      intentSignals: ["pricing_page_visit"],
    };
    const misleadingActivity: Activity = {
      id: "act_split_relationship",
      accountId: relationshipAccount.id,
      type: "intent_event",
      subject: "Pricing inquiry",
      body: "Visited careers page",
      occurredAt: ISO,
      createdById: "system",
      verified: true,
    };

    const misleading = prioritizeAccounts({
      runId: "run_split_relationship",
      createdAt: ISO,
      contexts: [
        {
          account: relationshipAccount,
          contacts: [],
          opportunities: [],
          activities: [misleadingActivity],
        },
      ],
    })[0];
    const noIntent = prioritizeAccounts({
      runId: "run_split_relationship_baseline",
      createdAt: ISO,
      contexts: [
        {
          account: { ...relationshipAccount, intentSignals: [] },
          contacts: [],
          opportunities: [],
          activities: [misleadingActivity],
        },
      ],
    })[0];

    expect(misleading?.sourceSignals.some((signal) => signal.kind === "intent")).toBe(false);
    expect(misleading?.reasonCodes).not.toContain("verified_intent_signal");
    expect(misleading?.score).toBe(noIntent?.score);
  });

  it("validates stale authority even when a direct template does not interpolate source signals", async () => {
    const staleOpportunity: Opportunity = {
      id: "opp_stale_proposal",
      accountId: account.id,
      name: "Stale Proposal",
      stage: "proposal",
      amountUsd: 50_000,
      probability: 0.5,
      closeDate: "2026-12-01T00:00:00Z",
      isClosed: false,
      isWon: false,
      nextStep: "Re-engage customer",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const emailRecommendation: Recommendation = {
      ...recommendation,
      id: "rec_stale_email_authority",
      reasonCodes: ["stalled_opportunity"],
      sourceSignals: [
        {
          kind: "opportunity",
          refId: staleOpportunity.id,
          description: 'Open opportunity "Stale Proposal" in proposal stage worth $50,000.',
          verified: true,
        },
      ],
      nextBestAction: {
        type: "send_email",
        customerFacing: true,
        crmWriteBack: false,
        objective: "Re-engage the proposal.",
      },
    };

    const result = await attachHybridActionDraft(
      emailRecommendation,
      { ...context, opportunities: [staleOpportunity] },
      {
        policy: policy({ enabled: false }),
        now: ISO,
      },
    );

    expect(result.outcome.source).toBe("held");
    expect(result.outcome.failureCode).toBe("DRAFT_CONTEXT_STALE_SIGNAL");
    expect(result.recommendation.nextBestAction.draft).toBeUndefined();
  });

  it("builds a durable service-context production entrypoint and fails closed without production durability", () => {
    const production = buildDailyPrioritizationEntrypointOptions(ISO, {
      NODE_ENV: "production",
      REQUIRE_HUMAN_APPROVAL: true,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    });

    expect(production.autoApprove).toBeUndefined();
    expect(production.rlsContext).toEqual({
      kind: "service",
      actorId: "daily_prioritization_scheduler",
    });

    expect(() =>
      buildDailyPrioritizationEntrypointOptions(ISO, {
        NODE_ENV: "production",
        REQUIRE_HUMAN_APPROVAL: true,
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      }),
    ).toThrow("requires durable Supabase configuration");

    expect(() =>
      buildDailyPrioritizationEntrypointOptions(ISO, {
        NODE_ENV: "production",
        REQUIRE_HUMAN_APPROVAL: false,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      }),
    ).toThrow("requires human approval");
  });
});
