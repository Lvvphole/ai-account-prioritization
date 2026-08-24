#!/usr/bin/env bash
set -uo pipefail

REPORT_DIR="verification-reports"
rows=()
overall=0

check_clean() {
  local status
  if ! status="$(git status --porcelain --untracked-files=all 2>/dev/null)"; then
    echo "FAIL: cannot determine candidate working-tree state."
    return 1
  fi
  if [ -n "$status" ]; then
    echo "FAIL: working tree is not clean; Tier-3 verification requires a committed candidate."
    return 1
  fi
}

if ! START_SHA="$(git rev-parse --verify HEAD 2>/dev/null)"; then
  echo "BLOCKED: cannot resolve the candidate HEAD."
  exit 2
fi

if ! check_clean; then
  echo "Candidate clean before verification: FAIL"
  exit 1
fi

echo "Candidate clean before verification: PASS"
rows+=("| Candidate clean before verification | PASS |")

mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORT_DIR/verification-$STAMP.md"

run_gate() {
  local name="$1"
  shift
  echo "==> $name"
  if "$@"; then
    rows+=("| $name | PASS |")
  else
    rows+=("| $name | FAIL |")
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
    .github/workflows/production-verification.yml
  )
  for file in "${required[@]}"; do
    if [ ! -f "$file" ]; then
      echo "MISSING: $file"
      missing=1
    fi
  done
  return "$missing"
}

check_schema_drift() {
  git diff --exit-code -- \
    packages/shared-schemas/generated \
    apps/api-python/src/schemas/generated
}

check_head_unchanged() {
  local current_sha
  if ! current_sha="$(git rev-parse --verify HEAD 2>/dev/null)"; then
    echo "FAIL: cannot resolve candidate HEAD after verification."
    return 1
  fi
  if [ "$current_sha" != "$START_SHA" ]; then
    echo "FAIL: candidate HEAD changed during verification."
    return 1
  fi
}

run_gate "Required files" check_files
run_gate "Install (frozen lockfile)" pnpm install --frozen-lockfile
run_gate "Secret scan" pnpm scan:secrets
run_gate "Generate schemas" pnpm generate:schemas
run_gate "Schema artifacts committed (no drift)" check_schema_drift
run_gate "Lint" pnpm lint
run_gate "Build" pnpm build
run_gate "Typecheck" pnpm typecheck
run_gate "Unit tests" pnpm test
run_gate "Deterministic evals" pnpm test:evals
run_gate "Verification layer" pnpm test:verification-layer
run_gate "Build Python support service" pnpm build:api-python
run_gate "No Prisma" pnpm check:no-prisma
run_gate "Security package" pnpm verify:security
run_gate "Observability package" pnpm verify:observability
run_gate "Acceptance A — deterministic baseline" pnpm test:acceptance:a

if [ -n "${P4_PRODUCTION_MODEL_ADMISSION:-}" ]; then
  run_gate "Acceptance B — single qualified model" pnpm test:acceptance:b
elif [ -f "config/production-model-admission.json" ]; then
  export P4_PRODUCTION_MODEL_ADMISSION="$PWD/config/production-model-admission.json"
  run_gate "Acceptance B — single qualified model" pnpm test:acceptance:b
else
  rows+=("| Acceptance B — single qualified model | not active |")
fi

run_gate "Docker compose config" pnpm docker:config
run_gate "Docker image build" pnpm docker:build
run_gate "Git diff check" git diff --check
run_gate "Candidate HEAD unchanged" check_head_unchanged
run_gate "Candidate clean after verification" check_clean

if [ "$overall" -eq 0 ]; then
  result="ALL GATES PASSED"
else
  result="FAILURES PRESENT"
fi

{
  echo "# Production verification report"
  echo
  echo "- Commit: \`$START_SHA\`"
  echo "- Generated (UTC): $STAMP"
  echo "- Result: $result"
  echo
  echo "| Gate | Status |"
  echo "| ---- | ------ |"
  for row in "${rows[@]}"; do
    echo "$row"
  done
} | tee "$REPORT"

echo
echo "Report written to $REPORT"
exit "$overall"
