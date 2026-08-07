import { describe, expect, it } from "vitest";
import {
  createSeedStore,
  resetStore,
  runDailyPrioritizationForAllOwners,
  runtimeDraftingPolicyFromEnv,
  type DataStore,
  type RuntimeModelClient,
} from "agent-runtime";

const OWNER_ID = "33333333-3333-3333-3333-333333333333";
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

/**
 * Acceptance A is the model-disabled production baseline. This test executes
 * the real daily scheduler, deterministic prioritizer, deterministic template
 * drafting, verification, approval handling, and published-recommendation DTO
 * persistence boundary. Database/RLS/approval/execution/follow-up continuity is
 * verified by the companion migration acceptance suite in the same root gate.
 */
describe("Acceptance A — deterministic baseline", () => {
  it("completes without a model call and is byte-identical for identical input", async () => {
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
  });
});
