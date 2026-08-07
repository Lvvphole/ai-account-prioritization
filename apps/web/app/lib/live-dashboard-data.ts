import type { Recommendation } from "@repo/shared-schemas";

export interface LiveDashboardWorkspace {
  id: string;
  name: string;
}

export interface LiveDashboardAccountSummary {
  id: string;
  name: string;
  industry?: string;
  tier: string;
  openPipelineUsd: number;
  updatedAt: string;
}

export interface LiveDashboardDataSource {
  listAuthorizedWorkspaces(): Promise<LiveDashboardWorkspace[]>;
  loadRecommendations(workspaceId: string): Promise<Recommendation[]>;
  loadAccounts(
    workspaceId: string,
    accountIds: string[],
  ): Promise<LiveDashboardAccountSummary[]>;
}

export type LiveDashboardStatus =
  | "ready"
  | "no_workspace"
  | "select_workspace"
  | "invalid_workspace";

export interface LiveDashboardData {
  status: LiveDashboardStatus;
  workspaces: LiveDashboardWorkspace[];
  activeWorkspaceId: string | null;
  recommendations: Recommendation[];
  accountsById: Record<string, LiveDashboardAccountSummary>;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeWorkspaces(
  workspaces: LiveDashboardWorkspace[],
): LiveDashboardWorkspace[] {
  const unique = new Map<string, LiveDashboardWorkspace>();
  for (const workspace of workspaces) {
    const id = workspace.id.trim();
    if (!id) continue;
    unique.set(id, { id, name: workspace.name.trim() || id });
  }
  return [...unique.values()].sort((a, b) => compareText(a.id, b.id));
}

export function resolveDashboardDataMode(
  nodeEnv: string | undefined,
  supabaseConfigured: boolean,
): "live" | "demo" {
  if (nodeEnv === "production" && !supabaseConfigured) {
    throw new Error("DASHBOARD_REQUIRES_SUPABASE_IN_PRODUCTION");
  }
  return supabaseConfigured ? "live" : "demo";
}

export function resolveWorkspaceSelection(
  workspaces: LiveDashboardWorkspace[],
  requestedWorkspaceId?: string | string[],
): Pick<LiveDashboardData, "status" | "activeWorkspaceId"> {
  const normalized = normalizeWorkspaces(workspaces);
  if (normalized.length === 0) {
    return { status: "no_workspace", activeWorkspaceId: null };
  }

  // Repeated workspace query parameters are ambiguous authority input. Reject
  // them deterministically rather than selecting one value by request order.
  if (Array.isArray(requestedWorkspaceId)) {
    return { status: "invalid_workspace", activeWorkspaceId: null };
  }

  const requested = requestedWorkspaceId?.trim();
  if (requested) {
    if (normalized.some((workspace) => workspace.id === requested)) {
      return { status: "ready", activeWorkspaceId: requested };
    }
    return { status: "invalid_workspace", activeWorkspaceId: null };
  }

  if (normalized.length === 1) {
    return { status: "ready", activeWorkspaceId: normalized[0]!.id };
  }

  return { status: "select_workspace", activeWorkspaceId: null };
}

export async function assembleLiveDashboardData(
  source: LiveDashboardDataSource,
  requestedWorkspaceId?: string | string[],
): Promise<LiveDashboardData> {
  const workspaces = normalizeWorkspaces(await source.listAuthorizedWorkspaces());
  const selection = resolveWorkspaceSelection(workspaces, requestedWorkspaceId);

  if (selection.status !== "ready" || !selection.activeWorkspaceId) {
    return {
      ...selection,
      workspaces,
      recommendations: [],
      accountsById: {},
    };
  }

  const recommendations = (await source.loadRecommendations(selection.activeWorkspaceId))
    .slice()
    .sort((a, b) => a.rank - b.rank || compareText(a.id, b.id));
  const accountIds = [...new Set(recommendations.map((recommendation) => recommendation.accountId))]
    .sort(compareText);
  const accounts = await source.loadAccounts(selection.activeWorkspaceId, accountIds);
  const requestedAccountIds = new Set(accountIds);
  const accountsById: Record<string, LiveDashboardAccountSummary> = {};

  for (const account of accounts.slice().sort((a, b) => compareText(a.id, b.id))) {
    if (requestedAccountIds.has(account.id)) {
      accountsById[account.id] = account;
    }
  }

  // Canonical account rows are the current authorization check. A durable
  // recommendation can outlive an ownership reassignment, so do not expose the
  // historical recommendation unless the current owner-scoped account query
  // also returned its account.
  const authorizedAccountIds = new Set(Object.keys(accountsById));
  const authorizedRecommendations = recommendations.filter((recommendation) =>
    authorizedAccountIds.has(recommendation.accountId),
  );

  return {
    status: "ready",
    workspaces,
    activeWorkspaceId: selection.activeWorkspaceId,
    recommendations: authorizedRecommendations,
    accountsById,
  };
}

/**
 * Build live export rows only from data that the configured dashboard already
 * authorized and rendered. Demo metadata is never consulted on this path.
 */
export function liveDashboardExportRows(
  data: LiveDashboardData,
): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];

  for (const rec of data.recommendations) {
    const account = data.accountsById[rec.accountId];
    if (!account) continue;

    rows.push({
      rank: rec.rank,
      account_id: rec.accountId,
      account_name: account.name,
      industry: account.industry ?? "",
      tier: account.tier,
      owner_id: rec.ownerId,
      // No authoritative representative display name is loaded by this view.
      // Preserve the column without substituting demo identity data.
      owner_name: "",
      score: rec.score,
      confidence: rec.confidence,
      reason_codes: rec.reasonCodes.join("|"),
      next_action: rec.nextBestAction.type,
      objective: rec.nextBestAction.objective,
      revenue_usd: account.openPipelineUsd,
      approval_status: rec.approvalStatus,
      evidence_count: rec.sourceSignals.length,
      evidence_verified: rec.sourceSignals.filter((signal) => signal.verified).length,
      evidence: rec.sourceSignals
        .map(
          (signal) =>
            `${signal.kind}:${signal.refId}:${signal.description}${signal.verified ? "" : " (UNVERIFIED)"}`,
        )
        .join(" | "),
      verification: rec.verification.status,
      run_id: rec.runId,
      created_at: rec.createdAt,
    });
  }

  return rows;
}
