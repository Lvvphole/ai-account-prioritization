#!/usr/bin/env bash
set -euo pipefail

# Regenerate the Supabase TypeScript DB types from the live schema.
#
# SOURCE OF TRUTH is supabase/migrations. This script regenerates
# packages/supabase-client/src/database.types.ts via the Supabase CLI.
#
# Degrades gracefully: if the CLI is unavailable or no project is reachable, it
# keeps the committed (hand-authored, migration-mirroring) types and exits 0 so
# the gate stays runnable in environments without Supabase.

OUT="packages/supabase-client/src/database.types.ts"

if ! command -v supabase >/dev/null 2>&1; then
  echo "[supabase:types] Supabase CLI not found; keeping committed types at $OUT"
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if supabase gen types typescript --local >"$tmp" 2>/dev/null && [ -s "$tmp" ]; then
  mv "$tmp" "$OUT"
  echo "[supabase:types] regenerated $OUT from local database"
  exit 0
fi

if supabase gen types typescript --linked --schema public >"$tmp" 2>/dev/null && [ -s "$tmp" ]; then
  mv "$tmp" "$OUT"
  echo "[supabase:types] regenerated $OUT from linked project"
  exit 0
fi

echo "[supabase:types] no reachable Supabase project; keeping committed types at $OUT"
exit 0
