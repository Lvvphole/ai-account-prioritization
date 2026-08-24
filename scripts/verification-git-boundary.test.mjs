import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const scanner = path.resolve(root, "scripts/scan-secrets.sh");
const AWS_FIXTURE = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const PRIVATE_KEY_FIXTURE = ["-----BEGIN ", "RSA PRIVATE KEY-----"].join("");
const JWT_FIXTURE = [
  "eyJ",
  "abcdefghijk",
  ".",
  "abcdefghijk",
  ".",
  "abcdefghijk",
].join("");

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function git(cwd, ...args) {
  const result = run("git", args, { cwd });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepo(prefix) {
  const repo = mkdtempSync(path.join(os.tmpdir(), prefix));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "verification@example.invalid");
  git(repo, "config", "user.name", "Verification Test");
  writeFileSync(path.join(repo, "app.txt"), "clean\n");
  git(repo, "add", "app.txt");
  git(repo, "commit", "-qm", "base");
  return repo;
}

function scan(repo, ...revisions) {
  const args = revisions.length > 0 ? ["--range", ...revisions] : [];
  return run("bash", [scanner, ...args], { cwd: repo });
}

function withRepo(prefix, body) {
  const repo = initRepo(prefix);
  try {
    return body(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function commitFile(repo, name, content, message = "change") {
  writeFileSync(path.join(repo, name), content);
  git(repo, "add", name);
  git(repo, "commit", "-qm", message);
  return git(repo, "rev-parse", "HEAD");
}

function assertRejectedWithoutLeak(result, secret) {
  assert.notEqual(result.status, 0, "secret-bearing object set must be rejected");
  assert.match(result.stdout, /potential secret material \[redacted\]/);
  assert.equal(result.stdout.includes(secret), false, "secret must not reach scanner logs");
}

test("scanner accepts clean history and .env.example", () => {
  withRepo("verification-clean-", (repo) => {
    writeFileSync(path.join(repo, ".env.example"), "TOKEN=placeholder\n");
    git(repo, "add", ".env.example");
    git(repo, "commit", "-qm", "example env");
    assert.equal(scan(repo).status, 0);
  });
});

test("scanner fails closed when a revision cannot be resolved", () => {
  withRepo("verification-invalid-rev-", (repo) => {
    const result = scan(repo, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef..HEAD");
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /cannot resolve the selected Git object set/);
  });
});

for (const [name, value] of [
  ["AWS-shaped secret", AWS_FIXTURE],
  ["private-key header", PRIVATE_KEY_FIXTURE],
  ["JWT-shaped secret", JWT_FIXTURE],
]) {
  test(`scanner rejects ${name} in file content without logging it`, () => {
    withRepo("verification-blob-secret-", (repo) => {
      const base = git(repo, "rev-parse", "HEAD");
      const tip = commitFile(repo, "secret.txt", `${value}\n`, "secret file");
      assertRejectedWithoutLeak(scan(repo, `${base}..${tip}`), value);
    });
  });
}

test("scanner rejects a secret that is added and removed inside the range", () => {
  withRepo("verification-range-history-", (repo) => {
    const base = git(repo, "rev-parse", "HEAD");
    commitFile(repo, "secret.txt", `${AWS_FIXTURE}\n`, "add secret");
    git(repo, "rm", "-q", "secret.txt");
    git(repo, "commit", "-qm", "remove secret");
    const tip = git(repo, "rev-parse", "HEAD");
    assertRejectedWithoutLeak(scan(repo, `${base}..${tip}`), AWS_FIXTURE);
  });
});

test("scanner rejects a secret carried only in commit metadata", () => {
  withRepo("verification-commit-metadata-", (repo) => {
    const base = git(repo, "rev-parse", "HEAD");
    git(repo, "commit", "--allow-empty", "-qm", `metadata ${AWS_FIXTURE}`);
    const tip = git(repo, "rev-parse", "HEAD");
    assertRejectedWithoutLeak(scan(repo, `${base}..${tip}`), AWS_FIXTURE);
  });
});

test("scanner covers annotated and lightweight tags", () => {
  withRepo("verification-tags-", (repo) => {
    const target = git(repo, "rev-parse", "HEAD");
    git(repo, "tag", "lightweight", target);
    assert.equal(scan(repo, git(repo, "rev-parse", "lightweight")).status, 0);

    git(repo, "tag", "-a", "clean-tag", target, "-m", "clean release");
    const cleanTag = git(repo, "rev-parse", "clean-tag");
    assert.equal(scan(repo, cleanTag).status, 0);

    git(repo, "tag", "-a", "secret-tag", target, "-m", `release ${AWS_FIXTURE}`);
    const secretTag = git(repo, "rev-parse", "secret-tag");
    assertRejectedWithoutLeak(scan(repo, secretTag), AWS_FIXTURE);
    assertRejectedWithoutLeak(scan(repo, `${cleanTag}..${secretTag}`), AWS_FIXTURE);
  });
});

test("scanner covers direct blob and tree ref targets", () => {
  withRepo("verification-direct-objects-", (repo) => {
    const blobResult = run("git", ["hash-object", "-w", "--stdin"], {
      cwd: repo,
      input: `${AWS_FIXTURE}\n`,
    });
    assert.equal(blobResult.status, 0, blobResult.stderr);
    const blob = blobResult.stdout.trim();
    assertRejectedWithoutLeak(scan(repo, blob), AWS_FIXTURE);

    writeFileSync(path.join(repo, "direct.txt"), `${PRIVATE_KEY_FIXTURE}\n`);
    git(repo, "add", "direct.txt");
    const tree = git(repo, "write-tree");
    assertRejectedWithoutLeak(scan(repo, tree), PRIVATE_KEY_FIXTURE);
  });
});

test("scanner rejects prohibited .env entries", () => {
  withRepo("verification-env-", (repo) => {
    writeFileSync(path.join(repo, ".env"), "TOKEN=placeholder\n");
    git(repo, "add", "-f", ".env");
    git(repo, "commit", "-qm", "env file");
    const result = scan(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /prohibited \.env entry/);
  });
});
