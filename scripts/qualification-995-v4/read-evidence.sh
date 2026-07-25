#!/usr/bin/env bash
set -euo pipefail

d1_query() {
  local sql="$1" output="$2" payload tmp code
  payload="$(mktemp)"
  jq -n --arg sql "$sql" '{sql:$sql}' > "$payload"
  for attempt in $(seq 1 6); do
    tmp="${output}.attempt-${attempt}.json"
    code="$(curl --silent --show-error --connect-timeout 10 --max-time 75 \
      -o "$tmp" -w '%{http_code}' \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H 'Content-Type: application/json' --data-binary @"$payload" \
      "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${DATABASE_ID}/query" || true)"
    if [ "$code" = 200 ] && jq -e '.success==true and .result[0].success==true' "$tmp" >/dev/null 2>&1; then
      mv "$tmp" "$output"
      rm -f "$payload"
      return 0
    fi
    sleep "$((attempt * 2))"
  done
  cat "${output}.attempt-6.json" >&2 || true
  rm -f "$payload"
  return 1
}

cf_get() {
  curl --fail-with-body --silent --show-error --connect-timeout 10 --max-time 45 \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}$1" > "$2"
}

d1_query "SELECT scheduled_time,message_id,status,started_at,completed_at,next_scheduled_time,error_message,updated_at FROM fast_lane_queue_slots WHERE scheduled_time BETWEEN ${START_MS} AND ${END_MS} ORDER BY scheduled_time" slots.json
d1_query "SELECT s.scheduled_time,s.started_at AS slot_started_at,s.completed_at AS slot_completed_at,m.run_at,m.status AS metric_status,m.start_ledger_index,m.end_ledger_index,m.latest_observed_ledger,m.lag_ledgers,m.ledgers_processed,m.persistence_rows_read,m.persistence_rows_written,m.error_message AS metric_error FROM fast_lane_queue_slots s LEFT JOIN fast_lane_shadow_run_metrics m ON m.network='devnet' AND m.run_at>=s.started_at AND m.run_at<=s.completed_at WHERE s.scheduled_time BETWEEN ${START_MS} AND ${END_MS} ORDER BY s.scheduled_time,m.run_at" slot-metrics.json
d1_query "SELECT s.scheduled_time,s.started_at AS slot_started_at,s.completed_at AS slot_completed_at,h.start_ledger_index,h.end_ledger_index,h.end_ledger_hash,h.created_at,LENGTH(h.bundle_json) AS encoded_bytes,h.bundle_json FROM fast_lane_queue_slots s JOIN fast_lane_history_windows h ON h.network='devnet' AND h.created_at>=s.started_at AND h.created_at<=s.completed_at WHERE s.scheduled_time BETWEEN ${START_MS} AND ${END_MS} ORDER BY h.start_ledger_index,h.end_ledger_index,h.created_at" slot-windows.json
d1_query "SELECT epoch_id,last_processed_ledger,last_processed_hash,latest_observed_ledger,latest_observed_hash,status,(latest_observed_ledger-last_processed_ledger) AS lag_ledgers,updated_at FROM fast_lane_shadow_state WHERE network='devnet'" final-fast.json
d1_query "SELECT epoch_id,base_snapshot_id,base_ledger_index,base_ledger_hash,overlay_ledger_index,overlay_ledger_hash,updated_at FROM current_state_overlay_state WHERE network='devnet'" final-overlay.json
d1_query "SELECT * FROM fast_lane_shadow_base_binding WHERE network='devnet'" post-base-binding.json
d1_query "SELECT COUNT(*) AS compact_rows FROM fast_lane_shadow_objects_compact WHERE network='devnet'" compact.json
d1_query "SELECT COUNT(*) AS foldable_rows FROM fast_lane_shadow_objects_compact c WHERE c.network='devnet' AND EXISTS (SELECT 1 FROM fast_lane_shadow_base_binding b JOIN current_state_overlay_objects o ON o.network='devnet' AND o.epoch_id=b.base_epoch_id AND o.base_snapshot_id=b.base_snapshot_id AND o.object_type=c.object_type AND o.object_id=c.object_id WHERE b.network='devnet' AND (o.source_ledger_index>c.source_ledger_index OR (o.source_ledger_index=c.source_ledger_index AND o.source_transaction_index>=c.source_transaction_index)))" foldable.json
d1_query "SELECT COUNT(*) AS stale_rows FROM current_state_overlay_objects o WHERE o.network='devnet' AND NOT EXISTS (SELECT 1 FROM fast_lane_shadow_base_binding b WHERE b.network=o.network AND b.base_epoch_id=o.epoch_id AND b.base_snapshot_id=o.base_snapshot_id)" stale.json
d1_query "SELECT COUNT(*) AS retained_queue_slots,MIN(scheduled_time) AS first_slot,MAX(scheduled_time) AS last_slot FROM fast_lane_queue_slots WHERE status='completed'" queue-retention.json
d1_query "SELECT COUNT(*) AS retained_metrics,MIN(run_at) AS first_metric,MAX(run_at) AS last_metric FROM fast_lane_shadow_run_metrics WHERE network='devnet'" metric-retention.json
d1_query "SELECT COUNT(*) AS retained_windows,MIN(start_ledger_index) AS first_ledger,MAX(end_ledger_index) AS last_ledger,COALESCE(SUM(LENGTH(bundle_json)),0) AS payload_bytes FROM fast_lane_history_windows WHERE network='devnet'" window-retention.json

cf_get /workers/scripts/xrpl-lending-monitor/deployments post-deployments.json
cf_get /workers/scripts/xrpl-lending-monitor/settings post-settings.json
cf_get /workers/scripts/xrpl-lending-monitor/schedules post-schedules.json

for name_path in \
  'overview:/api/overview' \
  'history-source:/api/status/history-source' \
  'fast-lane-diff:/api/status/fast-lane-diff?limit=1' \
  'replacement-base:/api/status/replacement-base-rebase' \
  'pre-soak-readiness:/api/status/pre-soak-readiness'; do
  name="${name_path%%:*}"
  path="${name_path#*:}"
  code="$(curl --silent --show-error --connect-timeout 10 --max-time 60 --retry 3 --retry-all-errors \
    -o "${name}.json" -w '%{http_code}' "${PRODUCTION_BASE}${path}")"
  printf '%s\n' "$code" > "${name}.code"
done
