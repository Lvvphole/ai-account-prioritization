import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  STATUS,
  getChangedFiles,
  globToRegExp,
  parseContract,
  runGate,
  selectAffectedContracts,
} from "./harness-kernel.mjs";

const validContract = {
  version: 0,
  contracts: [
    {
      id: "runtime",
      paths: ["apps/runtime/**", "package.json"],
      gates: [{ id: "test", command: "node -e \"process.exit(0)\"" }],
    },
  ],
};

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("parseContract accepts the v0 contract and rejects invalid identity or timeout fields", () => {
  assert.deepEqual(parseContract(JSON.stringify(validContract)), validContract);

  const duplicateIds = {
    ...validContract,
    contracts: [validContract.contracts[0], validContract.contracts[0]],
  };
  assert.throws(
    () => parseContract(JSON.stringify(duplicateIds)),
    /duplicate contract id/,
  );

  const invalidTimeout = structuredClone(validContract);
  invalidTimeout.contracts[0].gates[0].timeout_ms = 0;
  assert.throws(
    () => parseContract(JSON.stringify(invalidTimeout)),
    /timeout_ms must be a positive integer/,
  );
});

test("glob matching supports exact, single-segment, and recursive patterns", () => {
  assert.equal(globToRegExp("package.json").test("package.json"), true);
  assert.equal(globToRegExp("apps/*/package.json").test("apps/web/package.json"), true);
  assert.equal(globToRegExp("apps/**").test("apps/runtime/src/index.ts"), true);
  assert.equal(globToRegExp("apps/*/package.json").test("apps/a/b/package.json"), false);
});

test("selectAffectedContracts returns only contracts matched by changed files", () => {
  const contract = {
    version: 0,
    contracts: [
      validContract.contracts[0],
      {
        id: "docs",
        paths: ["docs/**"],
        gates: [{ id: "docs", command: "true" }],
      },
    ],
  };
  assert.deepEqual(
    selectAffectedContracts(contract, ["apps/runtime/src/index.ts"]).map(
      (item) => item.id,
    ),
    ["runtime"],
  );
});

test("runGate maps deterministic command exit status to PASS or FAIL", () => {
  const cwd = process.cwd();
  assert.equal(
    runGate({ id: "pass", command: "node -e \"process.exit(0)\"" }, "c", cwd)
      .status,
    STATUS.PASS,
  );
  assert.equal(
    runGate({ id: "fail", command: "node -e \"process.exit(7)\"" }, "c", cwd)
      .status,
    STATUS.FAIL,
  );
});

test("runGate maps timeout expiration to BLOCKED", () => {
  const result = runGate(
    {
      id: "timeout",
      command: "node -e \"setTimeout(() => {}, 1000)\"",
      timeout_ms: 25,
    },
    "c",
    process.cwd(),
  );
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.exit_code, null);
  assert.match(result.stderr, /timed out after 25ms/);
});

test("getChangedFiles detects committed and local worktree changes from the merge base", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "harness-kernel-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "harness@example.invalid");
  git(repo, "config", "user.name", "Harness Test");
  mkdirSync(path.join(repo, "apps", "runtime"), { recursive: true });
  writeFileSync(path.join(repo, "apps", "runtime", "a.txt"), "a\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");

  writeFileSync(path.join(repo, "apps", "runtime", "a.txt"), "changed\n");
  writeFileSync(path.join(repo, "package.json"), "{}\n");

  const result = getChangedFiles({ cwd: repo, base, head: "WORKTREE" });
  assert.deepEqual(result.changedFiles, ["apps/runtime/a.txt", "package.json"]);
});

test("getChangedFiles includes both source and destination of a committed rename", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "harness-kernel-rename-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "harness@example.invalid");
  git(repo, "config", "user.name", "Harness Test");
  mkdirSync(path.join(repo, "apps", "runtime"), { recursive: true });
  writeFileSync(path.join(repo, "apps", "runtime", "a.txt"), "a\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");

  mkdirSync(path.join(repo, "ignored"), { recursive: true });
  git(repo, "mv", "apps/runtime/a.txt", "ignored/a.txt");
  git(repo, "commit", "-qm", "rename");
  const head = git(repo, "rev-parse", "HEAD");

  const result = getChangedFiles({ cwd: repo, base, head });
  assert.deepEqual(result.changedFiles, ["apps/runtime/a.txt", "ignored/a.txt"]);
});

test("harness-kernel gate anchors the agent engineering standard contract", () => {
  const contract = parseContract(readFileSync(".harness/contract.yaml", "utf8"));
  const standardContract = contract.contracts.find(
    (item) => item.id === "agent-engineering-standard",
  );

  assert.ok(standardContract, "agent-engineering-standard contract must exist");
  assert.ok(standardContract.paths.includes(".harness/contract.yaml"));
  assert.ok(standardContract.paths.includes("AGENTS.md"));
  assert.ok(standardContract.paths.includes("scripts/agent-standard.contract.test.mjs"));
  assert.deepEqual(standardContract.gates, [
    { id: "agent-standard-tests", command: "pnpm test:agent-standard" },
  ]);
});

// --- Verification-boundary regression tests -------------------------------------
//
// These lock the corrected verification boundary against defects that actually
// escaped: a duplicate Tier-3 orchestration (`verify:complete`), a local hook that
// falsely claimed completion authority, and Tier-3 evidence that did not identify the
// candidate it verified. They assert repository content only — they cannot observe
// GitHub branch-protection state, so a pass here is NOT evidence that the merge gate
// is enforced. That requires the `main` ruleset to require "PR Production
// Verification" with strict up-to-date-before-merge.

const CANONICAL_TIER3_COMMAND = "pnpm verify:production";

// These files document the very commands they are asserted against, so a naive
// substring search matches prose explaining why a command is absent. Assert over
// executable content only.
function withoutComments(source) {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function markdownSection(source, heading) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

test("verify:production is the only Tier-3 orchestration in package.json", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(
    pkg.scripts["verify:complete"],
    undefined,
    "verify:complete duplicated the canonical verifier and must not return",
  );

  // Any other script that chains several Tier-3 gates is a second Definition of Done.
  const tier3Markers = [
    "pnpm lint",
    "pnpm build",
    "pnpm typecheck",
    "pnpm test",
    "pnpm docker:build",
  ];
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (name === "verify:production") continue;
    const matched = tier3Markers.filter((marker) => command.includes(marker));
    assert.ok(
      matched.length < 3,
      `script "${name}" chains Tier-3 gates (${matched.join(", ")}); ` +
        `${CANONICAL_TIER3_COMMAND} is the only completion verifier`,
    );
  }
});

test("verify-production.sh retains its gates and enforces candidate identity", () => {
  const script = withoutComments(readFileSync("scripts/verify-production.sh", "utf8"));

  assert.match(script, /run_gate "Required files" check_files/);
  assert.match(script, /pnpm test:acceptance:a/);
  assert.match(script, /check_schema_drift/);

  // Migrations reach Tier 3 through Acceptance A. Invoking them directly runs the
  // same suite twice.
  assert.doesNotMatch(
    script,
    /pnpm verify:migrations/,
    "verify:migrations must reach Tier 3 via Acceptance A, not a direct call",
  );

  // A PASS must be evidence about one exact, unchanging, fully committed candidate.
  assert.match(script, /git rev-parse HEAD/, "must record the full candidate SHA");
  assert.doesNotMatch(
    script,
    /rev-parse --short HEAD/,
    "an abbreviated SHA does not unambiguously identify the candidate",
  );
  assert.match(script, /run_gate "Candidate clean before verification"/);
  assert.match(script, /run_gate "Candidate clean after verification"/);
  assert.match(script, /run_gate "Candidate HEAD unchanged"/);
});

test("pre-push hook is a precheck and claims no completion authority", () => {
  const raw = readFileSync(".githooks/pre-push", "utf8");
  const hook = withoutComments(raw);

  assert.match(hook, /pnpm scan:secrets/, "secrets must be caught before they leave the machine");
  assert.match(hook, /pnpm lint/);
  assert.match(hook, /pnpm typecheck/);

  assert.doesNotMatch(
    hook,
    /pnpm verify:production/,
    "the local hook must not invoke the canonical verifier",
  );
  assert.doesNotMatch(
    hook,
    /verify:complete/,
    "the duplicate Tier-3 orchestration must not return",
  );
  assert.doesNotMatch(
    hook,
    /All verification gates passed/,
    "the hook must not claim completion it did not verify",
  );
  assert.match(hook, /PRECHECK PASS/);
  assert.match(hook, /Not Tier-3 completion/);
});

test("production verification runs the canonical gate on both pre-PR and PR candidates", () => {
  const workflow = withoutComments(
    readFileSync(".github/workflows/production-verification.yml", "utf8"),
  );

  // Distinct check names: GitHub matches required status checks by name, so two jobs
  // sharing one name cannot be independently required.
  assert.match(workflow, /name: Pre-PR Production Verification/);
  assert.match(workflow, /name: PR Production Verification/);

  // `on:` is workflow-scoped; without per-job guards both jobs run on both events.
  assert.match(workflow, /if: github\.event_name == 'push'/);
  assert.match(workflow, /if: github\.event_name == 'pull_request'/);

  assert.match(workflow, /branches-ignore: \["main"\]/);
  assert.match(workflow, /pull_request:\n {4}branches: \["main"\]/);

  const canonicalInvocations = workflow.match(/pnpm verify:production/g) ?? [];
  assert.equal(
    canonicalInvocations.length,
    2,
    "both jobs must run the unmodified canonical Tier-3 command",
  );
});

test("production verification enforces candidate identity rather than only recording it", () => {
  const workflow = withoutComments(
    readFileSync(".github/workflows/production-verification.yml", "utf8"),
  );

  const enforcementSteps = workflow.match(/name: Enforce candidate identity/g) ?? [];
  assert.equal(
    enforcementSteps.length,
    2,
    "both jobs must fail closed on a candidate mismatch",
  );

  // The push job proves the checkout is the pushed commit.
  assert.match(workflow, /tested_sha" != "\$EXPECTED_SHA/);
  // The PR job proves the integration candidate's second parent is the PR head.
  assert.match(workflow, /HEAD\^2/);
  assert.match(workflow, /merged_head" != "\$EXPECTED_HEAD_SHA/);
  // merge_commit_sha can be stale or null while mergeability is still computing.
  assert.doesNotMatch(
    workflow,
    /merge_commit_sha/,
    "candidate identity must come from parentage, not an event field",
  );
});

test("candidate context is event-specific and never fabricates a base for a push", () => {
  const workflow = readFileSync(
    ".github/workflows/production-verification.yml",
    "utf8",
  );
  const [, pushJob = "", prJob = ""] = workflow.split(/^ {2}(?:pre_pr|pr):$/m);

  for (const field of ["event: push", "branch:", "head_sha:", "tested_sha:"]) {
    assert.ok(pushJob.includes(field), `push context must record ${field}`);
  }
  assert.ok(
    !pushJob.includes("base_sha:"),
    "a push preceding any PR has no base; recording one would fabricate evidence",
  );

  for (const field of ["event: pull_request", "head_sha:", "base_sha:", "tested_sha:"]) {
    assert.ok(prJob.includes(field), `PR context must record ${field}`);
  }

  // tested_sha is derived from the checkout, not assumed from the event payload.
  const derived = workflow.match(/tested_sha: \$\(git rev-parse HEAD\)/g) ?? [];
  assert.equal(derived.length, 2, "tested_sha must be read from the checked-out repository");
});

test("CONTEXT.md references the canonical Definition of Done instead of restating it", () => {
  const section = markdownSection(
    readFileSync("docs/CONTEXT.md", "utf8"),
    "## Definition of Done",
  );

  assert.match(section, /AGENTS\.md §13\.3/);
  assert.match(section, /pnpm verify:production/);

  // A second copy of the command list is the synchronization burden ADR-002 avoids.
  const duplicated = ["pnpm build", "pnpm typecheck", "pnpm test:evals", "pnpm docker:build"];
  const present = duplicated.filter((command) => section.includes(command));
  assert.equal(
    present.length,
    0,
    `the Definition of Done section must not restate the Tier-3 command list ` +
      `(found: ${present.join(", ")})`,
  );
});

test("harness-kernel contract covers the verification harness it asserts about", () => {
  const contract = parseContract(readFileSync(".harness/contract.yaml", "utf8"));
  const kernel = contract.contracts.find((item) => item.id === "harness-kernel");

  assert.ok(kernel, "harness-kernel contract must exist");
  for (const covered of [
    "scripts/verify-production.sh",
    ".githooks/**",
    "docs/CONTEXT.md",
    ".github/workflows/production-verification.yml",
  ]) {
    assert.ok(
      kernel.paths.includes(covered),
      `editing ${covered} must select the harness-kernel gates`,
    );
  }
});
