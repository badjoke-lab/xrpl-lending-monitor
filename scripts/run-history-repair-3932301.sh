#!/usr/bin/env bash
set -euo pipefail

SOURCE_LEDGER=3800885
TARGET_LEDGER=3932301
TARGET_HASH=7D026FED85BCA2BDCFE450A0F3537707A43B4D08E1D2AE57AFBC54D88EBE1828
HISTORY_ENDPOINT=https://clio.devnet.rippletest.net:51234/
CANDIDATE_BRANCH=history-repair-3932301-data
FIXED_OBJECT_ID=AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1
FIXED_TRANSACTION_HASH=70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684
ROOT=history-repair-evidence
HISTORY_ROOT=.local/history-root
CURRENT_ROOT=.local/current-state

rm -rf "$ROOT"
mkdir -p "$ROOT"

PUBLICATION="$HISTORY_ROOT/history/publication.json"
CHANNEL="$HISTORY_ROOT/history-channel.json"
EXACT="$HISTORY_ROOT/history/index/exact/manifest.json"
CURRENT="$CURRENT_ROOT/read-model/manifest.json"

node scripts/verify-history-release-channel.mjs \
  --history-publication "$PUBLICATION" \
  --history-channel "$CHANNEL" \
  --exact-index-manifest "$EXACT" \
  > "$ROOT/source-release-channel.json"
jq -e --argjson source "$SOURCE_LEDGER" '.passed == true and .publication.ledgerIndex == $source' \
  "$ROOT/source-release-channel.json" >/dev/null
jq -e --argjson ledger "$TARGET_LEDGER" --arg hash "$TARGET_HASH" --slurpfile publication "$PUBLICATION" '
  .complete == true
  and .epochId == $publication[0].epochId
  and .ledgerIndex == $ledger
  and .ledgerHash == $hash
  and .snapshotId == "devnet-3932301-7d026fed85bc"
' "$CURRENT" >/dev/null
jq -e --argjson ledger "$TARGET_LEDGER" --arg hash "$TARGET_HASH" '
  .vars.APP_NETWORK == "devnet"
  and .vars.MAINNET_ENABLED == "false"
  and .vars.REPLACEMENT_BASE_LEDGER_INDEX == ($ledger | tostring)
  and .vars.REPLACEMENT_BASE_LEDGER_HASH == $hash
  and .triggers.crons == ["*/5 * * * *"]
  and (.queues.producers | length) == 1
  and (.queues.consumers | length) == 1
' wrangler.jsonc >/dev/null
cp "$PUBLICATION" "$ROOT/source-publication.json"
cp "$CHANNEL" "$ROOT/source-channel.json"
cp "$EXACT" "$ROOT/source-exact-index.json"
cp "$CURRENT" "$ROOT/target-current-state.json"

curl --fail-with-body --silent --show-error --retry 3 --connect-timeout 10 --max-time 60 \
  -H 'Content-Type: application/json' \
  --data '{"method":"ledger","params":[{"ledger_index":3800886,"transactions":true,"expand":true}]}' \
  "$HISTORY_ENDPOINT" > "$ROOT/clio-boundary.json"
jq -e '
  .result.status == "success"
  and .result.validated == true
  and (.result.ledger.ledger_index | tonumber) == 3800886
  and .result.ledger.parent_hash == "EAA0D29666E73D7594A52DF8000B07F346CD4DA24A9A07549612CDC7D727B700"
' "$ROOT/clio-boundary.json" >/dev/null

node .history-extension-plan-build/plan-history-extension.mjs \
  --local \
  --publication "$PUBLICATION" \
  --target-ledger "$TARGET_LEDGER" \
  --target-ledger-hash "$TARGET_HASH" \
  --segment-ledgers 500 \
  --checkpoint-every-segments 10 \
  --output "$ROOT/plan.json" \
  > "$ROOT/plan.stdout.json"
jq -e --argjson source "$SOURCE_LEDGER" --argjson target "$TARGET_LEDGER" '
  .source.endLedgerIndex == $source
  and .extension.startLedgerIndex == ($source + 1)
  and .extension.endLedgerIndex == $target
  and .extension.ledgerCount == ($target - $source)
  and .extension.segmentCount == 263
  and .target.ledgerIndex == $target
' "$ROOT/plan.json" >/dev/null

PLAN="$ROOT/plan.json"
EPOCH="$(jq -r '.epochId' "$PLAN")"
RANGE_START="$(jq -r '.extension.startLedgerIndex' "$PLAN")"
RANGE_END="$(jq -r '.extension.endLedgerIndex' "$PLAN")"
ANCHOR_ID="$(jq -r '.extension.anchorPreviousSegmentId' "$PLAN")"
ANCHOR_HASH="$(jq -r '.extension.anchorPreviousSegmentEndHash' "$PLAN")"
CHECKPOINT="$ROOT/checkpoint.json"
PREV_ID="$ANCHOR_ID"
PREV_HASH="$ANCHOR_HASH"
: > "$ROOT/manifest-paths.txt"
: > "$ROOT/segment-metrics.ndjson"
STARTED="$(date +%s)"

while IFS= read -r SEGMENT; do
  ORDINAL="$(jq -r '.ordinal' <<<"$SEGMENT")"
  SEGMENT_ID="$(jq -r '.segmentId' <<<"$SEGMENT")"
  START="$(jq -r '.startLedgerIndex' <<<"$SEGMENT")"
  END="$(jq -r '.endLedgerIndex' <<<"$SEGMENT")"
  OUT="$HISTORY_ROOT/history/${EPOCH}/${SEGMENT_ID}"
  PASSED=false
  ATTEMPTS=0
  SEGMENT_STARTED="$(date +%s)"
  for ATTEMPT in 1 2 3 4; do
    ATTEMPTS="$ATTEMPT"
    rm -rf "$OUT"
    if node .history-segment-build/run-history-segment.mjs \
      --local \
      --endpoint "$HISTORY_ENDPOINT" \
      --timeout-ms 30000 \
      --start-ledger "$START" \
      --end-ledger "$END" \
      --epoch-id "$EPOCH" \
      --segment-id "$SEGMENT_ID" \
      --previous-segment-id "$PREV_ID" \
      --previous-segment-end-hash "$PREV_HASH" \
      --source-revision "$GITHUB_SHA" \
      --output-dir "$OUT" \
      > "$ROOT/segment-${ORDINAL}.stdout.json" \
      2> "$ROOT/segment-${ORDINAL}-attempt-${ATTEMPT}.stderr.log"; then
      PASSED=true
      break
    fi
    sleep "$((ATTEMPT * 5))"
  done
  test "$PASSED" = true

  node .history-segment-checkpoint-build/update-history-segment-checkpoint.mjs \
    --local \
    --checkpoint "$CHECKPOINT" \
    --manifest "$OUT/manifest.json" \
    --epoch-id "$EPOCH" \
    --range-start-ledger "$RANGE_START" \
    --range-end-ledger "$RANGE_END" \
    --previous-segment-id "$ANCHOR_ID" \
    --previous-segment-end-hash "$ANCHOR_HASH" \
    > "$ROOT/checkpoint-${ORDINAL}.stdout.json"

  jq -nc \
    --argjson ordinal "$ORDINAL" \
    --arg segmentId "$SEGMENT_ID" \
    --argjson startLedgerIndex "$START" \
    --argjson endLedgerIndex "$END" \
    --argjson attempts "$ATTEMPTS" \
    --argjson elapsedSeconds "$(( $(date +%s) - SEGMENT_STARTED ))" \
    --argjson records "$(jq '[.files[].records] | add' "$OUT/manifest.json")" \
    '{ordinal:$ordinal,segmentId:$segmentId,startLedgerIndex:$startLedgerIndex,endLedgerIndex:$endLedgerIndex,attempts:$attempts,elapsedSeconds:$elapsedSeconds,totalRecords:$records}' \
    >> "$ROOT/segment-metrics.ndjson"
  printf '%s\n' "$OUT/manifest.json" >> "$ROOT/manifest-paths.txt"
  PREV_ID="$SEGMENT_ID"
  PREV_HASH="$(jq -r '.endLedgerHash' "$OUT/manifest.json")"
  if (( ORDINAL % 10 == 0 )); then
    echo "generated ${ORDINAL}/263 segments through ledger ${END}"
  fi
done < <(jq -c '.extension.segments[]' "$PLAN")

printf '%s\n' "$(( $(date +%s) - STARTED ))" > "$ROOT/delta-elapsed-seconds.txt"
jq -s '.' "$ROOT/segment-metrics.ndjson" > "$ROOT/segment-metrics.json"
jq -e --argjson end "$RANGE_END" '
  .nextLedgerIndex == ($end + 1) and (.completedSegments | length) == 263
' "$CHECKPOINT" >/dev/null

MANIFEST_ARGS=()
while IFS= read -r MANIFEST; do MANIFEST_ARGS+=(--manifest "$MANIFEST"); done < "$ROOT/manifest-paths.txt"
node .history-extension-artifacts-build/verify-history-extension-artifacts.mjs \
  --local --plan "$PLAN" "${MANIFEST_ARGS[@]}" > "$ROOT/plan-bound-summary.json"
node .history-segment-chain-build/verify-history-segment-chain.mjs \
  --local \
  "${MANIFEST_ARGS[@]}" \
  --epoch-id "$EPOCH" \
  --start-ledger "$RANGE_START" \
  --start-parent-hash "$(jq -r '.source.endLedgerHash' "$PLAN")" \
  --previous-segment-id "$(jq -r '.source.lastSegmentId' "$PLAN")" \
  --previous-segment-end-hash "$(jq -r '.source.endLedgerHash' "$PLAN")" \
  --end-ledger "$TARGET_LEDGER" \
  --end-ledger-hash "$TARGET_HASH" \
  > "$ROOT/chain-summary.json"
node .extended-history-publication-build/build-extended-history-publication.mjs \
  --local \
  --source-publication "$PUBLICATION" \
  --plan "$PLAN" \
  "${MANIFEST_ARGS[@]}" \
  --chain-id "canonical-devnet-3371676-${TARGET_LEDGER}" \
  --source-revision "$GITHUB_SHA" \
  --output "$ROOT/publication.json" \
  > "$ROOT/publication.stdout.json"
cp "$ROOT/publication.json" "$PUBLICATION"
jq -e --argjson ledger "$TARGET_LEDGER" --arg hash "$TARGET_HASH" '
  .complete == true
  and .endLedgerIndex == $ledger
  and .endLedgerHash == $hash
  and .segmentCount == 1136
' "$PUBLICATION" >/dev/null

INDEX_STARTED="$(date +%s)"
node .history-exact-index-build/build-history-exact-index.mjs \
  --local \
  --publication "$PUBLICATION" \
  --artifact-root "$HISTORY_ROOT" \
  --output-dir "$HISTORY_ROOT/history/index/exact" \
  --asset-prefix history/index/exact \
  --bucket-count 256 \
  --source-revision "$GITHUB_SHA" \
  > "$ROOT/exact-index.stdout.json"
printf '%s\n' "$(( $(date +%s) - INDEX_STARTED ))" > "$ROOT/exact-index-elapsed-seconds.txt"
cp "$HISTORY_ROOT/history/index/exact/manifest.json" "$ROOT/exact-index-manifest.json"
jq -e --slurpfile publication "$PUBLICATION" '
  .schemaVersion == 2
  and .network == "devnet"
  and .epochId == $publication[0].epochId
  and .chainId == $publication[0].chainId
  and .publicationSha256 == $publication[0].publicationSha256
  and .bucketCount == 256
  and .totalRecords > 0
' "$ROOT/exact-index-manifest.json" >/dev/null

python3 - <<'PY'
import gzip, hashlib, json
from pathlib import Path
root = Path('.local/history-root')
manifest = json.loads((root / 'history/index/exact/manifest.json').read_text())
terms = {
    'object': 'AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1',
    'transaction': '70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684',
}
found = {}
for label, term in terms.items():
    bucket = int(hashlib.sha256(term.encode()).hexdigest()[:8], 16) % manifest['bucketCount']
    asset = next(item for item in manifest['assets'] if item['bucket'] == bucket)
    matches = []
    with gzip.open(root / asset['path'], 'rt') as handle:
        for line in handle:
            record = json.loads(line)
            if record['term'] == term:
                matches.append(record)
    found[label] = matches
object_matches = [
    record for record in found['object']
    if record['reference']['kind'] == 'object_change'
    and record['reference']['ledgerIndex'] == 3913030
    and record['reference']['searchResult']['transactionHash'] == terms['transaction']
]
transaction_matches = [
    record for record in found['transaction']
    if record['reference']['ledgerIndex'] == 3913030
]
evidence = {
    'passed': bool(object_matches and transaction_matches),
    'objectMatches': object_matches,
    'transactionMatches': transaction_matches,
}
Path('history-repair-evidence/fixed-witness-exact-index.json').write_text(json.dumps(evidence, indent=2) + '\n')
if not evidence['passed']:
    raise SystemExit('fixed object-change witness is missing from rebuilt exact index')
PY

git -C "$HISTORY_ROOT" config user.name github-actions[bot]
git -C "$HISTORY_ROOT" config user.email 41898282+github-actions[bot]@users.noreply.github.com
git -C "$HISTORY_ROOT" add history
git -C "$HISTORY_ROOT" commit -m 'Publish immutable history repair through ledger 3932301'
DATA_SHA="$(git -C "$HISTORY_ROOT" rev-parse HEAD)"
node .history-segment-channel-build/build-history-segment-channel.mjs \
  --local \
  --publication "$PUBLICATION" \
  --publication-path history/publication.json \
  --exact-index-manifest "$HISTORY_ROOT/history/index/exact/manifest.json" \
  --exact-index-manifest-path history/index/exact/manifest.json \
  --data-commit-sha "$DATA_SHA" \
  --output "$CHANNEL"
git -C "$HISTORY_ROOT" add history-channel.json
git -C "$HISTORY_ROOT" commit -m 'Activate immutable history repair candidate'
CANDIDATE_SHA="$(git -C "$HISTORY_ROOT" rev-parse HEAD)"
git -C "$HISTORY_ROOT" push --force origin "HEAD:refs/heads/${CANDIDATE_BRANCH}"
printf '%s\n' "$DATA_SHA" > "$ROOT/candidate-data-commit-sha.txt"
printf '%s\n' "$CANDIDATE_SHA" > "$ROOT/candidate-commit-sha.txt"

node .candidate-source-rehearsal-build/rehearse-candidate-sources.mjs \
  --local \
  --repository badjoke-lab/xrpl-lending-monitor \
  --history-branch "$CANDIDATE_BRANCH" \
  --current-state-branch current-state-data \
  > "$ROOT/remote-rehearsal.json"
jq -e --argjson ledger "$TARGET_LEDGER" --arg hash "$TARGET_HASH" '
  .passed == true
  and .ledgerIndex == $ledger
  and .ledgerHash == $hash
  and (.exactReads | length) == 3
' "$ROOT/remote-rehearsal.json" >/dev/null

jq -n \
  --slurpfile plan "$ROOT/plan.json" \
  --slurpfile publication "$ROOT/publication.json" \
  --slurpfile exact "$ROOT/exact-index-manifest.json" \
  --slurpfile witness "$ROOT/fixed-witness-exact-index.json" \
  --slurpfile remote "$ROOT/remote-rehearsal.json" \
  --slurpfile segments "$ROOT/segment-metrics.json" \
  --arg endpoint "$HISTORY_ENDPOINT" \
  --arg candidateBranch "$CANDIDATE_BRANCH" \
  --arg candidateCommitSha "$CANDIDATE_SHA" \
  --argjson deltaElapsedSeconds "$(cat "$ROOT/delta-elapsed-seconds.txt")" \
  --argjson exactIndexElapsedSeconds "$(cat "$ROOT/exact-index-elapsed-seconds.txt")" '
  {
    passed: true,
    endpoint: $endpoint,
    source: $plan[0].source,
    extension: ($plan[0].extension + {elapsedSeconds:$deltaElapsedSeconds,segments:$segments[0]}),
    target: {
      ledgerIndex: $publication[0].endLedgerIndex,
      ledgerHash: $publication[0].endLedgerHash,
      publicationSha256: $publication[0].publicationSha256,
      chainId: $publication[0].chainId
    },
    exactIndex: {
      manifestSha256: $exact[0].manifestSha256,
      totalRecords: $exact[0].totalRecords,
      elapsedSeconds: $exactIndexElapsedSeconds
    },
    fixedWitness: $witness[0],
    candidate: {branch:$candidateBranch,commitSha:$candidateCommitSha},
    remoteRehearsal: $remote[0],
    productionMutation: false
  }
' > "$ROOT/evidence.json"
jq -e --argjson ledger "$TARGET_LEDGER" --arg hash "$TARGET_HASH" '
  .passed == true
  and .target.ledgerIndex == $ledger
  and .target.ledgerHash == $hash
  and .fixedWitness.passed == true
  and .remoteRehearsal.passed == true
  and .productionMutation == false
' "$ROOT/evidence.json" >/dev/null
