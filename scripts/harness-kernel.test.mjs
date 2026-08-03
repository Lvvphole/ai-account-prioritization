import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
