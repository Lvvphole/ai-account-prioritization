#!/usr/bin/env bash
# Minimal entrypoint: fail fast, then exec the container command (CMD/args).
set -euo pipefail
exec "$@"
