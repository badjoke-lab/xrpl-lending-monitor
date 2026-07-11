#!/usr/bin/env bash
set -euo pipefail

ROOT="${CUTOVER_EVIDENCE_DIR:-live-cutover-evidence}"
PRODUCTION_BASE="${PRODUCTION_BASE:-https://xrpl-lending-monitor.badjoke-lab.workers.dev}"
PRODUCTION_HISTORY_BRANCH="${PRODUCTION_HISTORY_BRANCH:-history-data}"
PRODUCTION_CURRENT_STATE_BRANCH="${PRODUCTION_CURRENT_STATE_BRANCH:-current-state-data}"
HISTORY_CANDIDATE_DIR="${HISTORY_CANDIDATE_DIR:-.local/history-candidate}"
CURRENT_CANDIDATE_DIR="${CURRENT_CANDIDATE_DIR:-.local/current-candidate}"
D1_DATABASE_ID="${D1_DATABASE_ID:-bebc2c68-03d2-4a1c-98a7-46b34ee4e25d}"

required() {
  local name="$1"
  test -n "${!name:-}" || { echo "${name} is required" >&2; exit 2; }
}

for name in \
  HISTORY_CANDIDATE_BRANCH \
  CURRENT_STATE_CANDIDATE_BRANCH \
  CONFIRM_PRODUCTION_WRITE \
  CLOUDFLARE_API_TOKEN \
  CLOUDFLARE_ACCOUNT_ID; do
  required "${name}"
done

test "${CONFIRM_PRODUCTION_WRITE}" = true
git check-ref-format --branch "${HISTORY_CANDIDATE_BRANCH}" > /dev/null
git check-ref-format --branch "${CURRENT_STATE_CANDIDATE_BRANCH}" > /dev/null
test "${HISTORY_CANDIDATE_BRANCH}" != "${CURRENT_STATE_CANDIDATE_BRANCH}"
test "${HISTORY_CANDIDATE_BRANCH}" != "${PRODUCTION_HISTORY_BRANCH}"
test "${CURRENT_STATE_CANDIDATE_BRANCH}" != "${PRODUCTION_CURRENT_STATE_BRANCH}"

mkdir -p "${ROOT}"

remote_sha() {
  git ls-remote origin "refs/heads/$1" | awk '{print $1}'
}

repo_json() {
  local file="$1"
  jq -e . "${file}" > /dev/null
}

PUBLICATION="${HISTORY_CANDIDATE_DIR}/history/publication.json"
EXACT="${HISTORY_CANDIDATE_DIR}/history/index/exact/manifest.json"
HISTORY_CHANNEL="${HISTORY_CANDIDATE_DIR}/history-channel.json"
CURRENT_MANIFEST="${CURRENT_CANDIDATE_DIR}/read-model/manifest.json"
CURRENT_CHANNEL="${CURRENT_CANDIDATE_DIR}/channel.json"
CURRENT_SUMMARY="${CURRENT_CANDIDATE_DIR}/rolling-read-model-summary.json"

for file in \
  "${PUBLICATION}" \
  "${EXACT}" \
  "${HISTORY_CHANNEL}" \
  "${CURRENT_MANIFEST}" \
  "${CURRENT_CHANNEL}" \
  "${CURRENT_SUMMARY}"; do
  test -s "${file}"
  repo_json "${file}"
done

export HISTORY_CANDIDATE_SHA="$(git -C "${HISTORY_CANDIDATE_DIR}" rev-parse HEAD)"
export CURRENT_CANDIDATE_SHA="$(git -C "${CURRENT_CANDIDATE_DIR}" rev-parse HEAD)"
test "${HISTORY_CANDIDATE_SHA}" = "$(remote_sha "${HISTORY_CANDIDATE_BRANCH}")"
test "${CURRENT_CANDIDATE_SHA}" = "$(remote_sha "${CURRENT_STATE_CANDIDATE_BRANCH}")"

export TARGET_LEDGER_INDEX="$(jq -r '.endLedgerIndex' "${PUBLICATION}")"
export TARGET_LEDGER_HASH="$(jq -r '.endLedgerHash' "${PUBLICATION}")"
export TARGET_PUBLICATION_SHA="$(jq -r '.publicationSha256' "${PUBLICATION}")"
export TARGET_SNAPSHOT_ID="$(jq -r '.snapshotId' "${CURRENT_MANIFEST}")"
export TARGET_CURRENT_MANIFEST_SHA="$(jq -r '.manifestSha256' "${CURRENT_MANIFEST}")"
export TARGET_EPOCH_ID="$(jq -r '.epochId' "${CURRENT_MANIFEST}")"

printf '%s' "${HISTORY_CANDIDATE_SHA}" | grep -Eq '^[a-f0-9]{40}$'
printf '%s' "${CURRENT_CANDIDATE_SHA}" | grep -Eq '^[a-f0-9]{40}$'
printf '%s' "${TARGET_LEDGER_INDEX}" | grep -Eq '^[0-9]+$'
printf '%s' "${TARGET_LEDGER_HASH}" | grep -Eq '^[A-F0-9]{64}$'
printf '%s' "${TARGET_PUBLICATION_SHA}" | grep -Eq '^[a-f0-9]{64}$'
printf '%s' "${TARGET_CURRENT_MANIFEST_SHA}" | grep -Eq '^[a-f0-9]{64}$'
test "${TARGET_EPOCH_ID}" = devnet-3371675

jq -e --arg publication "${TARGET_PUBLICATION_SHA}" '
  .complete == true
  and .network == "devnet"
  and .publicationSha256 == $publication
' "${PUBLICATION}" > /dev/null
jq -e --arg publication "${TARGET_PUBLICATION_SHA}" '
  .publicationSha256 == $publication
  and .bucketCount == 256
  and .totalRecords > 0
' "${EXACT}" > /dev/null
jq -e \
  --argjson ledger "${TARGET_LEDGER_INDEX}" \
  --arg hash "${TARGET_LEDGER_HASH}" \
  --arg snapshot "${TARGET_SNAPSHOT_ID}" \
  --arg manifest "${TARGET_CURRENT_MANIFEST_SHA}" '
  .complete == true
  and .ledgerIndex == $ledger
  and .ledgerHash == $hash
  and .snapshotId == $snapshot
  and .manifestSha256 == $manifest
' "${CURRENT_MANIFEST}" > /dev/null
jq -e --arg snapshot "${TARGET_SNAPSHOT_ID}" --arg manifest "${TARGET_CURRENT_MANIFEST_SHA}" '
  .active.snapshotId == $snapshot
  and .active.manifestSha256 == $manifest
' "${CURRENT_CHANNEL}" > /dev/null
jq -e \
  --argjson ledger "${TARGET_LEDGER_INDEX}" \
  --arg hash "${TARGET_LEDGER_HASH}" \
  --arg snapshot "${TARGET_SNAPSHOT_ID}" \
  --arg manifest "${TARGET_CURRENT_MANIFEST_SHA}" '
  .target.ledgerIndex == $ledger
  and .target.ledgerHash == $hash
  and .target.snapshotId == $snapshot
  and .target.manifestSha256 == $manifest
  and .rollingBase.segmentCount == 64
' "${CURRENT_SUMMARY}" > /dev/null
jq -e '.active.dataCommitSha | test("^[a-f0-9]{40}$")' "${HISTORY_CHANNEL}" > /dev/null

jq -n \
  --arg historyBranch "${HISTORY_CANDIDATE_BRANCH}" \
  --arg historyCommitSha "${HISTORY_CANDIDATE_SHA}" \
  --arg currentStateBranch "${CURRENT_STATE_CANDIDATE_BRANCH}" \
  --arg currentStateCommitSha "${CURRENT_CANDIDATE_SHA}" \
  --argjson ledgerIndex "${TARGET_LEDGER_INDEX}" \
  --arg ledgerHash "${TARGET_LEDGER_HASH}" \
  --arg publicationSha256 "${TARGET_PUBLICATION_SHA}" \
  --arg snapshotId "${TARGET_SNAPSHOT_ID}" \
  --arg currentManifestSha256 "${TARGET_CURRENT_MANIFEST_SHA}" \
  '{historyBranch:$historyBranch,historyCommitSha:$historyCommitSha,currentStateBranch:$currentStateBranch,currentStateCommitSha:$currentStateCommitSha,target:{ledgerIndex:$ledgerIndex,ledgerHash:$ledgerHash,publicationSha256:$publicationSha256,snapshotId:$snapshotId,currentManifestSha256:$currentManifestSha256}}' \
  > "${ROOT}/target-identity.json"

node .candidate-source-rehearsal-build/rehearse-candidate-sources.mjs \
  --local \
  --repository badjoke-lab/xrpl-lending-monitor \
  --history-branch "${HISTORY_CANDIDATE_BRANCH}" \
  --current-state-branch "${CURRENT_STATE_CANDIDATE_BRANCH}" \
  > "${ROOT}/candidate-summary.json"
jq -e \
  --argjson ledger "${TARGET_LEDGER_INDEX}" \
  --arg hash "${TARGET_LEDGER_HASH}" \
  --arg manifest "${TARGET_CURRENT_MANIFEST_SHA}" '
  .passed == true
  and (.exactReads | length) == 3
  and .recentHistory.items == 1
  and .ledgerIndex == $ledger
  and .ledgerHash == $hash
  and .currentStateManifestSha256 == $manifest
' "${ROOT}/candidate-summary.json" > /dev/null

jq -n '{method:"ledger",params:[{ledger_index:"validated",transactions:false,expand:false}]}' > "${ROOT}/head-request.json"
jq -n --argjson ledger "${TARGET_LEDGER_INDEX}" '{method:"ledger",params:[{ledger_index:$ledger,transactions:false,expand:false}]}' > "${ROOT}/target-request.json"
ENDPOINTS=('https://devnet.honeycluster.io/' 'https://s.devnet.rippletest.net:51234/')
HEADS=()
for i in 0 1; do
  curl --fail-with-body --silent --show-error --retry 3 \
    -H 'content-type: application/json' \
    --data @"${ROOT}/head-request.json" "${ENDPOINTS[$i]}" \
    > "${ROOT}/head-$i.json"
  curl --fail-with-body --silent --show-error --retry 3 \
    -H 'content-type: application/json' \
    --data @"${ROOT}/target-request.json" "${ENDPOINTS[$i]}" \
    > "${ROOT}/target-$i.json"
  head_ledger="$(jq -r '.result.ledger_index // .result.ledger.ledger_index' "${ROOT}/head-$i.json")"
  target_hash="$(jq -r '.result.ledger_hash // .result.ledger.ledger_hash' "${ROOT}/target-$i.json")"
  test "${target_hash}" = "${TARGET_LEDGER_HASH}"
  test "${head_ledger}" -ge "${TARGET_LEDGER_INDEX}"
  HEADS+=("${head_ledger}")
done
export LIVE_HEAD_AT_GATE="${HEADS[0]}"
if [ "${HEADS[1]}" -lt "${LIVE_HEAD_AT_GATE}" ]; then LIVE_HEAD_AT_GATE="${HEADS[1]}"; fi
export TARGET_LAG_AT_GATE="$((LIVE_HEAD_AT_GATE - TARGET_LEDGER_INDEX))"
test "${TARGET_LAG_AT_GATE}" -le 300

TODAY="$(date -u +%F)"
read -r -d '' GRAPHQL_QUERY <<'GRAPHQL' || true
query D1Usage($accountTag:string!,$start:Date,$end:Date,$databaseId:string){viewer{accounts(filter:{accountTag:$accountTag}){d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:$start,date_leq:$end,databaseId:$databaseId}){sum{rowsRead rowsWritten}}}}}
GRAPHQL
jq -n \
  --arg query "${GRAPHQL_QUERY}" \
  --arg accountTag "${CLOUDFLARE_ACCOUNT_ID}" \
  --arg start "${TODAY}" \
  --arg end "${TODAY}" \
  --arg databaseId "${D1_DATABASE_ID}" \
  '{query:$query,variables:{accountTag:$accountTag,start:$start,end:$end,databaseId:$databaseId}}' \
  > "${ROOT}/d1-request.json"
curl --fail-with-body --silent --show-error --retry 3 -X POST \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H 'content-type: application/json' \
  --data @"${ROOT}/d1-request.json" \
  https://api.cloudflare.com/client/v4/graphql \
  > "${ROOT}/d1-response.json"
jq -e '((.errors // []) | length) == 0 and (.data.viewer.accounts | length) > 0' "${ROOT}/d1-response.json" > /dev/null
jq '[.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups[]] as $groups | {rows_read:([$groups[].sum.rowsRead // 0] | add // 0),rows_written:([$groups[].sum.rowsWritten // 0] | add // 0)} | .rows_read_remaining=(5000000-.rows_read) | .rows_written_remaining=(100000-.rows_written)' \
  "${ROOT}/d1-response.json" > "${ROOT}/d1-summary.json"
jq -e '.rows_read < 4900000 and .rows_written < 95000 and .rows_written_remaining >= 5000' "${ROOT}/d1-summary.json" > /dev/null

export PROD_HISTORY_SHA_BEFORE="$(remote_sha "${PRODUCTION_HISTORY_BRANCH}")"
export PROD_CURRENT_SHA_BEFORE="$(remote_sha "${PRODUCTION_CURRENT_STATE_BRANCH}")"
printf '%s' "${PROD_HISTORY_SHA_BEFORE}" | grep -Eq '^[a-f0-9]{40}$'
printf '%s' "${PROD_CURRENT_SHA_BEFORE}" | grep -Eq '^[a-f0-9]{40}$'
printf '%s\n' "${PROD_HISTORY_SHA_BEFORE}" > "${ROOT}/production-history-before.txt"
printf '%s\n' "${PROD_CURRENT_SHA_BEFORE}" > "${ROOT}/production-current-before.txt"
export CUTOVER_TOKEN="$(openssl rand -hex 32)"

python - <<'PY'
import copy
import json
import os
from pathlib import Path

source = json.loads(Path('wrangler.jsonc').read_text())
assert source['triggers']['crons'] == ['*/5 * * * *']
assert source['vars']['APP_NETWORK'] == 'devnet'
assert source['vars']['MAINNET_ENABLED'] == 'false'

def target_config(branch: str, token):
    cfg = copy.deepcopy(source)
    cfg['triggers']['crons'] = ['*/5 * * * *']
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
Path('wrangler.live-cutover.jsonc').write_text(json.dumps(cutover, indent=2) + '\n')
Path('wrangler.live-final.jsonc').write_text(json.dumps(final, indent=2) + '\n')
PY

jq -e \
  --arg branch "${CURRENT_STATE_CANDIDATE_BRANCH}" \
  --arg snapshot "${TARGET_SNAPSHOT_ID}" \
  --argjson ledger "${TARGET_LEDGER_INDEX}" \
  --arg hash "${TARGET_LEDGER_HASH}" \
  --arg token "${CUTOVER_TOKEN}" '
  .triggers.crons == ["*/5 * * * *"]
  and .vars.APP_NETWORK == "devnet"
  and .vars.MAINNET_ENABLED == "false"
  and .vars.CURRENT_STATE_REPLACEMENT_GITHUB_BRANCH == $branch
  and .vars.CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID == $snapshot
  and (.vars.REPLACEMENT_BASE_LEDGER_INDEX | tonumber) == $ledger
  and .vars.REPLACEMENT_BASE_LEDGER_HASH == $hash
  and .vars.REPLACEMENT_BASE_CUTOVER_TOKEN == $token
' wrangler.live-cutover.jsonc > /dev/null
jq -e \
  --arg branch "${PRODUCTION_CURRENT_STATE_BRANCH}" \
  --arg snapshot "${TARGET_SNAPSHOT_ID}" \
  --argjson ledger "${TARGET_LEDGER_INDEX}" \
  --arg hash "${TARGET_LEDGER_HASH}" '
  .triggers.crons == ["*/5 * * * *"]
  and .vars.CURRENT_STATE_REPLACEMENT_GITHUB_BRANCH == $branch
  and .vars.CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID == $snapshot
  and (.vars.REPLACEMENT_BASE_LEDGER_INDEX | tonumber) == $ledger
  and .vars.REPLACEMENT_BASE_LEDGER_HASH == $hash
  and (.vars | has("REPLACEMENT_BASE_CUTOVER_TOKEN") | not)
' wrangler.live-final.jsonc > /dev/null

cleanup() {
  local exit_code=$?
  set +e
  if [ -f "${ROOT}/cutover-applied" ]; then
    remote_current="$(remote_sha "${PRODUCTION_CURRENT_STATE_BRANCH}")"
    if [ "${remote_current}" != "${CURRENT_CANDIDATE_SHA}" ]; then
      if [ "${remote_current}" = "${PROD_CURRENT_SHA_BEFORE}" ]; then
        git fetch origin "refs/heads/${CURRENT_STATE_CANDIDATE_BRANCH}:refs/remotes/origin/${CURRENT_STATE_CANDIDATE_BRANCH}"
        git push --force-with-lease="refs/heads/${PRODUCTION_CURRENT_STATE_BRANCH}:${PROD_CURRENT_SHA_BEFORE}" \
          origin "${CURRENT_CANDIDATE_SHA}:refs/heads/${PRODUCTION_CURRENT_STATE_BRANCH}"
      fi
    fi
    if [ ! -f "${ROOT}/final-config-deployed" ]; then
      pnpm exec wrangler deploy --config wrangler.live-final.jsonc
    fi
  elif [ -f "${ROOT}/history-promoted" ]; then
    remote_history="$(remote_sha "${PRODUCTION_HISTORY_BRANCH}")"
    if [ "${remote_history}" = "${HISTORY_CANDIDATE_SHA}" ]; then
      git push --force-with-lease="refs/heads/${PRODUCTION_HISTORY_BRANCH}:${HISTORY_CANDIDATE_SHA}" \
        origin "${PROD_HISTORY_SHA_BEFORE}:refs/heads/${PRODUCTION_HISTORY_BRANCH}"
    fi
    if [ -f "${ROOT}/cutover-config-deployed" ]; then
      pnpm exec wrangler deploy --config wrangler.jsonc
    fi
  fi
  exit "${exit_code}"
}
trap cleanup EXIT

test "$(remote_sha "${HISTORY_CANDIDATE_BRANCH}")" = "${HISTORY_CANDIDATE_SHA}"
test "$(remote_sha "${CURRENT_STATE_CANDIDATE_BRANCH}")" = "${CURRENT_CANDIDATE_SHA}"

git fetch origin "refs/heads/${HISTORY_CANDIDATE_BRANCH}:refs/remotes/origin/${HISTORY_CANDIDATE_BRANCH}"
git push --force-with-lease="refs/heads/${PRODUCTION_HISTORY_BRANCH}:${PROD_HISTORY_SHA_BEFORE}" \
  origin "${HISTORY_CANDIDATE_SHA}:refs/heads/${PRODUCTION_HISTORY_BRANCH}"
test "$(remote_sha "${PRODUCTION_HISTORY_BRANCH}")" = "${HISTORY_CANDIDATE_SHA}"
touch "${ROOT}/history-promoted"

for _ in $(seq 1 30); do
  curl --fail-with-body --silent --show-error --retry 2 \
    "${PRODUCTION_BASE}/api/status/history-source" > "${ROOT}/history-after.json" || true
  if jq -e --arg publication "${TARGET_PUBLICATION_SHA}" --argjson ledger "${TARGET_LEDGER_INDEX}" '
    .status == "ok"
    and .mode == "hybrid"
    and .chain.end_ledger_index == $ledger
    and .chain.publication_sha256 == $publication
    and .exact_index.total_records > 0
  ' "${ROOT}/history-after.json" > /dev/null 2>&1; then
    touch "${ROOT}/history-confirmed"
    break
  fi
  sleep 10
done
test -f "${ROOT}/history-confirmed"

pnpm exec wrangler deploy --config wrangler.live-cutover.jsonc
touch "${ROOT}/cutover-config-deployed"

for attempt in 1 2 3; do
  http_status="$(curl --silent --show-error --retry 2 \
    -o "${ROOT}/cutover-response-${attempt}.json" -w '%{http_code}' \
    -X POST \
    -H "x-replacement-base-cutover-token: ${CUTOVER_TOKEN}" \
    "${PRODUCTION_BASE}/api/operator/replacement-base-cutover")"
  if [ "${http_status}" = 200 ] && jq -e --arg snapshot "${TARGET_SNAPSHOT_ID}" --argjson ledger "${TARGET_LEDGER_INDEX}" '
    .status == "cutover_applied"
    and .target.snapshotId == $snapshot
    and .target.ledgerIndex == $ledger
  ' "${ROOT}/cutover-response-${attempt}.json" > /dev/null 2>&1; then
    touch "${ROOT}/cutover-applied"
    break
  fi
  sleep 5
done
test -f "${ROOT}/cutover-applied"

git fetch origin "refs/heads/${CURRENT_STATE_CANDIDATE_BRANCH}:refs/remotes/origin/${CURRENT_STATE_CANDIDATE_BRANCH}"
git push --force-with-lease="refs/heads/${PRODUCTION_CURRENT_STATE_BRANCH}:${PROD_CURRENT_SHA_BEFORE}" \
  origin "${CURRENT_CANDIDATE_SHA}:refs/heads/${PRODUCTION_CURRENT_STATE_BRANCH}"
test "$(remote_sha "${PRODUCTION_CURRENT_STATE_BRANCH}")" = "${CURRENT_CANDIDATE_SHA}"
touch "${ROOT}/current-promoted"

pnpm exec wrangler deploy --config wrangler.live-final.jsonc
touch "${ROOT}/final-config-deployed"
curl --fail-with-body --silent --show-error --retry 3 \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/xrpl-lending-monitor/schedules" \
  > "${ROOT}/schedule-final.json"
jq -e '.result.schedules | length == 1 and .[0].cron == "*/5 * * * *"' "${ROOT}/schedule-final.json" > /dev/null

for _ in $(seq 1 54); do
  curl --fail-with-body --silent --show-error --retry 2 "${PRODUCTION_BASE}/api/overview" > "${ROOT}/overview-final.json" || true
  curl --fail-with-body --silent --show-error --retry 2 "${PRODUCTION_BASE}/api/status/history-source" > "${ROOT}/history-final.json" || true
  curl --fail-with-body --silent --show-error --retry 2 "${PRODUCTION_BASE}/api/status/replacement-base-rebase" > "${ROOT}/rebase-final.json" || true
  curl --fail-with-body --silent --show-error --retry 2 "${PRODUCTION_BASE}/api/status/fast-lane-diff?limit=500" > "${ROOT}/diff-final.json" || true

  if jq -e --arg snapshot "${TARGET_SNAPSHOT_ID}" --argjson ledger "${TARGET_LEDGER_INDEX}" '
      .status == "replayed"
      and .target.snapshotId == $snapshot
      and .target.ledgerIndex == $ledger
    ' "${ROOT}/rebase-final.json" > /dev/null 2>&1 \
    && jq -e --arg publication "${TARGET_PUBLICATION_SHA}" --argjson ledger "${TARGET_LEDGER_INDEX}" '
      .status == "ok"
      and .mode == "hybrid"
      and .chain.end_ledger_index == $ledger
      and .chain.publication_sha256 == $publication
    ' "${ROOT}/history-final.json" > /dev/null 2>&1 \
    && jq -e --argjson base "${TARGET_LEDGER_INDEX}" '
      .current_state_watermark.ledger_index >= $base
      and .current_state_watermark.source == "fast_lane"
      and .counts_watermark.ledger_index == $base
    ' "${ROOT}/overview-final.json" > /dev/null 2>&1 \
    && jq -e '
      .status == "ok"
      and .passed == true
      and .sample.exactProjectionMismatches == 0
    ' "${ROOT}/diff-final.json" > /dev/null 2>&1; then
    touch "${ROOT}/final-confirmed"
    break
  fi
  sleep 10
done
test -f "${ROOT}/final-confirmed"

jq -n \
  --slurpfile target "${ROOT}/target-identity.json" \
  --slurpfile usage "${ROOT}/d1-summary.json" \
  --slurpfile overview "${ROOT}/overview-final.json" \
  --slurpfile history "${ROOT}/history-final.json" \
  --slurpfile rebase "${ROOT}/rebase-final.json" \
  --slurpfile diff "${ROOT}/diff-final.json" \
  --argjson liveHeadAtGate "${LIVE_HEAD_AT_GATE}" \
  --argjson targetLagAtGate "${TARGET_LAG_AT_GATE}" \
  '{passed:true,target:$target[0],liveHeadAtGate:$liveHeadAtGate,targetLagAtGate:$targetLagAtGate,d1UsageAtGate:$usage[0],overview:$overview[0],history:$history[0],rebase:$rebase[0],fastLaneDiff:$diff[0],schedule:"*/5 * * * *",mainnetEnabled:false}' \
  > "${ROOT}/evidence.json"

trap - EXIT
