import {
  GENERATED_DRAFT_SCHEMA_VERSION,
  GeneratedDraftSchema,
  type Recommendation,
} from "@repo/shared-schemas";
import type { AccountContext } from "../account-prioritizer/prioritizer.policy";
import { generateCallObjective } from "./tools/generate-call-objective";
import { generateEmailDraft } from "./tools/generate-email-draft";
import { generateCrmNote } from "./tools/generate-crm-note";
import { buildVerifiedDraftContext } from "./build-draft-context";
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
  type RuntimeModelTelemetry,
} from "../../inference/runtime-model";
import {
  DRAFT_GROUNDING_RULES_VERSION,
  renderGroundedDraft,
  validateDraftGrounding,
} from "./validate-draft-grounding";

export const DETERMINISTIC_DRAFT_FALLBACK_VERSION = "deterministic-template-v1";

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
}

export interface HybridDraftResult {
  recommendation: Recommendation;
  outcome: HybridDraftOutcome;
}

export interface HybridDraftOptions {
  policy?: RuntimeDraftingPolicy;
  modelClient?: RuntimeModelClient;
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
 * Bounded runtime-AI drafting path. The model receives only a verified minimum
 * context and can return candidate language only. All model output is strict
 * schema parsed and deterministically grounded before it is attached.
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

  if (!policy.enabled || !modelDraftable(rec.nextBestAction.type)) {
    return {
      recommendation: template(),
      outcome: { ...baseOutcome, source: "template" },
    };
  }

  try {
    const context = buildVerifiedDraftContext(rec, ctx);
    const client = options.modelClient ?? anthropicRuntimeModelClient;
    const modelResult = await client.generate(
      {
        system: RUNTIME_DRAFT_SYSTEM_PROMPT,
        user: buildRuntimeDraftUserPrompt(context),
      },
      policy,
    );
    modelTelemetry = modelResult.telemetry;

    const parsed = GeneratedDraftSchema.safeParse(modelResult.output);
    if (!parsed.success) {
      throw new Error("DRAFT_SCHEMA_INVALID");
    }

    const grounding = validateDraftGrounding(parsed.data, context);
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
      },
    };
  } catch (error) {
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
      },
    };
  }
}
