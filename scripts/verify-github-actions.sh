#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ZIZMOR_VERSION="1.29.0"
ZIZMOR_IMAGE_DIGEST="sha256:863026d54f91271b10b60b67ad8054cb37120167e162482597db102b3026a284"
ZIZMOR_IMAGE="ghcr.io/zizmorcore/zizmor:${ZIZMOR_VERSION}@${ZIZMOR_IMAGE_DIGEST}"
RULESET_ID="persona=auditor;online_audits=false;config=default"
SUPPRESSIONS_ID="none"
RULESET_HASH="$(printf '%s' "$RULESET_ID" | sha256sum | awk '{print $1}')"
SUPPRESSIONS_HASH="$(printf '%s' "$SUPPRESSIONS_ID" | sha256sum | awk '{print $1}')"

echo "==> Audit GitHub Actions workflows"
echo "scanner_id=zizmor"
echo "scanner_version=$ZIZMOR_VERSION"
echo "scanner_image_digest=$ZIZMOR_IMAGE_DIGEST"
echo "ruleset_hash=$RULESET_HASH"
echo "suppressions_hash=$SUPPRESSIONS_HASH"

docker run --rm \
  --volume "$ROOT:/workspace:ro" \
  --workdir /workspace \
  "$ZIZMOR_IMAGE" \
  --persona=auditor \
  --no-online-audits \
  .

echo "PASSED: GitHub Actions workflow audit."
