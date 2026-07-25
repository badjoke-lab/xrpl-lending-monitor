#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${CUTOVER_EVIDENCE_DIR:-current-state-cutover-evidence}"
PRODUCTION_BASE="${PRODUCTION_BASE:-https://xrpl-lending-monitor.badjoke-lab.workers.dev}"
PRODUCTION_CURRENT_STATE_BRANCH="${PRODUCTION_CURRENT_STATE_BRANCH:-current-state-data}"
CURRENT_CANDIDATE_DIR="${CURRENT_CANDIDATE_DIR:-.local/current-candidate}"
PRODUCTION_CURRENT_DIR="${PRODUCTION_CURRENT_DIR:-.local/production-current-before}"
D1_DATABASE_ID="${D1_DATABASE_ID:-bebc2c68-03d2-4a1c-98a7-46b34ee4e25d}"

required() {
  local name="$1"
  test -n "${!name:-}" || { echo "${name} is required" >&2; exit 2; }
}

for name in CURRENT_STATE_CANDIDATE_BRANCH CONFIRM_PRODUCTION_WRITE CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  required "$name"
done
test "$CONFIRM_PRODUCTION_WRITE" = true
git check-ref-format --branch "$CURRENT_STATE_CANDIDATE_BRANCH" >/dev/null
test "$CURRENT_STATE_CANDIDATE_BRANCH" != "$PRODUCTION_CURRENT_STATE_BRANCH"
mkdir -p "$ROOT"

remote_sha() {
  git ls-remote origin "refs/heads/$1" | awk '{print $1}'
}

CURRENT_MANIFEST="$CURRENT_CANDIDATE_DIR/read-model/manifest.json"
CURRENT_CHANNEL="$CURRENT_CANDIDATE_DIR/channel.json"
CURRENT_SUMMARY="$CURRENT_CANDIDATE_DIR/rolling-read-model-summary.json"
PRODUCTION_MANIFEST="$PRODUCTION_CURRENT_DIR/read-model/manifest.json"
for file in "$CURRENT_MANIFEST" "$CURRENT_CHANNEL" "$CURRENT_SUMMARY" "$PRODUCTION_MANIFEST"; do
  test -s "$file"
  jq -e . "$file" >/dev/null
done

CURRENT_CANDIDATE_SHA="$(git -C "$CURRENT_CANDIDATE_DIR" rev-parse HEAD)"
test "$CURRENT_CANDIDATE_SHA" = "$(remote_sha "$CURRENT_STATE_CANDIDATE_BRANCH")"
TARGET_LEDGER_INDEX="$(jq -r .ledgerIndex "$CURRENT_MANIFEST")"
TARGET_LEDGER_HASH="$(jq -r .ledgerHash "$CURRENT_MANIFEST")"
TARGET_SNAPSHOT_ID="$(jq -r .snapshotId "$CURRENT_MANIFEST")"
TARGET_EPOCH_ID="$(jq -r .epochId "$CURRENT_MANIFEST")"
TARGET_CURRENT_MANIFEST_SHA="$(jq -r .manifestSha256 "$CURRENT_MANIFEST")"
PRODUCTION_LEDGER_INDEX="$(jq -r .ledgerIndex "$PRODUCTION_MANIFEST")"
PROD_CURRENT_SHA_BEFORE="$(remote_sha "$PRODUCTION_CURRENT_STATE_BRANCH")"

printf '%s' "$CURRENT_CANDIDATE_SHA" | grep -Eq '^[a-f0-9]{40}$'
printf '%s' "$TARGET_LEDGER_INDEX" | grep -Eq '^[0-9]+$'
printf '%s' "$TARGET_LEDGER_HASH" | grep -Eq '^[A-F0-9]{64}$'
printf '%s' "$TARGET_CURRENT_MANIFEST_SHA" | grep -Eq '^[a-f0-9]{64}$'
printf '%s' "$PROD_CURRENT_SHA_BEFORE" | grep -Eq '^[a-f0-9]{40}$'
test "$TARGET_EPOCH_ID" = devnet-3371675
test "$TARGET_LEDGER_INDEX" -ge "$PRODUCTION_LEDGER_INDEX"

jq -e \
  --argjson ledger "$TARGET_LEDGER_INDEX" \
  --arg hash "$TARGET_LEDGER_HASH" \
  --arg snapshot "$TARGET_SNAPSHOT_ID" \
  --arg manifest "$TARGET_CURRENT_MANIFEST_SHA" '
  .complete == true
  and .ledgerIndex == $ledger
  and .ledgerHash == $hash
  and .snapshotId == $snapshot
  and .manifestSha256 == $manifest
' "$CURRENT_MANIFEST" >/dev/null
jq -e --arg snapshot "$TARGET_SNAPSHOT_ID" --arg manifest "$TARGET_CURRENT_MANIFEST_SHA" '
  .active.snapshotId == $snapshot
  and .active.manifestSha256 == $manifest
  and (.active.dataCommitSha | test("^[a-f0-9]{40}$"))
' "$CURRENT_CHANNEL" >/dev/null
jq -e \
  --argjson ledger "$TARGET_LEDGER_INDEX" \
  --arg hash "$TARGET_LEDGER_HASH" \
  --arg snapshot "$TARGET_SNAPSHOT_ID" \
  --arg manifest "$TARGET_CURRENT_MANIFEST_SHA" '
  .mode == "d1-overlay-fold"
  and .target.ledgerIndex == $ledger
  and .target.ledgerHash == $hash
  and .target.snapshotId == $snapshot
  and .target.manifestSha256 == $manifest
  and .rollingBase.segmentCount == 64
' "$CURRENT_SUMMARY" >/dev/null

PRODUCTION_LEDGER_HASH="$(jq -r .ledgerHash "$PRODUCTION_MANIFEST")"
if test "$TARGET_LEDGER_INDEX" = "$PRODUCTION_LEDGER_INDEX" \
  && test "$TARGET_LEDGER_HASH" = "$PRODUCTION_LEDGER_HASH"; then
  cp "$PRODUCTION_MANIFEST" "$ROOT/production-current.json"
  jq -n \
    --argjson ledgerIndex "$TARGET_LEDGER_INDEX" \
    --arg ledgerHash "$TARGET_LEDGER_HASH" \
    --arg snapshotId "$TARGET_SNAPSHOT_ID" \
    '{passed:true,noOp:true,target:{ledgerIndex:$ledgerIndex,ledgerHash:$ledgerHash,snapshotId:$snapshotId},schedule:"*/5 * * * *",mainnetEnabled:false}' \
    > "$ROOT/evidence.json"
  exit 0
fi

jq -n \
  --arg currentStateBranch "$CURRENT_STATE_CANDIDATE_BRANCH" \
  --arg currentStateCommitSha "$CURRENT_CANDIDATE_SHA" \
  --argjson previousLedgerIndex "$PRODUCTION_LEDGER_INDEX" \
  --argjson ledgerIndex "$TARGET_LEDGER_INDEX" \
  --arg ledgerHash "$TARGET_LEDGER_HASH" \
  --arg snapshotId "$TARGET_SNAPSHOT_ID" \
  --arg epochId "$TARGET_EPOCH_ID" \
  --arg currentManifestSha256 "$TARGET_CURRENT_MANIFEST_SHA" '
  {
    currentStateBranch:$currentStateBranch,
    currentStateCommitSha:$currentStateCommitSha,
    previousLedgerIndex:$previousLedgerIndex,
    target:{ledgerIndex:$ledgerIndex,ledgerHash:$ledgerHash,snapshotId:$snapshotId,epochId:$epochId,currentManifestSha256:$currentManifestSha256}
  }
' > "$ROOT/target-identity.json"
printf '%s\n' "$PROD_CURRENT_SHA_BEFORE" > "$ROOT/production-current-before.txt"

TODAY="$(date -u +%F)"
read -r -d '' GRAPHQL_QUERY <<'GRAPHQL' || true
query D1Usage($accountTag:string!,$start:Date,$end:Date,$databaseId:string){viewer{accounts(filter:{accountTag:$accountTag}){d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:$start,date_leq:$end,databaseId:$databaseId}){sum{rowsRead rowsWritten}}}}}
GRAPHQL
jq -n \
  --arg query "$GRAPHQL_QUERY" \
  --arg accountTag "$CLOUDFLARE_ACCOUNT_ID" \
  --arg start "$TODAY" \
  --arg end "$TODAY" \
  --arg databaseId "$D1_DATABASE_ID" \
  '{query:$query,variables:{accountTag:$accountTag,start:$start,end:$end,databaseId:$databaseId}}' \
  > "$ROOT/d1-request.json"
curl --fail-with-body --silent --show-error --retry 3 -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'content-type: application/json' \
  --data @"$ROOT/d1-request.json" \
  https://api.cloudflare.com/client/v4/graphql \
  > "$ROOT/d1-response.json"
jq -e '((.errors // []) | length) == 0 and (.data.viewer.accounts | length) > 0' "$ROOT/d1-response.json" >/dev/null
jq '[.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups[]] as $groups | {rows_read:([$groups[].sum.rowsRead // 0] | add // 0),rows_written:([$groups[].sum.rowsWritten // 0] | add // 0)}' \
  "$ROOT/d1-response.json" > "$ROOT/d1-summary.json"
jq -e '.rows_read >= 0 and .rows_written >= 0' "$ROOT/d1-summary.json" >/dev/null

CUTOVER_TOKEN="$(openssl rand -hex 32)"
export TARGET_LEDGER_INDEX TARGET_LEDGER_HASH TARGET_SNAPSHOT_ID TARGET_EPOCH_ID CUTOVER_TOKEN CURRENT_STATE_CANDIDATE_BRANCH PRODUCTION_CURRENT_STATE_BRANCH
python3 - <<'PY'
import copy
import json
import os
from pathlib import Path

source = json.loads(Path('wrangler.jsonc').read_text())
assert source['triggers']['crons'] == ['*/5 * * * *']
assert source['vars']['APP_NETWORK'] == 'devnet'
assert source['vars']['MAINNET_ENABLED'] == 'false'

def target_config(branch: str, token: str | None):
    cfg = copy.deepcopy(source)
    vars_ = cfg['vars']
    vars_['CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID'] = os.environ['TARGET_SNAPSHOT_ID']
    vars_['CURRENT_STATE_REPLACEMENT_GITHUB_BRANCH'] = branch
    vars_['REPLACEMENT_BASE_REBASE_ENABLED'] = 'true'
    vars_['REPLACEMENT_BASE_EPOCH_ID'] = os.environ['TARGET_EPOCH_ID']
    vars_['REPLACEMENT_BASE_SNAPSHOT_ID'] = os.environ['TARGET_SNAPSHOT_ID']
    vars_['REPLACEMENT_BASE_LEDGER_INDEX'] = os.environ['TARGET_LEDGER_INDEX']
    vars_['REPLACEMENT_BASE_LEDGER_HASH'] = os.environ['TARGET_LEDGER_HASH']
    if token is None:
        vars_.pop('REPLACEMENT_BASE_CUTOVER_TOKEN', None)
    else:
        vars_['REPLACEMENT_BASE_CUTOVER_TOKEN'] = token
    return cfg

cutover = target_config(os.environ['CURRENT_STATE_CANDIDATE_BRANCH'], os.environ['CUTOVER_TOKEN'])
final = target_config(os.environ['PRODUCTION_CURRENT_STATE_BRANCH'], None)
Path('wrangler.current-state-cutover.jsonc').write_text(json.dumps(cutover, indent=2) + '\n')
Path('wrangler.current-state-final.jsonc').write_text(json.dumps(final, indent=2) + '\n')
PY

cleanup() {
  local exit_code=$?
  set +e
  if test -f "$ROOT/cutover-applied"; then
    remote_current="$(remote_sha "$PRODUCTION_CURRENT_STATE_BRANCH")"
    if test "$remote_current" != "$CURRENT_CANDIDATE_SHA" && test "$remote_current" = "$PROD_CURRENT_SHA_BEFORE"; then
      git fetch origin "refs/heads/$CURRENT_STATE_CANDIDATE_BRANCH:refs/remotes/origin/$CURRENT_STATE_CANDIDATE_BRANCH"
      git push --force-with-lease="refs/heads/$PRODUCTION_CURRENT_STATE_BRANCH:$PROD_CURRENT_SHA_BEFORE" \
        origin "$CURRENT_CANDIDATE_SHA:refs/heads/$PRODUCTION_CURRENT_STATE_BRANCH"
    fi
    if ! test -f "$ROOT/final-config-deployed"; then
      pnpm exec wrangler deploy --config wrangler.current-state-final.jsonc
    fi
  elif test -f "$ROOT/cutover-config-deployed"; then
    pnpm exec wrangler deploy --config wrangler.jsonc
  fi
  exit "$exit_code"
}
trap cleanup EXIT

pnpm exec wrangler deploy --config wrangler.current-state-cutover.jsonc
touch "$ROOT/cutover-config-deployed"

binding_ready=false
for attempt in $(seq 1 30); do
  status="$(curl --silent --show-error --retry 2 -o "$ROOT/readiness-$attempt.json" -w '%{http_code}' -X POST "$PRODUCTION_BASE/api/operator/replacement-base-cutover")"
  printf '%s\n' "$status" > "$ROOT/readiness-$attempt.status"
  if test "$status" = 403; then
    binding_ready=true
    break
  fi
  sleep 3
done
test "$binding_ready" = true

for attempt in $(seq 1 12); do
  status="$(curl --silent --show-error --retry 2 -o "$ROOT/cutover-response-$attempt.json" -w '%{http_code}' \
    -X POST -H "x-replacement-base-cutover-token: $CUTOVER_TOKEN" \
    "$PRODUCTION_BASE/api/operator/replacement-base-cutover")"
  if test "$status" = 200 && jq -e --arg snapshot "$TARGET_SNAPSHOT_ID" --argjson ledger "$TARGET_LEDGER_INDEX" '
    .status == "cutover_applied"
    and .target.snapshotId == $snapshot
    and .target.ledgerIndex == $ledger
  ' "$ROOT/cutover-response-$attempt.json" >/dev/null 2>&1; then
    touch "$ROOT/cutover-applied"
    break
  fi
  sleep 5
done
test -f "$ROOT/cutover-applied"

git fetch origin "refs/heads/$CURRENT_STATE_CANDIDATE_BRANCH:refs/remotes/origin/$CURRENT_STATE_CANDIDATE_BRANCH"
git push --force-with-lease="refs/heads/$PRODUCTION_CURRENT_STATE_BRANCH:$PROD_CURRENT_SHA_BEFORE" \
  origin "$CURRENT_CANDIDATE_SHA:refs/heads/$PRODUCTION_CURRENT_STATE_BRANCH"
test "$(remote_sha "$PRODUCTION_CURRENT_STATE_BRANCH")" = "$CURRENT_CANDIDATE_SHA"
touch "$ROOT/current-promoted"

pnpm exec wrangler deploy --config wrangler.current-state-final.jsonc
touch "$ROOT/final-config-deployed"

curl --fail-with-body --silent --show-error --retry 3 \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/xrpl-lending-monitor/schedules" \
  > "$ROOT/schedule-final.json"
jq -e '.result.schedules | length == 1 and .[0].cron == "*/5 * * * *"' "$ROOT/schedule-final.json" >/dev/null

verified=false
for _ in $(seq 1 90); do
  curl --fail-with-body --silent --show-error --retry 2 "$PRODUCTION_BASE/api/overview" > "$ROOT/overview-final.json" || true
  curl --fail-with-body --silent --show-error --retry 2 "$PRODUCTION_BASE/api/status/replacement-base-rebase" > "$ROOT/rebase-final.json" || true
  curl --fail-with-body --silent --show-error --retry 2 "$PRODUCTION_BASE/api/status/fast-lane-diff?limit=500" > "$ROOT/diff-final.json" || true
  if jq -e --arg snapshot "$TARGET_SNAPSHOT_ID" --argjson ledger "$TARGET_LEDGER_INDEX" '
      .status == "replayed" and .target.snapshotId == $snapshot and .target.ledgerIndex == $ledger
    ' "$ROOT/rebase-final.json" >/dev/null 2>&1 \
    && jq -e --argjson base "$TARGET_LEDGER_INDEX" '
      .current_state_watermark.ledger_index >= $base
      and .current_state_watermark.source == "fast_lane"
      and .counts_watermark.ledger_index >= $base
    ' "$ROOT/overview-final.json" >/dev/null 2>&1 \
    && jq -e '.status == "ok" and .passed == true and .sample.exactProjectionMismatches == 0' "$ROOT/diff-final.json" >/dev/null 2>&1; then
    verified=true
    break
  fi
  sleep 10
done
test "$verified" = true

sync_main_config() {
  local attempt
  for attempt in $(seq 1 5); do
    git fetch origin main
    git reset --hard origin/main
    python3 - <<'PY'
import json
from pathlib import Path

latest = json.loads(Path('wrangler.jsonc').read_text())
target = json.loads(Path('wrangler.current-state-final.jsonc').read_text())
assert latest['triggers']['crons'] == ['*/5 * * * *']
assert latest['vars']['APP_NETWORK'] == 'devnet'
assert latest['vars']['MAINNET_ENABLED'] == 'false'
keys = [
    'CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID',
    'CURRENT_STATE_REPLACEMENT_GITHUB_BRANCH',
    'REPLACEMENT_BASE_REBASE_ENABLED',
    'REPLACEMENT_BASE_EPOCH_ID',
    'REPLACEMENT_BASE_SNAPSHOT_ID',
    'REPLACEMENT_BASE_LEDGER_INDEX',
    'REPLACEMENT_BASE_LEDGER_HASH',
]
for key in keys:
    latest['vars'][key] = target['vars'][key]
latest['vars'].pop('REPLACEMENT_BASE_CUTOVER_TOKEN', None)
Path('wrangler.jsonc').write_text(json.dumps(latest, indent=2) + '\n')
PY
    git config user.name github-actions[bot]
    git config user.email 41898282+github-actions[bot]@users.noreply.github.com
    git add wrangler.jsonc
    if git diff --cached --quiet; then
      return 0
    fi
    git commit -m "ops: advance production current-state checkpoint to $TARGET_LEDGER_INDEX"
    if git push origin HEAD:main; then
      return 0
    fi
    sleep 2
  done
  return 1
}
sync_main_config

jq -n \
  --slurpfile target "$ROOT/target-identity.json" \
  --slurpfile usage "$ROOT/d1-summary.json" \
  --slurpfile overview "$ROOT/overview-final.json" \
  --slurpfile rebase "$ROOT/rebase-final.json" \
  --slurpfile diff "$ROOT/diff-final.json" '
  {passed:true,target:$target[0],d1UsageAtGate:$usage[0],overview:$overview[0],rebase:$rebase[0],fastLaneDiff:$diff[0],schedule:"*/5 * * * *",mainnetEnabled:false,historyMode:"archived_plus_forward_only"}
' > "$ROOT/evidence.json"

trap - EXIT
