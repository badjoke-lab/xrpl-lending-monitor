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
: "${EXPECTED_OLD_VERSION:?EXPECTED_OLD_VERSION is required}"
: "${EXPECTED_SUCCESSOR:?EXPECTED_SUCCESSOR is required}"
: "${EXPECTED_QUEUE_BYTES:?EXPECTED_QUEUE_BYTES is required}"
: "${EXPECTED_SUCCESSOR_CRON:?EXPECTED_SUCCESSOR_CRON is required}"

mkdir -p "$STATE_ROOT/preflight"
CURRENT_RESTART_PREFLIGHT_OUTPUT="$STATE_ROOT/preflight" python scripts/current-restart-preflight.py
result="$STATE_ROOT/preflight/result.json"
test -f "$result"
jq -e '
  .productionMutation == false
  and .safeToDeployRepair == true
  and .checks.devnetOnly == true
  and .checks.queueDeliveryPaused == true
  and .checks.schedulerStillDisabled == true
  and .checks.singleDeploymentVersion == true
  and .checks.noLiveUnstagedProcessingSlot == true
  and .checks.noStagedSuccessorSlot == true
  and .checks.noPendingQueueSlot == true
  and .checks.staleOverlayZero == true
  and .checks.foldableCompactZero == true
  and .checks.latestMetricCommittedAtCursor == true
  and .checks.replacementBaseReplaySafe == true
' "$result" >/dev/null

deployment="$(jq -r '.state.deployment.versions[0].version_id' "$result")"
test "$deployment" = "$EXPECTED_OLD_VERSION"

auth="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
qbase="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/queues/${QUEUE_ID}"
api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${DATABASE_ID}/query"

curl -fsS -H "$auth" "$qbase" > "$STATE_ROOT/queue.json"
jq -e '.success == true and .result.settings.delivery_paused == true' "$STATE_ROOT/queue.json" >/dev/null
curl -fsS -H "$auth" "$qbase/metrics" > "$STATE_ROOT/queue-metrics.json"
jq -e --argjson bytes "$EXPECTED_QUEUE_BYTES" '.success == true and (.result.backlog_count // -1) == 0 and (.result.backlog_bytes // -1) == $bytes' "$STATE_ROOT/queue-metrics.json" >/dev/null
curl -fsS -X POST -H "$auth" -H 'Content-Type: application/json' "$qbase/messages/peek" -d '{"batch_size":2}' > "$STATE_ROOT/queue-peek.json"
jq -e '.success == true and ((.result.messages // .result // []) | length) == 1' "$STATE_ROOT/queue-peek.json" >/dev/null

message_id="$(jq -r '(.result.messages // .result // [])[0].id' "$STATE_ROOT/queue-peek.json")"
message_ref="$(jq -r '(.result.messages // .result // [])[0].ref' "$STATE_ROOT/queue-peek.json")"
message_body="$(jq -r '(.result.messages // .result // [])[0].body' "$STATE_ROOT/queue-peek.json")"
test -n "$message_id" && test "$message_id" != null
test -n "$message_ref" && test "$message_ref" != null
test "$(printf '%s' "$message_body" | wc -c | tr -d ' ')" -eq "$EXPECTED_QUEUE_BYTES"
jq -e --argjson scheduled "$EXPECTED_SUCCESSOR" --arg cron "$EXPECTED_SUCCESSOR_CRON" '.scheduledTime == $scheduled and .cron == $cron' <<<"$message_body" >/dev/null
body_sha="$(printf '%s' "$message_body" | sha256sum | awk '{print $1}')"

query() {
  local sql="$1"
  curl -fsS -H "$auth" -H 'Content-Type: application/json' "$api" -d "$(jq -n --arg sql "$sql" '{sql:$sql}')"
}
query "SELECT scheduled_time,status,completed_at,next_scheduled_time,next_cron,error_message,updated_at FROM fast_lane_queue_slots WHERE status='completed' AND next_scheduled_time=${EXPECTED_SUCCESSOR}" > "$STATE_ROOT/predecessor.json"
jq -e --argjson successor "$EXPECTED_SUCCESSOR" --arg cron "$EXPECTED_SUCCESSOR_CRON" '
  .success == true
  and .result[0].success == true
  and (.result[0].results | length) == 1
  and .result[0].results[0].status == "completed"
  and .result[0].results[0].error_message == null
  and .result[0].results[0].next_scheduled_time == $successor
  and .result[0].results[0].next_cron == $cron
  and (.result[0].results[0].next_scheduled_time - .result[0].results[0].scheduled_time) == 14400000
' "$STATE_ROOT/predecessor.json" >/dev/null
query "SELECT COUNT(*) AS row_count FROM fast_lane_queue_slots WHERE scheduled_time=${EXPECTED_SUCCESSOR}" > "$STATE_ROOT/due-slot.json"
jq -e '.success == true and .result[0].success == true and .result[0].results[0].row_count == 0' "$STATE_ROOT/due-slot.json" >/dev/null

backlog_count="$(jq -r '.result.backlog_count' "$STATE_ROOT/queue-metrics.json")"
backlog_bytes="$(jq -r '.result.backlog_bytes' "$STATE_ROOT/queue-metrics.json")"
predecessor_scheduled="$(jq -r '.result[0].results[0].scheduled_time' "$STATE_ROOT/predecessor.json")"
predecessor_completed="$(jq -r '.result[0].results[0].completed_at' "$STATE_ROOT/predecessor.json")"
predecessor_updated="$(jq -r '.result[0].results[0].updated_at' "$STATE_ROOT/predecessor.json")"

jq -n -S \
  --arg sourceCommit "$(git rev-parse HEAD)" \
  --arg candidateCommit "$CUTOVER_DATA_COMMIT" \
  --arg deployment "$deployment" \
  --arg snapshot "$TARGET_SNAPSHOT" \
  --arg manifest "$TARGET_MANIFEST" \
  --arg fastHash "$(jq -r '.state.fastLane.last_processed_hash' "$result")" \
  --arg metricRunAt "$(jq -r '.state.latestMetric.run_at' "$result")" \
  --arg messageId "$message_id" \
  --arg messageRef "$message_ref" \
  --arg bodySha "$body_sha" \
  --arg successorCron "$EXPECTED_SUCCESSOR_CRON" \
  --arg predecessorCompletedAt "$predecessor_completed" \
  --arg predecessorUpdatedAt "$predecessor_updated" \
  --argjson target "$TARGET_LEDGER" \
  --argjson fastLedger "$(jq -r '.state.fastLane.last_processed_ledger' "$result")" \
  --argjson pending "$(jq -r '.state.queueSlotCounts.pending // 0' "$result")" \
  --argjson live "$(jq -r '.state.processingSlots.liveUnstaged' "$result")" \
  --argjson staged "$(jq -r '.state.processingSlots.stagedSuccessor' "$result")" \
  --argjson backlogCount "$backlog_count" \
  --argjson backlogBytes "$backlog_bytes" \
  --argjson successor "$EXPECTED_SUCCESSOR" \
  --argjson predecessorScheduled "$predecessor_scheduled" \
  '{sourceCommit:$sourceCommit,candidateCommit:$candidateCommit,deployment:$deployment,target:$target,snapshot:$snapshot,manifest:$manifest,fastLedger:$fastLedger,fastHash:$fastHash,metricRunAt:$metricRunAt,pending:$pending,live:$live,staged:$staged,queuePaused:true,backlogCount:$backlogCount,backlogBytes:$backlogBytes,visibleMessages:1,dueSuccessor:{scheduledTime:$successor,cron:$successorCron,messageId:$messageId,messageRef:$messageRef,bodySha256:$bodySha},predecessor:{scheduledTime:$predecessorScheduled,completedAt:$predecessorCompletedAt,updatedAt:$predecessorUpdatedAt,cadenceMs:14400000},schedules:0}' \
  > "$STATE_ROOT/stable-state.json"

digest="$(sha256sum "$STATE_ROOT/stable-state.json" | awk '{print $1}')"
jq -n -S \
  --arg deployment "$deployment" \
  --arg messageId "$message_id" \
  --arg messageRef "$message_ref" \
  --arg bodySha "$body_sha" \
  --arg digest "$digest" \
  --argjson successor "$EXPECTED_SUCCESSOR" \
  --argjson backlogBytes "$backlog_bytes" \
  '{deployment:$deployment,successorScheduledTime:$successor,backlogBytes:$backlogBytes,messageId:$messageId,messageRef:$messageRef,bodySha256:$bodySha,stateDigest:$digest,productionMutation:false}' \
  > "$STATE_ROOT/state-metadata.json"

cat "$STATE_ROOT/state-metadata.json"
