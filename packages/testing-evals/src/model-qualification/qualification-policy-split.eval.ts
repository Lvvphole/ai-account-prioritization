import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseModelQualificationConfig,
  parseQualificationOnlyModelConfig,
} from "./qualification-contract";

const canonicalPolicy = (): unknown =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), "../../config/p4-qualification-policy.json"), "utf8"),
  );

describe("P4 qualification policy candidate split", () => {
  it("keeps OpenAI outside the integrated qualification-and-admission candidate set", () => {
    const config = parseModelQualificationConfig(canonicalPolicy());

    expect(config.candidates.map((candidate) => candidate.id)).toEqual([
      "anthropic-haiku-4-5-default",
      "anthropic-sonnet-4-6-low",
    ]);
    expect(config.candidates.some((candidate) => candidate.provider === "openai")).toBe(false);
  });

  it("runs the report-only path with only the approved OpenAI candidate", () => {
    const config = parseQualificationOnlyModelConfig(canonicalPolicy());

    expect(config.candidates.map((candidate) => candidate.id)).toEqual([
      "openai-gpt-5-4-nano-2026-03-17-default",
    ]);
    expect(config.candidates.every((candidate) => candidate.provider === "openai")).toBe(true);
  });
});
