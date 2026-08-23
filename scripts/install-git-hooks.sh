#!/usr/bin/env bash
# Points git at the repository's checked-in hooks. Run by the root `prepare`
# script, so a fresh clone gets .githooks/pre-push from `pnpm install` with no
# manual step.
#
# Exactly one failure is tolerated: there being no git repository to configure.
# `.dockerignore` excludes `.git`, and infra/docker/Dockerfile.* run
# `pnpm install` over that context, so `prepare` legitimately runs where no
# repository exists — and git itself may not be installed there either.
#
# Every other failure is real and must surface. A blanket `|| true` would report
# success while leaving core.hooksPath unset, so pushes would silently skip the
# secret, lint, and typecheck prechecks while the setup looked like it worked.
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "install-git-hooks: git is not available; skipping hook installation"
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "install-git-hooks: no git repository here; skipping hook installation"
  exit 0
fi

# Inside a checkout this must succeed. A stale .git/config.lock or read-only
# repository metadata is a genuine failure, not something to swallow.
git config core.hooksPath .githooks
echo "install-git-hooks: core.hooksPath -> .githooks"
