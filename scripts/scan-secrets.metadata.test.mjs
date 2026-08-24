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

function scan(cwd, ...args) {
  return spawnSync("bash", [scanner, "--range", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function initRepo(prefix) {
  const repo = mkdtempSync(path.join(os.tmpdir(), prefix));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "harness@example.invalid");
  git(repo, "config", "user.name", "Harness Test");
  writeFileSync(path.join(repo, "app.txt"), "clean\n");
  git(repo, "add", "app.txt");
  git(repo, "commit", "-qm", "base");
  return repo;
}

test("range scan rejects a secret carried only in commit metadata", () => {
  const repo = initRepo("secret-commit-metadata-");
  const base = git(repo, "rev-parse", "HEAD");

  git(repo, "commit", "--allow-empty", "-qm", `metadata leak ${AWS_KEY_FIXTURE}`);
  const tip = git(repo, "rev-parse", "HEAD");

  const result = scan(repo, `${base}..${tip}`);

  assert.notEqual(result.status, 0, "a secret-bearing commit object must block the push");
  assert.match(result.stdout, /potential secret\(s\) in commit metadata/);
  assert.ok(
    !result.stdout.includes(AWS_KEY_FIXTURE),
    "the scanner must not echo the detected secret into logs",
  );
});

test("range scan redacts secrets found in commit trees", () => {
  const repo = initRepo("secret-tree-redaction-");
  const base = git(repo, "rev-parse", "HEAD");

  writeFileSync(path.join(repo, "creds.txt"), `AWS_KEY=${AWS_KEY_FIXTURE}\n`);
  git(repo, "add", "creds.txt");
  git(repo, "commit", "-qm", "tree leak");
  const tip = git(repo, "rev-parse", "HEAD");

  const result = scan(repo, `${base}..${tip}`);

  assert.notEqual(result.status, 0, "a secret-bearing commit tree must block the push");
  assert.match(result.stdout, /potential secret\(s\) in commit\/tree object/);
  assert.match(result.stdout, /creds\.txt/, "safe path diagnostics must remain available");
  assert.ok(
    !result.stdout.includes(AWS_KEY_FIXTURE),
    "commit-tree matches must not copy the detected secret into logs",
  );
});

test("range scan rejects annotated-tag metadata, including a tag-only update", () => {
  const repo = initRepo("secret-tag-metadata-");
  const target = git(repo, "rev-parse", "HEAD");

  git(repo, "tag", "-a", "clean-tag", target, "-m", "clean release metadata");
  const cleanTag = git(repo, "rev-parse", "refs/tags/clean-tag");
  const clean = scan(repo, cleanTag);
  assert.equal(clean.status, 0, "ordinary annotated-tag metadata must remain valid");

  git(repo, "tag", "-a", "leaky-tag", target, "-m", `metadata leak ${AWS_KEY_FIXTURE}`);
  const leakyTag = git(repo, "rev-parse", "refs/tags/leaky-tag");

  const newTag = scan(repo, leakyTag);
  assert.notEqual(newTag.status, 0, "a secret-bearing annotated tag must block a new-tag push");
  assert.match(newTag.stdout, /potential secret\(s\) in annotated tag metadata/);
  assert.ok(!newTag.stdout.includes(AWS_KEY_FIXTURE), "annotated-tag secrets must be redacted");

  // Both tags point at the same commit, so this range contains no outgoing commits.
  // The new tag object is still outgoing and must be inspected before a forced update.
  const tagOnlyUpdate = scan(repo, `${cleanTag}..${leakyTag}`);
  assert.notEqual(
    tagOnlyUpdate.status,
    0,
    "a tag-only update must not pass merely because rev-list selects zero commits",
  );
  assert.match(tagOnlyUpdate.stdout, /potential secret\(s\) in annotated tag metadata/);
});

test("range scan rejects a secret-bearing direct blob target", () => {
  const repo = initRepo("secret-direct-blob-");
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repo,
    input: `${AWS_KEY_FIXTURE}\n`,
    encoding: "utf8",
  });
  assert.equal(blob.status, 0, blob.stderr);
  const blobSha = blob.stdout.trim();

  const result = scan(repo, blobSha);
  assert.notEqual(result.status, 0, "a secret-bearing blob targeted directly by a ref must block");
  assert.match(result.stdout, /potential secret\(s\) in outgoing blob/);
  assert.ok(!result.stdout.includes(AWS_KEY_FIXTURE), "direct-blob secrets must be redacted");
});
