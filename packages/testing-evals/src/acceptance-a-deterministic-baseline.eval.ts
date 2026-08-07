import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createSeedStore,
  createSupabaseRepository,
  resetStore,
  runDailyPrioritizationForAllOwners,
  runtimeDraftingPolicyFromEnv,
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
    throw new Error("ACCEPTANCE_A_SEED_INCOMPLETE");
  }

  return {
    accounts: [
      {
        ...sourceAccount,
        id: ACCOUNT_ID,
        ownerId: OWNER_ID,
        name: "Acceptance A Account",
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

async function runAcceptanceProfile(modelClient: RuntimeModelClient) {
  resetStore(acceptanceStore());
  const draftingPolicy = runtimeDraftingPolicyFromEnv({
    RUNTIME_DRAFTING_ENABLED: "false",
  });

  expect(draftingPolicy.enabled).toBe(false);

  const runs = await runDailyPrioritizationForAllOwners({
    now: NOW,
    approvals: { [ACCOUNT_ID]: true },
    drafting: {
      policy: draftingPolicy,
      modelClient,
    },
  });

  expect(runs).toHaveLength(1);
  return runs[0];
}

function psql(sql: string, variables: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(variables)) {
    args.push("-v", `${name}=${value}`);
  }
  if (process.env.DATABASE_URL) {
    args.push("--dbname", process.env.DATABASE_URL);
  }
  args.push("-c", sql);

  return execFileSync("psql", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function exerciseDurableSpine(recommendation: Recommendation): Promise<void> {
  const payload = recommendation.nextBestAction.draft;
  if (!payload) throw new Error("ACCEPTANCE_A_VISIBLE_PAYLOAD_REQUIRED");

  const durableRepository = createSupabaseRepository(
    { kind: "service", actorId: "acceptance_a", workspaceId: WORKSPACE_ID },
    NOW,
    {
      rpcClient: () => ({
        async rpc(functionName, args) {
          if (functionName !== "persist_published_recommendations") {
            return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
          }
          try {
            const serialized = JSON.stringify(args.p_recommendations);
            const result = psql(
              "select public.persist_published_recommendations(:'recommendations'::jsonb);",
              { recommendations: serialized },
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

  // This is the production Supabase repository persistence method. Its narrow
  // RPC port is bound to the same temporary PostgreSQL instance that the
  // migration verifier prepared, so the exact runtime artifact continues into
  // the durable representative path instead of being recreated as a SQL fixture.
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
 * Acceptance A is the model-disabled production baseline. The normal eval pass
 * proves deterministic runtime behavior. The dedicated Acceptance A root gate
 * additionally keeps a migrated PostgreSQL instance alive and drives the exact
 * generated recommendation through the production Supabase persistence method,
 * RLS read, approval, execution, and follow-up boundaries.
 */
describe("Acceptance A — deterministic baseline", () => {
  it("completes without a model call and preserves one artifact end to end", async () => {
    let modelCalls = 0;
    const forbiddenModelClient: RuntimeModelClient = {
      async generate() {
        modelCalls += 1;
        throw new Error("ACCEPTANCE_A_MODEL_CALL_FORBIDDEN");
      },
    };

    const first = await runAcceptanceProfile(forbiddenModelClient);
    const second = await runAcceptanceProfile(forbiddenModelClient);

    expect(modelCalls).toBe(0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first?.totalAccountsConsidered).toBe(1);
    expect(first?.blockedCount).toBe(0);
    expect(first?.recommendations).toHaveLength(1);

    const recommendation = first?.recommendations[0];
    expect(recommendation?.accountId).toBe(ACCOUNT_ID);
    expect(recommendation?.ownerId).toBe(OWNER_ID);
    expect(recommendation?.rank).toBe(1);
    expect(recommendation?.reasonCodes).toContain("data_quality_blocked");
    expect(recommendation?.nextBestAction.type).toBe("log_research_note");
    expect(recommendation?.nextBestAction.crmWriteBack).toBe(true);
    expect(recommendation?.nextBestAction.draft).toBeTruthy();
    expect(recommendation?.approvalStatus).toBe("approved");
    expect(recommendation?.verification.status).toBe("passed");
    expect(recommendation?.verification.permissionGranted).toBe(true);
    expect(recommendation?.sourceSignals.length).toBeGreaterThan(0);
    expect(recommendation?.sourceSignals.every((signal) => signal.verified)).toBe(true);
    expect(recommendation?.published).toBe(true);

    if (process.env.ACCEPTANCE_A_DATABASE_BACKED === "true") {
      if (!recommendation) throw new Error("ACCEPTANCE_A_RECOMMENDATION_REQUIRED");
      await exerciseDurableSpine(recommendation);
    }
  });
});
