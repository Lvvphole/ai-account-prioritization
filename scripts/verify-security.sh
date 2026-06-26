#!/usr/bin/env bash
set -euo pipefail

# Verify the security package and that the runtime's approval gate delegates to
# it (no silent re-implementation or weakening of the human-approval gate).
echo "==> Verify security package & approval-gate delegation"

required_files=(
  "packages/security/package.json"
  "packages/security/src/index.ts"
  "packages/security/src/rbac.ts"
  "packages/security/src/approval.ts"
  "packages/security/src/pii.ts"
  "packages/security/src/security.test.ts"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "MISSING: $file"
    exit 1
  fi
done

# Guard: the runtime permission gate must delegate to @repo/security, and the
# canonical approval policy must fail closed (approved-only).
if ! grep -q "isApprovalSatisfied" \
  apps/agent-runtime/src/agents/orchestrator/orchestrator.guardrails.ts; then
  echo "FAIL: runtime approval gate does not delegate to @repo/security."
  exit 1
fi

if ! grep -q 'approvalStatus === "approved"' packages/security/src/approval.ts; then
  echo "FAIL: approval policy is not fail-closed (approved-only)."
  exit 1
fi

# Build, typecheck, and run the deterministic security unit tests.
pnpm --filter @repo/security build
pnpm --filter @repo/security typecheck
pnpm --filter @repo/security test

echo "PASSED: security package present, fail-closed, and wired into the runtime."
