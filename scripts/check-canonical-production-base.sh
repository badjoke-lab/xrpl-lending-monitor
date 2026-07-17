#!/usr/bin/env bash
set -euo pipefail

CURRENT_REF="${CURRENT_STATE_DATA_REF:-refs/remotes/origin/current-state-data}"
HISTORY_REF="${HISTORY_DATA_REF:-refs/remotes/origin/history-data}"
ROOT="${CANONICAL_BASE_CHECK_DIR:-.local/canonical-base-check}"

mkdir -p "${ROOT}"
git show "${CURRENT_REF}:read-model/manifest.json" > "${ROOT}/current-manifest.json"
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
printf '%s' "${CURRENT_HASH}" | grep -Eq '^[A-F0-9]{64}$'
printf '%s' "${CURRENT_SNAPSHOT}" | grep -Eq '^devnet-[0-9]+-[a-f0-9]{12}$'

test "${CURRENT_LEDGER}" = "${HISTORY_LEDGER}"
test "${CURRENT_HASH}" = "${HISTORY_HASH}"
test "${CURRENT_EPOCH}" = "${HISTORY_EPOCH}"

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

jq -n \
  --arg epochId "${CURRENT_EPOCH}" \
  --arg snapshotId "${CURRENT_SNAPSHOT}" \
  --argjson ledgerIndex "${CURRENT_LEDGER}" \
  --arg ledgerHash "${CURRENT_HASH}" \
  '{passed:true,epochId:$epochId,snapshotId:$snapshotId,ledgerIndex:$ledgerIndex,ledgerHash:$ledgerHash}'
