#!/usr/bin/env bash
set -euo pipefail

CURRENT_REF="${CURRENT_STATE_DATA_REF:-refs/remotes/origin/current-state-data}"
HISTORY_REF="${HISTORY_DATA_REF:-refs/remotes/origin/history-data}"
ROOT="${CANONICAL_BASE_CHECK_DIR:-.local/canonical-base-check}"

mkdir -p "${ROOT}"
git show "${CURRENT_REF}:read-model/manifest.json" > "${ROOT}/current-manifest.json"
git show "${CURRENT_REF}:rolling-read-model-summary.json" > "${ROOT}/current-summary.json"
git show "${HISTORY_REF}:history/publication.json" > "${ROOT}/history-publication.json"

jq -e '.complete == true and .epochId == "devnet-3371675"' \
  "${ROOT}/current-manifest.json" > /dev/null
jq -e '.complete == true and .network == "devnet" and .epochId == "devnet-3371675"' \
  "${ROOT}/history-publication.json" > /dev/null

CURRENT_LEDGER="$(jq -r '.ledgerIndex' "${ROOT}/current-manifest.json")"
CURRENT_HASH="$(jq -r '.ledgerHash' "${ROOT}/current-manifest.json")"
CURRENT_SNAPSHOT="$(jq -r '.snapshotId' "${ROOT}/current-manifest.json")"
CURRENT_EPOCH="$(jq -r '.epochId' "${ROOT}/current-manifest.json")"
HISTORY_LEDGER="$(jq -r '.endLedgerIndex' "${ROOT}/history-publication.json")"
HISTORY_HASH="$(jq -r '.endLedgerHash' "${ROOT}/history-publication.json")"
HISTORY_EPOCH="$(jq -r '.epochId' "${ROOT}/history-publication.json")"

printf '%s' "${CURRENT_LEDGER}" | grep -Eq '^[0-9]+$'
printf '%s' "${HISTORY_LEDGER}" | grep -Eq '^[0-9]+$'
printf '%s' "${CURRENT_HASH}" | grep -Eq '^[A-F0-9]{64}$'
printf '%s' "${HISTORY_HASH}" | grep -Eq '^[A-F0-9]{64}$'
printf '%s' "${CURRENT_SNAPSHOT}" | grep -Eq '^devnet-[0-9]+-[a-f0-9]{12}$'

test "${CURRENT_EPOCH}" = "${HISTORY_EPOCH}"
test "${CURRENT_LEDGER}" -ge "${HISTORY_LEDGER}"
if test "${CURRENT_LEDGER}" -eq "${HISTORY_LEDGER}"; then
  test "${CURRENT_HASH}" = "${HISTORY_HASH}"
fi

jq -e \
  --arg snapshot "${CURRENT_SNAPSHOT}" \
  --arg epoch "${CURRENT_EPOCH}" \
  --arg ledger "${CURRENT_LEDGER}" \
  --arg hash "${CURRENT_HASH}" '
    .mode == "d1-overlay-fold"
    and .source.epochId == $epoch
    and (.source.ledgerIndex | tostring) == $ledger
    and .source.ledgerHash == $hash
    and .source.snapshotId == $snapshot
    and (.target.ledgerIndex | tostring) == $ledger
    and .target.ledgerHash == $hash
    and .target.snapshotId == $snapshot
    and .overlaySource.epochId == $epoch
    and (.overlaySource.overlayLedgerIndex | tostring) == $ledger
    and .overlaySource.overlayLedgerHash == $hash
  ' "${ROOT}/current-summary.json" > /dev/null

jq -e \
  --arg snapshot "${CURRENT_SNAPSHOT}" \
  --arg epoch "${CURRENT_EPOCH}" \
  --arg ledger "${CURRENT_LEDGER}" \
  --arg hash "${CURRENT_HASH}" '
    .vars.APP_NETWORK == "devnet"
    and .vars.MAINNET_ENABLED == "false"
    and .vars.CURRENT_STATE_GITHUB_BRANCH == "current-state-data"
    and .vars.CURRENT_STATE_REPLACEMENT_GITHUB_BRANCH == "current-state-data"
    and .vars.CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID == $snapshot
    and .vars.HISTORY_GITHUB_BRANCH == "history-data"
    and .vars.REPLACEMENT_BASE_REBASE_ENABLED == "true"
    and .vars.REPLACEMENT_BASE_EPOCH_ID == $epoch
    and .vars.REPLACEMENT_BASE_SNAPSHOT_ID == $snapshot
    and .vars.REPLACEMENT_BASE_LEDGER_INDEX == $ledger
    and .vars.REPLACEMENT_BASE_LEDGER_HASH == $hash
    and (.vars | has("REPLACEMENT_BASE_CUTOVER_TOKEN") | not)
  ' wrangler.jsonc > /dev/null

HISTORY_GAP="$((CURRENT_LEDGER - HISTORY_LEDGER))"
MODE="aligned"
if test "${HISTORY_GAP}" -gt 0; then MODE="archived_plus_forward_only"; fi

jq -n \
  --arg epochId "${CURRENT_EPOCH}" \
  --arg snapshotId "${CURRENT_SNAPSHOT}" \
  --argjson currentLedgerIndex "${CURRENT_LEDGER}" \
  --arg currentLedgerHash "${CURRENT_HASH}" \
  --argjson historyLedgerIndex "${HISTORY_LEDGER}" \
  --arg historyLedgerHash "${HISTORY_HASH}" \
  --argjson historyGapLedgers "${HISTORY_GAP}" \
  --arg historyMode "${MODE}" \
  '{passed:true,epochId:$epochId,snapshotId:$snapshotId,currentLedgerIndex:$currentLedgerIndex,currentLedgerHash:$currentLedgerHash,historyLedgerIndex:$historyLedgerIndex,historyLedgerHash:$historyLedgerHash,historyGapLedgers:$historyGapLedgers,historyMode:$historyMode}'
