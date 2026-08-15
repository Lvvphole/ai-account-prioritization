import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("runtime model registry startup contract", () => {
  it("fails module loading when production Anthropic drafting lacks sandbox authentication", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RUNTIME_DRAFTING_ENABLED", "true");
    vi.stubEnv("RUNTIME_DRAFT_PROVIDER", "anthropic");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_TEAM_ID", "");
    vi.stubEnv("VERCEL_PROJECT_ID", "");
    vi.stubEnv("VERCEL_TOKEN", "");
    vi.resetModules();

    await expect(import("./runtime-model-registry")).rejects.toThrow(
      "Vercel Sandbox control-plane authentication is required.",
    );
  });

  it("allows module loading when production Anthropic drafting has sandbox authentication", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RUNTIME_DRAFTING_ENABLED", "true");
    vi.stubEnv("RUNTIME_DRAFT_PROVIDER", "anthropic");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "test-oidc-token");
    vi.stubEnv("VERCEL_TEAM_ID", "");
    vi.stubEnv("VERCEL_PROJECT_ID", "");
    vi.stubEnv("VERCEL_TOKEN", "");
    vi.resetModules();

    await expect(import("./runtime-model-registry")).resolves.toBeDefined();
  });
});
