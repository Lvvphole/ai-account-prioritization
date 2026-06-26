#!/usr/bin/env bash
set -euo pipefail

# Handoff script (reference). Builds, verifies, and pushes the production monorepo.
# Adjust PROJECT_DIR / BRANCH_NAME to your environment before running.

PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
REPO_URL="${REPO_URL:-https://github.com/Lvvphole/ai-account-prioritization}"
BRANCH_NAME="${BRANCH_NAME:-feat/production-monorepo-agent-runtime}"

echo "==> Entering project"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

echo "==> Initializing git repo if needed"
if [ ! -d ".git" ]; then
  git init
  git remote add origin "$REPO_URL"
fi

echo "==> Ensuring origin remote"
git remote set-url origin "$REPO_URL"

echo "==> Creating branch"
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git checkout "$BRANCH_NAME"
else
  git checkout -b "$BRANCH_NAME"
fi

echo "==> Installing dependencies"
pnpm install

echo "==> Running full production verification (build, typecheck, evals, security, observability, secrets)"
pnpm verify:production

echo "==> Checking formatting conflicts"
git diff --check

echo "==> Staging files"
git add .

echo "==> Committing"
git commit -m "Build production monorepo for AI account prioritization agent" || echo "No changes to commit."

echo "==> Pushing branch"
git push -u origin "$BRANCH_NAME"

echo "==> Done. Open PR from $BRANCH_NAME into main."
