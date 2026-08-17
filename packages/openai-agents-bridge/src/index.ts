import {
  Agent,
  OpenAIProvider,
  Runner,
  type JsonSchemaDefinition,
} from "@openai/agents";
import OpenAI from "openai";

export type OpenAIAgentsReasoningEffort = "low" | "medium" | "high";

export interface OpenAIAgentsBridgeRequest {
  credential: string;
  model: string;
  system: string;
  user: string;
  outputSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
  reasoningEffort?: OpenAIAgentsReasoningEffort;
  signal: AbortSignal;
}

export interface OpenAIAgentsBridgeUsage {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}

export interface OpenAIAgentsBridgeResult {
  output: unknown;
  usage: OpenAIAgentsBridgeUsage;
}

export type OpenAIAgentsBridgeErrorKind =
  | "timeout"
  | "http"
  | "invalid_response";

export class OpenAIAgentsBridgeError extends Error {
  constructor(
    public readonly kind: OpenAIAgentsBridgeErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "OpenAIAgentsBridgeError";
  }
}

const cachedInputTokens = (
  details: Record<string, number>[],
): number | undefined => {
  let total = 0;
  let observed = false;
  for (const detail of details) {
    const value = detail.cached_tokens ?? detail.cachedTokens;
    if (typeof value === "number") {
      total += value;
      observed = true;
    }
  }
  return observed ? total : undefined;
};

const errorCauseHasName = (error: unknown, expectedName: string): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ("name" in current && current.name === expectedName) return true;
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
};

export async function runOpenAIAgentsBridge(
  request: OpenAIAgentsBridgeRequest,
  fetchImpl: typeof fetch,
): Promise<OpenAIAgentsBridgeResult> {
  const client = new OpenAI({
    apiKey: request.credential,
    fetch: fetchImpl,
    maxRetries: 0,
    timeout: request.timeoutMs,
  });
  const provider = new OpenAIProvider({
    openAIClient: client,
    useResponses: true,
  });
  const runner = new Runner({
    modelProvider: provider,
    tracingDisabled: true,
  });
  const outputType: JsonSchemaDefinition = {
    type: "json_schema",
    name: "generated_draft",
    strict: true,
    schema: request.outputSchema as JsonSchemaDefinition["schema"],
  };
  const agent = new Agent({
    name: "bounded-runtime-drafting",
    instructions: request.system,
    model: request.model,
    modelSettings: {
      maxTokens: request.maxOutputTokens,
      reasoning: request.reasoningEffort
        ? { effort: request.reasoningEffort }
        : undefined,
    },
    outputType,
    tools: [],
  });

  try {
    const result = await runner.run(agent, request.user, {
      maxTurns: 1,
      signal: request.signal,
    });
    if (result.finalOutput === undefined || result.state.usage.requests !== 1) {
      throw new OpenAIAgentsBridgeError(
        "invalid_response",
        "OpenAI Agents SDK did not return one bounded final response.",
      );
    }

    return {
      output: result.finalOutput,
      usage: {
        inputTokens: result.state.usage.inputTokens,
        cachedInputTokens: cachedInputTokens(
          result.state.usage.inputTokensDetails,
        ),
        outputTokens: result.state.usage.outputTokens,
      },
    };
  } catch (error) {
    if (error instanceof OpenAIAgentsBridgeError) throw error;
    if (
      request.signal.aborted ||
      error instanceof OpenAI.APIConnectionTimeoutError ||
      (error instanceof OpenAI.APIConnectionError &&
        errorCauseHasName(error, "SandboxRuntimeTimeoutError"))
    ) {
      throw new OpenAIAgentsBridgeError(
        "timeout",
        "OpenAI Agents SDK request exceeded its deadline.",
      );
    }
    if (error instanceof OpenAI.APIError && error.status !== undefined) {
      throw new OpenAIAgentsBridgeError(
        "http",
        `OpenAI returned HTTP ${error.status}.`,
        error.status,
      );
    }
    if (error instanceof OpenAI.APIConnectionError) {
      throw new OpenAIAgentsBridgeError(
        "http",
        "OpenAI connection failed.",
      );
    }
    throw new OpenAIAgentsBridgeError(
      "invalid_response",
      "OpenAI Agents SDK failed to produce a bounded response.",
    );
  }
}
