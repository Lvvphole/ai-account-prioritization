#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ZERO_SHA = /^0{40}$/;
const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isSourcePath(filePath, policy) {
  const normalized = normalizePath(filePath);
  const basename = path.posix.basename(normalized);

  if (policy.changeBudget.excludeBasenames.includes(basename)) return false;
  if (policy.changeBudget.excludePrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }

  if (policy.changeBudget.sourceBasenames.includes(basename)) return true;
  return policy.changeBudget.sourceExtensions.includes(path.posix.extname(normalized));
}

export function countNumstat(numstat, policy) {
  let total = 0;
  const files = [];

  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const [addedRaw, , ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    if (!filePath || addedRaw === '-' || !isSourcePath(filePath, policy)) continue;

    const added = Number.parseInt(addedRaw, 10);
    if (!Number.isFinite(added)) continue;
    total += added;
    files.push({ path: normalizePath(filePath), changedSourceLines: added });
  }

  return { total, files };
}

function diffNumstat(from, to) {
  return git(['diff', '--numstat', '--no-renames', from, to, '--']);
}

function showNumstat(commit) {
  return git(['show', '--numstat', '--format=', '--no-renames', commit, '--']);
}

function listCommits(base, head) {
  const output = git(['rev-list', '--reverse', `${base}..${head}`]);
  return output ? output.split('\n').filter(Boolean) : [];
}

export function extractPriority(body, policy) {
  const regex = new RegExp(policy.repair.priorityPattern, 'i');
  const match = regex.exec(body ?? '');
  return match ? `P${match[1]}`.toUpperCase() : null;
}

export function subsystemForPath(filePath, policy) {
  const normalized = normalizePath(filePath ?? 'unknown');

  for (const group of policy.repair.subsystemGroups) {
    if (group.prefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix))) {
      return group.name;
    }
  }

  const parts = normalized.split('/');
  if (parts[0] === 'apps' && parts[2] === 'src' && parts[3] === 'agents' && parts[4]) {
    return parts.slice(0, 5).join('/');
  }
  if ((parts[0] === 'apps' || parts[0] === 'packages') && parts[1]) {
    return parts.slice(0, 2).join('/');
  }
  return parts.length > 1 ? parts[0] : normalized;
}

function toEpoch(value) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error(`Invalid timestamp: ${value}`);
  return epoch;
}

export function analyzeRepairEvents({ commits, findings, policy }) {
  const events = [
    ...commits.map((commit) => ({ type: 'commit', at: toEpoch(commit.committedAt), value: commit })),
    ...findings.map((finding) => ({ type: 'finding', at: toEpoch(finding.createdAt), value: finding })),
  ].sort((a, b) => a.at - b.at || (a.type === 'finding' ? -1 : 1));

  const rounds = [];
  const blockedReasons = [];
  let awaitingRepair = false;
  let pendingFindings = [];
  let lastRoundSubsystems = new Set();
  let repairRound = 0;

  for (const event of events) {
    if (event.type === 'finding') {
      const finding = event.value;
      const subsystem = subsystemForPath(finding.path, policy);
      const priority = finding.priority;

      if (repairRound > 0 && !finding.resolved) {
        if ((priority === 'P0' || priority === 'P1') && policy.repair.newValidP0P1AfterRepair === 0) {
          blockedReasons.push({
            code: 'NEW_VALID_P0_P1_AFTER_REPAIR',
            findingId: finding.id,
            subsystem,
            priority,
          });
        }

        if (
          lastRoundSubsystems.has(subsystem) &&
          policy.repair.sameSubsystemRepeatDefectBudget === 0
        ) {
          blockedReasons.push({
            code: 'SAME_SUBSYSTEM_REPEAT_DEFECT',
            findingId: finding.id,
            subsystem,
            priority,
          });
        }

        if (repairRound >= policy.repair.maxRoundsPerPr) {
          blockedReasons.push({
            code: 'MAX_REPAIR_ROUNDS_EXCEEDED',
            findingId: finding.id,
            subsystem,
            priority,
          });
        }
      }

      awaitingRepair = true;
      pendingFindings.push({ ...finding, subsystem });
      continue;
    }

    if (awaitingRepair) {
      repairRound += 1;
      const subsystems = [...new Set(pendingFindings.map((finding) => finding.subsystem))];
      const round = {
        number: repairRound,
        firstCommitSha: event.value.sha,
        firstCommitAt: event.value.committedAt,
        findingIds: pendingFindings.map((finding) => finding.id),
        subsystems,
      };
      rounds.push(round);
      lastRoundSubsystems = new Set(subsystems);
      pendingFindings = [];
      awaitingRepair = false;

      if (repairRound > policy.repair.maxRoundsPerPr) {
        blockedReasons.push({
          code: 'MAX_REPAIR_ROUNDS_EXCEEDED',
          commitSha: event.value.sha,
        });
      }
    }
  }

  const pendingUnresolved = pendingFindings.filter((finding) => !finding.resolved);
  const circuitBreakerState = blockedReasons.length > 0
    ? 'BLOCKED'
    : pendingUnresolved.length > 0
      ? 'AWAITING_REPAIR'
      : 'OPEN';

  return {
    repairRound,
    rounds,
    pendingUnresolved,
    blockedReasons: dedupeReasons(blockedReasons),
    circuitBreakerState,
  };
}

function dedupeReasons(reasons) {
  const seen = new Set();
  return reasons.filter((reason) => {
    const key = JSON.stringify(reason);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function verifyContractDrift(policy, agentsPath) {
  const text = fs.readFileSync(agentsPath, 'utf8');
  const expected = new Map([
    ['MAX_CODE_CHANGE_LINES', policy.changeBudget.maxChangedSourceLinesPerExecution],
    ['MAX_REPAIR_ROUNDS_PER_PR', policy.repair.maxRoundsPerPr],
    ['NEW_REGRESSION_BUDGET', policy.repair.newRegressionBudget],
    ['NEW_VALID_P0_P1_AFTER_REPAIR', policy.repair.newValidP0P1AfterRepair],
    ['SAME_SUBSYSTEM_REPEAT_DEFECT_BUDGET', policy.repair.sameSubsystemRepeatDefectBudget],
  ]);

  const drift = [];
  for (const [name, value] of expected) {
    const regex = new RegExp(`${name}\\s*=\\s*${value}(?:\\s|$)`);
    if (!regex.test(text)) drift.push(`${name}=${value}`);
  }
  return drift;
}

async function githubJson(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchAllPrCommits({ apiUrl, repository, prNumber, token }) {
  const commits = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(
      `${apiUrl}/repos/${repository}/pulls/${prNumber}/commits?per_page=100&page=${page}`,
      token,
    );
    commits.push(...batch.map((item) => ({
      sha: item.sha,
      committedAt: item.commit.committer?.date ?? item.commit.author?.date,
    })));
    if (batch.length < 100) break;
  }
  return commits;
}

async function fetchReviewThreads({ repository, prNumber, token }) {
  const [owner, name] = repository.split('/');
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            nodes {
              id
              isResolved
              path
              comments(first: 1) {
                nodes { id body createdAt url author { login } }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;

  const threads = [];
  let cursor = null;
  do {
    const data = await githubJson('https://api.github.com/graphql', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner, name, number: prNumber, cursor } }),
    });
    if (data.errors?.length) throw new Error(`GitHub GraphQL: ${JSON.stringify(data.errors)}`);
    const page = data.data.repository.pullRequest.reviewThreads;
    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return threads;
}

async function fetchCheckRuns({ apiUrl, repository, sha, token }) {
  const data = await githubJson(
    `${apiUrl}/repos/${repository}/commits/${sha}/check-runs?per_page=100&filter=latest`,
    token,
  );
  return new Map(
    data.check_runs
      .filter((check) => check.status === 'completed' && check.conclusion)
      .map((check) => [check.name, check.conclusion]),
  );
}

async function detectNewRegressions({ apiUrl, repository, token, baseSha, commits, rounds }) {
  const commitIndex = new Map(commits.map((commit, index) => [commit.sha, index]));
  const regressions = [];
  const cache = new Map();

  const checks = async (sha) => {
    if (!cache.has(sha)) cache.set(sha, await fetchCheckRuns({ apiUrl, repository, sha, token }));
    return cache.get(sha);
  };

  for (const round of rounds) {
    const index = commitIndex.get(round.firstCommitSha);
    const baselineSha = index > 0 ? commits[index - 1].sha : baseSha;
    const baselineChecks = await checks(baselineSha);
    const repairChecks = await checks(round.firstCommitSha);

    for (const [name, conclusion] of repairChecks) {
      if (!FAILURE_CONCLUSIONS.has(conclusion)) continue;
      if (baselineChecks.get(name) === 'success') {
        regressions.push({ round: round.number, check: name, baselineSha, repairSha: round.firstCommitSha });
      }
    }
  }

  return regressions;
}

function buildChangeBudgetReport({ event, policy }) {
  const limit = policy.changeBudget.maxChangedSourceLinesPerExecution;
  const executions = [];

  if (event.pull_request) {
    const base = event.pull_request.base.sha;
    const head = event.pull_request.head.sha;
    for (const sha of listCommits(base, head)) {
      const count = countNumstat(showNumstat(sha), policy);
      executions.push({ kind: 'commit', sha, changedSourceLines: count.total, files: count.files });
    }
  } else if (event.before && event.after && !ZERO_SHA.test(event.before)) {
    const count = countNumstat(diffNumstat(event.before, event.after), policy);
    executions.push({
      kind: 'push',
      from: event.before,
      to: event.after,
      changedSourceLines: count.total,
      files: count.files,
    });
  } else {
    const head = process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']);
    const count = countNumstat(showNumstat(head), policy);
    executions.push({ kind: 'commit', sha: head, changedSourceLines: count.total, files: count.files });
  }

  const violations = executions.filter((execution) => execution.changedSourceLines > limit);
  return { limit, executions, violations };
}

function appendSummary(report) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const lines = [
    '## Agent contract gate',
    '',
    `- Change budget: ${report.changeBudget.violations.length ? 'BLOCKED' : 'PASS'} (limit ${report.changeBudget.limit})`,
    `- Repair round: ${report.repair?.repairRound ?? 'n/a'}`,
    `- New regressions: ${report.repair?.newRegressions?.length ?? 'n/a'}`,
    `- Circuit breaker: ${report.repair?.circuitBreakerState ?? 'n/a'}`,
  ];
  if (report.blockedReasons.length) {
    lines.push('', '### Block reasons');
    for (const reason of report.blockedReasons) lines.push(`- \`${reason.code}\``);
  }
  fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`);
}

export async function run(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const policyPath = options.policyPath ?? path.join(cwd, '.harness', 'policy.json');
  const agentsPath = options.agentsPath ?? path.join(cwd, 'AGENTS.md');
  const eventPath = options.eventPath ?? process.env.GITHUB_EVENT_PATH;
  const event = options.event ?? (eventPath && fs.existsSync(eventPath) ? readJson(eventPath) : {});
  const policy = options.policy ?? readJson(policyPath);
  const blockedReasons = [];

  const drift = verifyContractDrift(policy, agentsPath);
  for (const item of drift) blockedReasons.push({ code: 'POLICY_CONTRACT_DRIFT', expected: item });

  const previousCwd = process.cwd();
  process.chdir(cwd);
  let changeBudget;
  try {
    changeBudget = buildChangeBudgetReport({ event, policy });
  } finally {
    process.chdir(previousCwd);
  }

  for (const violation of changeBudget.violations) {
    blockedReasons.push({
      code: 'CODE_CHANGE_BUDGET_EXCEEDED',
      changedSourceLines: violation.changedSourceLines,
      limit: changeBudget.limit,
      execution: violation.sha ?? `${violation.from}..${violation.to}`,
    });
  }

  let repair = null;
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  const apiUrl = options.apiUrl ?? process.env.GITHUB_API_URL ?? 'https://api.github.com';

  if (event.pull_request && token && repository) {
    const prNumber = event.pull_request.number ?? event.number;
    const commits = await fetchAllPrCommits({ apiUrl, repository, prNumber, token });
    const threads = await fetchReviewThreads({ repository, prNumber, token });
    const findings = threads
      .map((thread) => {
        const comment = thread.comments.nodes[0];
        if (!comment) return null;
        return {
          id: thread.id,
          commentId: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          path: thread.path,
          resolved: thread.isResolved,
          priority: extractPriority(comment.body, policy),
          author: comment.author?.login ?? 'unknown',
          url: comment.url,
        };
      })
      .filter(Boolean);

    repair = analyzeRepairEvents({ commits, findings, policy });
    const newRegressions = await detectNewRegressions({
      apiUrl,
      repository,
      token,
      baseSha: event.pull_request.base.sha,
      commits,
      rounds: repair.rounds,
    });
    repair.newRegressions = newRegressions;

    if (newRegressions.length > policy.repair.newRegressionBudget) {
      repair.blockedReasons.push({
        code: 'NEW_REGRESSION_BUDGET_EXCEEDED',
        count: newRegressions.length,
        budget: policy.repair.newRegressionBudget,
      });
      repair.circuitBreakerState = 'BLOCKED';
    }
    blockedReasons.push(...repair.blockedReasons);
  }

  const report = {
    policyVersion: policy.version,
    changeBudget,
    repair,
    blockedReasons: dedupeReasons(blockedReasons),
  };

  appendSummary(report);
  console.log(JSON.stringify(report, null, 2));

  return report;
}

async function main() {
  try {
    const report = await run();
    if (report.blockedReasons.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error('[agent-contract] enforcement error:', error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
