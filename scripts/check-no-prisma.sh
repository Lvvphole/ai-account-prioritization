#!/usr/bin/env bash
set -euo pipefail

# Enforce Execution Rule #28: Prisma is deferred and must not be added.
#
# We flag ACTUAL Prisma usage — dependencies, imports, and schema files — not
# prose. Docs that explain *why* Prisma is excluded must not trip this guard.

echo "==> Checking Prisma is not a dependency or import"
fail=0

# 1) Dependency entries in any package.json (prisma / @prisma/*).
while IFS= read -r pkg; do
  if grep -Eq '"(prisma|@prisma/[^"]+)"[[:space:]]*:' "$pkg"; then
    echo "FAILED: Prisma dependency declared in $pkg"
    fail=1
  fi
done < <(find . -name package.json -not -path '*/node_modules/*' -not -path '*/.turbo/*')

# 2) Source imports of prisma / @prisma/client.
if grep -REn "from ['\"](@prisma/client|prisma)['\"]|require\(['\"](@prisma/client|prisma)['\"]\)" \
  apps packages 2>/dev/null \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs'; then
  echo "FAILED: Prisma import found in source"
  fail=1
fi

# 3) Prisma schema files / directory.
if find . -path '*/node_modules/*' -prune -o \( -name 'schema.prisma' -o -path '*/prisma/*.prisma' \) -print | grep -q .; then
  echo "FAILED: Prisma schema file found"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "Prisma is deferred and not allowed in this stack (Rule #28)."
  exit 1
fi

echo "PASSED: no Prisma dependency, import, or schema found"
