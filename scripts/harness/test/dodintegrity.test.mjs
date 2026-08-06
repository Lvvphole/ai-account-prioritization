// Frozen DoD for the DoD-integrity check: D1-D7.
//
// D1-D3 run against the real candidate repository and must detect the defects that exist
// there today. D4-D7 run against a synthetic fixture representing the repaired shape, so the
// candidate checkout is never written to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkDodIntegrity,
  listUndeclaredPrCommands,
  extractRunCommands,
  readYamlList,
  FINDING,
} from '../verify-dod-integrity.mjs';

const CANDIDATE_ROOT = process.env.CANDIDATE_ROOT ?? '/home/claude/repo';

const codesFor = (r, gateSubstring) =>
  r.findings.filter((f) => (f.gate ?? '').includes(gateSubstring)).map((f) => f.code);

// ---------------------------------------------------------------------------
// D1-D3 — detect the defects present in the candidate repository today
// ---------------------------------------------------------------------------

const REAL = checkDodIntegrity(CANDIDATE_ROOT);

test('D1 detects the vacuous lint gate', () => {
  assert.ok(REAL.gates.length > 0, 'precondition: manifest declares gates');
  assert.ok(
    codesFor(REAL, 'pnpm lint').includes(FINDING.DOD_GATE_VACUOUS),
    'pnpm lint must be reported vacuous (turbo task with zero implementers)',
  );
});

test('D2 detects unenforced pnpm test', () => {
  assert.ok(
    codesFor(REAL, 'pnpm test').includes(FINDING.DOD_GATE_NOT_ENFORCED),
    'bare pnpm test must be reported as not enforced by any pull_request workflow',
  );
});

test('D3 detects the duplicated DoD list in CONTEXT.md', () => {
  assert.ok(
    REAL.findings.some((f) => f.code === FINDING.DUPLICATE_DOD_LIST),
    'a second independent completion list must be reported',
  );
});

test('D3b overall status on the unrepaired repository is FAIL', () => {
  assert.equal(REAL.status, 'FAIL');
});

// ---------------------------------------------------------------------------
// Fixture: the repaired shape
// ---------------------------------------------------------------------------

function buildFixture({
  dodCommands = ['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm verify:security'],
  rootScripts = { typecheck: 'turbo run typecheck', 'verify:security': 'bash scripts/verify-security.sh' },
  implementers = { 'packages/a': { name: '@fx/a', scripts: { typecheck: 'tsc --noEmit' } } },
  ciCommands = ['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm verify:security'],
  contextHasList = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dod-fixture-'));

  writeFileSync(
    join(root, 'prd_manifest.yaml'),
    `product: fixture\n\ndefinition_of_done:\n${dodCommands.map((c) => `  - ${c}`).join('\n')}\n\nother_key: value\n`,
  );

  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fx-root', scripts: rootScripts }, null, 2));

  for (const [dir, pkg] of Object.entries(implementers)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify(pkg, null, 2));
  }

  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'verify-security.sh'), '#!/usr/bin/env bash\nexit 0\n');

  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    `name: ci\n\non:\n  pull_request:\n    branches: ["**"]\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${ciCommands
      .map((c) => `      - run: ${c}\n`)
      .join('')}`,
  );

  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(
    join(root, 'docs', 'CONTEXT.md'),
    contextHasList
      ? '# Context\n\n## Definition of Done\n\n```bash\npnpm install\npnpm typecheck\npnpm verify:security\n```\n'
      : '# Context\n\nCompletion is defined by `prd_manifest.yaml:definition_of_done`.\n',
  );

  return root;
}

const cleanup = (p) => rmSync(p, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// D4 — the repaired shape passes
// ---------------------------------------------------------------------------

test('D4 passes on the repaired shape', () => {
  const root = buildFixture();
  try {
    const r = checkDodIntegrity(root);
    assert.deepEqual(r.findings, [], `unexpected findings: ${JSON.stringify(r.findings)}`);
    assert.equal(r.status, 'PASS');
    assert.equal(r.gates.length, 3);
  } finally {
    cleanup(root);
  }
});

test('D4b the duplicated-list check fires on the fixture when reintroduced', () => {
  const root = buildFixture({ contextHasList: true });
  try {
    const r = checkDodIntegrity(root);
    assert.ok(r.findings.some((f) => f.code === FINDING.DUPLICATE_DOD_LIST));
    assert.equal(r.status, 'FAIL');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// D5-D7 — mutations
// ---------------------------------------------------------------------------

test('D5 mutation: a fake DoD command makes the check fail', () => {
  const root = buildFixture({
    dodCommands: ['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm verify:security', 'pnpm not-a-real-gate'],
  });
  try {
    const r = checkDodIntegrity(root);
    assert.equal(r.status, 'FAIL');
    assert.ok(
      codesFor(r, 'not-a-real-gate').includes(FINDING.DOD_COMMAND_UNRESOLVABLE),
      'undeclared command must be reported unresolvable',
    );
  } finally {
    cleanup(root);
  }
});

test('D6 mutation: removing a CI invocation makes the check fail', () => {
  const root = buildFixture({
    ciCommands: ['pnpm install --frozen-lockfile', 'pnpm verify:security'], // typecheck dropped
  });
  try {
    const r = checkDodIntegrity(root);
    assert.equal(r.status, 'FAIL');
    assert.ok(
      codesFor(r, 'pnpm typecheck').includes(FINDING.DOD_GATE_NOT_ENFORCED),
      'a declared gate absent from PR CI must be reported unenforced',
    );
  } finally {
    cleanup(root);
  }
});

test('D7 mutation: a turbo task with zero implementers makes the check fail', () => {
  const root = buildFixture({ implementers: {} });
  try {
    const r = checkDodIntegrity(root);
    assert.equal(r.status, 'FAIL');
    assert.ok(
      codesFor(r, 'pnpm typecheck').includes(FINDING.DOD_GATE_VACUOUS),
      'a turbo-backed gate with no implementer must be reported vacuous',
    );
  } finally {
    cleanup(root);
  }
});

test('D8 a command appearing only in a workflow comment is not enforcement', () => {
  const root = buildFixture();
  try {
    const wf = join(root, '.github', 'workflows', 'ci.yml');
    writeFileSync(
      wf,
      [
        'name: ci',
        '',
        'on:',
        '  pull_request:',
        '    branches: ["**"]',
        '',
        'env:',
        '  NOTE: "remember to run pnpm typecheck locally"',
        '',
        'jobs:',
        '  verify:',
        '    steps:',
        '      # pnpm typecheck  (disabled while flaky)',
        '      - run: pnpm install --frozen-lockfile',
        '      - run: |',
        '          # pnpm typecheck',
        '          pnpm verify:security',
        '',
      ].join('\n'),
    );
    const r = checkDodIntegrity(root);
    assert.ok(
      codesFor(r, 'pnpm typecheck').includes(FINDING.DOD_GATE_NOT_ENFORCED),
      'a YAML comment, shell comment, or env string must not satisfy enforcement',
    );
  } finally {
    cleanup(root);
  }
});

test('D8b block-scalar run steps are recognized as enforcement', () => {
  const cmds = extractRunCommands(
    ['jobs:', '  a:', '    steps:', '      - run: |', '          pnpm typecheck', '          pnpm test', '      - run: pnpm build'].join('\n'),
  );
  assert.deepEqual(cmds, ['pnpm typecheck', 'pnpm test', 'pnpm build']);
});

test('D9 an unrecognized script form fails closed', () => {
  const root = buildFixture({
    dodCommands: ['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm verify:security', 'pnpm mystery'],
    rootScripts: {
      typecheck: 'turbo run typecheck',
      'verify:security': 'bash scripts/verify-security.sh',
      mystery: 'some-unknown-runner --do-things',
    },
    ciCommands: ['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm verify:security', 'pnpm mystery'],
  });
  try {
    const r = checkDodIntegrity(root);
    assert.equal(r.status, 'FAIL');
    assert.ok(
      codesFor(r, 'pnpm mystery').includes(FINDING.DOD_GATE_UNRECOGNIZED_FORM),
      'the checker must not claim an execution target it cannot verify',
    );
  } finally {
    cleanup(root);
  }
});

test('D10 reverse direction reports PR commands Artifact DoD does not declare', () => {
  const root = buildFixture({
    ciCommands: [
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm verify:security',
      'pnpm check:no-prisma',
    ],
  });
  try {
    assert.deepEqual(listUndeclaredPrCommands(root), ['check:no-prisma']);
  } finally {
    cleanup(root);
  }
});

test('D7b a non-PR workflow does not count as enforcement', () => {
  const root = buildFixture();
  try {
    // Move typecheck into a deploy-style workflow that is not pull_request triggered.
    const wf = join(root, '.github', 'workflows');
    writeFileSync(
      join(wf, 'ci.yml'),
      'name: ci\n\non:\n  pull_request:\n    branches: ["**"]\n\njobs:\n  verify:\n    steps:\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm verify:security\n',
    );
    writeFileSync(
      join(wf, 'deploy.yml'),
      'name: deploy\n\non:\n  push:\n    branches: ["main"]\n  workflow_dispatch:\n\njobs:\n  ship:\n    steps:\n      - run: pnpm typecheck\n',
    );
    const r = checkDodIntegrity(root);
    assert.ok(
      codesFor(r, 'pnpm typecheck').includes(FINDING.DOD_GATE_NOT_ENFORCED),
      'deploy-only invocation must not satisfy PR enforcement',
    );
  } finally {
    cleanup(root);
  }
});

test('D11 comments inside definition_of_done do not truncate the list', () => {
  const yaml = [
    'product: fixture',
    '',
    'definition_of_done:',
    '  # Artifact DoD is ALL PASS across every required gate.',
    '  - pnpm install --frozen-lockfile',
    '  # This comment is explanatory and is not a gate.',
    '  - pnpm typecheck',
    '  - pnpm verify:security',
    '',
    'other_key: value',
  ].join('\n');
  assert.deepEqual(readYamlList(yaml, 'definition_of_done'), [
    'pnpm install --frozen-lockfile',
    'pnpm typecheck',
    'pnpm verify:security',
  ]);
});

test('D12 node execution form is recognized and its target file must exist', () => {
  const validRoot = buildFixture({
    dodCommands: ['pnpm install --frozen-lockfile', 'pnpm verify:dod'],
    rootScripts: { 'verify:dod': 'node scripts/harness/verify-dod-integrity.mjs .' },
    implementers: {},
    ciCommands: ['pnpm install --frozen-lockfile', 'pnpm verify:dod'],
  });
  try {
    mkdirSync(join(validRoot, 'scripts', 'harness'), { recursive: true });
    writeFileSync(join(validRoot, 'scripts', 'harness', 'verify-dod-integrity.mjs'), 'process.exit(0);\n');
    const r = checkDodIntegrity(validRoot);
    assert.deepEqual(r.findings, [], `valid node target must pass: ${JSON.stringify(r.findings)}`);
  } finally {
    cleanup(validRoot);
  }

  const missingRoot = buildFixture({
    dodCommands: ['pnpm install --frozen-lockfile', 'pnpm verify:dod'],
    rootScripts: { 'verify:dod': 'node --trace-warnings scripts/harness/missing.mjs .' },
    implementers: {},
    ciCommands: ['pnpm install --frozen-lockfile', 'pnpm verify:dod'],
  });
  try {
    const r = checkDodIntegrity(missingRoot);
    assert.equal(r.status, 'FAIL');
    assert.ok(
      codesFor(r, 'pnpm verify:dod').includes(FINDING.DOD_GATE_VACUOUS),
      'missing node target must fail closed as vacuous',
    );
    assert.ok(
      !codesFor(r, 'pnpm verify:dod').includes(FINDING.DOD_GATE_UNRECOGNIZED_FORM),
      'recognized node form must not be reported as unrecognized',
    );
  } finally {
    cleanup(missingRoot);
  }
});

