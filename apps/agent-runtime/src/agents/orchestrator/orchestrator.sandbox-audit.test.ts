import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSeedStore } from "../../shared-tools/database/client";
import type { RuntimeRepository } from "../../shared-tools/runtime-repository";
import { sandboxedAnthropicRuntimeModelClient } from "../../inference/sandboxed-anthropic-runtime-model";
import { sandboxedOpenAIRuntimeModelClient } from "../../inference/sandboxed-openai-runtime-model";
import type { RuntimeDraftingPolicy } from "../sales-execution/execution.policy";

const repositoryOverride = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../shared-tools/runtime-repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../shared-tools/runtime-repository")
  >();
  return {
    ...actual,
    resolveRepository: () => {
      if (!repositoryOverride.current) {
        throw new Error("Sandbox audit test repository is required.");
      }
      return repositoryOverride.current;
    },
  };
});

import { runDailyPrioritizationForOwner } from "./orchestrator.agent";

const NOW = "2026-06-25T07:00:00.000Z";
const ANTHROPIC_EXECUTION_PROFILE_ID = "vercel-sandbox-anthropic-egress-v1";
const OPENAI_EXECUTION_PROFILE_ID = "vercel-sandbox-openai-egress-v1";

const draftingPolicy = (
  provider: RuntimeDraftingPolicy["provider"],
): RuntimeDraftingPolicy => ({
  enabled: true,
  provider,
  apiKey: "sandbox-audit-test-provider-key",
  model: "sandbox-audit-test-model",
  timeoutMs: 1_000,
  maxTokens: 200,
  maxInputTokens: 3_000,
  maxSignals: 5,
  maxConcurrent: 2,
  maxRunTokens: 20_000,
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
  reasoningEffort: "provider_default",
  outputFormat: "json_schema",
});

function durableAuditRepository(auditPath: string): RuntimeRepository {
  const store = createSeedStore();

  return {
    async listAccountsByOwner(ownerId) {
      return store.accounts.filter((account) => account.ownerId === ownerId);
    },
    async listAllOwners() {
      return [...new Set(store.accounts.map((account) => account.ownerId))].sort();
    },
    async listOwnerScopes() {
      return [...new Set(store.accounts.map((account) => account.ownerId))]
        .sort()
        .map((ownerId) => ({ ownerId }));
    },
    async listContactsByAccount(accountId) {
      return store.contacts.filter((contact) => contact.accountId === accountId);
    },
    async listOpportunitiesByAccount(accountId) {
      return store.opportunities.filter(
        (opportunity) => opportunity.accountId === accountId,
      );
    },
    async listActivitiesByAccount(accountId) {
      return store.activities.filter((activity) => activity.accountId === accountId);
    },
    async appendAudit(entry) {
      await appendFile(auditPath, `${JSON.stringify(entry)}\n`, "utf8");
    },
    async appendAnalytics() {},
    async persistPublishedRecommendations() {},
  };
}

afterEach(() => {
  repositoryOverride.current = undefined;
  vi.restoreAllMocks();
});

describe("built-in sandbox audit provenance", () => {
  it("persists the Anthropic sandbox execution profile before invocation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sandbox-audit-"));
    const auditPath = join(directory, "audit.jsonl");
    repositoryOverride.current = durableAuditRepository(auditPath);

    const generate = vi
      .spyOn(sandboxedAnthropicRuntimeModelClient, "generate")
      .mockImplementation(async () => {
        const persistedBeforeInvocation = await readFile(auditPath, "utf8");
        expect(persistedBeforeInvocation).toContain(
          `"executionProfileId":"${ANTHROPIC_EXECUTION_PROFILE_ID}"`,
        );
        throw new Error("SIMULATED_PROVIDER_FAILURE");
      });

    try {
      const run = await runDailyPrioritizationForOwner("rep_alex", {
        now: NOW,
        approvals: {
          acc_001: true,
          acc_002: true,
          acc_003: true,
          acc_004: true,
        },
        drafting: { policy: draftingPolicy("anthropic") },
      });

      expect(generate).toHaveBeenCalled();
      expect(run.totalAccountsConsidered).toBeGreaterThan(0);

      const durableEvidence = await readFile(auditPath, "utf8");
      expect(durableEvidence).toContain(
        '"action":"runtime_draft_invocation_start"',
      );
      expect(durableEvidence).toContain(
        `"executionProfileId":"${ANTHROPIC_EXECUTION_PROFILE_ID}"`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses OpenAI fallback without selecting Anthropic after an OpenAI failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sandbox-audit-openai-"));
    const auditPath = join(directory, "audit.jsonl");
    repositoryOverride.current = durableAuditRepository(auditPath);

    const anthropicGenerate = vi.spyOn(
      sandboxedAnthropicRuntimeModelClient,
      "generate",
    );
    const openaiGenerate = vi
      .spyOn(sandboxedOpenAIRuntimeModelClient, "generate")
      .mockImplementation(async () => {
        const persistedBeforeInvocation = await readFile(auditPath, "utf8");
        expect(persistedBeforeInvocation).toContain(
          `"executionProfileId":"${OPENAI_EXECUTION_PROFILE_ID}"`,
        );
        throw new Error("SIMULATED_OPENAI_PROVIDER_FAILURE");
      });

    try {
      const run = await runDailyPrioritizationForOwner("rep_alex", {
        now: NOW,
        approvals: {
          acc_001: true,
          acc_002: true,
          acc_003: true,
          acc_004: true,
        },
        drafting: { policy: draftingPolicy("openai") },
      });

      expect(openaiGenerate).toHaveBeenCalled();
      expect(anthropicGenerate).not.toHaveBeenCalled();
      expect(run.totalAccountsConsidered).toBeGreaterThan(0);

      const durableEvidence = await readFile(auditPath, "utf8");
      expect(durableEvidence).toContain(
        '"action":"runtime_draft_invocation_start"',
      );
      expect(durableEvidence).toContain(
        `"executionProfileId":"${OPENAI_EXECUTION_PROFILE_ID}"`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
