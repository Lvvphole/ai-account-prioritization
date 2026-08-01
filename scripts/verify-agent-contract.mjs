#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
const INCOMPLETE_CONCLUSIONS = new Set(['cancelled', 'skipped', 'neutral', 'stale']);

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
  if (parts[0] === 'apps' && parts[2] === 'src' && parts[3] === 'agents' && parts[4]) return parts.slice(0, 5).join('/');
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

export function parseRedesignAuthorization(body, marker) {
  if (!body?.includes(marker)) return null;
  const fenced = /```json\s*([\s\S]*?)```/i.exec(body);
  if (!fenced) return null;
  try {
    const value = JSON.parse(fenced[1]);
    return value.type === 'REDESIGN_AUTHORIZED' ? value : null;
  } catch {
    return null;
  }
}

export function applyRedesignCutovers(findings, authorizations) {
  const latest = new Map();
  for (const auth of authorizations) {
    const prior = latest.get(auth.subsystem);
    if (!prior || Date.parse(auth.createdAt) > Date.parse(prior.createdAt)) latest.set(auth.subsystem, auth);
  }
  return findings.filter((finding) => {
    const auth = latest.get(finding.subsystem);
    return !auth || Date.parse(finding.createdAt) > Date.parse(auth.createdAt);
  });
}

export function analyzeRepairHistory({ commitOrder, findings, policy }) {
  const commitIndex = new Map(commitOrder.map((sha, index) => [sha, index]));
  const grouped = new Map();

  for (const finding of findings) {
    const index = commitIndex.get(finding.reviewedCommitSha);
    if (index == null) continue;
    const key = finding.reviewedCommitSha;
    const group = grouped.get(key) ?? { reviewedCommitSha: key, index, findings: [] };
    group.findings.push(finding);
    grouped.set(key, group);
  }

  const checkpoints = [...grouped.values()].sort((a, b) => a.index - b.index);
  const rounds = [];
  const blockedReasons = [];

  for (let i = 0; i < checkpoints.length; i += 1) {
    const checkpoint = checkpoints[i];
    const priorRound = rounds.at(-1);

    if (priorRound) {
      for (const finding of checkpoint.findings) {
        if ((finding.priority === 'P0' || finding.priority === 'P1') && policy.repair.newValidP0P1AfterRepair === 0) {
          blockedReasons.push({ code: 'NEW_VALID_P0_P1_AFTER_REPAIR', findingId: finding.id, subsystem: finding.subsystem, priority: finding.priority });
        }
        if ((finding.priority === 'P0' || finding.priority === 'P1') && priorRound.subsystems.includes(finding.subsystem) && policy.repair.sameSubsystemRepeatDefectBudget === 0) {
          blockedReasons.push({ code: 'SAME_SUBSYSTEM_REPEAT_DEFECT', findingId: finding.id, subsystem: finding.subsystem, priority: finding.priority });
        }
        if (rounds.length >= policy.repair.maxRoundsPerPr) {
          blockedReasons.push({ code: 'MAX_REPAIR_ROUNDS_EXCEEDED', findingId: finding.id, subsystem: finding.subsystem });
        }
      }
    }

    const nextIndex = checkpoints[i + 1]?.index ?? (commitOrder.length - 1);
    const repairCommitShas = commitOrder.slice(checkpoint.index + 1, nextIndex + 1);
    if (repairCommitShas.length) {
      rounds.push({
        number: rounds.length + 1,
        baselineSha: checkpoint.reviewedCommitSha,
        findingIds: checkpoint.findings.map((finding) => finding.id),
        subsystems: [...new Set(checkpoint.findings.map((finding) => finding.subsystem))],
        repairCommitShas,
      });
    }
  }

  if (rounds.length > policy.repair.maxRoundsPerPr) {
    blockedReasons.push({ code: 'MAX_REPAIR_ROUNDS_EXCEEDED', rounds: rounds.length, budget: policy.repair.maxRoundsPerPr });
  }

  const lastCheckpoint = checkpoints.at(-1);
  const waitingForRepair = lastCheckpoint && lastCheckpoint.index === commitOrder.length - 1;
  return {
    repairRound: rounds.length,
    rounds,
    blockedReasons: dedupeReasons(blockedReasons),
    circuitBreakerState: blockedReasons.length ? 'BLOCKED' : waitingForRepair ? 'AWAITING_REPAIR' : 'OPEN',
  };
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

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} ${response.statusText}: ${await response.text()}`);
  return response.json();
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
  return fetchAllPages(`${apiUrl}/repos/${repository}/pulls/${prNumber}/commits`, token);
}

export function reviewBodyFinding(review, policy) {
  const priority = extractPriority(review.body, policy);
  if (!priority || !review.commit_id) return null;
  return {
    id: `review-body:${review.id}`,
    priority,
    subsystem: subsystemForPath(null, policy),
    path: null,
    reviewedCommitSha: review.commit_id,
    createdAt: review.submitted_at,
    url: review.html_url,
  };
}

async function fetchReviewFindings({ apiUrl, repository, prNumber, token, policy }) {
  const comments = await fetchAllPages(`${apiUrl}/repos/${repository}/pulls/${prNumber}/comments`, token);
  const reviews = await fetchAllPages(`${apiUrl}/repos/${repository}/pulls/${prNumber}/reviews`, token);
  const inlineFindings = comments
    .filter((comment) => !comment.in_reply_to_id)
    .map((comment) => {
      const priority = extractPriority(comment.body, policy);
      if (!priority) return null;
      return {
        id: `review-comment:${comment.id}`,
        priority,
        subsystem: subsystemForPath(comment.path, policy),
        path: comment.path,
        reviewedCommitSha: comment.commit_id ?? comment.original_commit_id,
        createdAt: comment.created_at,
        url: comment.html_url,
      };
    })
    .filter((finding) => finding?.reviewedCommitSha);
  const reviewBodyFindings = reviews.map((review) => reviewBodyFinding(review, policy)).filter(Boolean);
  return [...inlineFindings, ...reviewBodyFindings];
}

async function fetchRedesignAuthorizations({ apiUrl, repository, prNumber, token, policy }) {
  const comments = await fetchAllPages(`${apiUrl}/repos/${repository}/issues/${prNumber}/comments`, token);
  return comments.map((comment) => {
    const auth = parseRedesignAuthorization(comment.body, policy.authorization.marker);
    if (!auth || !policy.authorization.trustedActors.includes(comment.user?.login)) return null;
    return { ...auth, createdAt: comment.created_at, commentId: comment.id };
  }).filter(Boolean);
}

async function fetchCheckRuns({ apiUrl, repository, sha, token }) {
  const data = await githubJson(`${apiUrl}/repos/${repository}/commits/${sha}/check-runs?per_page=100&filter=latest`, token);
  return new Map(data.check_runs.filter((check) => check.status === 'completed' && check.conclusion).map((check) => [check.name, check.conclusion]));
}

export function classifyCheckDelta(baselineConclusion, repairConclusion) {
  if (baselineConclusion !== 'success') return null;
  if (FAILURE_CONCLUSIONS.has(repairConclusion)) return 'NEW_REGRESSION';
  if (INCOMPLETE_CONCLUSIONS.has(repairConclusion)) return 'VERIFICATION_INCOMPLETE';
  return null;
}

async function detectNewRegressions({ apiUrl, repository, token, rounds }) {
  const cache = new Map();
  const checks = async (sha) => {
    if (!cache.has(sha)) cache.set(sha, await fetchCheckRuns({ apiUrl, repository, sha, token }));
    return cache.get(sha);
  };
  const regressions = [];
  for (const round of rounds) {
    const baseline = await checks(round.baselineSha);
    for (const repairSha of round.repairCommitShas) {
      const repair = await checks(repairSha);
      for (const [name, conclusion] of repair) {
        const code = classifyCheckDelta(baseline.get(name), conclusion);
        if (code) regressions.push({ code, round: round.number, check: name, baselineSha: round.baselineSha, repairSha });
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
  const count = countNumstat(git(['diff', '--numstat', '--no-renames', base, head, '--'], cwd), policy);
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
    blockedReasons.push({ code: 'REVIEW_HISTORY_UNAVAILABLE' });
  } else if (event.pull_request) {
    const prNumber = event.pull_request.number ?? event.number;
    const commits = await fetchPrCommits({ apiUrl, repository, prNumber, token });
    const commitOrder = commits.map((commit) => commit.sha);
    const findings = await fetchReviewFindings({ apiUrl, repository, prNumber, token, policy });
    const authorizations = await fetchRedesignAuthorizations({ apiUrl, repository, prNumber, token, policy });
    const activeFindings = applyRedesignCutovers(findings, authorizations);
    repair = analyzeRepairHistory({ commitOrder, findings: activeFindings, policy });
    repair.historicalFindings = findings.length;
    repair.activeFindings = activeFindings.length;
    repair.newRegressions = await detectNewRegressions({ apiUrl, repository, token, rounds: repair.rounds });
    for (const issue of repair.newRegressions.filter((item) => item.code === 'VERIFICATION_INCOMPLETE')) {
      repair.blockedReasons.push(issue);
    }
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