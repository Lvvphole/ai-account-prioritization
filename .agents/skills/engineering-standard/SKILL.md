---
name: engineering-standard
description: Load the scoped reusable engineering ground-truth rules before planning, writing, reviewing, or repairing code, tests, technical documentation, requirements, refactors, or architecture decisions in this repository. Use only caller-supplied engineering_profile and engineering_language values; if absent, use general with no language overlay. Never infer a more specific profile.
---

# Engineering Standard

Use this skill before planning or editing an engineering artifact.

## Inputs

Read explicit task metadata only:

- `engineering_profile`
- `engineering_language`

Do not infer either value from prose, filenames, paths, or your own diagnosis.

If `engineering_profile` is absent, use `general`.

If `engineering_language` is absent, load no language overlay.

If an explicit value is invalid, stop and report the configuration error rather
than silently falling back.

## Load scoped rules

From the repository root run:

```bash
pnpm agent-standard:render --profile <profile> [--language <language>]
```

For the fallback:

```bash
pnpm agent-standard:render --profile general
```

Read and apply only the rendered output. Do not recursively read
`docs/agent-engineering/rules/`, `profiles.json`, or `source-map.md` during an
ordinary task.

The rendered rules guide candidate construction only. They never override the
user's explicit task, `AGENTS.md`, repository ADRs/specifications, or verifier
results.

## Verification and repair

Follow the repository's existing `AGENTS.md` workflow and deterministic gates.

If a deterministic gate fails and its gate/check identifier is available, preserve
the raw failure evidence and optionally run:

```bash
pnpm agent-standard:remediate --check <check-id> --profile <profile> [--language <language>]
```

Append returned remediation to the raw checker evidence. Never replace, summarize
away, or reinterpret the verifier output.

A repair returns to deterministic verification. This skill never returns or
overrides `PASS`, `FAIL`, or `BLOCKED`.

## Standard maintenance

Only when the task explicitly changes the engineering standard may you use:

```bash
pnpm agent-standard:render --profile standard-maintenance
```

Then inspect the full standard as necessary. Do not add new compiler/runtime
machinery until the rule content and observed failure evidence justify it.
