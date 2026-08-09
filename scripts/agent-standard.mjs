#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DEFAULT = "docs/agent-engineering";
const ENGINEERING_PREFIXES = ["TW-", "REQ-", "SC-", "RT-", "AD-", "PY-", "TS-"];
const EXECUTABLE_FAILURE_TYPES = new Set([
  "command",
  "linter",
  "schema",
  "structural-test",
  "typecheck",
]);
const VALID_LEVELS = new Set(["MUST", "CONDITIONAL"]);
const VALID_DELIVERY = new Set(["preload", "on_failure"]);
const VALID_OVERRIDE = new Set(["LOCKED", "SPECIALIZABLE", "DEFAULT"]);
const VALID_VERIFICATION = new Set([
  ...EXECUTABLE_FAILURE_TYPES,
  "none",
  "semantic-review",
]);

export class AgentStandardError extends Error {}
export class AgentStandardConfigurationError extends AgentStandardError {}
export class UnknownProfileError extends AgentStandardConfigurationError {}
export class UnknownLanguageOverlayError extends AgentStandardConfigurationError {}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AgentStandardConfigurationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AgentStandardConfigurationError(`${label} must be an array of strings`);
  }
  if (new Set(value).size !== value.length) {
    throw new AgentStandardConfigurationError(`${label} contains duplicates`);
  }
  return [...value];
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new AgentStandardConfigurationError(`${path}: ${error.message}`);
  }
}

function jsonFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...jsonFiles(path));
    else if (name.endsWith(".json")) files.push(path);
  }
  return files;
}

function parseRule(raw, origin) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgentStandardConfigurationError(`${origin}: rule must be an object`);
  }

  const id = nonEmpty(raw.id, `${origin}.id`);
  const domain = nonEmpty(raw.domain, `${id}.domain`);
  const level = nonEmpty(raw.level, `${id}.level`);
  const delivery = nonEmpty(raw.delivery, `${id}.delivery`);
  const instruction = nonEmpty(raw.instruction, `${id}.instruction`);
  const overridePolicy = nonEmpty(raw.override_policy, `${id}.override_policy`);

  if (!VALID_LEVELS.has(level)) {
    throw new AgentStandardConfigurationError(`${id}: invalid level ${level}`);
  }
  if (!VALID_DELIVERY.has(delivery)) {
    throw new AgentStandardConfigurationError(`${id}: invalid delivery ${delivery}`);
  }
  if (!VALID_OVERRIDE.has(overridePolicy)) {
    throw new AgentStandardConfigurationError(
      `${id}: invalid override_policy ${overridePolicy}`,
    );
  }

  const applies = raw.applies_to;
  if (!applies || typeof applies !== "object" || Array.isArray(applies)) {
    throw new AgentStandardConfigurationError(`${id}: applies_to must be an object`);
  }

  const verification = raw.verification;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    throw new AgentStandardConfigurationError(`${id}: verification must be an object`);
  }
  const verificationType = nonEmpty(verification.type, `${id}.verification.type`);
  if (!VALID_VERIFICATION.has(verificationType)) {
    throw new AgentStandardConfigurationError(
      `${id}: invalid verification.type ${verificationType}`,
    );
  }
  const verificationRef =
    verification.ref === null || verification.ref === undefined
      ? null
      : nonEmpty(verification.ref, `${id}.verification.ref`);

  if (delivery === "on_failure") {
    if (!EXECUTABLE_FAILURE_TYPES.has(verificationType)) {
      throw new AgentStandardConfigurationError(
        `${id}: delivery=on_failure requires an executable verification trigger`,
      );
    }
    if (!verificationRef) {
      throw new AgentStandardConfigurationError(
        `${id}: delivery=on_failure requires verification.ref`,
      );
    }
  }

  const sources = stringArray(raw.sources, `${id}.sources`);
  if (sources.length === 0) {
    throw new AgentStandardConfigurationError(`${id}: sources must not be empty`);
  }

  const specializes =
    raw.specializes === null || raw.specializes === undefined
      ? null
      : nonEmpty(raw.specializes, `${id}.specializes`);

  return Object.freeze({
    id,
    domain,
    level,
    delivery,
    instruction,
    applies_to: Object.freeze({
      profiles: stringArray(applies.profiles ?? [], `${id}.applies_to.profiles`),
      languages: stringArray(applies.languages ?? [], `${id}.applies_to.languages`),
      // Schema field retained. v1 performs no path resolution.
      paths: stringArray(applies.paths ?? [], `${id}.applies_to.paths`),
    }),
    verification: Object.freeze({ type: verificationType, ref: verificationRef }),
    override_policy: overridePolicy,
    sources,
    kernel: raw.kernel === true,
    specializes,
  });
}

function loadRules(root) {
  const rules = new Map();
  for (const file of jsonFiles(join(root, "rules"))) {
    const document = readJson(file);
    const rows = document && Array.isArray(document.rules)
      ? document.rules
      : [document];

    for (const row of rows) {
      const rule = parseRule(row, file);
      if (rules.has(rule.id)) {
        throw new AgentStandardConfigurationError(`duplicate rule id: ${rule.id}`);
      }
      if (rule.specializes) {
        throw new AgentStandardConfigurationError(
          `${rule.id}: reusable shared rules must not specialize another rule`,
        );
      }
      rules.set(rule.id, rule);
    }
  }
  return rules;
}

function loadProfiles(root) {
  const document = readJson(join(root, "profiles.json"));
  if (!document || !Array.isArray(document.profiles)) {
    throw new AgentStandardConfigurationError(
      "profiles.json must contain a profiles array",
    );
  }

  const profiles = new Map();
  for (const raw of document.profiles) {
    const id = nonEmpty(raw.id, "profile.id");
    const preload = stringArray(raw.preload, `${id}.preload`);
    const notes =
      raw.notes === undefined || raw.notes === null
        ? ""
        : typeof raw.notes === "string"
          ? raw.notes
          : (() => {
              throw new AgentStandardConfigurationError(`${id}.notes must be a string`);
            })();

    if (profiles.has(id)) {
      throw new AgentStandardConfigurationError(`duplicate profile id: ${id}`);
    }
    profiles.set(id, Object.freeze({ id, preload, notes }));
  }
  return profiles;
}

function applies(rule, profile, language) {
  if (
    rule.applies_to.profiles.length > 0 &&
    !rule.applies_to.profiles.includes(profile) &&
    !rule.applies_to.profiles.includes("general")
  ) {
    return false;
  }

  if (
    rule.applies_to.languages.length > 0 &&
    (!language || !rule.applies_to.languages.includes(language))
  ) {
    return false;
  }

  // applies_to.paths is intentionally not evaluated in v1.
  return true;
}

function validate(standard) {
  const { manifest, rules, profiles } = standard;

  if ((manifest.default_profile ?? "general") !== "general") {
    throw new AgentStandardConfigurationError(
      "default_profile must remain general",
    );
  }
  if ((manifest.path_resolution ?? "deferred") !== "deferred") {
    throw new AgentStandardConfigurationError(
      "path_resolution must remain deferred",
    );
  }
  if (manifest.acceptance_authority !== "external_verifier") {
    throw new AgentStandardConfigurationError(
      "acceptance_authority must remain external_verifier",
    );
  }
  nonEmpty(manifest.governing_context_id, "governing_context_id");

  if (!profiles.has("general")) {
    throw new AgentStandardConfigurationError("missing general profile");
  }

  for (const profile of profiles.values()) {
    for (const id of profile.preload) {
      if (!rules.has(id)) {
        throw new AgentStandardConfigurationError(
          `profile ${profile.id} references missing rule ${id}`,
        );
      }
    }
    if (profile.id !== "standard-maintenance") {
      const rejected = profile.preload.filter((id) => id.startsWith("RD-"));
      if (rejected.length > 0) {
        throw new AgentStandardConfigurationError(
          `ordinary profile ${profile.id} contains rejected-design rules`,
        );
      }
    }
  }

  const kernel = [...rules.values()]
    .filter((rule) => rule.kernel)
    .map((rule) => rule.id)
    .sort();
  const general = [...profiles.get("general").preload].sort();

  if (JSON.stringify(kernel) !== JSON.stringify(general)) {
    throw new AgentStandardConfigurationError(
      "general profile must equal the shared kernel exactly",
    );
  }

  const engineeringCount = [...rules.keys()].filter((id) =>
    ENGINEERING_PREFIXES.some((prefix) => id.startsWith(prefix)),
  ).length;
  const rejectedCount = [...rules.keys()].filter((id) => id.startsWith("RD-")).length;

  if (engineeringCount !== 33) {
    throw new AgentStandardConfigurationError(
      `expected 33 engineering rules; got ${engineeringCount}`,
    );
  }
  if (rejectedCount !== 8) {
    throw new AgentStandardConfigurationError(
      `expected 8 rejected-design meta-rules; got ${rejectedCount}`,
    );
  }

  for (const id of rules.keys()) {
    if (id.startsWith("AAP-") || id.startsWith("LOCAL-")) {
      throw new AgentStandardConfigurationError(
        `reusable registry contains repository-specific rule ${id}`,
      );
    }
  }

  const overlays = manifest.language_overlays ?? {};
  if (!overlays || typeof overlays !== "object" || Array.isArray(overlays)) {
    throw new AgentStandardConfigurationError(
      "language_overlays must be an object",
    );
  }
  for (const [language, profileId] of Object.entries(overlays)) {
    nonEmpty(language, "language overlay key");
    nonEmpty(profileId, `language_overlays.${language}`);
    if (!profiles.has(profileId)) {
      throw new AgentStandardConfigurationError(
        `language ${language} references missing overlay profile ${profileId}`,
      );
    }
  }

  return { engineeringCount, rejectedCount };
}

export function loadStandard(root = ROOT_DEFAULT) {
  const absoluteRoot = resolve(root);
  const standard = {
    root: absoluteRoot,
    manifest: readJson(join(absoluteRoot, "manifest.json")),
    rules: loadRules(absoluteRoot),
    profiles: loadProfiles(absoluteRoot),
  };
  Object.assign(standard, validate(standard));
  return Object.freeze(standard);
}

function profileOf(standard, requested) {
  const id = requested ?? "general";
  const profile = standard.profiles.get(id);
  if (!profile) {
    throw new UnknownProfileError(
      `unknown task profile ${id}; omit it only when general is intended`,
    );
  }
  return profile;
}

function overlayOf(standard, language) {
  if (language === null || language === undefined) return null;
  const profileId = standard.manifest.language_overlays?.[language];
  if (!profileId) {
    throw new UnknownLanguageOverlayError(
      `no deterministic language overlay configured for ${language}`,
    );
  }
  return standard.profiles.get(profileId);
}

export function compileContext(
  standard,
  { profile = "general", language = null } = {},
) {
  const taskProfile = profileOf(standard, profile);
  const overlay = overlayOf(standard, language);
  const ids = [...taskProfile.preload, ...(overlay?.preload ?? [])];

  const selected = [];
  const seen = new Set();

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);

    const rule = standard.rules.get(id);
    if (rule.delivery !== "preload") continue;
    if (!applies(rule, taskProfile.id, language)) continue;
    selected.push(rule);
  }

  const lines = [
    "<engineering_standard>",
    "Purpose: guide candidate construction only.",
    "Authority: this standard does not override the explicit authorized task, AGENTS.md, repository ADRs/specifications, or verifier outcomes.",
    "If a real authority conflict exists, surface it; do not resolve it silently.",
    `Profile: ${taskProfile.id}`,
  ];
  if (language) lines.push(`Language overlay: ${language}`);
  lines.push("Rules:");
  for (const rule of selected) {
    lines.push(`- ${rule.id} [${rule.level}] ${rule.instruction}`);
  }
  lines.push("</engineering_standard>");

  return Object.freeze({
    profile: taskProfile.id,
    language,
    governing_context_id: standard.manifest.governing_context_id,
    rule_ids: selected.map((rule) => rule.id),
    text: lines.join("\n"),
  });
}

export function remediationFor(
  standard,
  { checkRef, profile = "general", language = null },
) {
  nonEmpty(checkRef, "checkRef");
  const taskProfile = profileOf(standard, profile);
  overlayOf(standard, language);

  const matches = [];
  for (const rule of standard.rules.values()) {
    if (
      rule.delivery === "on_failure" &&
      rule.verification.ref === checkRef &&
      applies(rule, taskProfile.id, language)
    ) {
      matches.push(rule);
    }
  }

  if (matches.length === 0) return null;

  const lines = [
    "<engineering_standard_remediation>",
    `Deterministic check: ${checkRef}`,
    "Preserve raw checker output as verification evidence. The rules below only explain the applicable constraint.",
  ];
  for (const rule of matches) {
    lines.push(`- ${rule.id} [${rule.level}] ${rule.instruction}`);
  }
  lines.push("</engineering_standard_remediation>");
  return lines.join("\n");
}

function parseCli(argv) {
  const command = argv[0];
  if (!["validate", "render", "remediate"].includes(command)) {
    throw new AgentStandardConfigurationError(
      "command required: validate | render | remediate",
    );
  }

  const args = {
    command,
    root: ROOT_DEFAULT,
    profile: "general",
    language: null,
    check: null,
    json: false,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i];

    if (key === "--json") {
      args.json = true;
      continue;
    }

    if (!["--root", "--profile", "--language", "--check"].includes(key)) {
      throw new AgentStandardConfigurationError(`unknown argument: ${key}`);
    }

    const value = argv[++i];
    if (!value || value.startsWith("--")) {
      throw new AgentStandardConfigurationError(`missing value for ${key}`);
    }
    args[key.slice(2)] = value;
  }

  return args;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseCli(argv);
    const standard = loadStandard(args.root);

    if (args.command === "validate") {
      const result = {
        status: "OK",
        engineering_rules: standard.engineeringCount,
        rejected_design_rules: standard.rejectedCount,
        profiles: standard.profiles.size,
        governing_context_id: standard.manifest.governing_context_id,
      };
      process.stdout.write(
        args.json
          ? `${JSON.stringify(result)}\n`
          : `OK: ${result.engineering_rules} engineering rules, ${result.rejected_design_rules} rejected-design rules, ${result.profiles} profiles, governing_context_id=${result.governing_context_id}\n`,
      );
      return 0;
    }

    if (args.command === "render") {
      const bundle = compileContext(standard, {
        profile: args.profile,
        language: args.language,
      });
      process.stdout.write(
        args.json ? `${JSON.stringify(bundle)}\n` : `${bundle.text}\n`,
      );
      return 0;
    }

    if (!args.check) {
      throw new AgentStandardConfigurationError(
        "remediate requires --check <deterministic-check-id>",
      );
    }

    const remediation = remediationFor(standard, {
      checkRef: args.check,
      profile: args.profile,
      language: args.language,
    });
    const result = { check_ref: args.check, remediation };

    process.stdout.write(
      args.json
        ? `${JSON.stringify(result)}\n`
        : remediation
          ? `${remediation}\n`
          : "NO_REMEDIATION\n",
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    return 2;
  }
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  process.exitCode = main();
}
