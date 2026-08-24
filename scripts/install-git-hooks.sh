#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  if [ -e .git ]; then
    echo "FAIL: Git metadata exists but the repository cannot be resolved."
    exit 1
  fi
  exit 0
fi

git config core.hooksPath .githooks
