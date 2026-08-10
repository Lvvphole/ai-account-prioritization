#!/usr/bin/env bash
set -euo pipefail

manifest="p4-output/evidence-manifest.json"
artifact_prefix="p4-qualification-transfer-${GITHUB_RUN_ID}-"

transfer_artifact="$(
  gh api \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2026-03-10' \
    "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts?per_page=100" \
    --jq "[.artifacts[] | select((.expired == false) and (.name | startswith(\"${artifact_prefix}\")))] | sort_by(.created_at) | last | .name"
)"
test -n "$transfer_artifact"
test "$transfer_artifact" != "null"

mkdir -p p4-output
gh run download "$GITHUB_RUN_ID" \
  --repo "$GITHUB_REPOSITORY" \
  --name "$transfer_artifact" \
  --dir p4-output

test -f "$manifest"
jq -e '
  .contractVersion == "p4-qualification-evidence-v1" and
  (.workflow.runId | type == "string") and
  (.workflow.producerRunAttempt | type == "number") and
  (.workflow.qualificationSourceSha | type == "string") and
  (.decision.owner | type == "string") and
  (.decision.ref | type == "string") and
  (.qualification.outcome == "success" or .qualification.outcome == "failure") and
  (.qualification.policyFileSha256 | test("^[a-f0-9]{64}$")) and
  (.invocations.startedCount | type == "number") and
  (.invocations.completedCount | type == "number") and
  (.invocations.invalidRecordCount | type == "number") and
  (.artifacts.report.present | type == "boolean") and
  (.artifacts.admission.present | type == "boolean") and
  (.artifacts.admission.publishEligible | type == "boolean")
' "$manifest" >/dev/null

producer_run_id="$(jq -er '.workflow.runId' "$manifest")"
producer_attempt="$(jq -er '.workflow.producerRunAttempt' "$manifest")"
source_sha="$(jq -er '.workflow.qualificationSourceSha' "$manifest")"
release_tag="$(jq -er '.release.tag' "$manifest")"
recorded_transfer="$(jq -er '.release.transferArtifact' "$manifest")"
decision_owner="$(jq -er '.decision.owner' "$manifest")"
decision_ref="$(jq -er '.decision.ref' "$manifest")"
qualification_outcome="$(jq -er '.qualification.outcome' "$manifest")"
invocation_started="$(jq -er '.invocations.startedCount' "$manifest")"
invocation_completed="$(jq -er '.invocations.completedCount' "$manifest")"
invalid_invocations="$(jq -er '.invocations.invalidRecordCount' "$manifest")"

test "$producer_run_id" = "$GITHUB_RUN_ID"
test "$source_sha" = "$P4_EXPECTED_SOURCE_SHA"
test "$recorded_transfer" = "$transfer_artifact"
test "$release_tag" = "p4-qualification-${GITHUB_RUN_ID}-${producer_attempt}"

verify_asset_hash() {
  local asset_path="$1"
  local expected_hash="$2"
  case "$asset_path" in
    p4-output/*) ;;
    *) return 1 ;;
  esac
  test -f "$asset_path"
  test "$(sha256sum "$asset_path" | awk '{print $1}')" = "$expected_hash"
}

report_present="$(jq -r '.artifacts.report.present' "$manifest")"
admission_present="$(jq -r '.artifacts.admission.present' "$manifest")"
admission_publish="$(jq -r '.artifacts.admission.publishEligible' "$manifest")"
invocation_present="$(jq -r '.invocations.present' "$manifest")"
assets=("$manifest")

if [ "$invocation_present" = "true" ]; then
  invocation_path="$(jq -er '.invocations.path' "$manifest")"
  invocation_hash="$(jq -er '.invocations.sha256' "$manifest")"
  verify_asset_hash "$invocation_path" "$invocation_hash"
  assets+=("$invocation_path")
fi

if [ "$report_present" = "true" ]; then
  report_path="$(jq -er '.artifacts.report.path' "$manifest")"
  report_hash="$(jq -er '.artifacts.report.sha256' "$manifest")"
  verify_asset_hash "$report_path" "$report_hash"
  assets+=("$report_path")
fi

if [ "$admission_publish" = "true" ]; then
  test "$qualification_outcome" = "success"
  test "$admission_present" = "true"
  admission_path="$(jq -er '.artifacts.admission.path' "$manifest")"
  admission_hash="$(jq -er '.artifacts.admission.sha256' "$manifest")"
  verify_asset_hash "$admission_path" "$admission_hash"
  assets+=("$admission_path")
fi

if [ "$qualification_outcome" = "success" ]; then
  test "$report_present" = "true"
  test "$admission_publish" = "true"
  test "$invocation_present" = "true"
  test "$invocation_started" -gt 0
  test "$invocation_started" -eq "$invocation_completed"
  test "$invalid_invocations" -eq 0
else
  test "$admission_publish" = "false"
fi

release_state=""
if release_state="$(
  gh release view "$release_tag" \
    --repo "$GITHUB_REPOSITORY" \
    --json isDraft,isImmutable,targetCommitish \
    --jq '[.isDraft, .isImmutable, .targetCommitish] | @tsv' \
    2>/dev/null
)"; then
  read -r release_is_draft release_is_immutable release_target <<< "$release_state"
  test "$release_target" = "$P4_EXPECTED_SOURCE_SHA"
else
  gh release create "$release_tag" \
    --repo "$GITHUB_REPOSITORY" \
    --target "$P4_EXPECTED_SOURCE_SHA" \
    --title "P4 qualification ${GITHUB_RUN_ID}/${producer_attempt}" \
    --notes "Decision owner: ${decision_owner}\nDecision ref: ${decision_ref}\nQualification source: ${P4_EXPECTED_SOURCE_SHA}\nProducer attempt: ${producer_attempt}" \
    --draft
  release_is_draft=true
  release_is_immutable=false
fi

if [ "$release_is_draft" = "true" ]; then
  gh release upload "$release_tag" "${assets[@]}" \
    --repo "$GITHUB_REPOSITORY" \
    --clobber
  gh release edit "$release_tag" --repo "$GITHUB_REPOSITORY" --draft=false
else
  test "$release_is_immutable" = "true"
fi

gh release verify "$release_tag" --repo "$GITHUB_REPOSITORY"
for asset in "${assets[@]}"; do
  gh release verify-asset "$release_tag" "$asset" --repo "$GITHUB_REPOSITORY"
done

test "$qualification_outcome" = "success"
