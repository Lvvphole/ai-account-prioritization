#!/usr/bin/env bash
# Full production verification: runs every required Tier 3 gate and writes a
# markdown report to verification-reports/. Exits non-zero if any gate fails.
# The executor never self-certifies; this is the machine-checkable record the
# verifier owns.
set -uo pipefail

REPORT_DIR="verification-reports"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORT_DIR/verification-$STAMP.md"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

overall=0
rows=()

run_gate() {
  local name="$1"
  shift
  echo "==> $name"
  if "$@"; then
    rows+=("| $name | ✅ pass |")
  else
    rows+=("| $name | ❌ FAIL |")
    overall=1
  fi
}

check_files() {
  local missing=0
  local required=(
    AGENTS.md
    prd_manifest.yaml
    turbo.json
    packages/shared-schemas/scripts/generate-json-schemas.ts
    apps/agent-runtime/src/agents/orchestrator/orchestrator.guardrails.ts
    packages/security/src/index.ts
    packages/observability/src/index.ts
    apps/api-python/src/observability/__init__.py
    .github/workflows/ci.yml
    .github/workflows/security.yml
    .github/workflows/deploy.yml
  )
  for f in "${required[@]}"; do
    if [ ! -f "$f" ]; then
      echo "MISSING: $f"
      missing=1
    fi
  done
  return $missing
}

# Generated JSON Schema must already match the committed Zod source. A non-empty
# diff means generation changed tracked artifacts and the committed contract is
# stale.
check_schema_drift() {
  git diff --exit-code -- \
    packages/shared-schemas/generated \
    apps/api-python/src/schemas/generated
}

run_gate "Required files" check_files
run_gate "Install (frozen lockfile)" pnpm install --frozen-lockfile
# Scan before any step that can rewrite tracked files so the scan reflects the
# committed tree, not regenerated output.
run_gate "Secret scan" pnpm scan:secrets
run_gate "Generate schemas" pnpm generate:schemas
run_gate "Schema artifacts committed (no drift)" check_schema_drift
run_gate "Lint" pnpm lint
run_gate "Build" pnpm build
run_gate "Typecheck" pnpm typecheck
run_gate "Unit tests" pnpm test
run_gate "Deterministic evals" pnpm test:evals
run_gate "Build Python support service" pnpm build:api-python
run_gate "No Prisma" pnpm check:no-prisma
run_gate "Security package" pnpm verify:security
run_gate "Observability package" pnpm verify:observability
# Acceptance A owns the model-disabled production profile and invokes
# `pnpm verify:migrations` as its durable database stage. This keeps the
# canonical migration command inside the Tier 3 verifier without running the
# same migration suite twice.
run_gate "Acceptance A — deterministic baseline" pnpm test:acceptance:a
run_gate "Docker compose config" pnpm docker:config
run_gate "Docker image build" pnpm docker:build
run_gate "Git diff check" git diff --check

# `pnpm verify:production` invokes this script, so the Tier 3 list's
# verify:production entry is satisfied by this execution rather than recursively
# invoking itself.
result="$([ $overall -eq 0 ] && echo '✅ ALL GATES PASSED' || echo '❌ FAILURES PRESENT')"
{
  echo "# Production verification report"
  echo
  echo "- Commit: \`$COMMIT\`"
  echo "- Generated (UTC): $STAMP"
  echo "- Result: $result"
  echo
  echo "| Gate | Status |"
  echo "| ---- | ------ |"
  for r in "${rows[@]}"; do echo "$r"; done
} | tee "$REPORT"

echo
echo "Report written to $REPORT"
exit $overall
