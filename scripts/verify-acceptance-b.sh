#!/usr/bin/env bash
# Acceptance B — single qualified production model.
#
# The gate requires one real production admission artifact and the exact runtime
# configuration that the human admitted. It calls the admitted production model
# adapter, permits only the configured deterministic fallback, and carries the
# resulting recommendation through the same migrated durable representative path
# as Acceptance A.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "FAILED: Acceptance B — $*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "$name is required"
}

require_env P4_PRODUCTION_MODEL_ADMISSION
require_env RUNTIME_DRAFT_API_KEY
require_env RUNTIME_DRAFT_PROVIDER
require_env RUNTIME_DRAFT_MODEL
require_env RUNTIME_DRAFT_REASONING_EFFORT
require_env RUNTIME_DRAFT_TIMEOUT_MS
require_env RUNTIME_DRAFT_MAX_TOKENS
require_env RUNTIME_DRAFT_MAX_INPUT_TOKENS
require_env RUNTIME_DRAFT_MAX_SIGNALS
require_env RUNTIME_DRAFT_MAX_EVIDENCE_AGE_DAYS
require_env RUNTIME_DRAFT_MAX_CONCURRENT
require_env RUNTIME_DRAFT_MAX_RUN_TOKENS
require_env RUNTIME_DRAFT_FALLBACK

[ -f "$P4_PRODUCTION_MODEL_ADMISSION" ] \
  || fail "P4_PRODUCTION_MODEL_ADMISSION does not point to a readable admission artifact"
# Turbo runs the package task from its workspace directory. Pin the admission to
# an absolute path so path resolution cannot depend on the task working directory.
P4_ADMISSION_DIR="$(cd "$(dirname "$P4_PRODUCTION_MODEL_ADMISSION")" && pwd)"
export P4_PRODUCTION_MODEL_ADMISSION="$P4_ADMISSION_DIR/$(basename "$P4_PRODUCTION_MODEL_ADMISSION")"
export RUNTIME_DRAFTING_ENABLED=true
export VERIFY_ACCEPTANCE_B_RUNTIME=true

echo "==> Acceptance B: one admitted model-enabled durable production spine"
pnpm verify:migrations \
  || fail "single-qualified-model durable production spine"

echo "PASSED: Acceptance B — single qualified model end to end."
