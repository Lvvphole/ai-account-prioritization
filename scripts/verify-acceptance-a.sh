#!/usr/bin/env bash
# Acceptance A — deterministic baseline.
#
# The gate owns the model-disabled profile. It runs the real daily runtime with
# a model client that must never be called, then executes the durable database
# behavior suites. Suite 13 verifies continuity across recommendation
# persistence, representative RLS read, exact-payload approval, protected
# execution, and durable follow-up without changing recommendation authority.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "FAILED: Acceptance A — $*" >&2
  exit 1
}

export RUNTIME_DRAFTING_ENABLED=false
unset RUNTIME_DRAFT_API_KEY RUNTIME_DRAFT_MODEL

[ "$RUNTIME_DRAFTING_ENABLED" = "false" ] || fail "runtime drafting must be disabled"

echo "==> Acceptance A: deterministic model-disabled daily runtime"
pnpm --filter @repo/testing-evals exec vitest run src/acceptance-a-deterministic-baseline.eval.ts \
  || fail "deterministic runtime profile"

echo "==> Acceptance A: durable production-spine behavior"
pnpm verify:migrations \
  || fail "durable production-spine behavior"

echo "PASSED: Acceptance A — deterministic baseline end to end."
