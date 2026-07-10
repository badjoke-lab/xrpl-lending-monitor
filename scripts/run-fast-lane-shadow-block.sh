#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:?data branch required}"
ITERATIONS="${2:?iteration count required}"
DATA="/tmp/${BRANCH}"
SAMPLE="/tmp/fast-lane-shadow-sample.json"

if ! printf '%s' "${ITERATIONS}" | grep -Eq '^[1-9][0-9]*$'; then
  echo "iterations must be a positive integer" >&2
  exit 1
fi

git config user.name github-actions[bot]
git config user.email 41898282+github-actions[bot]@users.noreply.github.com
rm -rf "${DATA}"

if git ls-remote --exit-code origin "refs/heads/${BRANCH}" >/dev/null 2>&1; then
  git fetch origin "refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
  git worktree add -B "${BRANCH}" "${DATA}" "refs/remotes/origin/${BRANCH}"
else
  git worktree add --detach "${DATA}"
  git -C "${DATA}" checkout --orphan "${BRANCH}"
  git -C "${DATA}" rm -rf . || true
  git -C "${DATA}" clean -fdx
fi

mkdir -p "${DATA}/samples"

for ITERATION in $(seq 1 "${ITERATIONS}"); do
  ITERATION_STARTED="$(date +%s)"
  START_LEDGER=''
  if [ -f "${DATA}/state.json" ]; then
    LAST_END="$(jq -r '.lastEndLedger // empty' "${DATA}/state.json")"
    if printf '%s' "${LAST_END}" | grep -Eq '^[0-9]+$'; then
      START_LEDGER="$((LAST_END + 1))"
    fi
  fi

  ARGS=(
    --endpoint https://devnet.honeycluster.io/
    --max-ledgers 180
    --read-window 4
    --bootstrap-ledgers 90
    --output "${SAMPLE}"
  )
  if [ -n "${START_LEDGER}" ]; then
    ARGS+=(--start-ledger "${START_LEDGER}")
  fi

  node scripts/measure-fast-lane-shadow-canary.mjs "${ARGS[@]}"
  jq -e '.mode == "read-only-shadow" and .source.cadenceTargetSeconds == 300' "${SAMPLE}" >/dev/null

  STAMP="$(jq -r '.sampledAt' "${SAMPLE}" | tr ':.' '--')"
  RUN_KEY="${GITHUB_RUN_ID:-local}-${GITHUB_JOB:-job}-${ITERATION}"
  cp "${SAMPLE}" "${DATA}/samples/${STAMP}-${RUN_KEY}.json"
  jq -c . "${SAMPLE}" >> "${DATA}/samples.ndjson"

  END_LEDGER="$(jq -r '.source.endLedger // empty' "${SAMPLE}")"
  LATEST_LEDGER="$(jq -r '.source.latestValidatedLedger' "${SAMPLE}")"
  SAMPLED_AT="$(jq -r '.sampledAt' "${SAMPLE}")"
  if printf '%s' "${END_LEDGER}" | grep -Eq '^[0-9]+$'; then
    jq -n --argjson lastEndLedger "${END_LEDGER}" --argjson latestValidatedLedger "${LATEST_LEDGER}" --arg sampledAt "${SAMPLED_AT}" \
      '{schemaVersion:1,lastEndLedger:$lastEndLedger,latestValidatedLedger:$latestValidatedLedger,updatedAt:$sampledAt}' > "${DATA}/state.json"
  fi

  DATA_DIR="${DATA}" node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const dataDir = process.env.DATA_DIR
const lines = fs.readFileSync(path.join(dataDir, 'samples.ndjson'), 'utf8').trim().split('\n').filter(Boolean)
const samples = lines.map((line) => JSON.parse(line))
const totals = samples.reduce((acc, sample) => {
  acc.ledgersRead += sample.source.ledgersRead
  acc.inspectedTransactions += sample.metrics.inspectedTransactions
  acc.lendingTransactions += sample.metrics.lendingTransactions
  acc.successfulLendingTransactions += sample.metrics.successfulLendingTransactions
  acc.affectedObjectTouches += sample.metrics.affectedObjects.total
  acc.minimalProjectionWriteLowerBound += sample.metrics.minimalProjectionWriteLowerBound
  acc.elapsedMs += sample.timing.elapsedMs
  if (sample.source.completeToHead) acc.completeToHeadSamples += 1
  acc.maxBacklogBefore = Math.max(acc.maxBacklogBefore, sample.source.backlogBefore)
  return acc
}, {ledgersRead:0,inspectedTransactions:0,lendingTransactions:0,successfulLendingTransactions:0,affectedObjectTouches:0,minimalProjectionWriteLowerBound:0,elapsedMs:0,completeToHeadSamples:0,maxBacklogBefore:0})
const sampledTimes = samples.map((sample) => Date.parse(sample.sampledAt)).filter(Number.isFinite).sort((a,b)=>a-b)
const gaps = sampledTimes.slice(1).map((value,index)=>(value-sampledTimes[index])/1000)
const aggregate = {
  schemaVersion:1,
  mode:'read-only-shadow-22h-aggregate',
  sampleCount:samples.length,
  firstSampledAt:samples[0]?.sampledAt??null,
  lastSampledAt:samples.at(-1)?.sampledAt??null,
  coverage:{firstRequestedStartLedger:samples[0]?.source.requestedStartLedger??null,lastEndLedger:samples.at(-1)?.source.endLedger??null,lastValidatedLedger:samples.at(-1)?.source.latestValidatedLedger??null},
  cadence:{targetSeconds:300,averageObservedGapSeconds:gaps.length?gaps.reduce((sum,value)=>sum+value,0)/gaps.length:null,maxObservedGapSeconds:gaps.length?Math.max(...gaps):null,minObservedGapSeconds:gaps.length?Math.min(...gaps):null,completeToHeadRate:samples.length?totals.completeToHeadSamples/samples.length:null},
  totals,
  averagesPerSample:{ledgersRead:samples.length?totals.ledgersRead/samples.length:0,lendingTransactions:samples.length?totals.lendingTransactions/samples.length:0,affectedObjectTouches:samples.length?totals.affectedObjectTouches/samples.length:0,minimalProjectionWriteLowerBound:samples.length?totals.minimalProjectionWriteLowerBound/samples.length:0,elapsedMs:samples.length?totals.elapsedMs/samples.length:0}
}
fs.writeFileSync(path.join(dataDir,'summary.json'), `${JSON.stringify(aggregate,null,2)}\n`)
NODE

  git -C "${DATA}" add samples samples.ndjson state.json summary.json
  git -C "${DATA}" commit -m "Record 22h fast-lane sample ${RUN_KEY}"
  git -C "${DATA}" push origin "HEAD:refs/heads/${BRANCH}"

  if [ "${ITERATION}" -lt "${ITERATIONS}" ]; then
    ELAPSED="$(( $(date +%s) - ITERATION_STARTED ))"
    SLEEP_SECONDS="$((300 - ELAPSED))"
    if [ "${SLEEP_SECONDS}" -lt 1 ]; then SLEEP_SECONDS=1; fi
    sleep "${SLEEP_SECONDS}"
  fi
done
