import {
  PrioritizationRunSchema,
  type PrioritizationRun,
  type Recommendation,
} from "@repo/shared-schemas";
import {
  createInitialState,
  transition,
  type OrchestratorInputs,
} from "./orchestrator.state";
import { prioritizeAccounts } from "../account-prioritizer/prioritizer.agent";
import type { AccountContext } from "../account-prioritizer/prioritizer.policy";
import { attachActionDraft } from "../sales-execution/execution.agent";
import { verifyRecommendation } from "../guardrails/guardrail.agent";
import { readAccounts } from "../../shared-tools/crm/read-accounts";
import { readContacts } from "../../shared-tools/crm/read-contacts";
import { readOpportunities } from "../../shared-tools/crm/read-opportunities";
import { readActivities } from "../../shared-tools/crm/read-activities";
import { writeAuditLog } from "../../shared-tools/audit/write-audit-log";
import { trackEvent } from "../../shared-tools/analytics/track-event";
import {
  resolveRepository,
  type RuntimeRepository,
} from "../../shared-tools/runtime-repository";
import type { RlsContext } from "../../shared-tools/supabase/rls-context";

/**
 * Orchestrator — the synchronous, deterministic runtime loop.
 *
 * DISCOVER -> PLAN -> EXECUTE -> VERIFY -> ITERATE -> PUBLISH. No LLM ranking,
 * no async judge, fail-closed at the guardrail gate, full audit trail.
 */
export interface RunOptions {
  /** Injected clock for deterministic runs/evals. Defaults to now. */
  now?: string;
  /** Simulated human approvals keyed by accountId (human-in-the-loop). */
  approvals?: Record<string, boolean>;
  /** Approve all approval-gated actions (demo/eval convenience). */
  autoApprove?: boolean;
  /**
   * Optional RLS context. When supplied AND Supabase is configured, the run
   * reads source signals from Supabase and writes audit evidence to
   * `audit_evidence`. Absent => deterministic, offline in-memory store.
   */
  rlsContext?: RlsContext;
}

function buildContexts(inputs: OrchestratorInputs): AccountContext[] {
  return inputs.accounts.map((account) => ({
    account,
    contacts: inputs.contacts.filter((c) => c.accountId === account.id),
    opportunities: inputs.opportunities.filter((o) => o.accountId === account.id),
    activities: inputs.activities.filter((a) => a.accountId === account.id),
  }));
}

async function applyApproval(
  rec: Recommendation,
  opts: RunOptions,
  runId: string,
  now: string,
  repo: RuntimeRepository,
): Promise<Recommendation> {
  const needsApproval =
    rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack;
  if (!needsApproval) return rec;

  const approved = opts.autoApprove === true || opts.approvals?.[rec.accountId] === true;

  await trackEvent(
    {
      name: "approval_requested",
      runId,
      accountId: rec.accountId,
      userId: rec.ownerId,
      occurredAt: now,
      properties: { actionType: rec.nextBestAction.type },
    },
    repo,
  );

  if (!approved) return { ...rec, approvalStatus: "pending_approval" };

  await writeAuditLog(
    {
      runId,
      accountId: rec.accountId,
      actorId: rec.ownerId,
      action: "approve_action",
      decision: "approved",
      reason: `Human approved ${rec.nextBestAction.type} action.`,
      occurredAt: now,
    },
    repo,
  );
  await trackEvent(
    {
      name: "approval_granted",
      runId,
      accountId: rec.accountId,
      userId: rec.ownerId,
      occurredAt: now,
      properties: { actionType: rec.nextBestAction.type },
    },
    repo,
  );
  return { ...rec, approvalStatus: "approved" };
}

export async function runDailyPrioritizationForOwner(
  ownerId: string,
  opts: RunOptions = {},
): Promise<PrioritizationRun> {
  const now = opts.now ?? new Date().toISOString();
  const runId = `run_${ownerId}_${now}`;

  // Resolve the run's data port once: Supabase when an RLS context is supplied
  // and configured, else the deterministic in-memory store.
  const repo = resolveRepository(opts.rlsContext, now);

  await trackEvent({ name: "run_started", runId, userId: ownerId, occurredAt: now }, repo);

  // --- DISCOVER ---
  const accounts = await readAccounts(ownerId, repo);
  const accountIds = accounts.map((a) => a.id);
  const [contacts, opportunities, activities] = await Promise.all([
    readContacts(accountIds, repo),
    readOpportunities(accountIds, repo),
    readActivities(accountIds, repo),
  ]);
  const inputs: OrchestratorInputs = { accounts, contacts, opportunities, activities };

  let state = createInitialState({ runId, ownerId, startedAt: now, inputs });
  const contexts = buildContexts(inputs);
  const contextByAccount = new Map(contexts.map((c) => [c.account.id, c]));

  // --- PLAN (deterministic scoring + ranking) ---
  const candidates = prioritizeAccounts({ runId, contexts, createdAt: now });
  state = transition(state, "PLAN", { candidates });

  // --- EXECUTE (attach drafts; never sends) ---
  const withDrafts = candidates.map((rec) => {
    const ctx = contextByAccount.get(rec.accountId);
    return ctx ? attachActionDraft(rec, ctx) : rec;
  });
  state = transition(state, "EXECUTE", { candidates: withDrafts });

  // --- VERIFY (human approval + deterministic guardrails, fail-closed) ---
  const published: Recommendation[] = [];
  const blocked: OrchestratorBlocked[] = [];

  for (const candidate of withDrafts) {
    const withApproval = await applyApproval(candidate, opts, runId, now, repo);
    const { recommendation, allowed } = verifyRecommendation(withApproval, now);

    if (allowed) {
      const publishedRec: Recommendation = { ...recommendation, published: true };
      published.push(publishedRec);
      await writeAuditLog(
        {
          runId,
          accountId: publishedRec.accountId,
          actorId: "orchestrator",
          action: "publish_recommendation",
          decision: "allowed",
          reason: "Passed schema, guardrails, source verification, and permission.",
          evidence: { score: publishedRec.score, rank: publishedRec.rank },
          occurredAt: now,
        },
        repo,
      );
      await trackEvent(
        {
          name: "recommendation_published",
          runId,
          accountId: publishedRec.accountId,
          userId: ownerId,
          occurredAt: now,
          properties: { rank: publishedRec.rank, score: publishedRec.score },
        },
        repo,
      );
    } else {
      blocked.push({
        recommendationId: recommendation.id,
        accountId: recommendation.accountId,
        failedGates: recommendation.verification.failedGates,
      });
      await writeAuditLog(
        {
          runId,
          accountId: recommendation.accountId,
          actorId: "orchestrator",
          action: "block_recommendation",
          decision: "blocked",
          reason: `Failed gates: ${recommendation.verification.failedGates.join(", ")}`,
          occurredAt: now,
        },
        repo,
      );
      await trackEvent(
        {
          name: "recommendation_blocked",
          runId,
          accountId: recommendation.accountId,
          userId: ownerId,
          occurredAt: now,
          properties: { failedGates: recommendation.verification.failedGates },
        },
        repo,
      );
    }
  }

  // --- ITERATE / PUBLISH ---
  state = transition(state, "VERIFY", { candidates: withDrafts });
  state = transition(state, "ITERATE", { published, blocked });
  state = transition(state, "PUBLISH", { published, blocked });
  state = transition(state, "DONE");

  const run: PrioritizationRun = PrioritizationRunSchema.parse({
    runId,
    ownerId,
    generatedAt: now,
    recommendations: published.sort((a, b) => a.rank - b.rank),
    totalAccountsConsidered: accounts.length,
    blockedCount: blocked.length,
  });

  await trackEvent(
    {
      name: "run_completed",
      runId,
      userId: ownerId,
      occurredAt: now,
      properties: { published: published.length, blocked: blocked.length },
    },
    repo,
  );

  // Final fail-closed validation of terminal state.
  if (state.phase !== "DONE") {
    throw new Error(`Run ${runId} did not reach DONE (phase=${state.phase}).`);
  }

  return run;
}

interface OrchestratorBlocked {
  recommendationId: string;
  accountId: string;
  failedGates: string[];
}
