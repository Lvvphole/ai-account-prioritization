#!/usr/bin/env bash
set -euo pipefail

# Verify the observability package exists, redacts PII before emit (Rule #30),
# and that its deterministic eval is present.
echo "==> Verify observability package & PII-safe telemetry"

required_files=(
  "packages/observability/package.json"
  "packages/observability/src/index.ts"
  "packages/observability/src/event.ts"
  "packages/observability/src/sink.ts"
  "packages/observability/src/observability.ts"
  "packages/testing-evals/src/observability.eval.ts"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "MISSING: $file"
    exit 1
  fi
done

# Guard: the emitter must redact attributes before they reach a sink.
if ! grep -q "redactProperties" packages/observability/src/observability.ts; then
  echo "FAIL: observability emitter does not redact attributes (PII-safe telemetry)."
  exit 1
fi

pnpm --filter @repo/observability build
pnpm --filter @repo/observability typecheck
pnpm --filter @repo/observability test

echo "PASSED: observability package present, PII-redacting, and schema-validated."
