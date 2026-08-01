#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
const LEDGER_TYPES = new Set(['COMMIT_OBSERVED', 'DEFECT_DISCOVERED', 'REDESIGN_AUTHORIZED']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function normalizePath(filePath) {
  return (filePath ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isSourcePath(filePath, policy) {
  const normalized = normalizePath(filePath);
  const basename = path.posix.basename(normalized);
  if (policy.changeBudget.excludeBasenames.includes(basename)) return false;
  if (policy.changeBudget.excludePrefixes.some((prefix) => normalized.startsWith(prefix))) return false;
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

export function extractPriority(body, policy) {
  const match = new RegExp(policy.repair.priorityPattern, 'i').exec(body ?? '');
  return match ? `P${match[1]}`.toUpperCase() : null;
}

export function subsystemForPath(filePath, policy) {
  const normalized = normalizePath(filePath || 'unknown');
  for (const group of policy.repair.subsystemGroups) {
    if (group.prefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix))) return group.name;
  }
  const parts = normalized.split('/');
  if (parts[0] === 'apps' && parts[2] === 'src' && parts[3] === 'agents' && parts[4]) {
    return parts.slice(0, 5).join('/');
  }
  if ((parts[0] === 'apps' || parts[0] === 'packages') && parts[1]) return parts.slice(0, 2).join('/');
  return parts.length > 1 ? parts[0] : normalized;
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

export function parseLedgerComment(body, marker) {
  if (!body?.includes(marker)) return null;
  const fenced = /```json\s*([\s\S]*?)```/i.exec(body);
  if (!fenced) return null;
  try {
    const event = JSON.parse(fenced[1]);
    return LEDGER_TYPES.has(event.type) ? event : null;
  } catch {
    return null;
  }
}

function eventEpoch(item) {
  const value = item.occurredAt ?? item.createdAt;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error(`Invalid ledger timestamp: ${value}`);
  return epoch;
}

function ledgerKey(event) {
  if (event.type === 'COMMIT_OBSERVED') return `commit:${event.sha}`;
  if (event.type === 'DEFECT_DISCOVERED') return `finding:${event.findingId}`;
  if (event.type === 'REDESIGN_AUTHORIZED') return `redesign:${event.subsystem}:${event.headSha}`;
  return JSON.stringify(event);
}

function dedupeLedger(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = ledgerKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function analyzeLedger({ ledger, policy }) {
  const ordered = dedupeLedger([...ledger]).sort((a, b) => eventEpoch(a) - eventEpoch(b) || a.sequence - b.sequence);
  const latestAuthorization = new Map();
  for (const item of ordered) {
    if (item.type === 'REDESIGN_AUTHORIZED') latestAuthorization.set(item.subsystem, item);
  }

  const active = ordered.filter((item) => {
    if (item.type === 'REDESIGN_AUTHORIZED' || item.type === 'COMMIT_OBSERVED') return true;
    const authorization = item.subsystem ? latestAuthorization.get(item.subsystem) : null;
    return !authorization || eventEpoch(item) > eventEpoch(authorization);
  });

  const rounds = [];
  const blockedReasons = [];
  let pendingFindings = [];
  let currentRound = null;
  let completedRoundSubsystems = new Set();

  for (const event of active) {
    if (event.type === 'REDESIGN_AUTHORIZED') {
      pendingFindings = [];
      currentRound = null;
      completedRoundSubsystems = new Set();
      continue;
    }

    if (event.type === 'DEFECT_DISCOVERED') {
      if (currentRound?.commitShas.length) {
        rounds.push(currentRound);
        completedRoundSubsystems = new Set(currentRound.subsystems);
        currentRound = null;
      }

      const roundCount = rounds.length;
      if (roundCount > 0) {
        if ((event.priority === 'P0' || event.priority === 'P1') && policy.repair.newValidP0P1AfterRepair === 0) {
          blockedReasons.push({ code: 'NEW_VALID_P0_P1_AFTER_REPAIR', findingId: event.findingId, subsystem: event.subsystem, priority: event.priority });
        }
        if (completedRoundSubsystems.has(event.subsystem) && policy.repair.sameSubsystemRepeatDefectBudget === 0) {
          blockedReasons.push({ code: 'SAME_SUBSYSTEM_REPEAT_DEFECT', findingId: event.findingId, subsystem: event.subsystem, priority: event.priority });
        }
        if (roundCount >= policy.repair.maxRoundsPerPr) {
          blockedReasons.push({ code: 'MAX_REPAIR_ROUNDS_EXCEEDED', findingId: event.findingId, subsystem: event.subsystem });
        }
      }
      pendingFindings.push(event);
      continue;
    }

    if (event.type === 'COMMIT_OBSERVED') {
      if (pendingFindings.length && !currentRound) {
        const number = rounds.length + 1;
        currentRound = {
          number,
          findingIds: pendingFindings.map((finding) => finding.findingId),
          subsystems: [...new Set(pendingFindings.map((finding) => finding.subsystem))],
          commitShas: [],
        };
        pendingFindings = [];
      }
      if (currentRound) currentRound.commitShas.push(event.sha);
    }
  }

  if (currentRound?.commitShas.length) rounds.push(currentRound);
  if (rounds.length > policy.repair.maxRoundsPerPr) {
    blockedReasons.push({ code: 'MAX_REPAIR_ROUNDS_EXCEEDED', rounds: rounds.length, budget: policy.repair.maxRoundsPerPr });
  }

  return {
    repairRound: rounds.length,
    rounds,
    pendingFindingIds: pendingFindings.map((finding) => finding.findingId),
    blockedReasons: dedupeReasons(blockedReasons),
    circuitBreakerState: blockedReasons.length ? 'BLOCKED' : pendingFindings.length ? 'AWAITING_REPAIR' : 'OPEN',
  };
}

export function findRegressionCandidates({ rounds, commitOrder }) {
  const index = new Map(commitOrder.map((sha, i) => [sha, i]));
  return rounds.map((round) => {
    const firstIndex = index.get(round.commitShas[0]);
    if (firstIndex == null) throw new Error(`Round commit missing from PR: ${round.commitShas[0]}`);
    return {
      ...round,
      baselineSha: firstIndex > 0 ? commitOrder[firstIndex - 1] : null,
      checkShas: [...round.commitShas],
    };
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
  return [...expected].filter(([name, value]) => !new RegExp(`${name}\\s*=\\s*${value}(?:\\s|$)`).test(text)).map(([name, value]) => `${name}=${value}`);
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
  if (!response.ok) throw new Error(`GitHub API ${response.status} ${response.statusText}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function fetchAllPages(url, token) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const separator = url.includes('?') ? '&' : '?';
    const batch = await githubJson(`${url}${separator}per_page=100&page=${page}`, token);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

async function fetchPrCommits({ apiUrl, repository, prNumber, token }) {
  const rows = await fetchAllPages(`${apiUrl}/repos/${repository}/pulls/${prNumber}/commits`, token);
  return rows.map((row) => ({ sha: row.sha }));
}

async function fetchIssueComments({ apiUrl, repository, prNumber, token }) {
  return fetchAllPages(`${apiUrl}/repos/${repository}/issues/${prNumber}/comments`, token);
}

async function fetchReviewThreads({ repository, prNumber, token }) {
  const [owner, name] = repository.split('/');
  const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id path comments(first:1){nodes{id body createdAt url author{login}}}} pageInfo{hasNextPage endCursor}}}}}`;
  const threads = [];
  let cursor = null;
  do {
    const data = await githubJson('https://api.github.com/graphql', token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { owner, name, number: prNumber, cursor } }),
    });
    if (data.errors?.length) throw new Error(`GitHub GraphQL: ${JSON.stringify(data.errors)}`);
    const page = data.data.repository.pullRequest.reviewThreads;
    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return threads;
}

function ledgerBody(event, marker) {
  return `${marker}\n\`\`\`json\n${JSON.stringify(event)}\n\`\`\`\n`;
}

async function appendLedgerEvent({ apiUrl, repository, prNumber, token, marker, event }) {
  return githubJson(`${apiUrl}/repos/${repository}/issues/${prNumber}/comments`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: ledgerBody(event, marker) }),
  });
}

async function synchronizeLedger({ apiUrl, repository, prNumber, token, policy, commits, threads }) {
  const comments = await fetchIssueComments({ apiUrl, repository, prNumber, token });
  const ledger = comments.map((comment) => {
    const event = parseLedgerComment(comment.body, policy.ledger.marker);
    if (!event) return null;
    const actor = comment.user?.login ?? 'unknown';
    const allowed = event.type === 'REDESIGN_AUTHORIZED'
      ? policy.ledger.trustedActors.includes(actor)
      : policy.ledger.writerActors.includes(actor);
    return allowed ? { ...event, sequence: comment.id, createdAt: comment.created_at, ledgerCommentId: comment.id, actor } : null;
  }).filter(Boolean);

  const observedCommits = new Set(ledger.filter((event) => event.type === 'COMMIT_OBSERVED').map((event) => event.sha));
  const observedFindings = new Set(ledger.filter((event) => event.type === 'DEFECT_DISCOVERED').map((event) => event.findingId));

  for (const commit of commits) {
    if (observedCommits.has(commit.sha)) continue;
    const created = await appendLedgerEvent({ apiUrl, repository, prNumber, token, marker: policy.ledger.marker, event: { type: 'COMMIT_OBSERVED', sha: commit.sha } });
    ledger.push({ type: 'COMMIT_OBSERVED', sha: commit.sha, sequence: created.id, createdAt: created.created_at, ledgerCommentId: created.id });
  }

  for (const thread of threads) {
    const comment = thread.comments.nodes[0];
    if (!comment || observedFindings.has(thread.id)) continue;
    const priority = extractPriority(comment.body, policy);
    if (!priority) continue;
    const event = {
      type: 'DEFECT_DISCOVERED', findingId: thread.id, reviewCommentId: comment.id, priority,
      subsystem: subsystemForPath(thread.path, policy), path: thread.path, reviewUrl: comment.url, occurredAt: comment.createdAt,
    };
    const created = await appendLedgerEvent({ apiUrl, repository, prNumber, token, marker: policy.ledger.marker, event });
    ledger.push({ ...event, sequence: created.id, createdAt: created.created_at, ledgerCommentId: created.id });
  }

  return dedupeLedger(ledger).sort((a, b) => eventEpoch(a) - eventEpoch(b) || a.sequence - b.sequence);
}

async function fetchCheckRuns({ apiUrl, repository, sha, token }) {
  const data = await githubJson(`${apiUrl}/repos/${repository}/commits/${sha}/check-runs?per_page=100&filter=latest`, token);
  return new Map(data.check_runs.filter((check) => check.status === 'completed' && check.conclusion).map((check) => [check.name, check.conclusion]));
}

async function detectNewRegressions({ apiUrl, repository, token, baseSha, commitOrder, rounds }) {
  const candidates = findRegressionCandidates({ rounds, commitOrder });
  const cache = new Map();
  const checks = async (sha) => {
    if (!cache.has(sha)) cache.set(sha, await fetchCheckRuns({ apiUrl, repository, sha, token }));
    return cache.get(sha);
  };
  const regressions = [];
  for (const round of candidates) {
    const baselineSha = round.baselineSha ?? baseSha;
    const baseline = await checks(baselineSha);
    for (const repairSha of round.checkShas) {
      const repair = await checks(repairSha);
      for (const [name, conclusion] of repair) {
        if (FAILURE_CONCLUSIONS.has(conclusion) && baseline.get(name) === 'success') {
          regressions.push({ round: round.number, check: name, baselineSha, repairSha });
        }
      }
    }
  }
  return regressions;
}

function buildChangeBudgetReport({ event, policy, cwd }) {
  const limit = policy.changeBudget.maxChangedSourceLinesPerExecution;
  if (policy.changeBudget.executionBoundary !== 'pull_request') throw new Error('Unsupported execution boundary');
  if (!event.pull_request) return { boundary: 'pull_request', limit, changedSourceLines: 0, files: [], violations: [] };
  const base = event.pull_request.base.sha;
  const head = event.pull_request.head.sha;
  const numstat = git(['diff', '--numstat', '--no-renames', base, head, '--'], cwd);
  const count = countNumstat(numstat, policy);
  return { boundary: 'pull_request', base, head, limit, changedSourceLines: count.total, files: count.files, violations: count.total > limit ? [{ changedSourceLines: count.total, limit }] : [] };
}

function appendSummary(report) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const lines = [
    '## Agent contract gate', '',
    `- Execution boundary: ${report.changeBudget.boundary}`,
    `- Changed source/config lines: ${report.changeBudget.changedSourceLines}/${report.changeBudget.limit}`,
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
  const policy = options.policy ?? readJson(options.policyPath ?? path.join(cwd, '.harness', 'policy.json'));
  const agentsPath = options.agentsPath ?? path.join(cwd, 'AGENTS.md');
  const eventPath = options.eventPath ?? process.env.GITHUB_EVENT_PATH;
  const event = options.event ?? (eventPath && fs.existsSync(eventPath) ? readJson(eventPath) : {});
  const blockedReasons = verifyContractDrift(policy, agentsPath).map((expected) => ({ code: 'POLICY_CONTRACT_DRIFT', expected }));
  const changeBudget = buildChangeBudgetReport({ event, policy, cwd });
  if (changeBudget.violations.length) blockedReasons.push({ code: 'CODE_CHANGE_BUDGET_EXCEEDED', changedSourceLines: changeBudget.changedSourceLines, limit: changeBudget.limit });

  let repair = null;
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  const apiUrl = options.apiUrl ?? process.env.GITHUB_API_URL ?? 'https://api.github.com';

  if (event.pull_request && (!token || !repository)) {
    blockedReasons.push({ code: 'LEDGER_UNAVAILABLE' });
  } else if (event.pull_request && token && repository) {
    const prNumber = event.pull_request.number ?? event.number;
    const commits = await fetchPrCommits({ apiUrl, repository, prNumber, token });
    const threads = await fetchReviewThreads({ repository, prNumber, token });
    const ledger = await synchronizeLedger({ apiUrl, repository, prNumber, token, policy, commits, threads });
    repair = analyzeLedger({ ledger, policy });
    repair.ledgerEvents = ledger.length;
    repair.newRegressions = await detectNewRegressions({
      apiUrl, repository, token, baseSha: event.pull_request.base.sha,
      commitOrder: commits.map((commit) => commit.sha), rounds: repair.rounds,
    });
    if (repair.newRegressions.length > policy.repair.newRegressionBudget) {
      repair.blockedReasons.push({ code: 'NEW_REGRESSION_BUDGET_EXCEEDED', count: repair.newRegressions.length, budget: policy.repair.newRegressionBudget });
      repair.circuitBreakerState = 'BLOCKED';
    }
    blockedReasons.push(...repair.blockedReasons);
  }

  const report = { policyVersion: policy.version, changeBudget, repair, blockedReasons: dedupeReasons(blockedReasons) };
  appendSummary(report);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  try {
    const report = await run();
    if (report.blockedReasons.length) process.exitCode = 1;
  } catch (error) {
    console.error('[agent-contract] enforcement error:', error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
