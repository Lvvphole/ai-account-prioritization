# PR-E OpenAI Qualification

## Purpose

PR-E adds one OpenAI model to the P4 qualification system. It does not authorize production admission or activation.

## Candidate sets

`config/p4-qualification-policy.json` remains the single policy file.

The existing `candidates` array remains the integrated qualification-and-admission candidate set. It contains only the current Anthropic candidates.

The new `qualificationOnlyCandidates` array contains candidates that the report-only command can evaluate. PR-E puts only `openai-gpt-5-4-nano-2026-03-17-default` in this array.

The contract identifier remains `p4-model-qualification-v2`. This is safe for an older v2 integrated evaluator because that evaluator ignores the new top-level array and cannot see its OpenAI candidate. OpenAI is not present in the integrated `candidates` array.

The two arrays must not use the same candidate ID.

## Qualification-only command

Use:

```bash
pnpm qualify:models:report
```

This command reads the canonical policy, selects only `qualificationOnlyCandidates`, runs the existing P4 qualification evaluator, and writes only the immutable qualification report.

The report records `mode=qualification_only`, the selected candidate set, and a SHA-256 hash of the complete canonical policy file. The existing `qualificationPolicyHash` continues to identify the projected execution configuration.

The command does not require `P4_ADMISSION_DECISION_OWNER` or `P4_ADMISSION_DECISION_REF`. It does not read `P4_PRODUCTION_MODEL_ADMISSION_OUTPUT`. It cannot create a production admission artifact.

Set `P4_QUALIFICATION_REPORT` to a new unused path when a specific report path is required. The command reserves the report path before any provider call.

## OpenAI boundary

A successful report can move the OpenAI configuration from `IMPLEMENTED` to `QUALIFIED` only.

It does not move OpenAI to `STAGED`, `ADMITTED`, or `ACTIVE`.

The integrated command remains:

```bash
pnpm qualify:models
```

That command parses only `candidates`. The OpenAI PR-E candidate is not in that array, so the integrated command cannot select it for production admission.

A later production-admission change must be explicit and separately authorized.

## Spend boundary

Do not run the live report-only qualification without explicit authorization for provider calls and spend.

PR-E implementation and branch verification use no live OpenAI qualification call.
