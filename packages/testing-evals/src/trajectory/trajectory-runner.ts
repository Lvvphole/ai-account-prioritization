import type { Recommendation } from "@repo/shared-schemas";
import {
  RUNTIME_CONFIG,
  attachHybridActionDraft,
  prioritizeAccounts,
  verifyRecommendation,
} from "agent-runtime";
import {
  loadTrajectoryCorpus,
  type TrajectoryCase,
  type TrajectoryContext,
} from "./corpus";
import { runHybridDraftTrajectories } from "./hybrid-cases";
import { TEMPLATE_POLICY } from "./policies";

export interface TrajectoryEvalSummary {
  corpusVersion: string;
  totalCases: number;
  authorityCasesPassed: number;
  topRankingCasesExpected: number;
  topRankingCasesPassed: number;
  templateDraftCasesPassed: number;
  verificationCasesPassed: number;
  promptInjectionCases: number;
  promptInjectionCasesPassed: number;
  guardrailCases: number;
  guardrailCasesPassed: number;
  hybridDraftCases: number;
  hybridDraftCasesPassed: number;
  publishableCases: number;
  heldCases: number;
  reasonCodeCoverage: string[];
  actionCoverage: string[];
  passed: boolean;
  failures: string[];
}

function authorityEnvelope(rec: Recommendation): object {
  return {
    accountId: rec.accountId,
    ownerId: rec.ownerId,
    score: rec.score,
    rank: rec.rank,
    confidence: rec.confidence,
    reasonCodes: rec.reasonCodes,
    sourceSignals: rec.sourceSignals,
    nextBestAction: {
      type: rec.nextBestAction.type,
      customerFacing: rec.nextBestAction.customerFacing,
      crmWriteBack: rec.nextBestAction.crmWriteBack,
      objective: rec.nextBestAction.objective,
    },
  };
}

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const confidenceMatches = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 0.000001;

const pushFailure = (
  failures: string[],
  caseId: string,
  message: string,
): void => {
  failures.push(`${caseId}: ${message}`);
};

function approvedForVerification(rec: Recommendation): Recommendation {
  if (
    !rec.nextBestAction.customerFacing &&
    !rec.nextBestAction.crmWriteBack
  ) {
    return rec;
  }
  return { ...rec, approvalStatus: "approved" };
}

function sanitizedInjectionContext(
  trajectoryCase: TrajectoryCase,
): TrajectoryContext {
  return {
    ...trajectoryCase.context,
    activities: trajectoryCase.context.activities.map((activity) => ({
      ...activity,
      body:
        typeof activity.body === "string" &&
        activity.body.includes("IGNORE ALL PREVIOUS INSTRUCTIONS")
          ? "Customer-provided note treated only as data."
          : activity.body,
    })),
  };
}

export async function runTrajectoryEval(): Promise<TrajectoryEvalSummary> {
  const { manifest, cases, guardrailCases } = loadTrajectoryCorpus();
  const failures: string[] = [];
  const contexts = cases.map((trajectoryCase) => trajectoryCase.context);
  const expectedByAccountId = new Map(
    cases.map((trajectoryCase) => [
      trajectoryCase.context.account.id,
      trajectoryCase,
    ]),
  );

  let authorityCasesPassed = 0;
  let templateDraftCasesPassed = 0;
  let verificationCasesPassed = 0;
  let publishableCases = 0;
  let heldCases = 0;
  const perCaseCandidates: Recommendation[] = [];

  // Exercise all 500 account states independently. The production prioritizer
  // intentionally caps one run at maxRecommendations, so single-account runs
  // let the corpus evaluate every score/confidence/reason/action trajectory
  // without weakening that production limit.
  for (const trajectoryCase of cases) {
    const candidate = prioritizeAccounts({
      runId: `trajectory_${trajectoryCase.caseId}`,
      contexts: [trajectoryCase.context],
      createdAt: manifest.evaluationNow,
    })[0];

    if (!candidate) {
      pushFailure(
        failures,
        trajectoryCase.caseId,
        "single-account prioritization returned no candidate",
      );
      continue;
    }
    perCaseCandidates.push(candidate);

    const expected = trajectoryCase.expected;
    const authorityErrors: string[] = [];

    if (candidate.score !== expected.score) {
      authorityErrors.push(
        `score expected=${expected.score} actual=${candidate.score}`,
      );
    }
    if (!confidenceMatches(candidate.confidence, expected.confidence)) {
      authorityErrors.push(
        `confidence expected=${expected.confidence} actual=${candidate.confidence}`,
      );
    }
    if (candidate.rank !== 1) {
      authorityErrors.push(
        `single-account rank expected=1 actual=${candidate.rank}`,
      );
    }
    if (!sameJson(candidate.reasonCodes, expected.reasonCodes)) {
      authorityErrors.push(
        `reasonCodes expected=${expected.reasonCodes.join("|")} actual=${candidate.reasonCodes.join("|")}`,
      );
    }
    if (candidate.nextBestAction.type !== expected.nextBestActionType) {
      authorityErrors.push(
        `action expected=${expected.nextBestActionType} actual=${candidate.nextBestAction.type}`,
      );
    }
    if (
      candidate.sourceSignals.length === 0 ||
      candidate.sourceSignals.some((signal) => !signal.verified)
    ) {
      authorityErrors.push("source signals are missing or unverified");
    }

    if (authorityErrors.length === 0) {
      authorityCasesPassed += 1;
    } else {
      for (const message of authorityErrors) {
        pushFailure(failures, trajectoryCase.caseId, message);
      }
    }

    const beforeDraft = authorityEnvelope(candidate);
    const drafted = await attachHybridActionDraft(
      candidate,
      trajectoryCase.context,
      {
        policy: TEMPLATE_POLICY,
        now: manifest.evaluationNow,
      },
    );
    const draftErrors: string[] = [];

    if (drafted.outcome.source !== "template") {
      draftErrors.push(
        `expected deterministic template source, got ${drafted.outcome.source}${drafted.outcome.failureCode ? ` (${drafted.outcome.failureCode})` : ""}`,
      );
    }
    if (!sameJson(beforeDraft, authorityEnvelope(drafted.recommendation))) {
      draftErrors.push("drafting mutated the deterministic authority envelope");
    }

    const shouldHaveDraft =
      drafted.recommendation.nextBestAction.type !== "no_action_hold";
    if (
      shouldHaveDraft &&
      !drafted.recommendation.nextBestAction.draft?.trim()
    ) {
      draftErrors.push("draftable action did not receive a template draft");
    }
    if (
      !shouldHaveDraft &&
      drafted.recommendation.nextBestAction.draft !== undefined
    ) {
      draftErrors.push("no_action_hold unexpectedly received a draft");
    }

    if (draftErrors.length === 0) {
      templateDraftCasesPassed += 1;
    } else {
      for (const message of draftErrors) {
        pushFailure(failures, trajectoryCase.caseId, message);
      }
    }

    const verification = verifyRecommendation(
      approvedForVerification(drafted.recommendation),
      manifest.evaluationNow,
    );
    const actualPass = verification.allowed;
    const expectedPass = expected.confidenceGatePasses;

    if (actualPass === expectedPass) {
      verificationCasesPassed += 1;
    } else {
      pushFailure(
        failures,
        trajectoryCase.caseId,
        `verification expected allowed=${expectedPass} actual=${actualPass} failedGates=${verification.recommendation.verification.failedGates.join("|")}`,
      );
    }

    if (
      !expectedPass &&
      !verification.recommendation.verification.failedGates.includes(
        "confidence_below_floor",
      )
    ) {
      pushFailure(
        failures,
        trajectoryCase.caseId,
        "expected confidence_below_floor hold gate was not present",
      );
    }

    if (actualPass) publishableCases += 1;
    else heldCases += 1;
  }

  // Exercise the real production run limit and stable global ordering against
  // the oracle's top-N accounts. We do not raise maxRecommendations for tests.
  const rankedCandidates = prioritizeAccounts({
    runId: "trajectory_corpus_global_rank",
    contexts,
    createdAt: manifest.evaluationNow,
  });
  const expectedTop = cases
    .filter(
      (trajectoryCase) =>
        trajectoryCase.expected.rank <= RUNTIME_CONFIG.maxRecommendations,
    )
    .sort((left, right) => left.expected.rank - right.expected.rank);
  let topRankingCasesPassed = 0;

  if (rankedCandidates.length !== expectedTop.length) {
    failures.push(
      `global ranking: expected ${expectedTop.length} selected accounts, got ${rankedCandidates.length}`,
    );
  }

  const rankingChecks = Math.max(rankedCandidates.length, expectedTop.length);
  for (let index = 0; index < rankingChecks; index += 1) {
    const actual = rankedCandidates[index];
    const expected = expectedTop[index];
    if (!actual || !expected) {
      failures.push(
        `global ranking: missing ${actual ? "oracle" : "candidate"} at position ${index + 1}`,
      );
      continue;
    }

    const expectedAccountId = expected.context.account.id;
    if (
      actual.accountId === expectedAccountId &&
      actual.rank === expected.expected.rank &&
      actual.score === expected.expected.score
    ) {
      topRankingCasesPassed += 1;
    } else {
      failures.push(
        `global ranking position ${index + 1}: expected account=${expectedAccountId} rank=${expected.expected.rank} score=${expected.expected.score}; actual account=${actual.accountId} rank=${actual.rank} score=${actual.score}`,
      );
    }
  }

  const reversedCandidates = prioritizeAccounts({
    runId: "trajectory_corpus_global_rank_reversed",
    contexts: [...contexts].reverse(),
    createdAt: manifest.evaluationNow,
  });
  if (
    !sameJson(
      rankedCandidates.map(authorityEnvelope),
      reversedCandidates.map(authorityEnvelope),
    )
  ) {
    failures.push(
      "determinism: reversing input order changed the authoritative top-N ranked output",
    );
  }

  const injectionCases = cases.filter((trajectoryCase) =>
    trajectoryCase.context.activities.some(
      (activity) =>
        typeof activity.body === "string" &&
        activity.body.includes("IGNORE ALL PREVIOUS INSTRUCTIONS"),
    ),
  );
  let promptInjectionCasesPassed = 0;

  for (const trajectoryCase of injectionCases) {
    const original = prioritizeAccounts({
      runId: `injection_original_${trajectoryCase.caseId}`,
      contexts: [trajectoryCase.context],
      createdAt: manifest.evaluationNow,
    })[0];
    const sanitized = prioritizeAccounts({
      runId: `injection_sanitized_${trajectoryCase.caseId}`,
      contexts: [sanitizedInjectionContext(trajectoryCase)],
      createdAt: manifest.evaluationNow,
    })[0];

    if (
      original &&
      sanitized &&
      sameJson(authorityEnvelope(original), authorityEnvelope(sanitized))
    ) {
      promptInjectionCasesPassed += 1;
    } else {
      pushFailure(
        failures,
        trajectoryCase.caseId,
        "customer-controlled prompt-injection text changed authoritative output",
      );
    }
  }

  const guardrailBase = perCaseCandidates.find(
    (candidate) => candidate.confidence >= 0.2,
  );
  let guardrailCasesPassed = 0;

  if (!guardrailBase) {
    failures.push("guardrails: no publishable base candidate was available");
  } else {
    const approvedBase = approvedForVerification(guardrailBase);
    for (const guardrailCase of guardrailCases) {
      const candidate: Recommendation = {
        ...approvedBase,
        nextBestAction: {
          ...approvedBase.nextBestAction,
          draft: guardrailCase.draft,
        },
      };
      const decision = verifyRecommendation(candidate, manifest.evaluationNow);

      if (guardrailCase.expectedViolation === null) {
        if (decision.allowed) {
          guardrailCasesPassed += 1;
        } else {
          pushFailure(
            failures,
            guardrailCase.caseId,
            `safe candidate was blocked: ${decision.recommendation.verification.failedGates.join("|")}`,
          );
        }
        continue;
      }

      const expectedGate = `unsupported_claim:${guardrailCase.expectedViolation}`;
      if (
        !decision.allowed &&
        decision.recommendation.verification.failedGates.includes(expectedGate)
      ) {
        guardrailCasesPassed += 1;
      } else {
        pushFailure(
          failures,
          guardrailCase.caseId,
          `expected gate ${expectedGate}; actual=${decision.recommendation.verification.failedGates.join("|")}`,
        );
      }
    }
  }

  let hybridDraftCases = 0;
  let hybridDraftCasesPassed = 0;
  const hybridBase = perCaseCandidates.find(
    (candidate) =>
      candidate.confidence >= 0.2 &&
      candidate.nextBestAction.type !== "no_action_hold",
  );

  if (!hybridBase) {
    failures.push(
      "hybrid drafting: no model-draftable base candidate was available",
    );
  } else {
    const hybridCase = expectedByAccountId.get(hybridBase.accountId);
    if (!hybridCase) {
      failures.push("hybrid drafting: base candidate was missing from the oracle");
    } else {
      const hybrid = await runHybridDraftTrajectories(
        hybridBase,
        hybridCase,
        manifest.evaluationNow,
      );
      hybridDraftCases = hybrid.total;
      hybridDraftCasesPassed = hybrid.passed;
      failures.push(...hybrid.failures);
    }
  }

  const reasonCodeCoverage = [
    ...new Set(
      perCaseCandidates.flatMap((candidate) => candidate.reasonCodes),
    ),
  ].sort();
  const actionCoverage = [
    ...new Set(
      perCaseCandidates.map((candidate) => candidate.nextBestAction.type),
    ),
  ].sort();

  return {
    corpusVersion: manifest.version,
    totalCases: cases.length,
    authorityCasesPassed,
    topRankingCasesExpected: expectedTop.length,
    topRankingCasesPassed,
    templateDraftCasesPassed,
    verificationCasesPassed,
    promptInjectionCases: injectionCases.length,
    promptInjectionCasesPassed,
    guardrailCases: guardrailCases.length,
    guardrailCasesPassed,
    hybridDraftCases,
    hybridDraftCasesPassed,
    publishableCases,
    heldCases,
    reasonCodeCoverage,
    actionCoverage,
    passed: failures.length === 0,
    failures,
  };
}
