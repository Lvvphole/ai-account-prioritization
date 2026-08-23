#!/usr/bin/env bash
set -uo pipefail

# Self-contained secret scan (Rule #30: no secrets in repo).
# High-precision patterns only, to stay false-positive-free on a placeholder repo.
#
# Two modes:
#   scan-secrets.sh                            snapshot: tracked files at the current tip.
#   scan-secrets.sh --range <rev-list args>    history: every commit the range names.
#
# The snapshot mode is what `verify:production` uses — Tier 3 verifies one committed
# tree, so the tip is the right subject. It is NOT sufficient before a push: a branch
# that adds a secret in one commit and removes it in a later one passes a tip scan
# while pushing both commits, secret included. The pre-push hook therefore uses range
# mode over the commits actually being sent. Patterns live here once, in both modes.

# Secret material: private keys, AWS access-key ids, JWTs.
SECRET_RE='-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
# Only .env.example may be committed; never a real .env.
ENV_RE='(^|/)\.env($|\.)'

fail=0

report() {
  echo "FAIL: $1"
  echo "$2" | head -10
  fail=1
}

scan_snapshot() {
  echo "==> Scanning tracked files for committed secrets"

  local committed_env matches
  committed_env="$(git ls-files | grep -E "$ENV_RE" | grep -vE '\.env\.example$' || true)"
  [ -n "$committed_env" ] &&
    report "committed .env file(s) (only .env.example is allowed):" "$committed_env"

  matches="$(git ls-files | grep -vE 'pnpm-lock\.yaml$' | xargs -r grep -nEI "$SECRET_RE" 2>/dev/null || true)"
  [ -n "$matches" ] && report "potential committed secret(s):" "$matches"

  return 0
}

# Scans each commit's own tree, so a secret introduced and later deleted is still
# caught. `git grep -e` is required: the pattern starts with `-----BEGIN` and would
# otherwise be parsed as an option, making every scan error out and find nothing.
scan_range() {
  local commits commit committed_env matches
  commits="$(git rev-list "$@" 2>/dev/null || true)"

  if [ -z "$commits" ]; then
    echo "==> No outgoing commits to scan"
    return 0
  fi

  echo "==> Scanning $(printf '%s\n' "$commits" | wc -l | tr -d ' ') outgoing commit(s) for secrets"

  for commit in $commits; do
    committed_env="$(git ls-tree -r --name-only "$commit" | grep -E "$ENV_RE" | grep -vE '\.env\.example$' || true)"
    [ -n "$committed_env" ] &&
      report "committed .env file(s) in ${commit:0:12} (only .env.example is allowed):" "$committed_env"

    matches="$(git grep -nEI -e "$SECRET_RE" "$commit" -- . ':(exclude)pnpm-lock.yaml' 2>/dev/null || true)"
    [ -n "$matches" ] && report "potential secret(s) in commit ${commit:0:12}:" "$matches"
  done

  return 0
}

if [ "${1:-}" = "--range" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    echo "FAIL: --range requires at least one git rev-list argument"
    exit 1
  fi
  scan_range "$@"
else
  scan_snapshot
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "PASSED: no committed secrets detected."
