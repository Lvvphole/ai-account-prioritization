import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scanner = path.resolve("scripts/scan-secrets.sh");
const AWS_KEY_FIXTURE = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test("range scan rejects a secret carried only in commit metadata", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "secret-metadata-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "harness@example.invalid");
  git(repo, "config", "user.name", "Harness Test");

  writeFileSync(path.join(repo, "app.txt"), "clean\n");
  git(repo, "add", "app.txt");
  git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");

  git(repo, "commit", "--allow-empty", "-qm", `metadata leak ${AWS_KEY_FIXTURE}`);
  const tip = git(repo, "rev-parse", "HEAD");

  const result = spawnSync("bash", [scanner, "--range", `${base}..${tip}`], {
    cwd: repo,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, "a secret-bearing commit object must block the push");
  assert.match(result.stdout, /potential secret\(s\) in commit metadata/);
  assert.ok(
    !result.stdout.includes(AWS_KEY_FIXTURE),
    "the scanner must not echo the detected secret into logs",
  );
});
