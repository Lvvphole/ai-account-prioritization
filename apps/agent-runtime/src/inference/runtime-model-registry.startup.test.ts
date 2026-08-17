import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const stubProductionSandboxEnvironment = (provider: "anthropic" | "openai"): void => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RUNTIME_DRAFTING_ENABLED", "true");
  vi.stubEnv("RUNTIME_DRAFT_PROVIDER", provider);
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  vi.stubEnv("VERCEL_TEAM_ID", "");
  vi.stubEnv("VERCEL_PROJECT_ID", "");
  vi.stubEnv("VERCEL_TOKEN", "");
};

describe("runtime model registry startup contract", () => {
  it("registers both production-capable providers", async () => {
    const registry = await import("./runtime-model-registry");

    expect([...registry.IMPLEMENTED_RUNTIME_MODEL_PROVIDERS]).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("resolves Anthropic only to the sandboxed Anthropic client", async () => {
    const registry = await import("./runtime-model-registry");
    const anthropic = await import("./sandboxed-anthropic-runtime-model");

    expect(registry.runtimeModelClientForProvider("anthropic")).toBe(
      anthropic.sandboxedAnthropicRuntimeModelClient,
    );
  });

  it("resolves OpenAI only to the sandboxed OpenAI client", async () => {
    const registry = await import("./runtime-model-registry");
    const openai = await import("./sandboxed-openai-runtime-model");

    expect(registry.runtimeModelClientForProvider("openai")).toBe(
      openai.sandboxedOpenAIRuntimeModelClient,
    );
  });

  it("records the fixed sandbox execution profile for each implemented provider", async () => {
    const registry = await import("./runtime-model-registry");

    expect(registry.runtimeModelExecutionProfileForProvider("anthropic")).toBe(
      "vercel-sandbox-anthropic-egress-v1",
    );
    expect(registry.runtimeModelExecutionProfileForProvider("openai")).toBe(
      "vercel-sandbox-openai-egress-v1",
    );
  });

  it("records the same strict OpenAI output configuration used by the bridge", async () => {
    const registry = await import("./runtime-model-registry");
    const schema = {
      type: "object",
      properties: { draft: { type: "string" } },
      required: ["draft"],
      additionalProperties: false,
    };

    expect(
      registry.runtimeModelOutputConfigurationForProvider(
        "openai",
        { type: "json_schema", schema },
        "low",
      ),
    ).toEqual({
      outputType: {
        type: "json_schema",
        name: "generated_draft",
        strict: true,
        schema,
      },
      reasoning: { effort: "low" },
    });
  });

  it.each(["anthropic", "openai"] as const)(
    "fails module loading when production %s drafting lacks sandbox authentication",
    async (provider) => {
      stubProductionSandboxEnvironment(provider);
      vi.resetModules();

      await expect(import("./runtime-model-registry")).rejects.toThrow(
        "Vercel Sandbox control-plane authentication is required.",
      );
    },
  );

  it.each(["anthropic", "openai"] as const)(
    "allows module loading when production %s drafting has sandbox authentication",
    async (provider) => {
      stubProductionSandboxEnvironment(provider);
      vi.stubEnv("VERCEL_OIDC_TOKEN", "test-oidc-token");
      vi.resetModules();

      await expect(import("./runtime-model-registry")).resolves.toBeDefined();
    },
  );

  it("fails closed for a provider without an implemented production adapter", async () => {
    const registry = await import("./runtime-model-registry");

    expect(() => registry.runtimeModelClientForProvider("xai")).toThrow(
      expect.objectContaining({ code: "DRAFT_MODEL_CONFIG_ERROR" }),
    );
  });
});
