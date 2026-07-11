#!/usr/bin/env bash
set -euo pipefail

ROOT="${CUTOVER_EVIDENCE_DIR:-live-cutover-evidence}"
PRODUCTION_BASE="${PRODUCTION_BASE:-https://xrpl-lending-monitor.badjoke-lab.workers.dev}"
TARGET_FILE="${ROOT}/target-identity.json"
test -s "${TARGET_FILE}"

TARGET_LEDGER_INDEX="$(jq -r '.target.ledgerIndex' "${TARGET_FILE}")"
TARGET_PUBLICATION_SHA="$(jq -r '.target.publicationSha256' "${TARGET_FILE}")"
TARGET_SNAPSHOT_ID="$(jq -r '.target.snapshotId' "${TARGET_FILE}")"
printf '%s' "${TARGET_LEDGER_INDEX}" | grep -Eq '^[0-9]+$'
printf '%s' "${TARGET_PUBLICATION_SHA}" | grep -Eq '^[a-f0-9]{64}$'
test -n "${TARGET_SNAPSHOT_ID}"

jq -n '{method:"ledger",params:[{ledger_index:"validated",transactions:false,expand:false}]}' > "${ROOT}/post-cutover-head-request.json"

for attempt in $(seq 1 90); do
  curl --fail-with-body --silent --show-error --retry 2 \
    -H 'content-type: application/json' \
    --data @"${ROOT}/post-cutover-head-request.json" \
    https://devnet.honeycluster.io/ \
    > "${ROOT}/post-cutover-head.json" || true
  curl --fail-with-body --silent --show-error --retry 2 \
    "${PRODUCTION_BASE}/api/overview" > "${ROOT}/post-cutover-overview.json" || true
  curl --fail-with-body --silent --show-error --retry 2 \
    "${PRODUCTION_BASE}/api/status/history-source" > "${ROOT}/post-cutover-history.json" || true
  curl --fail-with-body --silent --show-error --retry 2 \
    "${PRODUCTION_BASE}/api/status/replacement-base-rebase" > "${ROOT}/post-cutover-rebase.json" || true
  curl --fail-with-body --silent --show-error --retry 2 \
    "${PRODUCTION_BASE}/api/status/fast-lane-diff?limit=500" > "${ROOT}/post-cutover-diff.json" || true

  LIVE_LEDGER="$(jq -r '.result.ledger_index // .result.ledger.ledger_index // 0' "${ROOT}/post-cutover-head.json" 2>/dev/null || echo 0)"
  CURRENT_LEDGER="$(jq -r '.current_state_watermark.ledger_index // 0' "${ROOT}/post-cutover-overview.json" 2>/dev/null || echo 0)"
  CURRENT_UPDATED_AT="$(jq -r '.current_state_watermark.updated_at // empty' "${ROOT}/post-cutover-overview.json" 2>/dev/null || true)"
  LAG="$((LIVE_LEDGER - CURRENT_LEDGER))"
  if [ "${LAG}" -lt 0 ]; then LAG=0; fi

  AGE_SECONDS=999999
  if [ -n "${CURRENT_UPDATED_AT}" ]; then
    UPDATED_EPOCH="$(date -u -d "${CURRENT_UPDATED_AT}" +%s 2>/dev/null || echo 0)"
    NOW_EPOCH="$(date -u +%s)"
    if [ "${UPDATED_EPOCH}" -gt 0 ]; then
      AGE_SECONDS="$((NOW_EPOCH - UPDATED_EPOCH))"
      if [ "${AGE_SECONDS}" -lt 0 ]; then AGE_SECONDS=0; fi
    fi
  fi

  if [ "${LIVE_LEDGER}" -gt 0 ] \
    && [ "${CURRENT_LEDGER}" -ge "${TARGET_LEDGER_INDEX}" ] \
    && [ "${LAG}" -le 10 ] \
    && [ "${AGE_SECONDS}" -le 600 ] \
    && jq -e --arg snapshot "${TARGET_SNAPSHOT_ID}" --argjson ledger "${TARGET_LEDGER_INDEX}" '
      .status == "replayed"
      and .target.snapshotId == $snapshot
      and .target.ledgerIndex == $ledger
    ' "${ROOT}/post-cutover-rebase.json" > /dev/null 2>&1 \
    && jq -e --arg publication "${TARGET_PUBLICATION_SHA}" --argjson ledger "${TARGET_LEDGER_INDEX}" '
      .status == "ok"
      and .mode == "hybrid"
      and .chain.end_ledger_index == $ledger
      and .chain.publication_sha256 == $publication
      and .exact_index.total_records > 0
    ' "${ROOT}/post-cutover-history.json" > /dev/null 2>&1 \
    && jq -e --argjson ledger "${TARGET_LEDGER_INDEX}" '
      .current_state_watermark.source == "fast_lane"
      and .counts_watermark.ledger_index == $ledger
    ' "${ROOT}/post-cutover-overview.json" > /dev/null 2>&1 \
    && jq -e '
      .status == "ok"
      and .passed == true
      and .sample.exactProjectionMismatches == 0
    ' "${ROOT}/post-cutover-diff.json" > /dev/null 2>&1; then
    jq -n \
      --argjson liveLedger "${LIVE_LEDGER}" \
      --argjson currentLedger "${CURRENT_LEDGER}" \
      --argjson lagLedgers "${LAG}" \
      --argjson ageSeconds "${AGE_SECONDS}" \
      --argjson targetLedger "${TARGET_LEDGER_INDEX}" \
      --arg snapshotId "${TARGET_SNAPSHOT_ID}" \
      --arg publicationSha256 "${TARGET_PUBLICATION_SHA}" \
      '{passed:true,liveLedger:$liveLedger,currentStateLedger:$currentLedger,lagLedgers:$lagLedgers,currentStateAgeSeconds:$ageSeconds,target:{ledgerIndex:$targetLedger,snapshotId:$snapshotId,publicationSha256:$publicationSha256},schedule:"*/5 * * * *",mainnetEnabled:false}' \
      > "${ROOT}/post-cutover-verification.json"
    exit 0
  fi

  sleep 10
done

echo 'Post-cutover current-state freshness did not converge within 15 minutes' >&2
exit 1
