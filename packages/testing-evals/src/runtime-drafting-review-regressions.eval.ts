import { describe, expect, it } from "vitest";
import {
  attachHybridActionDraft,
  buildVerifiedDraftContext,
  createSeedStore,
  resetStore,
  runDailyPrioritizationForOwner,
  runtimeDraftingPolicyFromEnv,
  validateDraftGrounding,
  type RuntimeDraftingPolicy,
  type RuntimeModelClient,
  type RuntimeModelRequest,
} from "agent-runtime";
import {
  GeneratedDraftSchema,
  type Account,
  type Activity,
  type Opportunity,
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
      kind: "account",
      refId: account.id,
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

const accountRecommendation = (description: string): Recommendation => ({
  ...recommendation,
  sourceSignals: [
    {
      kind: "account",
      refId: account.id,
      description,
      verified: true,
    },
  ],
});

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
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
  ...overrides,
});

const contextFromRequest = (request: RuntimeModelRequest) => {
  const start = "SOURCE_DATA_START\n";
  const end = "\nSOURCE_DATA_END";
  const json = request.user.slice(
    request.user.indexOf(start) + start.length,
    request.user.lastIndexOf(end),
  );
  return JSON.parse(json) as {
    actionType: Recommendation["nextBestAction"]["type"];
    signals: Array<{ id: string; description: string }>;
  };
};

const exactEvidenceClient: RuntimeModelClient = {
  async generate(request) {
    const visible = contextFromRequest(request);
    return {
      output: {
        schemaVersion: "1.0",
        actionType: visible.actionType,
        sentences: [
          {
            text: visible.signals[0]?.description,
            sourceSignalIds: [visible.signals[0]?.id],
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

describe("runtime drafting Codex review regressions", () => {
  it("rejects relationship rearrangement even when token membership and global polarity match", () => {
    const verified = buildVerifiedDraftContext(recommendation, context);
    const draft = GeneratedDraftSchema.parse({
      schemaVersion: "1.0",
      actionType: "call",
      sentences: [
        {
          text: "Beta is not preferred; Alpha is preferred.",
          sourceSignalIds: [account.id],
        },
      ],
    });

    const result = validateDraftGrounding(draft, verified);
    expect(result.passed).toBe(false);
    expect(result.failedGates).toContain("DRAFT_RELATIONSHIP_MISMATCH");
  });

  it("rejects modality omissions and relational substitutions", () => {
    const modality = accountRecommendation("Customer may commit to renewal.");
    const modalityContext = buildVerifiedDraftContext(modality, context);
    const modalityDraft = GeneratedDraftSchema.parse({
      schemaVersion: "1.0",
      actionType: "call",
      sentences: [
        {
          text: "Customer commit to renewal.",
          sourceSignalIds: [account.id],
        },
      ],
    });
    expect(validateDraftGrounding(modalityDraft, modalityContext).passed).toBe(false);

    const relation = accountRecommendation("Alpha is preferred over Beta.");
    const relationContext = buildVerifiedDraftContext(relation, context);
    const relationDraft = GeneratedDraftSchema.parse({
      schemaVersion: "1.0",
      actionType: "call",
      sentences: [
        {
          text: "Alpha is preferred by Beta.",
          sourceSignalIds: [account.id],
        },
      ],
    });
    expect(validateDraftGrounding(relationDraft, relationContext).passed).toBe(false);
  });

  it("treats comma-formatted currency as one atomic value", () => {
    const rec = accountRecommendation("Open pipeline of $50,000.");
    const verified = buildVerifiedDraftContext(rec, context);
    const draft = GeneratedDraftSchema.parse({
      schemaVersion: "1.0",
      actionType: "call",
      sentences: [
        {
          text: "Open pipeline of $50.",
          sourceSignalIds: [account.id],
        },
      ],
    });

    const result = validateDraftGrounding(draft, verified);
    expect(result.passed).toBe(false);
    expect(result.failedGates).toContain("DRAFT_UNSUPPORTED_NUMBER");
  });

  it("preserves non-ASCII entity tokens during grounding", () => {
    const rec = accountRecommendation(
      'Open opportunity "東京" in Discovery stage worth $50,000.',
    );
    const verified = buildVerifiedDraftContext(rec, context);
    const draft = GeneratedDraftSchema.parse({
      schemaVersion: "1.0",
      actionType: "call",
      sentences: [
        {
          text: 'Open opportunity "北京" in Discovery stage worth $50,000.',
          sourceSignalIds: [account.id],
        },
      ],
    });

    const result = validateDraftGrounding(draft, verified);
    expect(result.passed).toBe(false);
    expect(result.failedGates).toContain("DRAFT_CLAIM_NOT_GROUNDED");
  });

  it("preserves symbol-bearing and emoji entity values during grounding", () => {
    for (const [evidence, fabricated] of [
      [
        'Open opportunity "C++" in Discovery stage worth $50,000.',
        'Open opportunity "C#" in Discovery stage worth $50,000.',
      ],
      [
        'Open opportunity "🔥" in Discovery stage worth $50,000.',
        'Open opportunity "⭐" in Discovery stage worth $50,000.',
      ],
    ] as const) {
      const rec = accountRecommendation(evidence);
      const verified = buildVerifiedDraftContext(rec, context);
      const draft = GeneratedDraftSchema.parse({
        schemaVersion: "1.0",
        actionType: "call",
        sentences: [
          {
            text: fabricated,
            sourceSignalIds: [account.id],
          },
        ],
      });

      const result = validateDraftGrounding(draft, verified);
      expect(result.passed).toBe(false);
      expect(result.failedGates).toContain("DRAFT_CLAIM_NOT_GROUNDED");
    }
  });

  it("holds stale resolved evidence instead of rendering it through template fallback", async () => {
    const staleAccount: Account = {
      ...account,
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const staleContext = { ...context, account: staleAccount };
    const rec = accountRecommendation("Open pipeline of $50,000.");
    let calls = 0;
    const client: RuntimeModelClient = {
      async generate(request, selectedPolicy) {
        calls += 1;
        return exactEvidenceClient.generate(request, selectedPolicy);
      },
    };

    const result = await attachHybridActionDraft(rec, staleContext, {
      policy: policy({ enabled: true, maxEvidenceAgeDays: 30, fallback: "template" }),
      modelClient: client,
      now: ISO,
    });

    expect(result.outcome.source).toBe("held");
    expect(result.outcome.failureCode).toBe("DRAFT_CONTEXT_STALE_SIGNAL");
    expect(result.recommendation.nextBestAction.draft).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("revalidates every signal consumed by template fallback beyond maxSignals", async () => {
    const opportunity: Opportunity = {
      id: "opp_fresh_review",
      accountId: account.id,
      name: "Fresh expansion",
      stage: "discovery",
      amountUsd: 50_000,
      probability: 0.5,
      isClosed: false,
      isWon: false,
      createdAt: ISO,
      updatedAt: ISO,
    };
    const rec: Recommendation = {
      ...recommendation,
      sourceSignals: [
        {
          kind: "opportunity",
          refId: opportunity.id,
          description: 'Open opportunity "Fresh expansion" in Discovery stage worth $50,000.',
          verified: true,
        },
        {
          kind: "contact",
          refId: "missing_contact",
          description: "Primary contact is Missing Person.",
          verified: true,
        },
      ],
    };
    let calls = 0;
    const invalidSchemaClient: RuntimeModelClient = {
      async generate() {
        calls += 1;
        return {
          output: {},
          telemetry: {
            provider: "anthropic",
            model: "pinned-test-model",
            latencyMs: 1,
            inputTokens: 20,
            outputTokens: 1,
          },
        };
      },
    };

    const result = await attachHybridActionDraft(
      rec,
      { ...context, opportunities: [opportunity] },
      {
        policy: policy({ enabled: true, maxSignals: 1, fallback: "template" }),
        modelClient: invalidSchemaClient,
        now: ISO,
      },
    );

    expect(calls).toBe(1);
    expect(result.outcome.source).toBe("held");
    expect(result.outcome.failureCode).toBe("DRAFT_CONTEXT_SOURCE_UNRESOLVED");
    expect(result.recommendation.nextBestAction.draft).toBeUndefined();
  });

  it("rejects future-dated evidence before provider invocation", async () => {
    const futureActivity: Activity = {
      id: "act_future_review",
      accountId: account.id,
      type: "intent_event",
      subject: "Future intent",
      occurredAt: "2026-08-02T06:45:00Z",
      createdById: "system",
      verified: true,
    };
    const rec: Recommendation = {
      ...recommendation,
      sourceSignals: [
        {
          kind: "intent",
          refId: futureActivity.id,
          description: "Customer showed future intent.",
          verified: true,
        },
      ],
    };
    let calls = 0;
    const client: RuntimeModelClient = {
      async generate(request, selectedPolicy) {
        calls += 1;
        return exactEvidenceClient.generate(request, selectedPolicy);
      },
    };

    const result = await attachHybridActionDraft(
      rec,
      { ...context, activities: [futureActivity] },
      {
        policy: policy({ enabled: true }),
        modelClient: client,
        now: ISO,
      },
    );

    expect(result.outcome.source).toBe("held");
    expect(result.outcome.failureCode).toBe("DRAFT_CONTEXT_FUTURE_SIGNAL");
    expect(calls).toBe(0);
  });

  it("records source-signal provenance for direct deterministic templates", async () => {
    const rec = accountRecommendation("Open pipeline of $50,000.");
    const result = await attachHybridActionDraft(rec, context, {
      policy: policy({ enabled: false }),
      now: ISO,
    });

    expect(result.outcome.source).toBe("template");
    expect(result.outcome.selectedSourceSignalIds).toEqual([account.id]);
    expect(result.outcome.claimCitations).toEqual([
      {
        text: "Open pipeline of $50,000.",
        sourceSignalIds: [account.id],
      },
    ]);
    expect(result.recommendation.nextBestAction.draft).toContain("Open pipeline of $50,000.");
  });

  it("persists pre-invocation evidence before calling the model and fails closed when it cannot", async () => {
    const rec = accountRecommendation("Open pipeline of $50,000.");
    let startPersisted = false;
    let calls = 0;
    const client: RuntimeModelClient = {
      async generate(request, selectedPolicy) {
        expect(startPersisted).toBe(true);
        calls += 1;
        return exactEvidenceClient.generate(request, selectedPolicy);
      },
    };

    const accepted = await attachHybridActionDraft(rec, context, {
      policy: policy({ enabled: true }),
      modelClient: client,
      now: ISO,
      beforeModelInvoke: async (invocation) => {
        expect(invocation.recommendationId).toBe(rec.id);
        expect(invocation.accountId).toBe(account.id);
        expect(invocation.selectedSourceSignalIds).toEqual([account.id]);
        startPersisted = true;
      },
    });
    expect(accepted.outcome.source).toBe("model");
    expect(calls).toBe(1);

    let blockedCalls = 0;
    const blocked = await attachHybridActionDraft(rec, context, {
      policy: policy({ enabled: true, fallback: "template" }),
      modelClient: {
        async generate(request, selectedPolicy) {
          blockedCalls += 1;
          return exactEvidenceClient.generate(request, selectedPolicy);
        },
      },
      now: ISO,
      beforeModelInvoke: async () => {
        throw new Error("audit unavailable");
      },
    });
    expect(blocked.outcome.source).toBe("held");
    expect(blocked.outcome.failureCode).toBe("DRAFT_AUDIT_START_FAILED");
    expect(blockedCalls).toBe(0);
  });

  it("records a non-secret effective policy snapshot and a value-sensitive hash on every outcome", async () => {
    const first = await attachHybridActionDraft(recommendation, context, {
      policy: policy(),
      now: ISO,
    });
    const second = await attachHybridActionDraft(recommendation, context, {
      policy: policy({ timeoutMs: 4321 }),
      now: ISO,
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
      maxEvidenceAgeDays: 90,
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
      drafting: { policy: policy({ maxEvidenceAgeDays: 3650 }) },
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
        maxEvidenceAgeDays: 3650,
        fallback: "template",
      });
      expect(
        "apiKey" in (entry.evidence.effectivePolicy as Record<string, unknown>),
      ).toBe(false);
    }

    expect(
      draftAudits.some(
        (entry) =>
          Array.isArray(entry.evidence.selectedSourceSignalIds) &&
          entry.evidence.selectedSourceSignalIds.length > 0 &&
          Array.isArray(entry.evidence.claimCitations) &&
          entry.evidence.claimCitations.length > 0,
      ),
    ).toBe(true);
  });

  it("persists accepted claim-to-source mappings and explicit verifier results", async () => {
    const store = resetStore(createSeedStore());
    await runDailyPrioritizationForOwner("rep_alex", {
      now: ISO,
      autoApprove: true,
      drafting: {
        policy: policy({
          enabled: true,
          maxEvidenceAgeDays: 3650,
          maxRunTokens: 100000,
        }),
        modelClient: exactEvidenceClient,
      },
    });

    const modelAudit = store.auditLog.find(
      (entry) =>
        entry.action === "runtime_draft" && entry.evidence.draftSource === "model",
    );
    expect(modelAudit).toBeTruthy();
    expect(modelAudit?.evidence.recommendationId).toEqual(expect.any(String));
    expect(modelAudit?.evidence.selectedSourceSignalIds).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    expect(modelAudit?.evidence.claimCitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.any(String),
          sourceSignalIds: expect.arrayContaining([expect.any(String)]),
        }),
      ]),
    );
    expect(modelAudit?.evidence.schemaValidation).toBe("passed");
    expect(modelAudit?.evidence.groundingValidation).toBe("passed");
    expect(modelAudit?.evidence.groundingFailedGates).toEqual([]);
  });

  it("persists invocation-start audit evidence before each model outcome", async () => {
    const store = resetStore(createSeedStore());
    await runDailyPrioritizationForOwner("rep_alex", {
      now: ISO,
      autoApprove: true,
      drafting: {
        policy: policy({
          enabled: true,
          maxEvidenceAgeDays: 3650,
          maxRunTokens: 100000,
        }),
        modelClient: exactEvidenceClient,
      },
    });

    const starts = store.auditLog.filter(
      (entry) => entry.action === "runtime_draft_invocation_start",
    );
    expect(starts.length).toBeGreaterThan(0);

    for (const start of starts) {
      const startIndex = store.auditLog.indexOf(start);
      const outcomeIndex = store.auditLog.findIndex(
        (entry, index) =>
          index > startIndex &&
          entry.action === "runtime_draft" &&
          entry.evidence.recommendationId === start.evidence.recommendationId,
      );
      expect(outcomeIndex).toBeGreaterThan(startIndex);
    }
  });

  it("rejects unrecognized runtime-drafting boolean values", () => {
    expect(() =>
      runtimeDraftingPolicyFromEnv({
        RUNTIME_DRAFTING_ENABLED: "TRUE",
      } as NodeJS.ProcessEnv),
    ).toThrow("Invalid runtime drafting boolean configuration: TRUE");

    const disabled = runtimeDraftingPolicyFromEnv({
      RUNTIME_DRAFTING_ENABLED: "false",
    } as NodeJS.ProcessEnv);
    expect(disabled.enabled).toBe(false);
    expect(disabled.maxEvidenceAgeDays).toBe(90);
  });

  it("rejects partially parsed runtime-drafting numeric values", () => {
    expect(() =>
      runtimeDraftingPolicyFromEnv({
        RUNTIME_DRAFT_TIMEOUT_MS: "5000ms",
      } as NodeJS.ProcessEnv),
    ).toThrow("Invalid runtime drafting numeric configuration: 5000ms");

    expect(() =>
      runtimeDraftingPolicyFromEnv({
        RUNTIME_DRAFT_MAX_TOKENS: "600.5",
      } as NodeJS.ProcessEnv),
    ).toThrow("Invalid runtime drafting numeric configuration: 600.5");
  });
});
