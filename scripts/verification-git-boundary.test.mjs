import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const scanner = path.resolve(root, "scripts/scan-secrets.sh");
const hook = path.resolve(root, ".githooks/pre-push");
const installer = path.resolve(root, "scripts/install-git-hooks.sh");
const verifier = path.resolve(root, "scripts/verify-production.sh");
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

test("scanner refuses shallow history", () => {
  const source = initRepo("verification-shallow-source-");
  const cloneParent = mkdtempSync(path.join(os.tmpdir(), "verification-shallow-clone-"));
  const clone = path.join(cloneParent, "repo");
  try {
    commitFile(source, "second.txt", "second\n", "second");
    const result = run("git", ["clone", "-q", "--depth", "1", `file://${source}`, clone]);
    assert.equal(result.status, 0, result.stderr);
    const scanned = scan(clone);
    assert.notEqual(scanned.status, 0);
    assert.match(scanned.stdout, /repository history is shallow/);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(cloneParent, { recursive: true, force: true });
  }
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

function installHookFixture(repo) {
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  mkdirSync(path.join(repo, ".githooks"), { recursive: true });
  copyFileSync(scanner, path.join(repo, "scripts", "scan-secrets.sh"));
  copyFileSync(hook, path.join(repo, ".githooks", "pre-push"));
}

test("pre-push scans new and existing outgoing object ranges", () => {
  withRepo("verification-hook-", (repo) => {
    installHookFixture(repo);
    commitFile(repo, "secret.txt", `${AWS_FIXTURE}\n`, "old secret");
    git(repo, "rm", "-q", "secret.txt");
    git(repo, "commit", "-qm", "remove old secret");
    const remoteBase = git(repo, "rev-parse", "HEAD");
    const cleanTip = commitFile(repo, "app.txt", "clean update\n", "clean update");

    const existing = run("bash", [path.join(repo, ".githooks", "pre-push")], {
      cwd: repo,
      input: `refs/heads/main ${cleanTip} refs/heads/main ${remoteBase}\n`,
    });
    assert.equal(existing.status, 0, existing.stdout + existing.stderr);

    const newRef = run("bash", [path.join(repo, ".githooks", "pre-push")], {
      cwd: repo,
      input: `refs/heads/new ${cleanTip} refs/heads/new ${"0".repeat(40)}\n`,
    });
    assert.notEqual(newRef.status, 0, "new ref must include reachable secret history");
    assert.equal(newRef.stdout.includes(AWS_FIXTURE), false);
  });
});

test("pre-push ignores deletions but still scans mixed content pushes", () => {
  withRepo("verification-hook-delete-", (repo) => {
    installHookFixture(repo);
    const remote = git(repo, "rev-parse", "HEAD");
    const deletion = `refs/heads/gone ${"0".repeat(40)} refs/heads/gone ${remote}\n`;
    const deletionOnly = run("bash", [path.join(repo, ".githooks", "pre-push")], {
      cwd: repo,
      input: deletion,
    });
    assert.equal(deletionOnly.status, 0, deletionOnly.stdout + deletionOnly.stderr);

    const secretTip = commitFile(repo, "secret.txt", `${AWS_FIXTURE}\n`, "secret");
    const mixed = run("bash", [path.join(repo, ".githooks", "pre-push")], {
      cwd: repo,
      input:
        deletion +
        `refs/heads/main ${secretTip} refs/heads/main ${remote}\n`,
    });
    assert.notEqual(mixed.status, 0, "content row in a mixed push must still be scanned");
  });
});

test("hook installer tolerates no repository and propagates real Git config failures", () => {
  const nonRepo = mkdtempSync(path.join(os.tmpdir(), "verification-no-repo-"));
  try {
    assert.equal(run("bash", [installer], { cwd: nonRepo }).status, 0);
  } finally {
    rmSync(nonRepo, { recursive: true, force: true });
  }

  withRepo("verification-installer-", (repo) => {
    const installed = run("bash", [installer], { cwd: repo });
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(git(repo, "config", "--get", "core.hooksPath"), ".githooks");

    writeFileSync(path.join(repo, ".git", "config.lock"), "locked\n");
    try {
      const blocked = run("bash", [installer], { cwd: repo });
      assert.notEqual(blocked.status, 0, "Git config failure must propagate");
    } finally {
      rmSync(path.join(repo, ".git", "config.lock"), { force: true });
    }
  });
});

test("production verification refuses a dirty candidate before mutating gates", () => {
  withRepo("verification-dirty-candidate-", (repo) => {
    mkdirSync(path.join(repo, "scripts"), { recursive: true });
    copyFileSync(verifier, path.join(repo, "scripts", "verify-production.sh"));
    writeFileSync(path.join(repo, "app.txt"), "uncommitted\n");

    const result = run("bash", ["scripts/verify-production.sh"], { cwd: repo });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Candidate clean before verification: FAIL/);
    assert.doesNotMatch(result.stdout, /==> Install \(frozen lockfile\)/);
    assert.equal(readFileSync(path.join(repo, "app.txt"), "utf8"), "uncommitted\n");
  });
});
