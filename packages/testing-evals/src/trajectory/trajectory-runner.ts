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
import {
  runHybridDraftTrajectories,
  runHybridPromptInjectionTrajectory,
} from "./hybrid-cases";
import { TEMPLATE_POLICY } from "./policies";
import { loadTrajectoryProvenance } from "./provenance";

const LOCKED_MAX_RECOMMENDATIONS = 25;

export interface TrajectoryEvalSummary {
  corpusVersion: string;
  inputContractVersion: string;
  totalCases: number;
  authorityCasesPassed: number;
  topRankingCasesExpected: number;
  topRankingCasesPassed: number;
  templateDraftCasesPassed: number;
  verificationCasesPassed: number;
  approvalGateCases: number;
  approvalGateCasesPassed: number;
  promptInjectionCases: number;
  promptInjectionCasesPassed: number;
  hybridInjectionCases: number;
  hybridInjectionCasesPassed: number;
  guardrailCases: number;
  guardrailCasesPassed: number;
  hybridDraftCases: number;
  hybridDraftCasesPassed: number;
  publishEligibleCases: number;
  heldCases: number;
  reasonCodeCoverage: string[];
  actionCoverage: string[];
  passed: boolean;
  failures: string[];
}

function recommendationStateWithoutDraft(rec: Recommendation): object {
  const nextBestAction = { ...rec.nextBestAction };
  delete nextBestAction.draft;
  return { ...rec, nextBestAction };
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

const needsApproval = (rec: Recommendation): boolean =>
  rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack;

function approvedForVerification(rec: Recommendation): Recommendation {
  return needsApproval(rec)
    ? { ...rec, approvalStatus: "approved" }
    : rec;
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
  const provenance = loadTrajectoryProvenance();
  const { manifest, cases, guardrailCases } = loadTrajectoryCorpus();
  const failures: string[] = [];
  const contexts = cases.map((trajectoryCase) => trajectoryCase.context);
  const expectedByAccountId = new Map(
    cases.map((trajectoryCase) => [
      trajectoryCase.context.account.id,
      trajectoryCase,
    ]),
  );

  if (
    provenance.manifest.expectedMaxRecommendations !==
    LOCKED_MAX_RECOMMENDATIONS
  ) {
    failures.push(
      `manifest: expectedMaxRecommendations must remain ${LOCKED_MAX_RECOMMENDATIONS}, got ${provenance.manifest.expectedMaxRecommendations}`,
    );
  }
  if (RUNTIME_CONFIG.maxRecommendations !== LOCKED_MAX_RECOMMENDATIONS) {
    failures.push(
      `runtime: maxRecommendations must remain ${LOCKED_MAX_RECOMMENDATIONS}, got ${RUNTIME_CONFIG.maxRecommendations}`,
    );
  }

  let authorityCasesPassed = 0;
  let templateDraftCasesPassed = 0;
  let verificationCasesPassed = 0;
  let publishEligibleCases = 0;
  let heldCases = 0;
  const perCaseCandidates: Recommendation[] = [];

  // Exercise all 500 synthetic canonical states independently. This is a
  // current-input-contract-v1 policy-lock regression, not a source-ingestion
  // or independent policy-correctness oracle.
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

    const beforeDraft = recommendationStateWithoutDraft(candidate);
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
    if (
      !sameJson(
        beforeDraft,
        recommendationStateWithoutDraft(drafted.recommendation),
      )
    ) {
      draftErrors.push(
        "drafting mutated non-draft recommendation state, including approval, verification, or publication fields",
      );
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

    if (verification.recommendation.published) {
      pushFailure(
        failures,
        trajectoryCase.caseId,
        "verification incorrectly performed publication",
      );
    }

    if (actualPass) publishEligibleCases += 1;
    else heldCases += 1;
  }

  // Lock the exact product invariant rather than deriving the oracle selection
  // from the same runtime value under test.
  const rankedCandidates = prioritizeAccounts({
    runId: "trajectory_corpus_global_rank",
    contexts,
    createdAt: manifest.evaluationNow,
  });
  const expectedTop = cases
    .filter(
      (trajectoryCase) =>
        trajectoryCase.expected.rank <= LOCKED_MAX_RECOMMENDATIONS,
    )
    .sort((left, right) => left.expected.rank - right.expected.rank);
  let topRankingCasesPassed = 0;

  if (expectedTop.length !== LOCKED_MAX_RECOMMENDATIONS) {
    failures.push(
      `global ranking: oracle must contain exactly ${LOCKED_MAX_RECOMMENDATIONS} top accounts, got ${expectedTop.length}`,
    );
  }
  if (rankedCandidates.length !== LOCKED_MAX_RECOMMENDATIONS) {
    failures.push(
      `global ranking: runtime must return exactly ${LOCKED_MAX_RECOMMENDATIONS} accounts, got ${rankedCandidates.length}`,
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
    runId: "trajectory_corpus_global_rank",
    contexts: [...contexts].reverse(),
    createdAt: manifest.evaluationNow,
  });
  if (
    !sameJson(
      rankedCandidates.map(recommendationStateWithoutDraft),
      reversedCandidates.map(recommendationStateWithoutDraft),
    )
  ) {
    failures.push(
      "determinism: reversing input order changed the authoritative top-25 ranked output",
    );
  }

  // Approved-state verification and publish-eligibility simulation. This does
  // not perform an orchestrator publication write or delivery operation.
  let approvalGateCases = 0;
  let approvalGateCasesPassed = 0;
  const approvalBase = perCaseCandidates.find(
    (candidate) =>
      candidate.confidence >= RUNTIME_CONFIG.minPublishableConfidence &&
      needsApproval(candidate),
  );

  if (!approvalBase) {
    failures.push(
      "approval gates: no approval-gated publish-eligible candidate was available",
    );
  } else {
    const approvalCases: Array<{
      status: Recommendation["approvalStatus"];
      expectedAllowed: boolean;
    }> = [
      { status: "pending_approval", expectedAllowed: false },
      { status: "rejected", expectedAllowed: false },
      { status: "approved", expectedAllowed: true },
    ];

    for (const approvalCase of approvalCases) {
      approvalGateCases += 1;
      const candidate: Recommendation = {
        ...approvalBase,
        approvalStatus: approvalCase.status,
        published: false,
      };
      const decision = verifyRecommendation(candidate, manifest.evaluationNow);
      const hasApprovalGate =
        decision.recommendation.verification.failedGates.includes(
          "approval_required",
        );
      const gateMatches = approvalCase.expectedAllowed
        ? !hasApprovalGate
        : hasApprovalGate;
      const publicationUntouched = !decision.recommendation.published;

      if (
        decision.allowed === approvalCase.expectedAllowed &&
        gateMatches &&
        publicationUntouched
      ) {
        approvalGateCasesPassed += 1;
      } else {
        failures.push(
          `approval_${approvalCase.status}: expected allowed=${approvalCase.expectedAllowed} approvalGate=${!approvalCase.expectedAllowed} published=false; actual allowed=${decision.allowed} failedGates=${decision.recommendation.verification.failedGates.join("|")} published=${decision.recommendation.published}`,
        );
      }
    }
  }

  // This first check proves raw CRM note bodies do not influence deterministic
  // ranking authority.
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
      runId: `injection_${trajectoryCase.caseId}`,
      contexts: [trajectoryCase.context],
      createdAt: manifest.evaluationNow,
    })[0];
    const sanitized = prioritizeAccounts({
      runId: `injection_${trajectoryCase.caseId}`,
      contexts: [sanitizedInjectionContext(trajectoryCase)],
      createdAt: manifest.evaluationNow,
    })[0];

    if (
      original &&
      sanitized &&
      sameJson(
        recommendationStateWithoutDraft(original),
        recommendationStateWithoutDraft(sanitized),
      )
    ) {
      promptInjectionCasesPassed += 1;
    } else {
      pushFailure(
        failures,
        trajectoryCase.caseId,
        "customer-controlled prompt-injection text changed deterministic ranking authority",
      );
    }
  }

  // This second check crosses the verified-context, model-candidate, grounding,
  // fallback, and final publish-eligibility boundary.
  let hybridInjectionCases = 0;
  let hybridInjectionCasesPassed = 0;
  const candidateByAccountId = new Map(
    perCaseCandidates.map((candidate) => [candidate.accountId, candidate]),
  );
  const hybridInjectionCase = injectionCases.find((trajectoryCase) => {
    const candidate = candidateByAccountId.get(
      trajectoryCase.context.account.id,
    );
    return (
      candidate !== undefined &&
      candidate.confidence >= RUNTIME_CONFIG.minPublishableConfidence &&
      candidate.nextBestAction.type !== "no_action_hold"
    );
  });

  if (!hybridInjectionCase) {
    failures.push(
      "hybrid injection: no draftable publish-eligible injection case was available",
    );
  } else {
    const candidate = candidateByAccountId.get(
      hybridInjectionCase.context.account.id,
    );
    if (!candidate) {
      failures.push("hybrid injection: candidate lookup failed");
    } else {
      const hybridInjection = await runHybridPromptInjectionTrajectory(
        candidate,
        hybridInjectionCase,
        manifest.evaluationNow,
      );
      hybridInjectionCases = hybridInjection.total;
      hybridInjectionCasesPassed = hybridInjection.passed;
      failures.push(...hybridInjection.failures);
    }
  }

  const guardrailBase = perCaseCandidates.find(
    (candidate) =>
      candidate.confidence >= RUNTIME_CONFIG.minPublishableConfidence,
  );
  let guardrailCasesPassed = 0;

  if (!guardrailBase) {
    failures.push(
      "guardrails: no publish-eligible base candidate was available",
    );
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
      candidate.confidence >= RUNTIME_CONFIG.minPublishableConfidence &&
      candidate.nextBestAction.type !== "no_action_hold" &&
      needsApproval(candidate),
  );

  if (!hybridBase) {
    failures.push(
      "hybrid drafting: no approval-gated model-draftable base candidate was available",
    );
  } else {
    const hybridCase = expectedByAccountId.get(hybridBase.accountId);
    if (!hybridCase) {
      failures.push(
        "hybrid drafting: base candidate was missing from the oracle",
      );
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
    inputContractVersion: provenance.manifest.inputContractVersion,
    totalCases: cases.length,
    authorityCasesPassed,
    topRankingCasesExpected: expectedTop.length,
    topRankingCasesPassed,
    templateDraftCasesPassed,
    verificationCasesPassed,
    approvalGateCases,
    approvalGateCasesPassed,
    promptInjectionCases: injectionCases.length,
    promptInjectionCasesPassed,
    hybridInjectionCases,
    hybridInjectionCasesPassed,
    guardrailCases: guardrailCases.length,
    guardrailCasesPassed,
    hybridDraftCases,
    hybridDraftCasesPassed,
    publishEligibleCases,
    heldCases,
    reasonCodeCoverage,
    actionCoverage,
    passed: failures.length === 0,
    failures,
  };
}
