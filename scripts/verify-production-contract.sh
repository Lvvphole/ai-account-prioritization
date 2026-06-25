#!/usr/bin/env bash
set -euo pipefail

echo "==> Verify production contract"

required_files=(
  "AGENTS.md"
  "prd_manifest.yaml"
  "turbo.json"
  "packages/shared-schemas/scripts/generate-json-schemas.ts"
  "apps/agent-runtime/src/agents/orchestrator/orchestrator.state.ts"
  "apps/agent-runtime/src/agents/orchestrator/orchestrator.guardrails.ts"
  "packages/testing-evals/src/judges/llm-judge.ts"
  "packages/testing-evals/vitest.config.ts"
  "apps/api-python/package.json"
  "apps/api-python/src/schemas/loader.py"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "MISSING: $file"
    exit 1
  fi
done

pnpm install --frozen-lockfile
pnpm generate:schemas
pnpm build
pnpm typecheck
pnpm test:evals

echo "PASSED: production contract verified"
