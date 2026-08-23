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
# Full 40-character SHA: a Tier-3 PASS is evidence about one exact commit, and an
# abbreviated SHA does not identify it unambiguously.
START_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

overall=0
rows=()

# Candidate identity. A report headed "ALL GATES PASSED / Commit: X" produced from a
# dirty tree did not verify X; it verified X plus uncommitted work. Cleanliness alone
# is also insufficient — a run could start at HEAD A, create commit B, and still end
# clean, straddling two candidates. Both conditions are gates, not annotations.
# Generated reports under verification-reports/ are gitignored, so this script's own
# output cannot trip these checks.
check_tree_clean() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "FAIL: working tree is not clean; Tier-3 verification requires a committed candidate"
    git status --short
    return 1
  fi
  return 0
}

check_head_unchanged() {
  local end_sha
  end_sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$end_sha" != "$START_SHA" ]; then
    echo "FAIL: HEAD moved during verification ($START_SHA -> $end_sha)"
    return 1
  fi
  return 0
}

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

# Runs first, ahead of install: `pnpm generate:schemas` below rewrites tracked
# artifacts, so a later "clean before" check could not distinguish a dirty candidate
# from this script's own effects.
run_gate "Candidate clean before verification" check_tree_clean
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

# Acceptance B becomes a required production gate only after a real
# qualification epoch and explicit human admission create one active admission
# artifact. Before that point the repository must remain model-optional and must
# not manufacture a candidate, threshold, credential, or PASS result.
if [ -n "${P4_PRODUCTION_MODEL_ADMISSION:-}" ]; then
  run_gate "Acceptance B — single qualified model" pnpm test:acceptance:b
elif [ -f "config/production-model-admission.json" ]; then
  export P4_PRODUCTION_MODEL_ADMISSION="$PWD/config/production-model-admission.json"
  run_gate "Acceptance B — single qualified model" pnpm test:acceptance:b
else
  rows+=("| Acceptance B — single qualified model | ⏭ not active; no production model admitted |")
fi

run_gate "Docker compose config" pnpm docker:config
run_gate "Docker image build" pnpm docker:build
run_gate "Git diff check" git diff --check
run_gate "Candidate clean after verification" check_tree_clean
run_gate "Candidate HEAD unchanged" check_head_unchanged

# `pnpm verify:production` invokes this script, so the Tier 3 list's
# verify:production entry is satisfied by this execution rather than recursively
# invoking itself.
result="$([ $overall -eq 0 ] && echo '✅ ALL GATES PASSED' || echo '❌ FAILURES PRESENT')"
{
  echo "# Production verification report"
  echo
  echo "- Candidate SHA: \`$START_SHA\`"
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
