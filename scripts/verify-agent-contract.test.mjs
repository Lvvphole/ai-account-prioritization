import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeLedger,
  countNumstat,
  extractPriority,
  findRegressionCandidates,
  isSourcePath,
  parseLedgerComment,
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
  ledger: {
    marker: '<!-- agent-contract-ledger:v1 -->',
    trustedActors: ['owner'],
    writerActors: ['github-actions[bot]', 'owner'],
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

const event = (sequence, value) => ({ createdAt: `2026-08-01T10:${String(sequence).padStart(2, '0')}:00Z`, sequence, ...value });

test('source budget aggregates the final PR patch rather than individual commits', () => {
  const numstat = ['600\t0\tsrc/a.ts', '600\t0\tsrc/b.ts'].join('\n');
  assert.equal(countNumstat(numstat, policy).total, 1200);
  assert.equal(isSourcePath('src/a.ts', policy), true);
  assert.equal(isSourcePath('docs/design.md', policy), false);
});

test('priority and subsystem classification remain deterministic', () => {
  assert.equal(extractPriority('P1 mechanical enforcement', policy), 'P1');
  assert.equal(extractPriority('ordinary review note', policy), null);
  assert.equal(subsystemForPath('scripts/verify-agent-contract.mjs', policy), 'agent-harness');
  assert.equal(
    subsystemForPath('apps/agent-runtime/src/agents/sales-execution/build.ts', policy),
    'apps/agent-runtime/src/agents/sales-execution',
  );
});

test('ledger parser accepts only marked typed JSON events', () => {
  const body = `${policy.ledger.marker}\n\`\`\`json\n{"type":"COMMIT_OBSERVED","sha":"c1"}\n\`\`\``;
  assert.deepEqual(parseLedgerComment(body, policy.ledger.marker), { type: 'COMMIT_OBSERVED', sha: 'c1' });
  assert.equal(parseLedgerComment('plain comment', policy.ledger.marker), null);
});

test('a persisted P1 after a completed repair blocks even without thread resolution state', () => {
  const ledger = [
    event(0, { type: 'DEFECT_DISCOVERED', findingId: 'f1', priority: 'P1', subsystem: 'agent-harness', path: 'AGENTS.md' }),
    event(1, { type: 'COMMIT_OBSERVED', sha: 'c1' }),
    event(2, { type: 'DEFECT_DISCOVERED', findingId: 'f2', priority: 'P1', subsystem: 'agent-harness', path: 'scripts/verify-agent-contract.mjs' }),
  ];
  const result = analyzeLedger({ ledger, policy });
  assert.equal(result.repairRound, 1);
  assert.ok(result.blockedReasons.some((reason) => reason.code === 'NEW_VALID_P0_P1_AFTER_REPAIR'));
  assert.ok(result.blockedReasons.some((reason) => reason.code === 'SAME_SUBSYSTEM_REPEAT_DEFECT'));
});

test('every commit in a repair round is retained for regression inspection', () => {
  const ledger = [
    event(0, { type: 'DEFECT_DISCOVERED', findingId: 'f1', priority: 'P2', subsystem: 'apps/a', path: 'apps/a/x.ts' }),
    event(1, { type: 'COMMIT_OBSERVED', sha: 'c1' }),
    event(2, { type: 'COMMIT_OBSERVED', sha: 'c2' }),
    event(3, { type: 'COMMIT_OBSERVED', sha: 'c3' }),
  ];
  const result = analyzeLedger({ ledger, policy });
  assert.deepEqual(result.rounds[0].commitShas, ['c1', 'c2', 'c3']);
  const candidates = findRegressionCandidates({ rounds: result.rounds, commitOrder: ['base1', 'c1', 'c2', 'c3'] });
  assert.equal(candidates[0].baselineSha, 'base1');
  assert.deepEqual(candidates[0].checkShas, ['c1', 'c2', 'c3']);
});

test('human redesign authorization creates a cutover without erasing historical defects', () => {
  const ledger = [
    event(0, { type: 'DEFECT_DISCOVERED', findingId: 'f1', priority: 'P1', subsystem: 'agent-harness', path: 'AGENTS.md' }),
    event(1, { type: 'COMMIT_OBSERVED', sha: 'c1' }),
    event(2, { type: 'DEFECT_DISCOVERED', findingId: 'f2', priority: 'P1', subsystem: 'agent-harness', path: 'scripts/verify-agent-contract.mjs' }),
    event(3, { type: 'REDESIGN_AUTHORIZED', subsystem: 'agent-harness', headSha: 'c1' }),
    event(4, { type: 'COMMIT_OBSERVED', sha: 'c2' }),
  ];
  const result = analyzeLedger({ ledger, policy });
  assert.equal(result.circuitBreakerState, 'OPEN');
  assert.equal(result.blockedReasons.length, 0);
  assert.equal(result.repairRound, 0);
});

test('a new P1 after redesign authorization trips the breaker again', () => {
  const ledger = [
    event(0, { type: 'REDESIGN_AUTHORIZED', subsystem: 'agent-harness', headSha: 'base' }),
    event(1, { type: 'DEFECT_DISCOVERED', findingId: 'f1', priority: 'P2', subsystem: 'agent-harness', path: 'AGENTS.md' }),
    event(2, { type: 'COMMIT_OBSERVED', sha: 'c1' }),
    event(3, { type: 'DEFECT_DISCOVERED', findingId: 'f2', priority: 'P1', subsystem: 'agent-harness', path: 'scripts/verify-agent-contract.mjs' }),
  ];
  const result = analyzeLedger({ ledger, policy });
  assert.equal(result.repairRound, 1);
  assert.ok(result.blockedReasons.some((reason) => reason.code === 'NEW_VALID_P0_P1_AFTER_REPAIR'));
});
