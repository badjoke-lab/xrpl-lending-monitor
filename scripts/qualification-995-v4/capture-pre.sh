#!/usr/bin/env bash
set -euo pipefail
test -n "$CLOUDFLARE_API_TOKEN"
test -n "$CLOUDFLARE_ACCOUNT_ID"

d1_query() {
  local sql="$1" output="$2" payload tmp code
  payload="$(mktemp)"
  jq -n --arg sql "$sql" '{sql:$sql}' > "$payload"
  for attempt in $(seq 1 6); do
    tmp="${output}.attempt-${attempt}.json"
    code="$(curl --silent --show-error --connect-timeout 10 --max-time 60 \
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

cf_get /workers/scripts/xrpl-lending-monitor/deployments pre-deployments.json
cf_get /workers/scripts/xrpl-lending-monitor/settings pre-settings.json
cf_get /workers/scripts/xrpl-lending-monitor/schedules pre-schedules.json
d1_query "SELECT * FROM fast_lane_shadow_base_binding WHERE network='devnet'" pre-base-binding.json
d1_query "SELECT epoch_id,base_snapshot_id,base_ledger_index,base_ledger_hash,overlay_ledger_index,overlay_ledger_hash FROM current_state_overlay_state WHERE network='devnet'" pre-overlay.json
d1_query "SELECT epoch_id,last_processed_ledger,last_processed_hash,latest_observed_ledger,latest_observed_hash,status FROM fast_lane_shadow_state WHERE network='devnet'" pre-fast.json
curl --fail-with-body --silent --show-error --connect-timeout 10 --max-time 45 --retry 3 --retry-all-errors \
  "${PRODUCTION_BASE}/api/status/history-source" > pre-history-source.json
curl --fail-with-body --silent --show-error --connect-timeout 10 --max-time 45 --retry 3 --retry-all-errors \
  "${PRODUCTION_BASE}/api/overview" > pre-overview.json

python - <<'PY'
import json
from pathlib import Path
def one(path):
    rows=json.loads(Path(path).read_text()).get('result',[{}])[0].get('results',[])
    return rows[0] if rows else None
dep=json.loads(Path('pre-deployments.json').read_text())['result']['deployments'][0]
versions=dep.get('versions') or []
assert len(versions)==1 and versions[0].get('percentage')==100
settings=json.loads(Path('pre-settings.json').read_text())
schedules=json.loads(Path('pre-schedules.json').read_text())
bindings=settings.get('result',{}).get('bindings',[])
def binding(name):
    values=[item.get('text',item.get('value')) for item in bindings if item.get('name')==name]
    return values[0] if values else None
identity={
    'deploymentId':dep.get('id'),
    'versionId':versions[0].get('version_id') or versions[0].get('id'),
    'deploymentCreatedOn':dep.get('created_on'),
    'appNetwork':binding('APP_NETWORK'),
    'mainnetEnabled':binding('MAINNET_ENABLED'),
    'maxLedgersPerRun':binding('FAST_LANE_MAX_LEDGERS_PER_RUN'),
    'queueBindings':[item for item in bindings if item.get('type')=='queue'],
    'schedules':schedules.get('result',{}).get('schedules',[]),
    'baseBinding':one('pre-base-binding.json'),
    'overlayBase':one('pre-overlay.json'),
    'fastEpoch':(one('pre-fast.json') or {}).get('epoch_id'),
    'historySource':json.loads(Path('pre-history-source.json').read_text()),
}
assert identity['deploymentId'] and identity['versionId']
assert identity['appNetwork']=='devnet' and identity['mainnetEnabled']=='false'
assert identity['maxLedgersPerRun']=='96'
assert len(identity['queueBindings'])==1
assert len(identity['schedules'])==1 and identity['schedules'][0].get('cron')=='*/5 * * * *'
Path('pre-identity.json').write_text(json.dumps(identity,indent=2)+'\n')
PY
