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
import {
  attachHybridActionDraft,
  createRuntimeDraftRunBudget,
  hybridDraftContractMetadata,
  type HybridDraftOptions,
  type HybridDraftOutcome,
} from "../sales-execution/execution.agent";
import { runtimeDraftingPolicyFromEnv } from "../sales-execution/execution.policy";
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

export interface RunOptions {
  /** Injected clock for deterministic runs/evals. Defaults to now. */
  now?: string;
  /** Simulated human approvals keyed by accountId (human-in-the-loop). */
  approvals?: Record<string, boolean>;
  /** Approve all approval-gated actions (demo/eval convenience). */
  autoApprove?: boolean;
  /** Optional bounded runtime-drafting policy/client overrides for tests. */
  drafting?: HybridDraftOptions;
  /** Optional RLS context for durable Supabase-backed runs. */
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

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  };

  const workerCount = Math.min(Math.max(1, limit), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
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

async function auditDraftOutcome(
  rec: Recommendation,
  outcome: HybridDraftOutcome,
  runId: string,
  now: string,
  repo: RuntimeRepository,
): Promise<void> {
  await writeAuditLog(
    {
      runId,
      accountId: rec.accountId,
      actorId: "runtime_drafter",
      action: "runtime_draft",
      decision: outcome.source === "held" ? "blocked" : "allowed",
      reason:
        outcome.source === "model"
          ? "Bounded runtime model draft passed schema and grounding validation."
          : outcome.source === "template"
            ? "Deterministic template draft used; runtime model was not invoked."
            : outcome.source === "template_fallback"
              ? `Runtime model draft failed; deterministic template fallback used (${outcome.failureCode ?? "unknown"}).`
              : `Runtime draft held (${outcome.failureCode ?? "unknown"}).`,
      evidence: {
        recommendationId: outcome.recommendationId,
        draftSource: outcome.source,
        selectedSourceSignalIds: outcome.selectedSourceSignalIds,
        claimCitations: outcome.claimCitations,
        schemaValidation: outcome.schemaValidation,
        groundingValidation: outcome.groundingValidation,
        groundingFailedGates: outcome.groundingFailedGates,
        provider: outcome.telemetry?.provider,
        model: outcome.telemetry?.model,
        promptVersion: outcome.promptVersion,
        promptHash: outcome.promptHash,
        schemaVersion: outcome.schemaVersion,
        policyVersion: outcome.policyVersion,
        effectivePolicyHash: outcome.effectivePolicyHash,
        effectivePolicy: outcome.effectivePolicy,
        groundingVersion: outcome.groundingVersion,
        fallbackVersion: outcome.fallbackVersion,
        latencyMs: outcome.telemetry?.latencyMs,
        inputTokens: outcome.telemetry?.inputTokens,
        outputTokens: outcome.telemetry?.outputTokens,
        inputTokenUpperBound: outcome.inputTokenUpperBound,
        reservedRunTokens: outcome.reservedRunTokens,
        failureCode: outcome.failureCode,
      },
      occurredAt: now,
    },
    repo,
  );
}

export async function runDailyPrioritizationForOwner(
  ownerId: string,
  opts: RunOptions = {},
): Promise<PrioritizationRun> {
  const now = opts.now ?? new Date().toISOString();
  const runId = `run_${ownerId}_${now}`;
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

  // --- PLAN (deterministic scoring + ranking + action authority) ---
  const candidates = prioritizeAccounts({ runId, contexts, createdAt: now });
  state = transition(state, "PLAN", { candidates });

  // --- EXECUTE (bounded model drafting or deterministic template fallback) ---
  const draftingPolicy = opts.drafting?.policy ?? runtimeDraftingPolicyFromEnv();
  const runBudget = createRuntimeDraftRunBudget(draftingPolicy.maxRunTokens);
  const draftingOptions: HybridDraftOptions = {
    policy: draftingPolicy,
    modelClient: opts.drafting?.modelClient,
    runBudget,
    now,
  };

  const draftResults = await mapWithConcurrency(
    candidates,
    draftingPolicy.maxConcurrent,
    async (rec) => {
      const ctx = contextByAccount.get(rec.accountId);
      if (!ctx) {
        return {
          recommendation: rec,
          outcome: {
            source: "held" as const,
            recommendationId: rec.id,
            selectedSourceSignalIds: [],
            claimCitations: [],
            schemaValidation: "not_run" as const,
            groundingValidation: "not_run" as const,
            groundingFailedGates: [],
            failureCode: "DRAFT_CONTEXT_MISSING",
            ...hybridDraftContractMetadata(draftingPolicy),
          },
        };
      }
      return attachHybridActionDraft(rec, ctx, draftingOptions);
    },
  );

  for (const result of draftResults) {
    await auditDraftOutcome(result.recommendation, result.outcome, runId, now, repo);
  }

  const withDrafts = draftResults.map((result) => result.recommendation);
  state = transition(state, "EXECUTE", { candidates: withDrafts });

  // --- VERIFY (deterministic verification + human approval, fail-closed) ---
  const published: Recommendation[] = [];
  const blocked: OrchestratorBlocked[] = [];

  for (const result of draftResults) {
    const candidate = result.recommendation;

    if (result.outcome.source === "held") {
      const failedGates = [result.outcome.failureCode ?? "DRAFT_HELD"];
      blocked.push({
        recommendationId: candidate.id,
        accountId: candidate.accountId,
        failedGates,
      });
      await writeAuditLog(
        {
          runId,
          accountId: candidate.accountId,
          actorId: "orchestrator",
          action: "block_recommendation",
          decision: "blocked",
          reason: `Failed gates: ${failedGates.join(", ")}`,
          occurredAt: now,
        },
        repo,
      );
      continue;
    }

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
      properties: {
        published: published.length,
        blocked: blocked.length,
        runtimeDraftTokensReserved: runBudget.reservedTokens,
        runtimeDraftTokenBudget: runBudget.maxTokens,
      },
    },
    repo,
  );

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
