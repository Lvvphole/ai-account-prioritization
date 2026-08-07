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
  requestedWorkspaceId?: string,
): Pick<LiveDashboardData, "status" | "activeWorkspaceId"> {
  const normalized = normalizeWorkspaces(workspaces);
  if (normalized.length === 0) {
    return { status: "no_workspace", activeWorkspaceId: null };
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
  requestedWorkspaceId?: string,
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
  const allowedAccountIds = new Set(accountIds);
  const accountsById: Record<string, LiveDashboardAccountSummary> = {};

  for (const account of accounts.slice().sort((a, b) => compareText(a.id, b.id))) {
    if (allowedAccountIds.has(account.id)) {
      accountsById[account.id] = account;
    }
  }

  return {
    status: "ready",
    workspaces,
    activeWorkspaceId: selection.activeWorkspaceId,
    recommendations,
    accountsById,
  };
}
