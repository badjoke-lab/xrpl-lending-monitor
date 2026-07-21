#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=.local/four-hour-history-maintenance
STATUS_PATH=.github/four-hour-history-maintenance-status.json
SOURCE_HISTORY=history-data
SOURCE_CURRENT=current-state-data
CANDIDATE_A_HISTORY=history-four-hour-a-data
CANDIDATE_A_CURRENT=current-state-four-hour-a-data
CANDIDATE_B_HISTORY=history-four-hour-b-data
CANDIDATE_B_CURRENT=current-state-four-hour-b-data
MAX_DELTA_LEDGERS=5000
MAX_LAG_LEDGERS=720
MAX_CYCLES=8
PRODUCTION_BASE=https://xrpl-lending-monitor.badjoke-lab.workers.dev
PHASE=initialize
mkdir -p "$ROOT"
: > "$ROOT/cycles.ndjson"

publish_status() {
  local state="$1" message="$2" child_run_id="${3:-}" api sha content
  jq -n \
    --arg state "$state" \
    --arg phase "$PHASE" \
    --arg message "$message" \
    --arg checkedAt "$(date -u +%FT%TZ)" \
    --arg runId "$GITHUB_RUN_ID" \
    --arg commit "$GITHUB_SHA" \
    --arg childRunId "$child_run_id" \
    '{state:$state,phase:$phase,message:$message,checkedAt:$checkedAt,runId:$runId,commit:$commit,childRunId:(if $childRunId == "" then null else $childRunId end),collectorCadence:"five_minutes",historyCadence:"four_hours"}' \
    > "$ROOT/status.json"
  if test -s "$ROOT/summary.json"; then
    jq -s '.[0] + {summary:.[1]}' "$ROOT/status.json" "$ROOT/summary.json" > "$ROOT/status-next.json"
    mv "$ROOT/status-next.json" "$ROOT/status.json"
  fi
  api="repos/${GITHUB_REPOSITORY}/contents/${STATUS_PATH}"
  sha="$(gh api "$api" --jq .sha 2>/dev/null || true)"
  content="$(base64 -w0 "$ROOT/status.json")"
  if test -n "$sha"; then
    gh api --method PUT "$api" -f message="ops: four-hour maintenance ${state}" -f content="$content" -f sha="$sha" -f branch=main >/dev/null
  else
    gh api --method PUT "$api" -f message="ops: four-hour maintenance ${state}" -f content="$content" -f branch=main >/dev/null
  fi
}

finish() {
  local code=$?
  trap - EXIT
  set +e
  if test "$code" -eq 0; then
    publish_status passed 'history/current-state maintenance completed'
  else
    publish_status failed "maintenance exited with code ${code}"
  fi
  exit "$code"
}
trap finish EXIT
publish_status running 'maintenance started'

fetch_json() {
  local branch="$1" path="$2" output="$3"
  gh api --method GET "repos/${GITHUB_REPOSITORY}/contents/${path}" -f ref="$branch" --jq .content \
    | tr -d '\n' | base64 --decode > "$output"
  jq -e . "$output" >/dev/null
}

live_head() {
  jq -n '{method:"ledger",params:[{ledger_index:"validated",transactions:false,expand:false}]}' \
    | curl --fail-with-body --silent --show-error --retry 5 --retry-all-errors \
        --connect-timeout 10 --max-time 45 \
        -H 'content-type: application/json' \
        --data-binary @- https://s.devnet.rippletest.net:51234/ \
    | jq -er '.result.ledger_index // .result.ledger.ledger_index'
}

cancel_obsolete_runs() {
  local workflow="$1" active
  gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100" > "$ROOT/${workflow}-runs.json"
  jq -r '.workflow_runs[] | select(.status != "completed") | .id' "$ROOT/${workflow}-runs.json" \
    | while IFS= read -r run_id; do
        test -n "$run_id" || continue
        gh api --method POST "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/cancel" >/dev/null 2>&1 \
          || gh api --method POST "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/force-cancel" >/dev/null 2>&1 \
          || true
      done
  for _ in $(seq 1 60); do
    active="$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100" --jq '[.workflow_runs[] | select(.status != "completed")] | length')"
    if test "$active" -eq 0; then
      return 0
    fi
    sleep 2
  done
  return 1
}

wait_new_run() {
  local workflow="$1" before_file="$2" run_id=''
  for _ in $(seq 1 120); do
    gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100" > "$ROOT/${workflow}-after.json"
    while IFS= read -r candidate; do
      if ! grep -Fxq "$candidate" "$before_file"; then
        run_id="$candidate"
        break
      fi
    done < <(jq -r '.workflow_runs | sort_by(.created_at) | reverse | .[].id' "$ROOT/${workflow}-after.json")
    if test -n "$run_id"; then
      break
    fi
    sleep 5
  done
  test -n "$run_id"
  printf '%s\n' "$run_id"
}

wait_success() {
  local run_id="$1" output="$2" status=''
  for _ in $(seq 1 720); do
    gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}" > "$output"
    status="$(jq -r .status "$output")"
    if test "$status" = completed; then
      break
    fi
    sleep 30
  done
  test "$(jq -r .status "$output")" = completed
  test "$(jq -r .conclusion "$output")" = success
}

PHASE=validate_boundary
jq -e '
  .triggers.crons == ["*/5 * * * *"]
  and .vars.APP_NETWORK == "devnet"
  and .vars.MAINNET_ENABLED == "false"
  and (.queues.producers | length) == 1
  and (.queues.consumers | length) == 1
  and .queues.consumers[0].max_batch_size == 1
  and .queues.consumers[0].max_concurrency == 1
' wrangler.jsonc >/dev/null
test -f .github/scripts/run-rolling-checkpoint-candidate.sh
bash -n .github/scripts/run-rolling-checkpoint-candidate.sh

PHASE=clear_obsolete_candidate_runs
cancel_obsolete_runs rolling-checkpoint-candidate.yml

source_history="$SOURCE_HISTORY"
source_current="$SOURCE_CURRENT"
final_history="$SOURCE_HISTORY"
final_current="$SOURCE_CURRENT"
final_lag=999999999

for cycle in $(seq 1 "$MAX_CYCLES"); do
  PHASE="cycle_${cycle}_read_source"
  fetch_json "$source_history" history/publication.json "$ROOT/source-history.json"
  fetch_json "$source_current" read-model/manifest.json "$ROOT/source-current.json"
  source_ledger="$(jq -r .endLedgerIndex "$ROOT/source-history.json")"
  source_hash="$(jq -r .endLedgerHash "$ROOT/source-history.json")"
  test "$(jq -r .complete "$ROOT/source-history.json")" = true
  test "$(jq -r .complete "$ROOT/source-current.json")" = true
  test "$source_ledger" = "$(jq -r .ledgerIndex "$ROOT/source-current.json")"
  test "$source_hash" = "$(jq -r .ledgerHash "$ROOT/source-current.json")"

  head="$(live_head)"
  final_lag=$((head - source_ledger))
  test "$final_lag" -ge 0
  if test "$final_lag" -le "$MAX_LAG_LEDGERS"; then
    break
  fi

  if test $((cycle % 2)) -eq 1; then
    output_history="$CANDIDATE_A_HISTORY"
    output_current="$CANDIDATE_A_CURRENT"
  else
    output_history="$CANDIDATE_B_HISTORY"
    output_current="$CANDIDATE_B_CURRENT"
  fi

  PHASE="cycle_${cycle}_dispatch_candidate"
  gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/rolling-checkpoint-candidate.yml/runs?event=workflow_dispatch&per_page=100" --jq '.workflow_runs[].id' > "$ROOT/candidate-before.txt"
  jq -n \
    --arg ref main \
    --arg sourceHistory "$source_history" \
    --arg sourceCurrent "$source_current" \
    --arg outputHistory "$output_history" \
    --arg outputCurrent "$output_current" \
    --arg maxDelta "$MAX_DELTA_LEDGERS" \
    '{ref:$ref,inputs:{source_history_branch:$sourceHistory,source_current_state_branch:$sourceCurrent,history_candidate_branch:$outputHistory,current_state_candidate_branch:$outputCurrent,max_delta_ledgers:$maxDelta,segment_ledgers:"500",read_window_size:"4"}}' \
    > "$ROOT/candidate-dispatch.json"
  gh api --method POST "repos/${GITHUB_REPOSITORY}/actions/workflows/rolling-checkpoint-candidate.yml/dispatches" --input "$ROOT/candidate-dispatch.json"
  child_run_id="$(wait_new_run rolling-checkpoint-candidate.yml "$ROOT/candidate-before.txt")"
  PHASE="cycle_${cycle}_candidate_${child_run_id}"
  publish_status running "candidate run ${child_run_id} is active" "$child_run_id"
  wait_success "$child_run_id" "$ROOT/candidate-run-${child_run_id}.json"

  PHASE="cycle_${cycle}_verify_candidate"
  fetch_json "$output_history" history/publication.json "$ROOT/output-history.json"
  fetch_json "$output_current" read-model/manifest.json "$ROOT/output-current.json"
  output_ledger="$(jq -r .endLedgerIndex "$ROOT/output-history.json")"
  output_hash="$(jq -r .endLedgerHash "$ROOT/output-history.json")"
  test "$output_ledger" -gt "$source_ledger"
  test "$output_ledger" -le $((source_ledger + MAX_DELTA_LEDGERS))
  test "$output_ledger" = "$(jq -r .ledgerIndex "$ROOT/output-current.json")"
  test "$output_hash" = "$(jq -r .ledgerHash "$ROOT/output-current.json")"
  head="$(live_head)"
  final_lag=$((head - output_ledger))
  jq -n \
    --argjson cycle "$cycle" \
    --argjson runId "$child_run_id" \
    --argjson sourceLedger "$source_ledger" \
    --argjson outputLedger "$output_ledger" \
    --argjson lag "$final_lag" \
    '{cycle:$cycle,runId:$runId,sourceLedger:$sourceLedger,outputLedger:$outputLedger,lagLedgers:$lag}' \
    >> "$ROOT/cycles.ndjson"
  jq -s '{cycles:.}' "$ROOT/cycles.ndjson" > "$ROOT/summary.json"
  publish_status running "candidate cycle ${cycle} completed" "$child_run_id"

  source_history="$output_history"
  source_current="$output_current"
  final_history="$output_history"
  final_current="$output_current"
done

test "$final_lag" -le "$MAX_LAG_LEDGERS"

if test "$final_history" != "$SOURCE_HISTORY" || test "$final_current" != "$SOURCE_CURRENT"; then
  PHASE=clear_obsolete_cutover_runs
  cancel_obsolete_runs rolling-checkpoint-live-cutover.yml
  PHASE=dispatch_cutover
  gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/rolling-checkpoint-live-cutover.yml/runs?event=workflow_dispatch&per_page=100" --jq '.workflow_runs[].id' > "$ROOT/cutover-before.txt"
  jq -n \
    --arg ref main \
    --arg history "$final_history" \
    --arg current "$final_current" \
    '{ref:$ref,inputs:{history_candidate_branch:$history,current_state_candidate_branch:$current,confirm_production_write:true}}' \
    > "$ROOT/cutover-dispatch.json"
  gh api --method POST "repos/${GITHUB_REPOSITORY}/actions/workflows/rolling-checkpoint-live-cutover.yml/dispatches" --input "$ROOT/cutover-dispatch.json"
  cutover_run_id="$(wait_new_run rolling-checkpoint-live-cutover.yml "$ROOT/cutover-before.txt")"
  PHASE="cutover_${cutover_run_id}"
  publish_status running "cutover run ${cutover_run_id} is active" "$cutover_run_id"
  wait_success "$cutover_run_id" "$ROOT/cutover-run-${cutover_run_id}.json"
fi

PHASE=verify_production
fetch_json "$SOURCE_HISTORY" history/publication.json "$ROOT/production-history.json"
fetch_json "$SOURCE_CURRENT" read-model/manifest.json "$ROOT/production-current.json"
production_ledger="$(jq -r .endLedgerIndex "$ROOT/production-history.json")"
production_hash="$(jq -r .endLedgerHash "$ROOT/production-history.json")"
test "$production_ledger" = "$(jq -r .ledgerIndex "$ROOT/production-current.json")"
test "$production_hash" = "$(jq -r .ledgerHash "$ROOT/production-current.json")"
head="$(live_head)"
production_lag=$((head - production_ledger))
test "$production_lag" -le "$MAX_LAG_LEDGERS"
curl --fail-with-body --silent --show-error --retry 3 "$PRODUCTION_BASE/api/overview" > "$ROOT/overview.json"
curl --fail-with-body --silent --show-error --retry 3 "$PRODUCTION_BASE/api/status/fast-lane-diff?limit=500" > "$ROOT/diff.json"
jq -e '.status == "ok" and .passed == true' "$ROOT/diff.json" >/dev/null
jq -n \
  --arg checkedAt "$(date -u +%FT%TZ)" \
  --argjson ledger "$production_ledger" \
  --arg hash "$production_hash" \
  --argjson lag "$production_lag" \
  --slurpfile cycles "$ROOT/cycles.ndjson" \
  '{checkedAt:$checkedAt,passed:true,production:{ledgerIndex:$ledger,ledgerHash:$hash,lagLedgers:$lag},cycles:$cycles,collectorCadence:"five_minutes",historyCadence:"four_hours"}' \
  > "$ROOT/summary.json"
