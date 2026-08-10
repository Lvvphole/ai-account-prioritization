#!/usr/bin/env bash
set -euo pipefail

# Verify GitHub Actions workflow safety, the security package, and the runtime's
# approval-gate delegation. The checks fail closed on deterministic violations.
echo "==> Verify security controls"

required_files=(
  "scripts/verify-github-actions.sh"
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

bash scripts/verify-github-actions.sh

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

echo "PASSED: security controls, package, and approval-gate delegation."
