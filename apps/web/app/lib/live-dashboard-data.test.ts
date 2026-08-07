import assert from "node:assert/strict";
import test from "node:test";
import type { Recommendation } from "@repo/shared-schemas";
import {
  assembleLiveDashboardData,
  liveDashboardExportRows,
  resolveDashboardDataMode,
  type LiveDashboardAccountSummary,
  type LiveDashboardDataSource,
  type LiveDashboardWorkspace,
} from "./live-dashboard-data";

const WORKSPACE_A = "aaaaaaaa-0000-0000-0000-000000000001";
const WORKSPACE_B = "bbbbbbbb-0000-0000-0000-000000000002";
const ACCOUNT_A = "aaaaaaa1-0000-0000-0000-000000000001";
const OWNER = "11111111-1111-1111-1111-111111111111";
const NOW = "2026-08-07T12:00:00.000Z";

const RECOMMENDATION: Recommendation = {
  id: "rec_workspace_a_1",
  runId: `run_${WORKSPACE_A}_${OWNER}_${NOW}`,
  accountId: ACCOUNT_A,
  ownerId: OWNER,
  score: 80,
  rank: 1,
  confidence: 0.9,
  reasonCodes: ["strategic_tier_account"],
  reasonNarrative: "Priority based on verified account evidence.",
  sourceSignals: [
    {
      kind: "account",
      refId: ACCOUNT_A,
      description: "Strategic account tier is authoritative.",
      verified: true,
    },
  ],
  nextBestAction: {
    type: "no_action_hold",
    customerFacing: false,
    crmWriteBack: false,
    objective: "Hold until the next verified signal.",
  },
  verification: {
    status: "passed",
    schemaValid: true,
    guardrailsPassed: true,
    sourceSignalsVerified: true,
    permissionGranted: true,
    failedGates: [],
    checkedAt: NOW,
  },
  approvalStatus: "not_required",
  published: true,
  createdAt: NOW,
};

const ACCOUNT: LiveDashboardAccountSummary = {
  id: ACCOUNT_A,
  name: "Helios Manufacturing",
  industry: "Industrial",
  tier: "strategic",
  openPipelineUsd: 180000,
  updatedAt: NOW,
};

function sourceFor(
  workspaces: LiveDashboardWorkspace[],
  recommendations: Recommendation[] = [RECOMMENDATION],
  accounts: LiveDashboardAccountSummary[] = [ACCOUNT],
): {
  source: LiveDashboardDataSource;
  recommendationCalls: string[];
  accountCalls: Array<{ workspaceId: string; accountIds: string[] }>;
} {
  const recommendationCalls: string[] = [];
  const accountCalls: Array<{ workspaceId: string; accountIds: string[] }> = [];
  return {
    recommendationCalls,
    accountCalls,
    source: {
      async listAuthorizedWorkspaces() {
        return workspaces;
      },
      async loadRecommendations(workspaceId) {
        recommendationCalls.push(workspaceId);
        return recommendations;
      },
      async loadAccounts(workspaceId, accountIds) {
        accountCalls.push({ workspaceId, accountIds });
        return accounts;
      },
    },
  };
}

test("production cannot fall back to demo data when Supabase is missing", () => {
  assert.throws(
    () => resolveDashboardDataMode("production", false),
    /DASHBOARD_REQUIRES_SUPABASE_IN_PRODUCTION/,
  );
  assert.equal(resolveDashboardDataMode("development", false), "demo");
  assert.equal(resolveDashboardDataMode("production", true), "live");
});

test("zero workspace memberships return an explicit no-workspace state", async () => {
  const fixture = sourceFor([]);
  const data = await assembleLiveDashboardData(fixture.source);

  assert.equal(data.status, "no_workspace");
  assert.equal(data.activeWorkspaceId, null);
  assert.deepEqual(data.recommendations, []);
  assert.deepEqual(fixture.recommendationCalls, []);
  assert.deepEqual(fixture.accountCalls, []);
});

test("one authorized workspace is selected automatically", async () => {
  const fixture = sourceFor([{ id: WORKSPACE_A, name: "Workspace A" }]);
  const data = await assembleLiveDashboardData(fixture.source);

  assert.equal(data.status, "ready");
  assert.equal(data.activeWorkspaceId, WORKSPACE_A);
  assert.deepEqual(fixture.recommendationCalls, [WORKSPACE_A]);
  assert.deepEqual(fixture.accountCalls, [{ workspaceId: WORKSPACE_A, accountIds: [ACCOUNT_A] }]);
  assert.equal(data.accountsById[ACCOUNT_A]?.name, "Helios Manufacturing");
});

test("multiple workspaces require an explicit selection before data loads", async () => {
  const fixture = sourceFor([
    { id: WORKSPACE_B, name: "Workspace B" },
    { id: WORKSPACE_A, name: "Workspace A" },
  ]);
  const data = await assembleLiveDashboardData(fixture.source);

  assert.equal(data.status, "select_workspace");
  assert.equal(data.activeWorkspaceId, null);
  assert.deepEqual(data.workspaces.map((workspace) => workspace.id), [WORKSPACE_A, WORKSPACE_B]);
  assert.deepEqual(fixture.recommendationCalls, []);
  assert.deepEqual(fixture.accountCalls, []);
});

test("an unauthorized requested workspace fails closed before recommendation reads", async () => {
  const fixture = sourceFor([{ id: WORKSPACE_A, name: "Workspace A" }]);
  const data = await assembleLiveDashboardData(fixture.source, WORKSPACE_B);

  assert.equal(data.status, "invalid_workspace");
  assert.equal(data.activeWorkspaceId, null);
  assert.deepEqual(fixture.recommendationCalls, []);
  assert.deepEqual(fixture.accountCalls, []);
});

test("repeated workspace query parameters fail closed before recommendation reads", async () => {
  const fixture = sourceFor([{ id: WORKSPACE_A, name: "Workspace A" }]);
  const data = await assembleLiveDashboardData(fixture.source, [WORKSPACE_A, WORKSPACE_B]);

  assert.equal(data.status, "invalid_workspace");
  assert.equal(data.activeWorkspaceId, null);
  assert.deepEqual(fixture.recommendationCalls, []);
  assert.deepEqual(fixture.accountCalls, []);
});

test("a valid explicit workspace scopes recommendation and account reads", async () => {
  const fixture = sourceFor([
    { id: WORKSPACE_A, name: "Workspace A" },
    { id: WORKSPACE_B, name: "Workspace B" },
  ]);
  const data = await assembleLiveDashboardData(fixture.source, WORKSPACE_A);

  assert.equal(data.status, "ready");
  assert.equal(data.activeWorkspaceId, WORKSPACE_A);
  assert.deepEqual(fixture.recommendationCalls, [WORKSPACE_A]);
  assert.deepEqual(fixture.accountCalls, [{ workspaceId: WORKSPACE_A, accountIds: [ACCOUNT_A] }]);
  assert.equal(data.recommendations[0]?.id, RECOMMENDATION.id);
});

test("recommendations are removed when the current owner-scoped account read no longer authorizes the account", async () => {
  const fixture = sourceFor(
    [{ id: WORKSPACE_A, name: "Workspace A" }],
    [RECOMMENDATION],
    [],
  );
  const data = await assembleLiveDashboardData(fixture.source, WORKSPACE_A);

  assert.equal(data.status, "ready");
  assert.deepEqual(data.recommendations, []);
  assert.deepEqual(data.accountsById, {});
  assert.deepEqual(fixture.recommendationCalls, [WORKSPACE_A]);
  assert.deepEqual(fixture.accountCalls, [{ workspaceId: WORKSPACE_A, accountIds: [ACCOUNT_A] }]);
});

test("live export rows use canonical account summaries and never demo metadata", async () => {
  const fixture = sourceFor([{ id: WORKSPACE_A, name: "Workspace A" }]);
  const data = await assembleLiveDashboardData(fixture.source, WORKSPACE_A);
  const rows = liveDashboardExportRows(data);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.account_id, ACCOUNT_A);
  assert.equal(rows[0]?.account_name, "Helios Manufacturing");
  assert.equal(rows[0]?.industry, "Industrial");
  assert.equal(rows[0]?.tier, "strategic");
  assert.equal(rows[0]?.revenue_usd, 180000);
  assert.equal(rows[0]?.owner_id, OWNER);
  assert.equal(rows[0]?.owner_name, "");
});
