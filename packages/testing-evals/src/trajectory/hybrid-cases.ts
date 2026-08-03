import {
  GENERATED_DRAFT_SCHEMA_VERSION,
  type Recommendation,
} from "@repo/shared-schemas";
import {
  RuntimeModelError,
  attachHybridActionDraft,
  buildVerifiedDraftContext,
  type RuntimeDraftingPolicy,
  type RuntimeModelClient,
} from "agent-runtime";
import type { TrajectoryCase } from "./corpus";
import { HYBRID_POLICY } from "./policies";

const authorityEnvelope = (rec: Recommendation): object => ({
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
});

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const modelClient = (
  outputOrError: unknown | Error,
): RuntimeModelClient => ({
  async generate() {
    if (outputOrError instanceof Error) throw outputOrError;
    return {
      output: outputOrError,
      telemetry: {
        provider: "anthropic",
        model: "eval-stub-model",
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 10,
      },
    };
  },
});

export interface HybridTrajectoryResult {
  total: number;
  passed: number;
  failures: string[];
}

export async function runHybridDraftTrajectories(
  candidate: Recommendation,
  trajectoryCase: TrajectoryCase,
  now: string,
): Promise<HybridTrajectoryResult> {
  const failures: string[] = [];
  const verifiedContext = buildVerifiedDraftContext(
    candidate,
    trajectoryCase.context,
    {
      maxSignals: HYBRID_POLICY.maxSignals,
      now,
      maxEvidenceAgeDays: HYBRID_POLICY.maxEvidenceAgeDays,
    },
  );
  const firstSignal = verifiedContext.signals[0];
  if (!firstSignal) {
    return {
      total: 1,
      passed: 0,
      failures: ["hybrid drafting: no verified signal was available"],
    };
  }

  const validOutput = {
    schemaVersion: GENERATED_DRAFT_SCHEMA_VERSION,
    actionType: candidate.nextBestAction.type,
    sentences: [
      {
        text: firstSignal.description,
        sourceSignalIds: [firstSignal.id],
      },
    ],
  };
  const alternateAction =
    candidate.nextBestAction.type === "log_research_note"
      ? "call"
      : "log_research_note";

  const cases: Array<{
    id: string;
    policy: RuntimeDraftingPolicy;
    client: RuntimeModelClient;
    expectedSource: "model" | "template_fallback" | "held";
    expectedFailure?: string;
  }> = [
    {
      id: "hybrid_model_grounded_success",
      policy: HYBRID_POLICY,
      client: modelClient(validOutput),
      expectedSource: "model",
    },
    {
      id: "hybrid_schema_failure_falls_back",
      policy: HYBRID_POLICY,
      client: modelClient({ invalid: true }),
      expectedSource: "template_fallback",
      expectedFailure: "DRAFT_SCHEMA_INVALID",
    },
    {
      id: "hybrid_grounding_failure_falls_back",
      policy: HYBRID_POLICY,
      client: modelClient({
        ...validOutput,
        sentences: [
          {
            text: "Unsupported factual statement.",
            sourceSignalIds: [firstSignal.id],
          },
        ],
      }),
      expectedSource: "template_fallback",
      expectedFailure: "DRAFT_CLAIM_NOT_GROUNDED",
    },
    {
      id: "hybrid_action_mutation_falls_back",
      policy: HYBRID_POLICY,
      client: modelClient({
        ...validOutput,
        actionType: alternateAction,
      }),
      expectedSource: "template_fallback",
      expectedFailure: "DRAFT_ACTION_MUTATION",
    },
    {
      id: "hybrid_timeout_falls_back",
      policy: HYBRID_POLICY,
      client: modelClient(
        new RuntimeModelError("DRAFT_MODEL_TIMEOUT", "Synthetic eval timeout."),
      ),
      expectedSource: "template_fallback",
      expectedFailure: "DRAFT_MODEL_TIMEOUT",
    },
    {
      id: "hybrid_timeout_holds_when_fallback_disabled",
      policy: { ...HYBRID_POLICY, fallback: "hold" },
      client: modelClient(
        new RuntimeModelError("DRAFT_MODEL_TIMEOUT", "Synthetic eval timeout."),
      ),
      expectedSource: "held",
      expectedFailure: "DRAFT_MODEL_TIMEOUT",
    },
  ];

  let passed = 0;
  for (const evalCase of cases) {
    const before = authorityEnvelope(candidate);
    const result = await attachHybridActionDraft(
      candidate,
      trajectoryCase.context,
      {
        policy: evalCase.policy,
        modelClient: evalCase.client,
        now,
        beforeModelInvoke: async () => undefined,
      },
    );

    const sourceMatches = result.outcome.source === evalCase.expectedSource;
    const failureMatches =
      evalCase.expectedFailure === undefined
        ? result.outcome.failureCode === undefined
        : result.outcome.failureCode === evalCase.expectedFailure;
    const authorityMatches = sameJson(
      before,
      authorityEnvelope(result.recommendation),
    );

    if (sourceMatches && failureMatches && authorityMatches) {
      passed += 1;
    } else {
      failures.push(
        `${evalCase.id}: expected source=${evalCase.expectedSource} failure=${evalCase.expectedFailure ?? "none"}; actual source=${result.outcome.source} failure=${result.outcome.failureCode ?? "none"} authorityPreserved=${authorityMatches}`,
      );
    }
  }

  return { total: cases.length, passed, failures };
}
