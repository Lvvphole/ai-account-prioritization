import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  compileContext,
  loadStandard,
} from "./agent-standard.mjs";

const ROOT = path.resolve("docs/agent-engineering");

function expectedPreloadForProfile(standard, profileId) {
  return [...standard.rules.values()]
    .filter((rule) => {
      if (rule.delivery !== "preload") return false;
      if (rule.id.startsWith("RD-")) return false;
      if (rule.applies_to.languages.length > 0) return false;

      const profiles = rule.applies_to.profiles;
      return (
        profiles.length === 0 ||
        profiles.includes(profileId) ||
        profiles.includes("general")
      );
    })
    .map((rule) => rule.id)
    .sort();
}

test("task profile preload lists match declared rule applicability", () => {
  const standard = loadStandard(ROOT);

  for (const profileId of standard.taskProfiles) {
    if (profileId === "standard-maintenance") continue;

    const expected = expectedPreloadForProfile(standard, profileId);
    const configured = [...standard.profiles.get(profileId).preload].sort();
    const rendered = [...compileContext(standard, { profile: profileId }).rule_ids].sort();

    assert.deepEqual(
      configured,
      expected,
      `${profileId} preload must match rule applies_to declarations`,
    );
    assert.deepEqual(
      rendered,
      expected,
      `${profileId} render must include every applicable preload rule`,
    );
  }
});

test("AGENTS and skill publish the manifest task-profile and language contract", () => {
  const standard = loadStandard(ROOT);
  const agents = readFileSync("AGENTS.md", "utf8");
  const skill = readFileSync(
    ".agents/skills/engineering-standard/SKILL.md",
    "utf8",
  );
  const contract = JSON.parse(readFileSync(".harness/contract.yaml", "utf8"));

  const expectedProfiles = `engineering_profile=<${standard.taskProfiles.join("|")}>`;
  const expectedLanguages = `engineering_language=<${Object.keys(
    standard.manifest.language_overlays,
  ).join("|")}>`;

  assert.ok(agents.includes(expectedProfiles));
  assert.ok(agents.includes(expectedLanguages));

  assert.match(skill, /engineering_profile/);
  assert.match(skill, /engineering_language/);
  assert.match(skill, /Do not infer either value/);
  assert.match(skill, /If `engineering_profile` is absent, use `general`/);
  assert.match(skill, /If `engineering_language` is absent, load no language overlay/);

  const standardContract = contract.contracts.find(
    (item) => item.id === "agent-engineering-standard",
  );
  assert.ok(standardContract);
  assert.ok(standardContract.paths.includes(".harness/contract.yaml"));
  assert.ok(standardContract.paths.includes("AGENTS.md"));
  assert.ok(standardContract.paths.includes("scripts/agent-standard.contract.test.mjs"));
});
