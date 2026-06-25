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
}

function buildContexts(inputs: OrchestratorInputs): AccountContext[] {
  return inputs.accounts.map((account) => ({
    account,
    contacts: inputs.contacts.filter((c) => c.accountId === account.id),
    opportunities: inputs.opportunities.filter((o) => o.accountId === account.id),
    activities: inputs.activities.filter((a) => a.accountId === account.id),
  }));
}

function applyApproval(
  rec: Recommendation,
  opts: RunOptions,
  runId: string,
  now: string,
): Recommendation {
  const needsApproval =
    rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack;
  if (!needsApproval) return rec;

  const approved = opts.autoApprove === true || opts.approvals?.[rec.accountId] === true;

  trackEvent({
    name: "approval_requested",
    runId,
    accountId: rec.accountId,
    userId: rec.ownerId,
    occurredAt: now,
    properties: { actionType: rec.nextBestAction.type },
  });

  if (!approved) return { ...rec, approvalStatus: "pending_approval" };

  writeAuditLog({
    runId,
    accountId: rec.accountId,
    actorId: rec.ownerId,
    action: "approve_action",
    decision: "approved",
    reason: `Human approved ${rec.nextBestAction.type} action.`,
    occurredAt: now,
  });
  trackEvent({
    name: "approval_granted",
    runId,
    accountId: rec.accountId,
    userId: rec.ownerId,
    occurredAt: now,
    properties: { actionType: rec.nextBestAction.type },
  });
  return { ...rec, approvalStatus: "approved" };
}

export async function runDailyPrioritizationForOwner(
  ownerId: string,
  opts: RunOptions = {},
): Promise<PrioritizationRun> {
  const now = opts.now ?? new Date().toISOString();
  const runId = `run_${ownerId}_${now}`;

  trackEvent({ name: "run_started", runId, userId: ownerId, occurredAt: now });

  // --- DISCOVER ---
  const accounts = await readAccounts(ownerId);
  const accountIds = accounts.map((a) => a.id);
  const [contacts, opportunities, activities] = await Promise.all([
    readContacts(accountIds),
    readOpportunities(accountIds),
    readActivities(accountIds),
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
    const withApproval = applyApproval(candidate, opts, runId, now);
    const { recommendation, allowed } = verifyRecommendation(withApproval, now);

    if (allowed) {
      const publishedRec: Recommendation = { ...recommendation, published: true };
      published.push(publishedRec);
      writeAuditLog({
        runId,
        accountId: publishedRec.accountId,
        actorId: "orchestrator",
        action: "publish_recommendation",
        decision: "allowed",
        reason: "Passed schema, guardrails, source verification, and permission.",
        evidence: { score: publishedRec.score, rank: publishedRec.rank },
        occurredAt: now,
      });
      trackEvent({
        name: "recommendation_published",
        runId,
        accountId: publishedRec.accountId,
        userId: ownerId,
        occurredAt: now,
        properties: { rank: publishedRec.rank, score: publishedRec.score },
      });
    } else {
      blocked.push({
        recommendationId: recommendation.id,
        accountId: recommendation.accountId,
        failedGates: recommendation.verification.failedGates,
      });
      writeAuditLog({
        runId,
        accountId: recommendation.accountId,
        actorId: "orchestrator",
        action: "block_recommendation",
        decision: "blocked",
        reason: `Failed gates: ${recommendation.verification.failedGates.join(", ")}`,
        occurredAt: now,
      });
      trackEvent({
        name: "recommendation_blocked",
        runId,
        accountId: recommendation.accountId,
        userId: ownerId,
        occurredAt: now,
        properties: { failedGates: recommendation.verification.failedGates },
      });
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

  trackEvent({
    name: "run_completed",
    runId,
    userId: ownerId,
    occurredAt: now,
    properties: { published: published.length, blocked: blocked.length },
  });

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
