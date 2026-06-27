#!/usr/bin/env bash
set -uo pipefail

# Self-contained secret scan over TRACKED files (Rule #30: no secrets in repo).
# High-precision patterns only, to stay false-positive-free on a placeholder repo.
echo "==> Scanning tracked files for committed secrets"

fail=0

# 1) Only .env.example may be committed; never a real .env.
committed_env="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.env\.example$' || true)"
if [ -n "$committed_env" ]; then
  echo "FAIL: committed .env file(s) (only .env.example is allowed):"
  echo "$committed_env"
  fail=1
fi

# 2) Secret material: private keys, AWS access-key ids, JWTs.
SECRET_RE='-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
matches="$(git ls-files | grep -vE 'pnpm-lock\.yaml$' | xargs -r grep -nEI "$SECRET_RE" 2>/dev/null || true)"
if [ -n "$matches" ]; then
  echo "FAIL: potential committed secret(s):"
  echo "$matches" | head -10
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "PASSED: no committed secrets detected."
