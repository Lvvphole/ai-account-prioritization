// DoD-integrity check.
//
// Proves that every gate declared in prd_manifest.yaml:definition_of_done resolves, has a real
// execution target, and is actually scheduled by a pull_request workflow's `run:` steps — and that no second document
// independently defines completion.
//
// A declared gate set is not trustworthy merely because the list exists.
//
// Zero dependencies. No model. No policy engine. Reads only:
//   prd_manifest.yaml, root + workspace package.json, .github/workflows/*.yml, docs/CONTEXT.md

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const FINDING = Object.freeze({
  MANIFEST_MISSING: 'MANIFEST_MISSING',
  DOD_LIST_MISSING: 'DOD_LIST_MISSING',
  DOD_COMMAND_UNRESOLVABLE: 'DOD_COMMAND_UNRESOLVABLE',
  DOD_GATE_VACUOUS: 'DOD_GATE_VACUOUS',
  DOD_GATE_NOT_ENFORCED: 'DOD_GATE_NOT_ENFORCED',
  DOD_GATE_UNRECOGNIZED_FORM: 'DOD_GATE_UNRECOGNIZED_FORM',
  DUPLICATE_DOD_LIST: 'DUPLICATE_DOD_LIST',
});

// Package-manager builtins are resolvable and non-vacuous by construction.
const BUILTIN_SCRIPTS = new Set(['install']);

const readIfPresent = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Minimal block-list reader: `key:` followed by `  - value` lines. Avoids a YAML dependency. */
export function readYamlList(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === `${key}:`);
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^\s+-\s+(.*\S)\s*$/.exec(lines[i]);
    if (m) {
      out.push(m[1].replace(/^["']|["']$/g, ''));
      continue;
    }
    if (lines[i].trim() === '') continue;
    if (lines[i].trimStart().startsWith('#')) continue;
    break;
  }
  return out;
}

function findPackageJsons(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.git' || e.startsWith('.')) continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (e === 'package.json') out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

/** `pnpm test:evals` -> `test:evals`; `pnpm install --frozen-lockfile` -> `install`. */
export function scriptNameOf(command) {
  const t = command.trim().split(/\s+/);
  const i = t.indexOf('pnpm');
  if (i === -1) return null;
  const next = t[i + 1];
  if (!next || next.startsWith('-')) return null;
  return next;
}

/**
 * Extract the commands a workflow actually schedules: the value of every `run:` step,
 * including block scalars, with shell comments stripped. Matching against whole workflow text
 * would let a YAML comment or an env string satisfy enforcement.
 */
export function extractRunCommands(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const inline = /^(\s*)-?\s*run:\s*(?![|>])(\S.*)$/.exec(lines[i]);
    if (inline) {
      out.push(inline[2]);
      continue;
    }
    const block = /^(\s*)-?\s*run:\s*[|>][-+]?\s*$/.exec(lines[i]);
    if (!block) continue;
    const baseIndent = block[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      const indent = lines[j].search(/\S/);
      if (indent <= baseIndent) break;
      out.push(lines[j].trim());
      i = j;
    }
  }
  // A shell comment is not a scheduled command.
  return out.map((c) => c.replace(/(^|\s)#.*$/, '$1').trim()).filter(Boolean);
}

function prTriggeredWorkflows(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }))
    .filter(({ text }) => {
      const on = /^on:\s*$/m.exec(text);
      if (!on) return /pull_request/.test(text);
      // Only the `on:` block decides the trigger.
      const after = text.slice(on.index);
      const block = after.split(/\n(?=\S)/)[0];
      return /pull_request/.test(block);
    });
}

export function checkDodIntegrity(root) {
  const findings = [];
  const add = (code, gate, detail) => findings.push({ code, gate, detail });

  const manifestPath = join(root, 'prd_manifest.yaml');
  const manifest = readIfPresent(manifestPath);
  if (manifest === null) {
    add(FINDING.MANIFEST_MISSING, null, manifestPath);
    return { status: 'FAIL', findings, gates: [] };
  }

  const gates = readYamlList(manifest, 'definition_of_done');
  if (!gates || gates.length === 0) {
    add(FINDING.DOD_LIST_MISSING, null, 'prd_manifest.yaml:definition_of_done');
    return { status: 'FAIL', findings, gates: [] };
  }

  const rootPkg = readJson(join(root, 'package.json')) ?? {};
  const rootScripts = rootPkg.scripts ?? {};

  // Workspace scripts, excluding the root manifest itself.
  const workspaceScripts = [];
  for (const p of findPackageJsons(root)) {
    if (p === join(root, 'package.json')) continue;
    const pkg = readJson(p);
    if (pkg) workspaceScripts.push({ dir: dirname(p), name: pkg.name, scripts: pkg.scripts ?? {} });
  }

  const prWorkflows = prTriggeredWorkflows(root);
  const prRunText = prWorkflows.flatMap((w) => extractRunCommands(w.text)).join('\n');

  for (const command of gates) {
    const script = scriptNameOf(command);

    // 1. RESOLVABLE
    if (script === null) {
      add(FINDING.DOD_COMMAND_UNRESOLVABLE, command, 'no pnpm script token');
      continue;
    }
    const builtin = BUILTIN_SCRIPTS.has(script);
    const definition = rootScripts[script];
    if (!builtin && definition === undefined) {
      add(FINDING.DOD_COMMAND_UNRESOLVABLE, command, `root package.json has no "${script}" script`);
      continue;
    }

    // 2. NON_VACUOUS - the command has a real execution target; turbo fan-out has >= 1
    //    implementer. This does not prove that an arbitrary command can fail.
    if (!builtin) {
      const turbo = /^turbo run (\S+)/.exec(definition);
      const bash = /^bash (\S+)/.exec(definition);
      const node = /^node(?:\s+--?\S+)*\s+(\S+)(?:\s+.*)?$/.exec(definition);
      const filtered = /^pnpm --filter (\S+) (\S+)/.exec(definition);

      if (turbo) {
        const task = turbo[1];
        const implementers = workspaceScripts.filter((w) => w.scripts[task] !== undefined);
        if (implementers.length === 0) {
          add(FINDING.DOD_GATE_VACUOUS, command, `turbo task "${task}" has 0 implementers`);
        }
      } else if (bash) {
        if (!existsSync(join(root, bash[1]))) {
          add(FINDING.DOD_GATE_VACUOUS, command, `script file missing: ${bash[1]}`);
        }
      } else if (node) {
        if (!existsSync(join(root, node[1]))) {
          add(FINDING.DOD_GATE_VACUOUS, command, `script file missing: ${node[1]}`);
        }
      } else if (filtered) {
        const [, pkgName, task] = filtered;
        const target = workspaceScripts.find((w) => w.name === pkgName);
        if (!target || target.scripts[task] === undefined) {
          add(FINDING.DOD_GATE_VACUOUS, command, `${pkgName} has no "${task}" script`);
        }
      } else {
        // Fail closed: the checker proves an execution target only for forms it recognizes.
        add(FINDING.DOD_GATE_UNRECOGNIZED_FORM, command, `unrecognized script form: ${definition}`);
      }
    }

    // 3. ENFORCED — the command must be invoked by a pull_request-triggered workflow.
    const invoked = new RegExp(`pnpm\\s+${script.replace(/[:.]/g, '\\$&')}(\\s|$)`, 'm').test(prRunText);
    if (!invoked) {
      add(FINDING.DOD_GATE_NOT_ENFORCED, command, 'not invoked by any pull_request workflow');
    }
  }

  // 4. NO SECOND COMPLETION AUTHORITY
  const context = readIfPresent(join(root, 'docs', 'CONTEXT.md'));
  if (context !== null) {
    const heading = /^#{1,6}\s*Definition of Done\s*$/im.exec(context);
    if (heading) {
      const after = context.slice(heading.index);
      const fence = /```[a-z]*\n([\s\S]*?)```/.exec(after);
      const count = fence ? (fence[1].match(/^\s*pnpm\s+\S+/gm) ?? []).length : 0;
      if (count >= 3) {
        add(
          FINDING.DUPLICATE_DOD_LIST,
          'docs/CONTEXT.md',
          `independent command list with ${count} pnpm commands`,
        );
      }
    }
  }

  return { status: findings.length === 0 ? 'PASS' : 'FAIL', findings, gates };
}

/**
 * Reverse direction: PR-scheduled pnpm commands that Artifact DoD does not declare.
 * Reporting only. Each must be either declared in definition_of_done or explicitly classified
 * as a different check class before "definition_of_done, and nothing else, defines Artifact
 * DoD" can be asserted. This function does not decide which, and does not affect the verdict.
 */
export function listUndeclaredPrCommands(root) {
  const manifest = readIfPresent(join(root, 'prd_manifest.yaml'));
  if (manifest === null) return [];
  const declared = new Set((readYamlList(manifest, 'definition_of_done') ?? []).map(scriptNameOf));
  const seen = new Set();
  for (const w of prTriggeredWorkflows(root)) {
    for (const cmd of extractRunCommands(w.text)) {
      const script = scriptNameOf(cmd);
      if (script && !declared.has(script)) seen.add(script);
    }
  }
  return [...seen].sort();
}

// CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const root = process.argv[2] ?? process.cwd();
  const r = checkDodIntegrity(root);
  for (const f of r.findings) {
    console.error(`${f.code}  ${f.gate ?? ''}  ${f.detail ?? ''}`.trim());
  }
  console.log(`DoD integrity: ${r.status} (${r.gates.length} declared gates, ${r.findings.length} findings)`);
  process.exit(r.status === 'PASS' ? 0 : 1);
}
