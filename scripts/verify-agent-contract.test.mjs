import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRepairHistory,
  applyFindingControls,
  applyRedesignCutovers,
  classifyCheckDelta,
  classifyFindingAttribution,
  countNumstat,
  extractPriority,
  isSourcePath,
  parseChangedRightLines,
  parseFindingControlRecord,
  parseRedesignAuthorization,
  parseScopedFixForwardAuthorization,
  reviewBodyFinding,
  subsystemForPath,
} from './verify-agent-contract.mjs';

const policy = {
  changeBudget: {
    executionBoundary: 'pull_request',
    maxChangedSourceLinesPerExecution: 1000,
    sourceExtensions: ['.ts', '.json', '.yml'],
    sourceBasenames: ['Dockerfile'],
    excludePrefixes: ['generated/', 'dist/'],
    excludeBasenames: ['pnpm-lock.yaml'],
  },
  authorization: {
    marker: '<!-- agent-contract-ledger:v1 -->',
    trustedActors: ['owner'],
  },
  repair: {
    maxRoundsPerPr: 2,
    newRegressionBudget: 0,
    newValidP0P1AfterRepair: 0,
    sameSubsystemRepeatDefectBudget: 0,
    priorityPattern: '\\bP([0-3])\\b',
    subsystemGroups: [{
      name: 'agent-harness',
      prefixes: ['AGENTS.md', '.harness/', 'scripts/verify-agent-contract', '.github/workflows/ci.yml', 'package.json'],
    }],
  },
};

const finding = (id, reviewedCommitSha, priority, subsystem = 'agent-harness', createdAt = '2026-08-01T10:00:00Z', attribution = 'NEWLY_INTRODUCED') => ({
  id, reviewedCommitSha, priority, reportedPriority: priority, validationState: 'VALID', resolved: false,
  attribution, subsystem, path: 'scripts/verify-agent-contract.mjs', line: 10, startLine: 10, createdAt,
});

test('source budget aggregates the whole PR patch', () => {
  const numstat = ['600\t0\tsrc/a.ts', '600\t0\tsrc/b.ts'].join('\n');
  assert.equal(countNumstat(numstat, policy).total, 1200);
  assert.equal(isSourcePath('src/a.ts', policy), true);
  assert.equal(isSourcePath('docs/design.md', policy), false);
});

test('priority and subsystem classification remain deterministic', () => {
  assert.equal(extractPriority('P1 mechanical enforcement', policy), 'P1');
  assert.equal(extractPriority('ordinary note', policy), null);
  assert.equal(subsystemForPath('scripts/verify-agent-contract.mjs', policy), 'agent-harness');
});

test('review-body P1 is normalized into repair findings', () => {
  const result = reviewBodyFinding({
    id: 42,
    body: 'P1 review summary defect',
    commit_id: 'c2',
    submitted_at: '2026-08-01T10:00:00Z',
    html_url: 'https://example.test/review/42',
  }, policy);
  assert.deepEqual(result, {
    id: 'review-body:42',
    priority: 'P1',
    subsystem: 'unknown',
    path: null,
    line: null,
    startLine: null,
    reviewedCommitSha: 'c2',
    createdAt: '2026-08-01T10:00:00Z',
    url: 'https://example.test/review/42',
  });
});

test('repair round includes every commit through the next reviewed commit', () => {
  const result = analyzeRepairHistory({
    policy,
    commitOrder: ['c1', 'c2', 'c3'],
    findings: [finding('f1', 'c1', 'P2'), finding('f2', 'c3', 'P2', 'packages/b')],
  });
  assert.deepEqual(result.rounds[0].repairCommitShas, ['c2', 'c3']);
  assert.equal(result.rounds[0].baselineSha, 'c1');
});

test('post-repair newly introduced P1 remains systemically blocking', () => {
  const result = analyzeRepairHistory({
    policy,
    commitOrder: ['c1', 'c2'],
    findings: [
      finding('f1', 'c1', 'P1', 'agent-harness', '2026-08-01T10:00:00Z'),
      finding('f2', 'c2', 'P1', 'agent-harness', '2026-08-01T10:05:00Z'),
    ],
  });
  assert.ok(result.blockedReasons.some((reason) => reason.code === 'NEW_VALID_P0_P1_AFTER_REPAIR'));
  assert.ok(result.blockedReasons.some((reason) => reason.code === 'SAME_SUBSYSTEM_REPEAT_DEFECT'));
});

test('same-subsystem repeat breaker ignores P2 but still blocks newly introduced P1', () => {
  const p2 = analyzeRepairHistory({
    policy,
    commitOrder: ['c1', 'c2'],
    findings: [finding('f1', 'c1', 'P1'), finding('f2', 'c2', 'P2')],
  });
  assert.equal(p2.blockedReasons.some((reason) => reason.code === 'SAME_SUBSYSTEM_REPEAT_DEFECT'), false);

  const p1 = analyzeRepairHistory({
    policy,
    commitOrder: ['c1', 'c2'],
    findings: [finding('f1', 'c1', 'P1'), finding('f2', 'c2', 'P1')],
  });
  assert.equal(p1.blockedReasons.some((reason) => reason.code === 'SAME_SUBSYSTEM_REPEAT_DEFECT'), true);
});

test('cancelled repair check is incomplete verification', () => {
  assert.equal(classifyCheckDelta('success', 'cancelled'), 'VERIFICATION_INCOMPLETE');
  assert.equal(classifyCheckDelta('success', 'failure'), 'NEW_REGRESSION');
  assert.equal(classifyCheckDelta('failure', 'cancelled'), null);
});

test('multiple findings on one reviewed commit are one checkpoint', () => {
  const result = analyzeRepairHistory({
    policy,
    commitOrder: ['c1', 'c2'],
    findings: [finding('f1', 'c1', 'P2'), finding('f2', 'c1', 'P2')],
  });
  assert.equal(result.repairRound, 1);
  assert.deepEqual(result.rounds[0].findingIds.sort(), ['f1', 'f2']);
});

test('trusted redesign authorization creates a historical cutover', () => {
  const findings = [
    finding('old', 'c1', 'P1', 'agent-harness', '2026-08-01T10:00:00Z'),
    finding('new', 'c2', 'P1', 'agent-harness', '2026-08-01T10:10:00Z'),
  ];
  const active = applyRedesignCutovers(findings, [{ subsystem: 'agent-harness', createdAt: '2026-08-01T10:05:00Z' }]);
  assert.deepEqual(active.map((item) => item.id), ['new']);
});

test('redesign authorization parser is marker and type bound', () => {
  const body = `${policy.authorization.marker}\n\`\`\`json\n{"type":"REDESIGN_AUTHORIZED","subsystem":"agent-harness","headSha":"c1"}\n\`\`\``;
  assert.equal(parseRedesignAuthorization(body, policy.authorization.marker).subsystem, 'agent-harness');
  assert.equal(parseRedesignAuthorization('plain comment', policy.authorization.marker), null);
});

test('scoped fix-forward authorization parser is marker and type bound', () => {
  const body = `${policy.authorization.marker}\n\`\`\`json\n{"type":"SCOPED_FIX_FORWARD_AUTHORIZED","finding_ids":["f1"]}\n\`\`\``;
  assert.equal(parseScopedFixForwardAuthorization(body, policy.authorization.marker).finding_ids[0], 'f1');
  assert.equal(parseScopedFixForwardAuthorization('plain comment', policy.authorization.marker), null);
});

test('reported priority is not validated priority', () => {
  const raw = [{ ...finding('review-comment:1', 'c1', 'P1'), priority: 'P1' }];
  const controlled = applyFindingControls(raw, []);
  assert.equal(controlled[0].reportedPriority, 'P1');
  assert.equal(controlled[0].validationState, 'PENDING');
  assert.equal(controlled[0].priority, null);
});

test('rebutted or unvalidated findings cannot latch the systemic breaker', () => {
  const marker = policy.authorization.marker;
  const rebuttal = parseFindingControlRecord(`${marker}\n\`\`\`json\n{"type":"FINDING_REBUTTED","finding_id":"github:review_comment:2:0"}\n\`\`\``, marker);
  const raw = [
    { ...finding('review-comment:1', 'c1', 'P1'), priority: 'P1' },
    { ...finding('review-comment:2', 'c2', 'P1'), priority: 'P1' },
  ];
  const controlled = applyFindingControls(raw, [{ ...rebuttal, createdAt: '2026-08-01T10:10:00Z', commentId: 1 }]);
  const valid = controlled.filter((item) => item.validationState === 'VALID');
  const result = analyzeRepairHistory({ policy, commitOrder: ['c1', 'c2'], findings: valid });
  assert.equal(result.blockedReasons.some((reason) => reason.code === 'NEW_VALID_P0_P1_AFTER_REPAIR'), false);
});

test('missing queued and absent baseline-required checks are incomplete', () => {
  assert.equal(classifyCheckDelta('success', undefined), 'VERIFICATION_INCOMPLETE');
  assert.equal(classifyCheckDelta('success', 'queued'), 'VERIFICATION_INCOMPLETE');
  assert.equal(classifyCheckDelta('success', 'in_progress'), 'VERIFICATION_INCOMPLETE');
});

test('pre-existing validated P1 surfaced after repair does not latch', () => {
  const result = analyzeRepairHistory({
    policy,
    commitOrder: ['c1', 'c2'],
    findings: [
      finding('f1', 'c1', 'P1'),
      finding('f2', 'c2', 'P1', 'agent-harness', '2026-08-01T10:05:00Z', 'PRE_EXISTING'),
    ],
  });
  assert.equal(result.blockedReasons.some((reason) => reason.code === 'NEW_VALID_P0_P1_AFTER_REPAIR'), false);
  assert.equal(result.blockedReasons.some((reason) => reason.code === 'SAME_SUBSYSTEM_REPEAT_DEFECT'), false);
});

test('newly introduced validated P1 still latches', () => {
  const result = analyzeRepairHistory({
    policy,
    commitOrder: ['c1', 'c2'],
    findings: [finding('f1', 'c1', 'P1'), finding('f2', 'c2', 'P1')],
  });
  assert.equal(result.blockedReasons.some((reason) => reason.code === 'NEW_VALID_P0_P1_AFTER_REPAIR'), true);
});

test('owner attribution overrides diff heuristic in either direction', () => {
  const changed = parseChangedRightLines([
    'diff --git a/scripts/verify-agent-contract.mjs b/scripts/verify-agent-contract.mjs',
    '--- a/scripts/verify-agent-contract.mjs',
    '+++ b/scripts/verify-agent-contract.mjs',
    '@@ -9,0 +10,1 @@',
    '+const added = true;',
  ].join('\n'));
  const anchored = { path: 'scripts/verify-agent-contract.mjs', line: 10, startLine: 10 };
  assert.equal(classifyFindingAttribution(anchored, changed), 'NEWLY_INTRODUCED');
  assert.equal(classifyFindingAttribution(anchored, changed, 'PRE_EXISTING'), 'PRE_EXISTING');
  const untouched = { path: 'scripts/verify-agent-contract.mjs', line: 20, startLine: 20 };
  assert.equal(classifyFindingAttribution(untouched, changed, 'NEWLY_INTRODUCED'), 'NEWLY_INTRODUCED');
});
