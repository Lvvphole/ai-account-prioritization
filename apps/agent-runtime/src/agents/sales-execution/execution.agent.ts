import { Buffer } from "node:buffer";
import {
  GENERATED_DRAFT_SCHEMA_VERSION,
  GeneratedDraftSchema,
  type Recommendation,
} from "@repo/shared-schemas";
import type { AccountContext } from "../account-prioritizer/prioritizer.policy";
import { generateCallObjective } from "./tools/generate-call-objective";
import { generateEmailDraft } from "./tools/generate-email-draft";
import { generateCrmNote } from "./tools/generate-crm-note";
import { buildVerifiedDraftContext, type VerifiedDraftContext } from "./build-draft-context";
import {
  buildRuntimeDraftUserPrompt,
  RUNTIME_DRAFT_PROMPT_HASH,
  RUNTIME_DRAFT_PROMPT_VERSION,
  RUNTIME_DRAFT_SYSTEM_PROMPT,
} from "./execution.prompt";
import {
  RUNTIME_DRAFT_POLICY_VERSION,
  runtimeDraftingPolicyFromEnv,
  type RuntimeDraftingPolicy,
} from "./execution.policy";
import {
  anthropicRuntimeModelClient,
  RuntimeModelError,
  type RuntimeModelClient,
  type RuntimeModelRequest,
  type RuntimeModelTelemetry,
} from "../../inference/runtime-model";
import {
  DRAFT_GROUNDING_RULES_VERSION,
  renderGroundedDraft,
  validateDraftGrounding,
} from "./validate-draft-grounding";

export const DETERMINISTIC_DRAFT_FALLBACK_VERSION = "deterministic-template-v1";
const MODEL_PROTOCOL_TOKEN_OVERHEAD = 64;

/**
 * Deterministic template drafter retained as the offline baseline and explicit
 * fail-safe fallback. Nothing here sends or writes anything.
 */
export function attachActionDraft(
  rec: Recommendation,
  ctx: AccountContext,
): Recommendation {
  const primaryContact = ctx.contacts.find((c) => c.isPrimary) ?? ctx.contacts[0];
  const action = rec.nextBestAction;
  let draft: string | undefined;

  switch (action.type) {
    case "call":
    case "schedule_meeting":
      draft = generateCallObjective({
        account: ctx.account,
        objective: action.objective,
        signals: rec.sourceSignals,
      });
      break;
    case "send_email":
      draft = generateEmailDraft({
        account: ctx.account,
        primaryContact,
        repId: rec.ownerId,
      });
      break;
    case "log_research_note":
      draft = generateCrmNote({
        account: ctx.account,
        reasonCodes: rec.reasonCodes,
        signals: rec.sourceSignals,
        score: rec.score,
        rank: rec.rank,
      });
      break;
    case "request_intro":
    case "escalate_to_manager":
    case "no_action_hold":
    default:
      draft = undefined;
  }

  return { ...rec, nextBestAction: { ...action, draft } };
}

export type DraftSource = "model" | "template" | "template_fallback" | "held";

export interface RuntimeDraftRunBudget {
  maxTokens: number;
  reservedTokens: number;
}

export function createRuntimeDraftRunBudget(maxTokens: number): RuntimeDraftRunBudget {
  return { maxTokens, reservedTokens: 0 };
}

export interface HybridDraftOutcome {
  source: DraftSource;
  failureCode?: string;
  telemetry?: RuntimeModelTelemetry;
  promptVersion: string;
  promptHash: string;
  schemaVersion: string;
  policyVersion: string;
  groundingVersion: string;
  fallbackVersion: string;
  inputTokenUpperBound?: number;
  reservedRunTokens?: number;
}

export interface HybridDraftResult {
  recommendation: Recommendation;
  outcome: HybridDraftOutcome;
}

export interface HybridDraftOptions {
  policy?: RuntimeDraftingPolicy;
  modelClient?: RuntimeModelClient;
  runBudget?: RuntimeDraftRunBudget;
}

export function hybridDraftContractMetadata(): Pick<
  HybridDraftOutcome,
  | "promptVersion"
  | "promptHash"
  | "schemaVersion"
  | "policyVersion"
  | "groundingVersion"
  | "fallbackVersion"
> {
  return {
    promptVersion: RUNTIME_DRAFT_PROMPT_VERSION,
    promptHash: RUNTIME_DRAFT_PROMPT_HASH,
    schemaVersion: GENERATED_DRAFT_SCHEMA_VERSION,
    policyVersion: RUNTIME_DRAFT_POLICY_VERSION,
    groundingVersion: DRAFT_GROUNDING_RULES_VERSION,
    fallbackVersion: DETERMINISTIC_DRAFT_FALLBACK_VERSION,
  };
}

const modelDraftable = (type: Recommendation["nextBestAction"]["type"]): boolean =>
  type === "call" ||
  type === "schedule_meeting" ||
  type === "send_email" ||
  type === "log_research_note";

/**
 * Conservative provider-independent upper bound. UTF-8 byte length is never
 * smaller than the number of byte-level input units, and the fixed protocol
 * allowance covers role/message framing without another metered provider call.
 */
export function estimateRuntimeModelInputTokensUpperBound(
  request: RuntimeModelRequest,
): number {
  return (
    Buffer.byteLength(request.system, "utf8") +
    Buffer.byteLength(request.user, "utf8") +
    MODEL_PROTOCOL_TOKEN_OVERHEAD
  );
}

function buildBudgetedDraftRequest(
  rec: Recommendation,
  ctx: AccountContext,
  policy: RuntimeDraftingPolicy,
): {
  context: VerifiedDraftContext;
  request: RuntimeModelRequest;
  inputTokenUpperBound: number;
} {
  const prioritized = buildVerifiedDraftContext(rec, ctx, {
    maxSignals: policy.maxSignals,
  });
  const selected: VerifiedDraftContext["signals"] = [];
  let selectedRequest: RuntimeModelRequest | undefined;
  let selectedInputUpperBound: number | undefined;

  for (const signal of prioritized.signals) {
    const trialContext: VerifiedDraftContext = {
      ...prioritized,
      signals: [...selected, signal],
    };
    const trialRequest: RuntimeModelRequest = {
      system: RUNTIME_DRAFT_SYSTEM_PROMPT,
      user: buildRuntimeDraftUserPrompt(trialContext),
    };
    const trialUpperBound = estimateRuntimeModelInputTokensUpperBound(trialRequest);
    if (trialUpperBound <= policy.maxInputTokens) {
      selected.push(signal);
      selectedRequest = trialRequest;
      selectedInputUpperBound = trialUpperBound;
    }
  }

  if (!selectedRequest || selectedInputUpperBound === undefined || selected.length === 0) {
    throw new Error("DRAFT_INPUT_BUDGET_EXCEEDED");
  }

  return {
    context: { ...prioritized, signals: selected },
    request: selectedRequest,
    inputTokenUpperBound: selectedInputUpperBound,
  };
}

function reserveRunBudget(
  budget: RuntimeDraftRunBudget | undefined,
  requestedTokens: number,
): boolean {
  if (!budget) return true;
  if (budget.reservedTokens + requestedTokens > budget.maxTokens) return false;
  budget.reservedTokens += requestedTokens;
  return true;
}

/**
 * Bounded runtime-AI drafting path. The model receives only a verified,
 * action-prioritized context that fits a hard conservative input budget. The
 * model can return candidate language only; strict schema parsing, grounding,
 * run-budget reservation, and deterministic fallbacks remain outside the model.
 */
export async function attachHybridActionDraft(
  rec: Recommendation,
  ctx: AccountContext,
  options: HybridDraftOptions = {},
): Promise<HybridDraftResult> {
  const policy = options.policy ?? runtimeDraftingPolicyFromEnv();
  const template = (): Recommendation => attachActionDraft(rec, ctx);
  const baseOutcome = hybridDraftContractMetadata();
  let modelTelemetry: RuntimeModelTelemetry | undefined;
  let inputTokenUpperBound: number | undefined;
  let reservedRunTokens: number | undefined;

  if (!policy.enabled || !modelDraftable(rec.nextBestAction.type)) {
    return {
      recommendation: template(),
      outcome: { ...baseOutcome, source: "template" },
    };
  }

  try {
    const prepared = buildBudgetedDraftRequest(rec, ctx, policy);
    inputTokenUpperBound = prepared.inputTokenUpperBound;
    reservedRunTokens = inputTokenUpperBound + policy.maxTokens;

    if (!reserveRunBudget(options.runBudget, reservedRunTokens)) {
      throw new Error("DRAFT_RUN_BUDGET_EXCEEDED");
    }

    const client = options.modelClient ?? anthropicRuntimeModelClient;
    const modelResult = await client.generate(prepared.request, policy);
    modelTelemetry = modelResult.telemetry;

    const parsed = GeneratedDraftSchema.safeParse(modelResult.output);
    if (!parsed.success) {
      throw new Error("DRAFT_SCHEMA_INVALID");
    }

    const grounding = validateDraftGrounding(parsed.data, prepared.context);
    if (!grounding.passed) {
      throw new Error(grounding.failedGates[0] ?? "DRAFT_GROUNDING_FAILED");
    }

    return {
      recommendation: {
        ...rec,
        nextBestAction: {
          ...rec.nextBestAction,
          draft: renderGroundedDraft(parsed.data),
        },
      },
      outcome: {
        ...baseOutcome,
        source: "model",
        telemetry: modelTelemetry,
        inputTokenUpperBound,
        reservedRunTokens,
      },
    };
  } catch (error) {
    if (error instanceof RuntimeModelError && error.telemetry) {
      modelTelemetry = error.telemetry;
    }
    const failureCode =
      error instanceof RuntimeModelError
        ? error.code
        : error instanceof Error
          ? error.message
          : "DRAFT_MODEL_FAILURE";

    if (policy.fallback === "template") {
      return {
        recommendation: template(),
        outcome: {
          ...baseOutcome,
          source: "template_fallback",
          failureCode,
          telemetry: modelTelemetry,
          inputTokenUpperBound,
          reservedRunTokens,
        },
      };
    }

    return {
      recommendation: rec,
      outcome: {
        ...baseOutcome,
        source: "held",
        failureCode,
        telemetry: modelTelemetry,
        inputTokenUpperBound,
        reservedRunTokens,
      },
    };
  }
}
