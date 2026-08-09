import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AgentStandardConfigurationError,
  UnknownProfileError,
  compileContext,
  loadStandard,
  remediationFor,
} from "./agent-standard.mjs";

const ROOT = path.resolve("docs/agent-engineering");

test("loads exactly 33 engineering rules and 8 rejected-design meta-rules", () => {
  const standard = loadStandard(ROOT);
  assert.equal(standard.engineeringCount, 33);
  assert.equal(standard.rejectedCount, 8);
  assert.equal(standard.rules.size, 41);
});

test("general fallback is exactly the five-rule kernel", () => {
  const bundle = compileContext(loadStandard(ROOT), { profile: "general" });
  assert.deepEqual(
    new Set(bundle.rule_ids),
    new Set(["REQ-001", "SC-001", "SC-002", "RT-006", "AD-002"]),
  );
});

test("invalid supplied profile fails instead of silently using general", () => {
  assert.throws(
    () => compileContext(loadStandard(ROOT), { profile: "bugfix" }),
    UnknownProfileError,
  );
});

test("internal language-overlay ids are rejected as task profiles", () => {
  const standard = loadStandard(ROOT);
  for (const profile of ["overlay-python", "overlay-typescript"]) {
    assert.throws(
      () => compileContext(standard, { profile }),
      UnknownProfileError,
    );
  }
});

test("language overlays are explicit and never cross-load", () => {
  const standard = loadStandard(ROOT);
  const ts = compileContext(standard, {
    profile: "bug-fix",
    language: "typescript",
  });
  const py = compileContext(standard, {
    profile: "bug-fix",
    language: "python",
  });

  assert.ok(["TS-001", "TS-002", "TS-003"].every((id) => ts.rule_ids.includes(id)));
  assert.ok(!ts.rule_ids.some((id) => id.startsWith("PY-")));
  assert.ok(["PY-001", "PY-002"].every((id) => py.rule_ids.includes(id)));
  assert.ok(!py.rule_ids.some((id) => id.startsWith("TS-")));
});

test("ordinary profiles do not preload rejected-design rules", () => {
  const standard = loadStandard(ROOT);
  for (const profile of [
    "general",
    "code-change",
    "bug-fix",
    "refactor",
    "technical-doc",
    "requirements",
    "architecture-change",
  ]) {
    const bundle = compileContext(standard, { profile });
    assert.ok(!bundle.rule_ids.some((id) => id.startsWith("RD-")));
  }
});

test("standard-maintenance loads only rejected-design rules", () => {
  const bundle = compileContext(loadStandard(ROOT), {
    profile: "standard-maintenance",
  });
  assert.equal(bundle.rule_ids.length, 8);
  assert.ok(bundle.rule_ids.every((id) => id.startsWith("RD-")));
});

test("reusable registry contains no repository-specific AAP or LOCAL rules", () => {
  const standard = loadStandard(ROOT);
  assert.ok(
    [...standard.rules.keys()].every(
      (id) => !id.startsWith("AAP-") && !id.startsWith("LOCAL-"),
    ),
  );
});

test("runtime render excludes sources, rationales, and path metadata", () => {
  const bundle = compileContext(loadStandard(ROOT), {
    profile: "bug-fix",
    language: "typescript",
  });
  assert.doesNotMatch(bundle.text, /source-map|CleanCode|Ousterhout|EffectiveTS/);
  assert.doesNotMatch(bundle.text, /applies_to|paths|sources/);
});

test("path field remains accepted but v1 exposes no path resolution output", () => {
  const standard = loadStandard(ROOT);
  assert.ok([...standard.rules.values()].every((rule) => Array.isArray(rule.applies_to.paths)));
  const bundle = compileContext(standard, { profile: "bug-fix" });
  assert.equal("paths" in bundle, false);
});

test("on_failure semantic-review is rejected as unreachable", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "aes-unreachable-"));
  const root = path.join(tmp, "agent-engineering");
  cpSync(ROOT, root, { recursive: true });

  writeFileSync(
    path.join(root, "rules", "bad.json"),
    JSON.stringify({
      rules: [{
        id: "BAD-001",
        domain: "bad",
        level: "MUST",
        delivery: "on_failure",
        instruction: "unreachable",
        applies_to: { profiles: ["bug-fix"], languages: [], paths: [] },
        verification: { type: "semantic-review", ref: "review" },
        override_policy: "DEFAULT",
        sources: ["local"],
      }],
    }),
  );

  assert.throws(() => loadStandard(root), AgentStandardConfigurationError);
});

test("remediation is dormant when no admitted on_failure rule matches", () => {
  const result = remediationFor(loadStandard(ROOT), {
    checkRef: "security-verification",
    profile: "bug-fix",
    language: "typescript",
  });
  assert.equal(result, null);
});

test("skill forbids profile and language inference", () => {
  const skill = readFileSync(
    ".agents/skills/engineering-standard/SKILL.md",
    "utf8",
  );
  assert.match(skill, /Do not infer either value/);
  assert.match(skill, /If `engineering_profile` is absent, use `general`/);
  assert.match(skill, /If `engineering_language` is absent, load no language overlay/);
});

test("manifest publishes only public task profiles and locks verifier boundaries", () => {
  const standard = loadStandard(ROOT);
  assert.deepEqual(standard.taskProfiles, [
    "general",
    "code-change",
    "bug-fix",
    "refactor",
    "technical-doc",
    "requirements",
    "architecture-change",
    "standard-maintenance",
  ]);
  assert.ok(!standard.taskProfiles.includes("overlay-python"));
  assert.ok(!standard.taskProfiles.includes("overlay-typescript"));
  assert.equal(standard.manifest.path_resolution, "deferred");
  assert.equal(standard.manifest.acceptance_authority, "external_verifier");
});

test("package exposes deterministic standard commands", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["agent-standard:validate"], "node scripts/agent-standard.mjs validate");
  assert.equal(pkg.scripts["agent-standard:render"], "node scripts/agent-standard.mjs render");
  assert.equal(pkg.scripts["agent-standard:remediate"], "node scripts/agent-standard.mjs remediate");
  assert.match(pkg.scripts["test:agent-standard"], /agent-standard\.test\.mjs/);
});

test("harness routes its own standard contract edits through the standard gate", () => {
  const contract = JSON.parse(readFileSync(".harness/contract.yaml", "utf8"));
  assert.deepEqual(
    contract.contracts.map((item) => item.id),
    [
      "harness-kernel",
      "agent-engineering-standard",
      "runtime-contract",
      "trajectory-contract",
    ],
  );
  const standardContract = contract.contracts.find(
    (item) => item.id === "agent-engineering-standard",
  );
  assert.ok(standardContract.paths.includes(".harness/contract.yaml"));
  assert.deepEqual(standardContract.gates, [
    { id: "agent-standard-tests", command: "pnpm test:agent-standard" },
  ]);
});
