import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createSeedStore,
  createSupabaseRepository,
  resetStore,
  runDailyPrioritizationForAllOwners,
  runtimeDraftingPolicyFromEnv,
  runtimeModelClientForProvider,
  type DataStore,
  type RuntimeModelClient,
} from "agent-runtime";
import type { Recommendation } from "@repo/shared-schemas";

const WORKSPACE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_USER_ID = "44444444-4444-4444-4444-444444444444";
const ACCOUNT_ID = "c2000000-0000-0000-0000-000000000001";
const NOW = "2026-06-25T07:00:00.000Z";

function acceptanceStore(): DataStore {
  const seed = createSeedStore();
  const sourceAccount = seed.accounts.find((account) => account.id === "acc_001");
  const sourceContact = seed.contacts.find((contact) => contact.accountId === "acc_001");
  const sourceOpportunity = seed.opportunities.find(
    (opportunity) => opportunity.accountId === "acc_001",
  );
  const sourceActivities = seed.activities.filter((activity) => activity.accountId === "acc_001");

  if (!sourceAccount || !sourceContact || !sourceOpportunity || sourceActivities.length === 0) {
    throw new Error("ACCEPTANCE_B_SEED_INCOMPLETE");
  }

  return {
    accounts: [
      {
        ...sourceAccount,
        id: ACCOUNT_ID,
        ownerId: OWNER_ID,
        name: "Acceptance B Account",
        dataQualityFlags: ["missing_primary_contact"],
      },
    ],
    contacts: [{ ...sourceContact, accountId: ACCOUNT_ID }],
    opportunities: [{ ...sourceOpportunity, accountId: ACCOUNT_ID }],
    activities: sourceActivities.map((activity) => ({ ...activity, accountId: ACCOUNT_ID })),
    auditLog: [],
    analytics: [],
  };
}

const authorityProjection = (recommendation: Recommendation): unknown => {
  const { draft: _draft, ...nextBestAction } = recommendation.nextBestAction;
  return { ...recommendation, nextBestAction };
};

async function deterministicBaseline(): Promise<Recommendation> {
  resetStore(acceptanceStore());
  let calls = 0;
  const forbiddenClient: RuntimeModelClient = {
    async generate() {
      calls += 1;
      throw new Error("ACCEPTANCE_B_BASELINE_MODEL_CALL_FORBIDDEN");
    },
  };
  const policy = runtimeDraftingPolicyFromEnv({ RUNTIME_DRAFTING_ENABLED: "false" });
  const runs = await runDailyPrioritizationForAllOwners({
    now: NOW,
    approvals: { [ACCOUNT_ID]: true },
    drafting: { policy, modelClient: forbiddenClient },
  });
  expect(calls).toBe(0);
  expect(runs).toHaveLength(1);
  const recommendation = runs[0]?.recommendations[0];
  if (!recommendation) throw new Error("ACCEPTANCE_B_BASELINE_RECOMMENDATION_REQUIRED");
  return recommendation;
}

async function admittedModelProfile(): Promise<{
  recommendation: Recommendation;
  modelCalls: number;
}> {
  resetStore(acceptanceStore());
  const policy = runtimeDraftingPolicyFromEnv(process.env);
  expect(policy.enabled).toBe(true);
  expect(policy.productionAdmission).toBeDefined();
  expect(policy.productionAdmission?.provider).toBe(policy.provider);
  expect(policy.productionAdmission?.modelId).toBe(policy.model);

  let modelCalls = 0;
  const productionClient = runtimeModelClientForProvider(policy.provider);
  const countedClient: RuntimeModelClient = {
    async generate(request, config) {
      modelCalls += 1;
      return productionClient.generate(request, config);
    },
  };

  const runs = await runDailyPrioritizationForAllOwners({
    now: NOW,
    approvals: { [ACCOUNT_ID]: true },
    drafting: { policy, modelClient: countedClient },
  });

  expect(modelCalls).toBeGreaterThan(0);
  expect(runs).toHaveLength(1);
  const recommendation = runs[0]?.recommendations[0];
  if (!recommendation) throw new Error("ACCEPTANCE_B_RECOMMENDATION_REQUIRED");
  return { recommendation, modelCalls };
}

function psql(sql: string, variables: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(variables)) {
    args.push("-v", `${name}=${value}`);
  }
  if (process.env.DATABASE_URL) args.push("--dbname", process.env.DATABASE_URL);
  args.push("-c", sql);
  return execFileSync("psql", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function exerciseDurableSpine(recommendation: Recommendation): Promise<void> {
  const payload = recommendation.nextBestAction.draft;
  if (!payload) throw new Error("ACCEPTANCE_B_VISIBLE_PAYLOAD_REQUIRED");

  const durableRepository = createSupabaseRepository(
    { kind: "service", actorId: "acceptance_b", workspaceId: WORKSPACE_ID },
    NOW,
    {
      rpcClient: () => ({
        async rpc(functionName, args) {
          if (functionName !== "persist_published_recommendations") {
            return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
          }
          try {
            const result = psql(
              "select public.persist_published_recommendations(:'recommendations'::jsonb);",
              { recommendations: JSON.stringify(args.p_recommendations) },
            );
            return { data: Number(result), error: null };
          } catch (error) {
            return {
              data: null,
              error: { message: error instanceof Error ? error.message : String(error) },
            };
          }
        },
      }),
    },
  );

  await durableRepository.persistPublishedRecommendations([recommendation]);

  const variables = {
    workspace_id: WORKSPACE_ID,
    owner_id: OWNER_ID,
    other_user_id: OTHER_USER_ID,
    recommendation_id: recommendation.id,
    payload,
  };
  const ownerClaims = JSON.stringify({ sub: OWNER_ID, role: "authenticated" });
  const otherClaims = JSON.stringify({ sub: OTHER_USER_ID, role: "authenticated" });

  expect(
    psql(
      `set role authenticated;
       set request.jwt.claims = :'claims';
       select count(*) from public.recommendations
        where workspace_id = :'workspace_id'::uuid
          and runtime_recommendation_id = :'recommendation_id';
       reset role;`,
      { ...variables, claims: ownerClaims },
    ),
  ).toBe("1");

  expect(
    psql(
      `set role authenticated;
       set request.jwt.claims = :'claims';
       select count(*) from public.recommendations
        where workspace_id = :'workspace_id'::uuid
          and runtime_recommendation_id = :'recommendation_id';
       reset role;`,
      { ...variables, claims: otherClaims },
    ),
  ).toBe("0");

  expect(
    psql(
      `set role authenticated;
       set request.jwt.claims = :'claims';
       select public.get_action_payload_approval_state(
         :'workspace_id'::uuid, :'recommendation_id', :'payload'
       ) ->> 'status';
       reset role;`,
      { ...variables, claims: ownerClaims },
    ),
  ).toBe("pending_approval");

  expect(
    psql(
      `set role authenticated;
       set request.jwt.claims = :'claims';
       select public.execute_approved_protected_action(
         :'workspace_id'::uuid, :'recommendation_id', :'payload'
       ) ->> 'status';
       reset role;`,
      { ...variables, claims: ownerClaims },
    ),
  ).toBe("BLOCKED");

  expect(
    psql(
      `set role authenticated;
       set request.jwt.claims = :'claims';
       select public.record_action_payload_decision(
         :'workspace_id'::uuid, :'recommendation_id', :'payload', 'approved'
       ) ->> 'status';
       reset role;`,
      { ...variables, claims: ownerClaims },
    ),
  ).toBe("approved");

  expect(
    psql(
      `set role authenticated;
       set request.jwt.claims = :'claims';
       select public.execute_approved_protected_action(
         :'workspace_id'::uuid, :'recommendation_id', :'payload'
       ) ->> 'status';
       reset role;`,
      { ...variables, claims: ownerClaims },
    ),
  ).toBe("PASS");

  expect(
    psql(
      `set role authenticated;
       set request.jwt.claims = :'claims';
       select public.record_recommendation_followup(
         :'workspace_id'::uuid, :'recommendation_id', 'unknown', 'unknown', null
       ) ->> 'code';
       reset role;`,
      { ...variables, claims: ownerClaims },
    ),
  ).toBe("unknown");

  expect(
    psql(
      `set role authenticated;
       set request.jwt.claims = :'claims';
       select public.get_recommendation_followup_state(
         :'workspace_id'::uuid, :'recommendation_id'
       ) ->> 'code';
       reset role;`,
      { ...variables, claims: ownerClaims },
    ),
  ).toBe("unknown");

  const stored = JSON.parse(
    psql(
      `select jsonb_build_object(
         'runId', run_id,
         'accountId', account_id::text,
         'ownerId', owner_id::text,
         'score', score,
         'rank', rank,
         'confidence', confidence,
         'reasonCodes', to_jsonb(reason_codes),
         'sourceSignals', source_signals,
         'nextBestAction', next_best_action,
         'approvalStatus', approval_status::text,
         'published', published,
         'verification', verification
       )::text
       from public.recommendations
       where workspace_id = :'workspace_id'::uuid
         and runtime_recommendation_id = :'recommendation_id';`,
      variables,
    ),
  ) as Record<string, unknown>;

  expect(stored).toEqual({
    runId: recommendation.runId,
    accountId: recommendation.accountId,
    ownerId: recommendation.ownerId,
    score: recommendation.score,
    rank: recommendation.rank,
    confidence: recommendation.confidence,
    reasonCodes: recommendation.reasonCodes,
    sourceSignals: recommendation.sourceSignals,
    nextBestAction: recommendation.nextBestAction,
    approvalStatus: recommendation.approvalStatus,
    published: recommendation.published,
    verification: recommendation.verification,
  });

  expect(
    Number(
      psql(
        `select count(*) from public.audit_evidence
          where workspace_id = :'workspace_id'::uuid
            and account_id = '${ACCOUNT_ID}'::uuid
            and evidence ->> 'recommendationId' = :'recommendation_id'
            and action in (
              'persist_recommendation',
              'action_payload_approval',
              'protected_action_execution',
              'recommendation_followup'
            );`,
        variables,
      ),
    ),
  ).toBeGreaterThanOrEqual(4);
}

/**
 * Acceptance B runs only after a real qualification report has produced one
 * explicit production admission. It uses the admitted production adapter, then
 * proves the same deterministic authority and durable representative path as
 * Acceptance A. Provider failure may use only the admitted deterministic
 * fallback. A hold that prevents the production path from completing fails B.
 */
describe("Acceptance B — single qualified model", () => {
  it("uses one admitted model configuration without changing deterministic authority", async () => {
    const baseline = await deterministicBaseline();
    const { recommendation, modelCalls } = await admittedModelProfile();

    expect(modelCalls).toBeGreaterThan(0);
    expect(authorityProjection(recommendation)).toEqual(authorityProjection(baseline));
    expect(recommendation.accountId).toBe(ACCOUNT_ID);
    expect(recommendation.ownerId).toBe(OWNER_ID);
    expect(recommendation.rank).toBe(1);
    expect(recommendation.reasonCodes).toContain("data_quality_blocked");
    expect(recommendation.nextBestAction.type).toBe("log_research_note");
    expect(recommendation.nextBestAction.crmWriteBack).toBe(true);
    expect(recommendation.nextBestAction.draft).toBeTruthy();
    expect(recommendation.approvalStatus).toBe("approved");
    expect(recommendation.verification.status).toBe("passed");
    expect(recommendation.verification.permissionGranted).toBe(true);
    expect(recommendation.sourceSignals.every((signal) => signal.verified)).toBe(true);
    expect(recommendation.published).toBe(true);

    if (process.env.ACCEPTANCE_B_DATABASE_BACKED === "true") {
      await exerciseDurableSpine(recommendation);
    }
  });
});
