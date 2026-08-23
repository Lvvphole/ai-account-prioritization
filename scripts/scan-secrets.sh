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
#
# FAIL CLOSED. Every git query below feeds a pass/fail decision, so a git *error* must
# never be read as "nothing found". Discarding a failure here turns the scanner into
# one that reports PASSED without inspecting anything — worse than having no scanner,
# because it looks like coverage.

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

# Filters a newline-separated file list down to disallowed .env paths. grep exiting 1
# here means "no matches", which is the normal clean result, not an error.
select_env_files() {
  printf '%s\n' "$1" | grep -E "$ENV_RE" | grep -vE '\.env\.example$' || true
}

scan_snapshot() {
  echo "==> Scanning tracked files for committed secrets"

  local files committed_env matches
  if ! files="$(git ls-files 2>/dev/null)"; then
    report "cannot list tracked files; refusing to report a clean scan:" "git ls-files failed"
    return 0
  fi

  committed_env="$(select_env_files "$files")"
  [ -n "$committed_env" ] &&
    report "committed .env file(s) (only .env.example is allowed):" "$committed_env"

  # `-e` is required, not stylistic: SECRET_RE starts with `-----BEGIN`, so without
  # it grep parses the pattern as an option, exits with a usage error, and — with
  # stderr discarded — this scan reported PASSED while matching nothing at all.
  #
  # xargs returns 123 whenever any grep child exits 1, which is the normal no-match
  # case, so a grep error cannot be distinguished here. The guard that is available
  # — that the file list resolved — is applied above.
  matches="$(printf '%s\n' "$files" | grep -vE 'pnpm-lock\.yaml$' | xargs -r grep -nEI -e "$SECRET_RE" 2>/dev/null || true)"
  [ -n "$matches" ] && report "potential committed secret(s):" "$matches"

  return 0
}

# Scans each commit's own tree, so a secret introduced and later deleted is still
# caught. `git grep -e` is required: the pattern starts with `-----BEGIN` and would
# otherwise be parsed as an option, making every scan error out and find nothing.
scan_range() {
  local commits commit tree committed_env matches grep_status

  # An unresolvable range — a remote sha absent from a stale clone, a bad argument —
  # must block the push. Treating it as an empty commit list would pass unscanned
  # history through while printing "no outgoing commits".
  if ! commits="$(git rev-list "$@" 2>/dev/null)"; then
    echo "FAIL: cannot resolve the outgoing commit range; refusing to pass unscanned history:"
    git rev-list "$@" 2>&1 | head -3
    fail=1
    return 0
  fi

  if [ -z "$commits" ]; then
    echo "==> No outgoing commits to scan"
    return 0
  fi

  echo "==> Scanning $(printf '%s\n' "$commits" | wc -l | tr -d ' ') outgoing commit(s) for secrets"

  for commit in $commits; do
    if ! tree="$(git ls-tree -r --name-only "$commit" 2>/dev/null)"; then
      report "cannot read the tree of commit ${commit:0:12}:" "git ls-tree failed"
      continue
    fi

    committed_env="$(select_env_files "$tree")"
    [ -n "$committed_env" ] &&
      report "committed .env file(s) in ${commit:0:12} (only .env.example is allowed):" "$committed_env"

    # git grep: 0 = matches found, 1 = no matches, anything higher = error.
    # Only exit 1 is a clean result; an error must not read as "no secrets".
    matches="$(git grep -nEI -e "$SECRET_RE" "$commit" -- . ':(exclude)pnpm-lock.yaml' 2>/dev/null)"
    grep_status=$?
    if [ "$grep_status" -gt 1 ]; then
      report "secret scan errored on commit ${commit:0:12}:" "git grep exited $grep_status"
      continue
    fi

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
