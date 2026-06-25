# Verification Summary

**Product:** AI Account Prioritization Agent for B2B Sales Teams
**Branch:** `claude/blissful-cori-y7o91o` (environment-designated; maps to the
requested `feat/production-monorepo-agent-runtime`)
**Verified:** 2026-06-25
**Overall:** ✅ PASSED

## Gates

| Gate | Command | Result |
| --- | --- | --- |
| Install | `pnpm install` | ✅ passed |
| Schema generation | `pnpm generate:schemas` | ✅ 14 schemas → 2 targets |
| Build | `pnpm build` | ✅ 4/4 tasks |
| Typecheck | `pnpm typecheck` | ✅ 7/7 tasks |
| Deterministic evals | `pnpm test:evals` | ✅ 20/20 tests |
| Judge gate | `EVAL_JUDGE_ENABLED=true pnpm test:judge` | ✅ 4/4 tests (heuristic fallback, no API key) |
| Python build | `pnpm build:api-python` | ✅ passed |
| Production contract | `scripts/verify-production-contract.sh` | ✅ PASSED |

## Eval suites

| Suite | Kind | Tests | Deployment-blocking |
| --- | --- | --- | --- |
| scoring | deterministic | 6 | yes |
| guardrails | guardrail | 5 | yes |
| daily-prioritization (golden) | deterministic | 4 | yes |
| security (adversarial) | security | 5 | yes |
| daily-prioritization-judge | llm_judge (non-runtime) | 4 | when `EVAL_JUDGE_ENABLED=true` |

## Contract invariants confirmed

- LLM does **not** rank; deterministic scoring decides rank.
- TypeScript/Zod is the schema source of truth; Python consumes generated JSON
  only.
- Runtime guardrails are synchronous & deterministic; the LLM judge is async and
  outside the runtime path.
- Human approval is required for customer-facing sends and CRM write-back
  (verified by fail-closed evals).
- Every recommendation carries score, confidence, reason codes, verified source
  signals, and a next best action.
- No recommendation publishes without passing verification; unsupported claims
  and unverified signals fail closed.
- Every critical action writes an audit entry.

## Notes

- The async judge degrades to a deterministic heuristic when no
  `ANTHROPIC_API_KEY` is present, so the gate is always runnable in CI.
- The Playwright spec (`packages/testing-evals/src/playwright.test.ts`) is an E2E
  artifact run separately under Playwright (not part of `test:evals`).
- `scripts/refactor-and-push.sh` is the reference handoff script; in this managed
  environment the push target is the designated branch above.
