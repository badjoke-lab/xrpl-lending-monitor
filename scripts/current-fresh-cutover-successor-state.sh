#!/usr/bin/env bash
set -euo pipefail

: "${STATE_ROOT:?STATE_ROOT is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${QUEUE_ID:?QUEUE_ID is required}"
: "${DATABASE_ID:?DATABASE_ID is required}"
: "${CUTOVER_DATA_COMMIT:?CUTOVER_DATA_COMMIT is required}"
: "${TARGET_LEDGER:?TARGET_LEDGER is required}"
: "${TARGET_SNAPSHOT:?TARGET_SNAPSHOT is required}"
: "${TARGET_MANIFEST:?TARGET_MANIFEST is required}"

mkdir -p "$STATE_ROOT/preflight"
set +e
CURRENT_RESTART_PREFLIGHT_OUTPUT="$STATE_ROOT/preflight" python scripts/current-restart-preflight.py
preflight_rc=$?
set -e
result="$STATE_ROOT/preflight/result.json"
test -f "$result"
test "$(jq -r '.productionMutation' "$result")" = false
test "$preflight_rc" -eq 1
jq -e '
  .failures == ["queueDeliveryPaused"]
  and .checks.devnetOnly == true
  and .checks.currentMaxLedgersBound == true
  and .checks.singleQueueBinding == true
  and .checks.schedulerStillDisabled == true
  and .checks.singleDeploymentVersion == true
  and .checks.baseBindingAligned == true
  and .checks.fastCursorAtOrAfterBase == true
  and .checks.noLiveUnstagedProcessingSlot == true
  and .checks.noStagedSuccessorSlot == true
  and .checks.noPendingQueueSlot == true
  and .checks.staleOverlayZero == true
  and .checks.foldableCompactZero == true
  and .checks.compactRowsDoNotExceedFastCursor == true
  and .checks.latestMetricCommittedAtCursor == true
  and .checks.replacementBaseReplaySafe == true
  and .state.queue.deliveryPaused == false
' "$result" >/dev/null

auth="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
qbase="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/queues/${QUEUE_ID}"
curl -fsS -H "$auth" "$qbase/metrics" > "$STATE_ROOT/queue-metrics.json"
curl -fsS -X POST -H "$auth" -H 'Content-Type: application/json' "$qbase/messages/peek" -d '{"batch_size":2}' > "$STATE_ROOT/queue-peek.json"
jq -e '.success == true and (.result.backlog_count // -1) == 0 and (.result.backlog_bytes // 0) > 0' "$STATE_ROOT/queue-metrics.json" >/dev/null
jq -e '.success == true and ((.result.messages // .result // []) | length) == 0' "$STATE_ROOT/queue-peek.json" >/dev/null

api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${DATABASE_ID}/query"
sql="SELECT scheduled_time,status,started_at,completed_at,next_scheduled_time,error_message,updated_at FROM fast_lane_queue_slots WHERE status='completed' AND next_scheduled_time IS NOT NULL AND next_scheduled_time > unixepoch('now')*1000 ORDER BY next_scheduled_time"
curl -fsS -H "$auth" -H 'Content-Type: application/json' "$api" -d "$(jq -n --arg sql "$sql" '{sql:$sql}')" > "$STATE_ROOT/future-successor.json"
jq -e '
  .success == true
  and .result[0].success == true
  and (.result[0].results | length) == 1
  and .result[0].results[0].status == "completed"
  and .result[0].results[0].error_message == null
  and (.result[0].results[0].scheduled_time | type) == "number"
  and (.result[0].results[0].next_scheduled_time | type) == "number"
  and (.result[0].results[0].next_scheduled_time - .result[0].results[0].scheduled_time) == 14400000
' "$STATE_ROOT/future-successor.json" >/dev/null

successor_next="$(jq -r '.result[0].results[0].next_scheduled_time' "$STATE_ROOT/future-successor.json")"
now_ms="$(( $(date -u +%s) * 1000 ))"
# Leave at least 15 minutes before the known delayed delivery can become eligible.
test "$successor_next" -ge "$((now_ms + 900000))"

deployment="$(jq -r '.state.deployment.versions[0].version_id' "$result")"
test -n "$deployment"
backlog_count="$(jq -r '.result.backlog_count' "$STATE_ROOT/queue-metrics.json")"
backlog_bytes="$(jq -r '.result.backlog_bytes' "$STATE_ROOT/queue-metrics.json")"

jq -n -S \
  --arg sourceCommit "$(git rev-parse HEAD)" \
  --arg candidateCommit "$CUTOVER_DATA_COMMIT" \
  --arg deployment "$deployment" \
  --arg snapshot "$TARGET_SNAPSHOT" \
  --arg manifest "$TARGET_MANIFEST" \
  --arg fastHash "$(jq -r '.state.fastLane.last_processed_hash' "$result")" \
  --arg metricRunAt "$(jq -r '.state.latestMetric.run_at' "$result")" \
  --arg successorStatus "$(jq -r '.result[0].results[0].status' "$STATE_ROOT/future-successor.json")" \
  --arg successorCompletedAt "$(jq -r '.result[0].results[0].completed_at' "$STATE_ROOT/future-successor.json")" \
  --arg successorUpdatedAt "$(jq -r '.result[0].results[0].updated_at' "$STATE_ROOT/future-successor.json")" \
  --argjson target "$TARGET_LEDGER" \
  --argjson fastLedger "$(jq -r '.state.fastLane.last_processed_ledger' "$result")" \
  --argjson pending "$(jq -r '.state.queueSlotCounts.pending // 0' "$result")" \
  --argjson live "$(jq -r '.state.processingSlots.liveUnstaged' "$result")" \
  --argjson staged "$(jq -r '.state.processingSlots.stagedSuccessor' "$result")" \
  --argjson backlogCount "$backlog_count" \
  --argjson backlogBytes "$backlog_bytes" \
  --argjson successorScheduled "$(jq -r '.result[0].results[0].scheduled_time' "$STATE_ROOT/future-successor.json")" \
  --argjson successorNext "$successor_next" \
  '{sourceCommit:$sourceCommit,candidateCommit:$candidateCommit,deployment:$deployment,target:$target,snapshot:$snapshot,manifest:$manifest,fastLedger:$fastLedger,fastHash:$fastHash,metricRunAt:$metricRunAt,pending:$pending,live:$live,staged:$staged,queuePaused:false,backlogCount:$backlogCount,backlogBytes:$backlogBytes,messagesVisible:0,schedules:0,delayedSuccessor:{status:$successorStatus,scheduledTime:$successorScheduled,nextScheduledTime:$successorNext,completedAt:$successorCompletedAt,updatedAt:$successorUpdatedAt,cadenceMs:14400000}}' \
  > "$STATE_ROOT/stable-state.json"

jq -n -S \
  --arg deployment "$deployment" \
  --argjson successorNext "$successor_next" \
  --argjson backlogBytes "$backlog_bytes" \
  --arg digest "$(sha256sum "$STATE_ROOT/stable-state.json" | awk '{print $1}')" \
  '{deployment:$deployment,successorNextScheduledTime:$successorNext,backlogBytes:$backlogBytes,stateDigest:$digest,productionMutation:false}' \
  > "$STATE_ROOT/state-metadata.json"

cat "$STATE_ROOT/state-metadata.json"
