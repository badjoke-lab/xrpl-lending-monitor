#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${CHECKPOINT_EVIDENCE_DIR:-current-state-checkpoint-evidence}"
REPOSITORY="${REPOSITORY:-badjoke-lab/xrpl-lending-monitor}"
CANDIDATE_A="${CANDIDATE_A:-current-state-four-hour-a-data}"
CANDIDATE_B="${CANDIDATE_B:-current-state-four-hour-b-data}"
PRODUCTION_CURRENT="${PRODUCTION_CURRENT:-current-state-data}"
STATUS_PATH=".github/four-hour-history-maintenance-status.json"

mkdir -p "$ROOT"
PHASE=initialize
candidate_run_id=""
cutover_run_id=""
source_branch=""
output_branch=""
source_ledger=-1
target_ledger=-1

status_json() {
  local state="$1"
  local message="$2"
  jq -n \
    --arg state "$state" \
    --arg phase "$PHASE" \
    --arg message "$message" \
    --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg runId "$GITHUB_RUN_ID" \
    --arg commit "$GITHUB_SHA" \
    --arg candidateRunId "$candidate_run_id" \
    --arg cutoverRunId "$cutover_run_id" \
    --arg sourceBranch "$source_branch" \
    --arg outputBranch "$output_branch" \
    --argjson sourceLedger "$source_ledger" \
    --argjson targetLedger "$target_ledger" '
    {
      state:$state,
      phase:$phase,
      message:$message,
      checkedAt:$checkedAt,
      runId:$runId,
      commit:$commit,
      candidateRunId:(if $candidateRunId == "" then null else $candidateRunId end),
      cutoverRunId:(if $cutoverRunId == "" then null else $cutoverRunId end),
      sourceBranch:(if $sourceBranch == "" then null else $sourceBranch end),
      outputBranch:(if $outputBranch == "" then null else $outputBranch end),
      sourceLedger:(if $sourceLedger < 0 then null else $sourceLedger end),
      targetLedger:(if $targetLedger < 0 then null else $targetLedger end),
      currentStateCadence:"five_minutes",
      checkpointCadence:"four_hours",
      historyMode:"archived_plus_forward_only"
    }
  ' > "$ROOT/status.json"
}

publish_status() {
  local state="$1"
  local message="$2"
  status_json "$state" "$message"
  local api_path="repos/$REPOSITORY/contents/$STATUS_PATH"
  local content existing_sha
  content="$(base64 -w0 "$ROOT/status.json")"
  for attempt in $(seq 1 10); do
    existing_sha="$(gh api "$api_path" --jq .sha 2>/dev/null || true)"
    if test -n "$existing_sha"; then
      if gh api --method PUT "$api_path" \
        -f message="ops: update current-state checkpoint status" \
        -f content="$content" \
        -f sha="$existing_sha" >/dev/null; then
        return 0
      fi
    elif gh api --method PUT "$api_path" \
      -f message="ops: create current-state checkpoint status" \
      -f content="$content" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

on_exit() {
  local code=$?
  trap - EXIT
  if test "$code" -eq 0; then
    publish_status success "current-state checkpoint completed" || true
  else
    publish_status failed "current-state checkpoint exited with code $code" || true
  fi
  exit "$code"
}
trap on_exit EXIT
publish_status running "current-state checkpoint started"

fetch_json() {
  local branch="$1"
  local path="$2"
  local output="$3"
  local encoded
  encoded="$(gh api "repos/$REPOSITORY/contents/$path?ref=$branch" --jq .content 2>/dev/null || true)"
  test -n "$encoded" || return 1
  printf '%s' "$encoded" | tr -d '\n' | base64 -d > "$output"
  jq -e . "$output" >/dev/null
}

wait_new_run() {
  local workflow="$1"
  local before="$2"
  local output="$3"
  for _ in $(seq 1 60); do
    gh api "repos/$REPOSITORY/actions/workflows/$workflow/runs?event=workflow_dispatch&per_page=50" \
      --jq '.workflow_runs[].id' > "$output.all"
    comm -23 <(sort -n "$output.all") <(sort -n "$before") | tail -n 1 > "$output"
    if test -s "$output"; then return 0; fi
    sleep 2
  done
  return 1
}

wait_success() {
  local run_id="$1"
  local output="$2"
  for _ in $(seq 1 720); do
    gh api "repos/$REPOSITORY/actions/runs/$run_id" > "$output"
    local status conclusion
    status="$(jq -r .status "$output")"
    if test "$status" = completed; then
      conclusion="$(jq -r .conclusion "$output")"
      test "$conclusion" = success
      return
    fi
    sleep 15
  done
  return 1
}

PHASE=select_source
for branch in "$PRODUCTION_CURRENT" "$CANDIDATE_A" "$CANDIDATE_B"; do
  key="${branch//[^A-Za-z0-9]/_}"
  manifest="$ROOT/$key-manifest.json"
  rolling="$ROOT/$key-rolling.json"
  if fetch_json "$branch" read-model/manifest.json "$manifest" \
    && fetch_json "$branch" rolling-base/manifest.json "$rolling"; then
    ledger="$(jq -r '.ledgerIndex // -1' "$manifest")"
    ledger_hash="$(jq -r '.ledgerHash // empty' "$manifest")"
    if test "$(jq -r '.complete // false' "$manifest")" = true \
      && test "$(jq -r '.complete // false' "$rolling")" = true \
      && test "$ledger" = "$(jq -r '.ledgerIndex // -2' "$rolling")" \
      && test "$ledger_hash" = "$(jq -r '.ledgerHash // empty' "$rolling")" \
      && test "$(jq -r '.segmentCount // 0' "$rolling")" -eq 64 \
      && test "$ledger" -gt "$source_ledger"; then
      source_branch="$branch"
      source_ledger="$ledger"
    fi
  fi
done
test -n "$source_branch"

if test "$source_branch" = "$CANDIDATE_A"; then
  output_branch="$CANDIDATE_B"
else
  output_branch="$CANDIDATE_A"
fi
jq -n --arg source "$source_branch" --arg output "$output_branch" --argjson ledger "$source_ledger" \
  '{sourceBranch:$source,outputBranch:$output,sourceLedger:$ledger}' > "$ROOT/selection.json"
publish_status running "selected newest verified rolling base"

PHASE=dispatch_candidate
gh api "repos/$REPOSITORY/actions/workflows/rolling-checkpoint-candidate.yml/runs?event=workflow_dispatch&per_page=50" \
  --jq '.workflow_runs[].id' > "$ROOT/candidate-before.txt"
jq -n --arg ref main --arg source "$source_branch" --arg output "$output_branch" \
  '{ref:$ref,inputs:{source_current_state_branch:$source,current_state_candidate_branch:$output}}' \
  > "$ROOT/candidate-dispatch.json"
gh api --method POST "repos/$REPOSITORY/actions/workflows/rolling-checkpoint-candidate.yml/dispatches" \
  --input "$ROOT/candidate-dispatch.json"
wait_new_run rolling-checkpoint-candidate.yml "$ROOT/candidate-before.txt" "$ROOT/candidate-run-id.txt"
candidate_run_id="$(cat "$ROOT/candidate-run-id.txt")"
PHASE="candidate_${candidate_run_id}"
publish_status running "candidate run is active"
wait_success "$candidate_run_id" "$ROOT/candidate-run.json"

PHASE=verify_candidate
fetch_json "$output_branch" read-model/manifest.json "$ROOT/output-manifest.json"
fetch_json "$output_branch" rolling-read-model-summary.json "$ROOT/output-summary.json"
target_ledger="$(jq -r .ledgerIndex "$ROOT/output-manifest.json")"
target_hash="$(jq -r .ledgerHash "$ROOT/output-manifest.json")"
test "$target_ledger" -ge "$source_ledger"
jq -e --argjson ledger "$target_ledger" --arg hash "$target_hash" '
  .mode == "d1-overlay-fold"
  and .target.ledgerIndex == $ledger
  and .target.ledgerHash == $hash
  and .rollingBase.segmentCount == 64
' "$ROOT/output-summary.json" >/dev/null
publish_status running "candidate checkpoint verified"

PHASE=dispatch_cutover
gh api "repos/$REPOSITORY/actions/workflows/rolling-checkpoint-live-cutover.yml/runs?event=workflow_dispatch&per_page=50" \
  --jq '.workflow_runs[].id' > "$ROOT/cutover-before.txt"
jq -n --arg ref main --arg branch "$output_branch" \
  '{ref:$ref,inputs:{current_state_candidate_branch:$branch,confirm_production_write:"true"}}' \
  > "$ROOT/cutover-dispatch.json"
gh api --method POST "repos/$REPOSITORY/actions/workflows/rolling-checkpoint-live-cutover.yml/dispatches" \
  --input "$ROOT/cutover-dispatch.json"
wait_new_run rolling-checkpoint-live-cutover.yml "$ROOT/cutover-before.txt" "$ROOT/cutover-run-id.txt"
cutover_run_id="$(cat "$ROOT/cutover-run-id.txt")"
PHASE="cutover_${cutover_run_id}"
publish_status running "current-state cutover run is active"
wait_success "$cutover_run_id" "$ROOT/cutover-run.json"

PHASE=verify_production
fetch_json "$PRODUCTION_CURRENT" read-model/manifest.json "$ROOT/production-final.json"
jq -e --argjson ledger "$target_ledger" --arg hash "$target_hash" '
  .complete == true and .ledgerIndex == $ledger and .ledgerHash == $hash
' "$ROOT/production-final.json" >/dev/null
jq -n \
  --slurpfile selection "$ROOT/selection.json" \
  --slurpfile target "$ROOT/output-manifest.json" \
  --slurpfile production "$ROOT/production-final.json" \
  --arg candidateRunId "$candidate_run_id" \
  --arg cutoverRunId "$cutover_run_id" '
  {
    passed:true,
    selection:$selection[0],
    target:$target[0],
    production:$production[0],
    candidateRunId:$candidateRunId,
    cutoverRunId:$cutoverRunId,
    currentStateCadence:"five_minutes",
    checkpointCadence:"four_hours",
    historyMode:"archived_plus_forward_only"
  }
' > "$ROOT/evidence.json"
PHASE=completed
