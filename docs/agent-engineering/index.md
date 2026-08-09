# Agent Engineering Standard

This directory is the repository-local system of record for reusable coding-agent
engineering guidance. The runtime/coding agent does **not** load this directory
wholesale.

## Governing rule

**Store broadly. Load narrowly. Enforce deterministically.**

The admitted engineering inventory contains:

- 33 engineering ground-truth rules across Technical Writing, Requirements,
  Software Construction, Refactoring & Testing, Architecture Decisions, Python,
  and TypeScript.
- 8 rejected-design meta-rules used only when maintaining this standard.
- a five-rule `general` kernel that is the only fallback when the caller supplies
  no task profile.

## Authority boundary

This standard guides candidate construction. It does not override:

1. the user's explicit task;
2. root or nested `AGENTS.md`;
3. repository product/architecture authorities and ADRs;
4. deterministic verifier outcomes.

It never returns `PASS`, `FAIL`, or `BLOCKED`.

## Profile resolution

The coding harness or human supplies `engineering_profile` explicitly when a
specific profile is known. The standard never asks the model to infer one.

Allowed task profiles:

- `general`
- `code-change`
- `bug-fix`
- `refactor`
- `technical-doc`
- `requirements`
- `architecture-change`
- `standard-maintenance`

Language overlays are also caller-supplied:

- `python`
- `typescript`

If no task profile is supplied, use `general`. If no language is supplied, load
no language overlay. An invalid supplied value is an error, not a silent fallback.

`applies_to.paths` remains a valid rule field, but v1 performs no path-based
resolution.

## Delivery

`delivery: preload` rules are included in the initial scoped context.

`delivery: on_failure` rules are not preloaded. They may be returned only after a
matching deterministic check fails. An `on_failure` rule must name an executable
verification trigger; `on_failure + semantic-review` is invalid.

## Files

- `manifest.json` — version and resolution invariants.
- `profiles.json` — declarative profile membership.
- `rules/` — canonical admitted rule records.
- `source-map.md` — provenance for standard maintenance only.

For ordinary tasks, use the repository skill
`.agents/skills/engineering-standard/SKILL.md` or the deterministic renderer
`scripts/agent-standard.mjs`. Do not read the full registry unless the task is
standard maintenance.
