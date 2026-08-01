import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRepairEvents,
  countNumstat,
  extractPriority,
  isSourcePath,
  subsystemForPath,
} from './verify-agent-contract.mjs';

const policy = {
  changeBudget: {
    maxChangedSourceLinesPerExecution: 1000,
    sourceExtensions: ['.ts', '.json', '.yml'],
    sourceBasenames: ['Dockerfile'],
    excludePrefixes: ['generated/', 'dist/'],
    excludeBasenames: ['pnpm-lock.yaml'],
  },
  repair: {
    maxRoundsPerPr: 2,
    newRegressionBudget: 0,
    newValidP0P1AfterRepair: 0,
    sameSubsystemRepeatDefectBudget: 0,
    priorityPattern: '\\bP([0-3])\\b',
    subsystemGroups: [
      {
        name: 'agent-harness',
        prefixes: ['AGENTS.md', '.harness/', 'scripts/verify-agent-contract', '.github/workflows/ci.yml', 'package.json'],
      },
    ],
  },
};

test('source budget counts only eligible changed source lines', () => {
  const numstat = [
    '700\t0\tsrc/a.ts',
    '250\t1\tpackage.json',
    '900\t0\tdocs/design.md',
    '500\t0\tgenerated/schema.json',
    '5\t2\tpnpm-lock.yaml',
  ].join('\n');

  assert.equal(countNumstat(numstat, policy).total, 950);
  assert.equal(isSourcePath('src/a.ts', policy), true);
  assert.equal(isSourcePath('docs/design.md', policy), false);
});

test('priority and subsystem classification are deterministic', () => {
  assert.equal(extractPriority('P1 Add mechanical enforcement', policy), 'P1');
  assert.equal(extractPriority('ordinary review note', policy), null);
  assert.equal(subsystemForPath('scripts/verify-agent-contract.mjs', policy), 'agent-harness');
  assert.equal(
    subsystemForPath('apps/agent-runtime/src/agents/sales-execution/build.ts', policy),
    'apps/agent-runtime/src/agents/sales-execution',
  );
});

test('multiple findings before a commit are one repair round', () => {
  const result = analyzeRepairEvents({
    policy,
    findings: [
      { id: 'f1', createdAt: '2026-08-01T10:00:00Z', path: 'src/a.ts', resolved: false, priority: 'P2' },
      { id: 'f2', createdAt: '2026-08-01T10:01:00Z', path: 'src/b.ts', resolved: false, priority: 'P2' },
    ],
    commits: [{ sha: 'c1', committedAt: '2026-08-01T10:02:00Z' }],
  });

  assert.equal(result.repairRound, 1);
  assert.deepEqual(result.rounds[0].findingIds, ['f1', 'f2']);
  assert.equal(result.circuitBreakerState, 'OPEN');
});

test('new P1 after a repair trips the circuit breaker', () => {
  const result = analyzeRepairEvents({
    policy,
    findings: [
      { id: 'f1', createdAt: '2026-08-01T10:00:00Z', path: 'AGENTS.md', resolved: true, priority: 'P1' },
      { id: 'f2', createdAt: '2026-08-01T10:03:00Z', path: 'scripts/verify-agent-contract.mjs', resolved: false, priority: 'P1' },
    ],
    commits: [{ sha: 'c1', committedAt: '2026-08-01T10:02:00Z' }],
  });

  assert.equal(result.repairRound, 1);
  assert.ok(result.blockedReasons.some((reason) => reason.code === 'NEW_VALID_P0_P1_AFTER_REPAIR'));
  assert.ok(result.blockedReasons.some((reason) => reason.code === 'SAME_SUBSYSTEM_REPEAT_DEFECT'));
  assert.equal(result.circuitBreakerState, 'BLOCKED');
});

test('a different-subsystem P2 may consume round two but not a third', () => {
  const result = analyzeRepairEvents({
    policy,
    findings: [
      { id: 'f1', createdAt: '2026-08-01T10:00:00Z', path: 'apps/a/src/x.ts', resolved: true, priority: 'P2' },
      { id: 'f2', createdAt: '2026-08-01T10:03:00Z', path: 'packages/b/src/y.ts', resolved: true, priority: 'P2' },
      { id: 'f3', createdAt: '2026-08-01T10:06:00Z', path: 'packages/c/src/z.ts', resolved: false, priority: 'P2' },
    ],
    commits: [
      { sha: 'c1', committedAt: '2026-08-01T10:02:00Z' },
      { sha: 'c2', committedAt: '2026-08-01T10:05:00Z' },
    ],
  });

  assert.equal(result.repairRound, 2);
  assert.ok(result.blockedReasons.some((reason) => reason.code === 'MAX_REPAIR_ROUNDS_EXCEEDED'));
  assert.equal(result.circuitBreakerState, 'BLOCKED');
});
