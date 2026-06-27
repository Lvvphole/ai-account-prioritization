#!/usr/bin/env bash
# Full production verification: runs every gate and writes a markdown report to
# verification-reports/. Exits non-zero if any gate fails. The executor never
# self-certifies — this is the machine-checkable record the verifier owns.
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

# Generated JSON Schema must already match the committed Zod source — it is the
# contract the Python service consumes. A non-empty diff means it was not committed.
check_schema_drift() {
  git diff --exit-code -- \
    packages/shared-schemas/generated \
    apps/api-python/src/schemas/generated
}

run_gate "Required files" check_files
run_gate "Install (frozen lockfile)" pnpm install --frozen-lockfile
# Scan BEFORE any step that can rewrite tracked files (e.g. schema generation),
# so the scan reflects the committed tree, not a regenerated one.
run_gate "Secret scan" pnpm scan:secrets
run_gate "Generate schemas" pnpm generate:schemas
run_gate "Schema artifacts committed (no drift)" check_schema_drift
run_gate "Build" pnpm build
run_gate "Typecheck" pnpm typecheck
run_gate "Deterministic evals" pnpm test:evals
run_gate "Judge eval (heuristic offline)" bash -c 'EVAL_JUDGE_ENABLED=true pnpm test:judge'
run_gate "No Prisma" pnpm check:no-prisma
run_gate "Security package" pnpm verify:security
run_gate "Observability package" pnpm verify:observability
run_gate "Docker compose config" docker compose -f infra/compose.yaml config

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
