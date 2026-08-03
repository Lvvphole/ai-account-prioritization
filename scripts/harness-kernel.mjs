#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  BLOCKED: "BLOCKED",
});

export const EXIT_CODE = Object.freeze({
  PASS: 0,
  FAIL: 1,
  BLOCKED: 2,
});

const CONTRACT_VERSION = 0;
const OUTPUT_LIMIT = 16_384;

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function parseContract(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "contract.yaml v0 must be JSON-compatible YAML (a valid JSON document)",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("contract root must be an object");
  }
  if (parsed.version !== CONTRACT_VERSION) {
    throw new Error(`contract version must be ${CONTRACT_VERSION}`);
  }
  if (!Array.isArray(parsed.contracts)) {
    throw new Error("contracts must be an array");
  }

  const contractIds = new Set();
  for (const [contractIndex, contract] of parsed.contracts.entries()) {
    if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
      throw new Error(`contracts[${contractIndex}] must be an object`);
    }
    assertNonEmptyString(contract.id, `contracts[${contractIndex}].id`);
    if (contractIds.has(contract.id)) {
      throw new Error(`duplicate contract id: ${contract.id}`);
    }
    contractIds.add(contract.id);

    if (!Array.isArray(contract.paths) || contract.paths.length === 0) {
      throw new Error(`contract ${contract.id} must define at least one path`);
    }
    for (const [pathIndex, pattern] of contract.paths.entries()) {
      assertNonEmptyString(pattern, `${contract.id}.paths[${pathIndex}]`);
      if (pattern.startsWith("/") || pattern.includes("\\")) {
        throw new Error(
          `${contract.id}.paths[${pathIndex}] must be a repository-relative POSIX path pattern`,
        );
      }
    }

    if (!Array.isArray(contract.gates) || contract.gates.length === 0) {
      throw new Error(`contract ${contract.id} must define at least one gate`);
    }
    const gateIds = new Set();
    for (const [gateIndex, gate] of contract.gates.entries()) {
      if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
        throw new Error(`${contract.id}.gates[${gateIndex}] must be an object`);
      }
      assertNonEmptyString(gate.id, `${contract.id}.gates[${gateIndex}].id`);
      assertNonEmptyString(
        gate.command,
        `${contract.id}.gates[${gateIndex}].command`,
      );
      if (gateIds.has(gate.id)) {
        throw new Error(`duplicate gate id in ${contract.id}: ${gate.id}`);
      }
      gateIds.add(gate.id);
    }
  }

  return parsed;
}

export function globToRegExp(pattern) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += char.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
    }
  }
  expression += "$";
  return new RegExp(expression);
}

export function selectAffectedContracts(contract, changedFiles) {
  return contract.contracts.filter((item) =>
    item.paths.some((pattern) => {
      const matcher = globToRegExp(pattern);
      return changedFiles.some((file) => matcher.test(file));
    }),
  );
}

function truncateOutput(value) {
  const text = value ?? "";
  if (text.length <= OUTPUT_LIMIT) {
    return text;
  }
  return `[truncated to last ${OUTPUT_LIMIT} characters]\n${text.slice(-OUTPUT_LIMIT)}`;
}

function run(command, cwd) {
  return spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = truncateOutput(result.stderr || result.error?.message || "");
    throw new Error(`git ${args.join(" ")} failed: ${detail.trim()}`);
  }
  return result.stdout.trim();
}

export function getChangedFiles({ cwd, base, head }) {
  const baseSha = git(["rev-parse", "--verify", `${base}^{commit}`], cwd);
  const worktree = head === "WORKTREE";
  const headSha = worktree
    ? git(["rev-parse", "--verify", "HEAD^{commit}"], cwd)
    : git(["rev-parse", "--verify", `${head}^{commit}`], cwd);
  const mergeBase = git(["merge-base", baseSha, headSha], cwd);
  const diffArgs = worktree
    ? ["diff", "--name-only", mergeBase]
    : ["diff", "--name-only", mergeBase, headSha];
  const output = git(diffArgs, cwd);
  const files = output
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
  if (worktree) {
    const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd);
    files.push(
      ...untracked
        .split("\n")
        .map((file) => file.trim())
        .filter(Boolean),
    );
  }
  const changedFiles = [...new Set(files)].sort();

  return {
    baseSha,
    headSha,
    headRef: worktree ? "WORKTREE" : head,
    mergeBase,
    changedFiles,
  };
}

export function runGate(gate, contractId, cwd) {
  const result = run(gate.command, cwd);
  if (result.error) {
    return {
      contract_id: contractId,
      id: gate.id,
      command: gate.command,
      status: STATUS.BLOCKED,
      exit_code: null,
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr || result.error.message),
    };
  }

  return {
    contract_id: contractId,
    id: gate.id,
    command: gate.command,
    status: result.status === 0 ? STATUS.PASS : STATUS.FAIL,
    exit_code: result.status,
    stdout: truncateOutput(result.stdout),
    stderr: truncateOutput(result.stderr),
  };
}

function parseArgs(argv) {
  const values = {
    base: process.env.HARNESS_BASE_SHA || "origin/main",
    head: process.env.HARNESS_HEAD_SHA || "WORKTREE",
    contract: ".harness/contract.yaml",
    evidence: "verification-reports/harness-evidence.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--base", "--head", "--contract", "--evidence"].includes(key)) {
      throw new Error(`unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${key}`);
    }
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

function writeEvidence(outputPath, evidence) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function blockedEvidence(reason, base, head) {
  return {
    schema_version: 0,
    status: STATUS.BLOCKED,
    base_ref: base,
    head_ref: head,
    base_sha: null,
    head_sha: null,
    merge_base: null,
    changed_files: [],
    affected_contracts: [],
    gates: [],
    blocked_reason: reason,
  };
}

export function executeHarness({ cwd, base, head, contractPath }) {
  const contract = parseContract(readFileSync(contractPath, "utf8"));
  const diff = getChangedFiles({ cwd, base, head });
  const affected = selectAffectedContracts(contract, diff.changedFiles);
  const gates = [];

  for (const item of affected) {
    for (const gate of item.gates) {
      const gateResult = runGate(gate, item.id, cwd);
      gates.push(gateResult);
      if (gateResult.status === STATUS.BLOCKED) {
        return {
          schema_version: 0,
          status: STATUS.BLOCKED,
          base_ref: base,
          head_ref: diff.headRef,
          base_sha: diff.baseSha,
          head_sha: diff.headSha,
          merge_base: diff.mergeBase,
          changed_files: diff.changedFiles,
          affected_contracts: affected.map((contractItem) => contractItem.id),
          gates,
          blocked_reason: `gate could not execute: ${item.id}/${gate.id}`,
        };
      }
      if (gateResult.status === STATUS.FAIL) {
        return {
          schema_version: 0,
          status: STATUS.FAIL,
          base_ref: base,
          head_ref: diff.headRef,
          base_sha: diff.baseSha,
          head_sha: diff.headSha,
          merge_base: diff.mergeBase,
          changed_files: diff.changedFiles,
          affected_contracts: affected.map((contractItem) => contractItem.id),
          gates,
          blocked_reason: null,
        };
      }
    }
  }

  return {
    schema_version: 0,
    status: STATUS.PASS,
    base_ref: base,
    head_ref: diff.headRef,
    base_sha: diff.baseSha,
    head_sha: diff.headSha,
    merge_base: diff.mergeBase,
    changed_files: diff.changedFiles,
    affected_contracts: affected.map((item) => item.id),
    gates,
    blocked_reason: null,
  };
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const evidence = blockedEvidence(error.message, null, null);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return EXIT_CODE.BLOCKED;
  }

  let cwd;
  let evidence;
  try {
    cwd = git(["rev-parse", "--show-toplevel"], process.cwd());
    const contractPath = resolve(cwd, args.contract);
    evidence = executeHarness({
      cwd,
      base: args.base,
      head: args.head,
      contractPath,
    });
  } catch (error) {
    evidence = blockedEvidence(error.message, args.base, args.head);
  }

  const evidencePath = resolve(cwd || process.cwd(), args.evidence);
  try {
    writeEvidence(evidencePath, evidence);
  } catch (error) {
    evidence = blockedEvidence(
      `failed to write evidence: ${error.message}`,
      args.base,
      args.head,
    );
  }

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return EXIT_CODE[evidence.status];
}

const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  process.exitCode = main();
}
