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

# Object IDs define the content boundary. Path annotations from rev-list are not a
# complete path inventory because one blob can be reachable through many names.
if ! object_ids="$(git rev-list --objects --no-object-names "${revisions[@]}" 2>/dev/null)"; then
  echo "FAIL: cannot resolve the selected Git object set."
  exit 1
fi

if [ -z "$object_ids" ]; then
  echo "PASSED: selected Git object set is empty."
  exit 0
fi

if ! object_types="$(printf '%s\n' "$object_ids" | git cat-file --batch-check='%(objectname) %(objecttype)' 2>/dev/null)"; then
  echo "FAIL: cannot classify the selected Git objects."
  exit 1
fi

tree_ids=()
while read -r object_id object_type; do
  case "$object_type" in
    blob|commit|tag) ;;
    tree)
      tree_ids+=("$object_id")
      ;;
    *)
      echo "FAIL: selected Git object ${object_id:0:12} has an unreadable or unsupported type."
      exit 1
      ;;
  esac
done <<< "$object_types"

# Each selected tree object owns its immediate entry names. Inspecting every tree
# entry preserves path identity even when different paths share the same blob.
env_found=0
if [ "${#tree_ids[@]}" -gt 0 ]; then
  if ! tree_entries_file="$(mktemp)"; then
    echo "FAIL: cannot create temporary storage for tree path verification."
    exit 1
  fi
  trap 'rm -f "$tree_entries_file"' EXIT

  for tree_id in "${tree_ids[@]}"; do
    if ! git ls-tree -z --name-only "$tree_id" >"$tree_entries_file" 2>/dev/null; then
      echo "FAIL: cannot inspect the selected Git tree paths."
      exit 1
    fi

    while IFS= read -r -d '' entry_name; do
      case "$entry_name" in
        .env|.env.*)
          if [ "$entry_name" != ".env.example" ]; then
            env_found=1
            break 2
          fi
          ;;
      esac
    done <"$tree_entries_file"
  done
fi

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
