#!/usr/bin/env bash
set -uo pipefail

SECRET_RE='-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'

if [ "${1:-}" = "--range" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    echo "FAIL: --range requires at least one revision argument."
    exit 1
  fi
  revisions=("$@")
else
  if [ "$#" -ne 0 ]; then
    echo "FAIL: unexpected scanner arguments."
    exit 1
  fi
  revisions=(HEAD)
fi

if ! shallow="$(git rev-parse --is-shallow-repository 2>/dev/null)"; then
  echo "FAIL: cannot determine repository history state."
  exit 1
fi
if [ "$shallow" = "true" ]; then
  echo "FAIL: repository history is shallow; refusing an incomplete secret scan."
  exit 1
fi

if ! objects="$(git rev-list --objects "${revisions[@]}" 2>/dev/null)"; then
  echo "FAIL: cannot resolve the selected Git object set."
  exit 1
fi

if [ -z "$objects" ]; then
  echo "PASSED: selected Git object set is empty."
  exit 0
fi

object_ids="$(printf '%s\n' "$objects" | awk '{print $1}')"
if ! object_types="$(printf '%s\n' "$object_ids" | git cat-file --batch-check='%(objectname) %(objecttype)' 2>/dev/null)"; then
  echo "FAIL: cannot classify the selected Git objects."
  exit 1
fi

while read -r object_id object_type; do
  case "$object_type" in
    blob|tree|commit|tag) ;;
    *)
      echo "FAIL: selected Git object ${object_id:0:12} has an unreadable or unsupported type."
      exit 1
      ;;
  esac
done <<< "$object_types"

env_found=0
while IFS= read -r line; do
  object_id="${line%% *}"
  [ "$line" = "$object_id" ] && continue
  path="${line#* }"
  base="${path##*/}"
  case "$base" in
    .env|.env.*)
      if [ "$base" != ".env.example" ]; then
        env_found=1
        break
      fi
      ;;
  esac
done <<< "$objects"

if [ "$env_found" -ne 0 ]; then
  echo "FAIL: selected Git objects contain a prohibited .env entry."
fi

printf '%s\n' "$object_ids" | git cat-file --batch 2>/dev/null | grep -aEq -e "$SECRET_RE"
pipeline_status=("${PIPESTATUS[@]}")
grep_status="${pipeline_status[2]}"
cat_file_status="${pipeline_status[1]}"

secret_found=0
scan_error=0
if [ "$grep_status" -eq 0 ]; then
  secret_found=1
elif [ "$grep_status" -gt 1 ] || [ "$cat_file_status" -ne 0 ]; then
  scan_error=1
fi

if [ "$scan_error" -ne 0 ]; then
  echo "FAIL: cannot safely scan the selected Git object content."
  exit 1
fi

if [ "$secret_found" -ne 0 ]; then
  echo "FAIL: selected Git objects contain potential secret material [redacted]."
fi

if [ "$env_found" -ne 0 ] || [ "$secret_found" -ne 0 ]; then
  exit 1
fi

echo "PASSED: selected Git objects contain no detected secrets."
