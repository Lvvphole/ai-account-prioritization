import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scanner = path.resolve("scripts/scan-secrets.sh");
const AWS_KEY_FIXTURE = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const PRIVATE_KEY_HEADER_FIXTURE = ["-----BEGIN ", "PRIVATE KEY-----"].join("");

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function scan(cwd, ...args) {
  return spawnSync("bash", [scanner, "--range", ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("range scan rejects secrets in commit metadata while clean metadata remains valid", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "secret-metadata-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "harness@example.invalid");
  git(repo, "config", "user.name", "Harness Test");

  writeFileSync(path.join(repo, "app.txt"), "clean\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "clean base");
  const base = git(repo, "rev-parse", "HEAD");

  const clean = scan(repo, base);
  assert.equal(clean.status, 0, "ordinary commit metadata must remain valid");

  writeFileSync(path.join(repo, "app.txt"), "still clean\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", `metadata leak ${AWS_KEY_FIXTURE}`);
  const awsTip = git(repo, "rev-parse", "HEAD");

  const awsLeak = scan(repo, `${base}..${awsTip}`);
  assert.notEqual(awsLeak.status, 0, "an AWS-key-shaped value in a commit message must block");
  assert.match(awsLeak.stdout, /potential secret\(s\) in commit metadata/);

  writeFileSync(path.join(repo, "app.txt"), "still clean again\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", `metadata leak ${PRIVATE_KEY_HEADER_FIXTURE}`);
  const keyTip = git(repo, "rev-parse", "HEAD");

  const keyLeak = scan(repo, `${awsTip}..${keyTip}`);
  assert.notEqual(keyLeak.status, 0, "a private-key header in a commit message must block");
  assert.match(keyLeak.stdout, /potential secret\(s\) in commit metadata/);
});
