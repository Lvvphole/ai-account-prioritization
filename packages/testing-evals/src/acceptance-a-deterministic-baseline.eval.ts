import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createSupabaseRepository,
  resetStore,
  runDailyPrioritizationForAllOwners,
  runtimeDraftingPolicyFromEnv,
  type DataStore,
  type RuntimeModelClient,
} from "agent-runtime";
import type { Account, Recommendation } from "@repo/shared-schemas";
import {
  ACCEPTANCE_A_DURABLE_OWNER_ID,
  ACCEPTANCE_A_NOW,
  ACCEPTANCE_A_WORKSPACE_ID,
  buildAcceptanceACrmFixture,
  type AcceptanceACrmFixture,
} from "./acceptance-a-crm-fixture";

const OTHER_USER_ID = "44444444-4444-4444-4444-444444444444";

function cloneStore(source: DataStore): DataStore {
  return {
    accounts: source.accounts.map((account) => ({
      ...account,
      intentSignals: [...account.intentSignals],
      dataQualityFlags: [...account.dataQualityFlags],
    })),
    contacts: source.contacts.map((contact) => ({ ...contact })),
    opportunities: source.opportunities.map((opportunity) => ({ ...opportunity })),
    activities: source.activities.map((activity) => ({ ...activity })),
    auditLog: [],
    analytics: [],
  };
}

async function runAcceptanceProfile(
  modelClient: RuntimeModelClient,
  fixture: AcceptanceACrmFixture,
) {
  const store = cloneStore(fixture.store);
  resetStore(store);
  const draftingPolicy = runtimeDraftingPolicyFromEnv({
    RUNTIME_DRAFTING_ENABLED: "false",
  });

  expect(draftingPolicy.enabled).toBe(false);

  const runs = await runDailyPrioritizationForAllOwners({
    now: ACCEPTANCE_A_NOW,
    approvals: Object.fromEntries(store.accounts.map((account) => [account.id, true])),
    drafting: {
      policy: draftingPolicy,
      modelClient,
    },
  });

  expect(runs).toHaveLength(fixture.workspaceMemberIds.length);
  return runs;
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

function seedDurableRepresentativeAccount(account: Account): void {
  const variables = {
    workspace_id: ACCEPTANCE_A_WORKSPACE_ID,
    account_id: account.id,
    account_name: account.name,
    owner_id: account.ownerId,
    tier: account.tier,
    lifecycle_stage: account.lifecycleStage,
    industry: account.industry ?? "",
    employee_count: String(account.employeeCount ?? 0),
    open_pipeline_usd: String(account.openPipelineUsd),
    health_score: String(account.healthScore ?? 50),
  };

  psql(
    `insert into public.accounts (
       id, workspace_id, name, owner_id, tier, lifecycle_stage, industry,
       employee_count, open_pipeline_usd, health_score, intent_signals, data_quality_flags
     ) values (
       :'account_id'::uuid, :'workspace_id'::uuid, :'account_name', :'owner_id'::uuid,
       :'tier'::public.account_tier, :'lifecycle_stage'::public.lifecycle_stage,
       nullif(:'industry', ''), :'employee_count'::integer, :'open_pipeline_usd'::numeric,
       :'health_score'::integer, array[]::text[], array[]::text[]
     )
     on conflict (id) do nothing;`,
    variables,
  );

  expect(
    psql(
      `select count(*) from public.accounts
        where id = :'account_id'::uuid
          and workspace_id = :'workspace_id'::uuid
          and owner_id = :'owner_id'::uuid
          and name = :'account_name'
          and tier = :'tier'::public.account_tier
          and lifecycle_stage = :'lifecycle_stage'::public.lifecycle_stage
          and open_pipeline_usd = :'open_pipeline_usd'::numeric;`,
      variables,
    ),
  ).toBe("1");
}

async function exerciseDurableSpine(
  recommendation: Recommendation,
  account: Account,
): Promise<void> {
  const payload = recommendation.nextBestAction.draft;
  if (!payload) throw new Error("ACCEPTANCE_A_VISIBLE_PAYLOAD_REQUIRED");

  seedDurableRepresentativeAccount(account);

  const durableRepository = createSupabaseRepository(
    { kind: "service", actorId: "acceptance_a", workspaceId: ACCEPTANCE_A_WORKSPACE_ID },
    ACCEPTANCE_A_NOW,
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

  await durableRepository.persistPublishedRecommendations([recommendation]);

  const variables = {
    workspace_id: ACCEPTANCE_A_WORKSPACE_ID,
    owner_id: recommendation.ownerId,
    other_user_id: OTHER_USER_ID,
    account_id: recommendation.accountId,
    recommendation_id: recommendation.id,
    payload,
  };
  const ownerClaims = JSON.stringify({ sub: recommendation.ownerId, role: "authenticated" });
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
            and account_id = :'account_id'::uuid
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
 * Acceptance A is the model-disabled production baseline. This version starts
 * from the user-approved CRM-derived synthetic fixture, drives it through the
 * real parser, mapping/normalization, validation, approval assessment and commit
 * planner, materializes only planned canonical writes into the deterministic
 * runtime, and then carries one exact recommendation through the durable
 * persistence, RLS, payload approval, protected execution and follow-up spine.
 */
describe("Acceptance A — deterministic baseline", () => {
  it("completes from the CRM-derived synthetic fixture without a model call", async () => {
    const fixture = await buildAcceptanceACrmFixture();
    let modelCalls = 0;
    const forbiddenModelClient: RuntimeModelClient = {
      async generate() {
        modelCalls += 1;
        throw new Error("ACCEPTANCE_A_MODEL_CALL_FORBIDDEN");
      },
    };

    expect(fixture.ingestion.map((batch) => [batch.objectType, batch.rows, batch.commitEntries])).toEqual([
      ["account", 1_925, 1_925],
      ["account_health", 1_925, 1_925],
      ["opportunity", 11_000, 11_000],
    ]);
    expect(fixture.ingestion.every((batch) => batch.secondApprovalRequired)).toBe(true);
    expect(fixture.ingestion.every((batch) => batch.quarantined === 0 && batch.rejected === 0)).toBe(true);

    const first = await runAcceptanceProfile(forbiddenModelClient, fixture);
    const second = await runAcceptanceProfile(forbiddenModelClient, fixture);

    expect(modelCalls).toBe(0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.reduce((sum, run) => sum + run.totalAccountsConsidered, 0)).toBe(1_925);
    expect(first.reduce((sum, run) => sum + run.blockedCount, 0)).toBe(0);

    const recommendations = first.flatMap((run) => run.recommendations);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(
      recommendations.every(
        (recommendation) =>
          recommendation.verification.status === "passed" &&
          recommendation.verification.permissionGranted === true &&
          recommendation.sourceSignals.length > 0 &&
          recommendation.sourceSignals.every((signal) => signal.verified) &&
          recommendation.published === true,
      ),
    ).toBe(true);

    const durableRun = first.find((run) => run.ownerId === ACCEPTANCE_A_DURABLE_OWNER_ID);
    expect(durableRun).toBeDefined();
    const recommendation = durableRun?.recommendations.find(
      (candidate) =>
        (candidate.nextBestAction.customerFacing || candidate.nextBestAction.crmWriteBack) &&
        Boolean(candidate.nextBestAction.draft),
    );
    expect(recommendation).toBeDefined();

    if (process.env.ACCEPTANCE_A_DATABASE_BACKED === "true") {
      if (!recommendation) throw new Error("ACCEPTANCE_A_RECOMMENDATION_REQUIRED");
      const account = fixture.store.accounts.find((candidate) => candidate.id === recommendation.accountId);
      if (!account) throw new Error("ACCEPTANCE_A_ACCOUNT_REQUIRED");
      await exerciseDurableSpine(recommendation, account);
    }
  }, 30_000);
});
