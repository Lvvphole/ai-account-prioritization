import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRepairHistory,
  applyRedesignCutovers,
  countNumstat,
  extractPriority,
  isSourcePath,
  parseRedesignAuthorization,
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

const finding = (id, reviewedCommitSha, priority, subsystem = 'agent-harness', createdAt = '2026-08-01T10:00:00Z') => ({
  id, reviewedCommitSha, priority, subsystem, path: 'scripts/verify-agent-contract.mjs', createdAt,
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

test('repair round includes every commit through the next reviewed commit', () => {
  const result = analyzeRepairHistory({
    policy,
    commitOrder: ['c1', 'c2', 'c3'],
    findings: [finding('f1', 'c1', 'P2'), finding('f2', 'c3', 'P2', 'packages/b')],
  });
  assert.deepEqual(result.rounds[0].repairCommitShas, ['c2', 'c3']);
  assert.equal(result.rounds[0].baselineSha, 'c1');
});

test('post-repair P1 remains blocking regardless of thread resolution state', () => {
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
