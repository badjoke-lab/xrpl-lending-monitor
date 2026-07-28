#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_RUN_ID:?SOURCE_RUN_ID is required}"
: "${COMBINED_HISTORY_BRANCH:?COMBINED_HISTORY_BRANCH is required}"
: "${CURRENT_STATE_BRANCH:?CURRENT_STATE_BRANCH is required}"
: "${TARGET_HASH:?TARGET_HASH is required}"

EVIDENCE="$RUNNER_TEMP/combined-history-resume-evidence"
BASE=.local/base-history
DELTA=.local/delta-history
OUTPUT="$RUNNER_TEMP/combined-exact"
rm -rf "$EVIDENCE" "$OUTPUT"
mkdir -p "$EVIDENCE" "$OUTPUT"
cp -a .local/prepare/evidence/. "$EVIDENCE/"
IMPLEMENTATION_SHA="$(cat "$EVIDENCE/implementation-sha.txt")"

python - <<'PY'
from pathlib import Path
path = Path('scripts/rehearse-candidate-sources.ts')
text = path.read_text()
needle = "    '2A3920F5B65CDEB35AEE7E4606736A7F0423D804A874EC3225BCD39A7A30A4D4',\n  ]"
replacement = "    '2A3920F5B65CDEB35AEE7E4606736A7F0423D804A874EC3225BCD39A7A30A4D4',\n    '70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684',\n    'AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1',\n  ]"
if needle not in text:
    raise SystemExit('candidate rehearsal witness boundary changed')
path.write_text(text.replace(needle, replacement))
PY
pnpm build:candidate-source-rehearsal

FIRST="$DELTA/history/devnet-3371675/devnet-3371675-3800886-3801385/manifest.json"
PREVIOUS_ID="$(jq -r .source.lastSegmentId "$EVIDENCE/extension-plan.json")"
PREVIOUS_HASH="$(jq -r .source.endLedgerHash "$EVIDENCE/extension-plan.json")"
tmp="${FIRST}.tmp"
jq -c --arg id "$PREVIOUS_ID" --arg hash "$PREVIOUS_HASH" \
  '.previousSegmentId = $id | .previousSegmentEndHash = $hash' "$FIRST" > "$tmp"
printf '\n' >> "$tmp"
mv "$tmp" "$FIRST"

VERIFY_ARGS=()
while IFS= read -r segment_id; do
  VERIFY_ARGS+=(--manifest "$DELTA/history/devnet-3371675/$segment_id/manifest.json")
done < <(jq -r '.extension.segments[].segmentId' "$EVIDENCE/extension-plan.json")
node .history-extension-artifacts-build/verify-history-extension-artifacts.mjs \
  --local --plan "$EVIDENCE/extension-plan.json" "${VERIFY_ARGS[@]}" \
  > "$EVIDENCE/final-extension-artifacts.json"

mkdir -p "$BASE/history/devnet-3371675"
while IFS= read -r segment_id; do
  source="$DELTA/history/devnet-3371675/$segment_id"
  target="$BASE/history/devnet-3371675/$segment_id"
  test -d "$source"
  test ! -e "$target"
  mv "$source" "$target"
done < <(jq -r '.extension.segments[].segmentId' "$EVIDENCE/extension-plan.json")
rm -rf "$DELTA/history/index"
cp "$EVIDENCE/combined-publication.json" "$BASE/history/publication.json"

cp .local/exact-parts/*.ndjson.gz "$OUTPUT/"
test "$(find "$OUTPUT" -maxdepth 1 -name '*.ndjson.gz' | wc -l)" -eq 256
PART_ARGS=()
while IFS= read -r part; do
  PART_ARGS+=(--part-manifest "$part")
done < <(find .local/exact-parts -maxdepth 1 -name 'part-*.json' | sort)
test "$((${#PART_ARGS[@]} / 2))" -eq 4

node .incremental-history-exact-index-build/build-incremental-history-exact-index.mjs \
  --local \
  --mode assemble \
  --publication "$EVIDENCE/combined-publication.json" \
  --plan "$EVIDENCE/extension-plan.json" \
  --base-index-dir "$BASE/history/index/exact" \
  --base-publication "$EVIDENCE/base-publication.json" \
  --output-dir "$OUTPUT" \
  --asset-prefix history/index/exact \
  --source-revision "$IMPLEMENTATION_SHA" \
  "${PART_ARGS[@]}" \
  > "$EVIDENCE/incremental-exact-index.json"
jq -e '.passed == true and .baseRecords > 0 and .addedRecords > 0 and .totalRecords == (.baseRecords + .addedRecords)' \
  "$EVIDENCE/incremental-exact-index.json" >/dev/null

rm -rf "$BASE/history/index/exact"
mkdir -p "$BASE/history/index"
mv "$OUTPUT" "$BASE/history/index/exact"
cp "$BASE/history/index/exact/manifest.json" "$EVIDENCE/exact-index-manifest.json"
df -h > "$EVIDENCE/disk-after-assembly.txt"
du -sh "$BASE" "$BASE/history/index/exact" .local/exact-parts > "$EVIDENCE/sizes-after-assembly.txt"

TERMS=(
  54A69056FD4D8017F52BB40FA27B6D155F2B07ECF0F24754A26EAF46F82045D0
  351B2FB507346B8B001148ED9D92A394D72FCA6CE87109A95B2C61A27B992F6E
  2A3920F5B65CDEB35AEE7E4606736A7F0423D804A874EC3225BCD39A7A30A4D4
  70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684
  AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1
)
failed=0
for term in "${TERMS[@]}"; do
  echo "[witness] start term=$term"
  set +e
  node .history-exact-rehearsal-build/rehearse-history-exact-lookups.mjs \
    --local \
    --publication "$BASE/history/publication.json" \
    --exact-index-manifest "$BASE/history/index/exact/manifest.json" \
    --artifact-root "$BASE" \
    --term "$term" \
    > "$EVIDENCE/witness-$term.json" \
    2> >(tee "$EVIDENCE/witness-$term.stderr.log" >&2)
  code=$?
  set -e
  printf '%s\n' "$code" > "$EVIDENCE/witness-$term.exit-code.txt"
  if test "$code" -ne 0; then
    failed=1
    echo "[witness] failed term=$term exit=$code"
  else
    jq -e '.passed == true and .termCount == 1 and .terms[0].referenceCount > 0 and .terms[0].matchedRecords > 0' \
      "$EVIDENCE/witness-$term.json" >/dev/null
    echo "[witness] passed term=$term"
  fi
done

python - "$EVIDENCE" "${TERMS[@]}" <<'PY'
import json
import sys
from pathlib import Path
root = Path(sys.argv[1])
terms = sys.argv[2:]
results = []
for term in terms:
    code = int((root / f'witness-{term}.exit-code.txt').read_text().strip())
    stdout = root / f'witness-{term}.json'
    stderr = root / f'witness-{term}.stderr.log'
    payload = None
    if stdout.exists() and stdout.stat().st_size:
        payload = json.loads(stdout.read_text())
    results.append({
        'term': term,
        'exitCode': code,
        'passed': code == 0 and bool(payload and payload.get('passed')),
        'result': payload,
        'stderr': stderr.read_text() if stderr.exists() else '',
    })
summary = {'schemaVersion': 1, 'passed': all(item['passed'] for item in results), 'terms': results}
(root / 'witness-summary.json').write_text(json.dumps(summary, separators=(',', ':')) + '\n')
PY
jq . "$EVIDENCE/witness-summary.json"
if test "$failed" -ne 0; then
  echo "One or more witness rehearsals failed" >&2
  exit 1
fi
jq -e '.passed == true and (.terms | length) == 5 and all(.terms[]; .passed == true)' \
  "$EVIDENCE/witness-summary.json" >/dev/null

OLD_SHA="$(git ls-remote origin "refs/heads/$COMBINED_HISTORY_BRANCH" | awk '{print $1}')"
printf '%s\n' "$OLD_SHA" > "$EVIDENCE/combined-branch-before.txt"
git -C "$BASE" config user.name github-actions[bot]
git -C "$BASE" config user.email 41898282+github-actions[bot]@users.noreply.github.com
git -C "$BASE" switch -C combined-history-candidate-publish
git -C "$BASE" add history
git -C "$BASE" commit -m "Publish combined immutable-history candidate through 3932301"
DATA_SHA="$(git -C "$BASE" rev-parse HEAD)"

(
  cd "$BASE"
  DATA_SHA="$DATA_SHA" node --input-type=module - <<'NODE'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
const publicationText = readFileSync('history/publication.json', 'utf8')
const exactText = readFileSync('history/index/exact/manifest.json', 'utf8')
const publication = JSON.parse(publicationText)
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const channel = {
  schemaVersion: 1,
  active: {
    dataCommitSha: process.env.DATA_SHA,
    publicationPath: 'history/publication.json',
    publicationSha256: sha256(publicationText),
    chainId: publication.chainId,
    epochId: publication.epochId,
    exactIndex: {
      manifestPath: 'history/index/exact/manifest.json',
      manifestSha256: sha256(exactText),
    },
  },
  updatedAt: publication.publishedAt,
}
writeFileSync('history-channel.json', `${JSON.stringify(channel)}\n`)
NODE
)

git -C "$BASE" add history-channel.json
git -C "$BASE" commit -m "Activate combined immutable-history candidate through 3932301"
CANDIDATE_SHA="$(git -C "$BASE" rev-parse HEAD)"
if test -n "$OLD_SHA"; then
  git -C "$BASE" push --force-with-lease="refs/heads/$COMBINED_HISTORY_BRANCH:$OLD_SHA" origin "HEAD:refs/heads/$COMBINED_HISTORY_BRANCH"
else
  git -C "$BASE" push origin "HEAD:refs/heads/$COMBINED_HISTORY_BRANCH"
fi
test "$(git ls-remote origin "refs/heads/$COMBINED_HISTORY_BRANCH" | awk '{print $1}')" = "$CANDIDATE_SHA"
printf '%s\n' "$DATA_SHA" > "$EVIDENCE/combined-data-commit.txt"
printf '%s\n' "$CANDIDATE_SHA" > "$EVIDENCE/combined-branch-head.txt"
cp "$BASE/history-channel.json" "$EVIDENCE/history-channel.json"

node .candidate-source-rehearsal-build/rehearse-candidate-sources.mjs \
  --local \
  --repository "$GITHUB_REPOSITORY" \
  --history-branch "$COMBINED_HISTORY_BRANCH" \
  --current-state-branch "$CURRENT_STATE_BRANCH" \
  > "$EVIDENCE/remote-rehearsal.json" \
  2> >(tee "$EVIDENCE/remote-rehearsal.stderr.log" >&2)
jq -e --arg hash "$TARGET_HASH" '
  .passed == true
  and .ledgerIndex == 3932301
  and .ledgerHash == $hash
  and .segmentCount == 1136
  and (.exactReads | length) == 5
  and all(.exactReads[]; .references > 0)
' "$EVIDENCE/remote-rehearsal.json" >/dev/null

jq -n \
  --arg sourceRunId "$SOURCE_RUN_ID" \
  --arg resumeRunId "$GITHUB_RUN_ID" \
  --arg dataSha "$DATA_SHA" \
  --arg candidateSha "$CANDIDATE_SHA" \
  --slurpfile publication "$EVIDENCE/combined-publication.json" \
  --slurpfile exact "$EVIDENCE/incremental-exact-index.json" \
  --slurpfile witnesses "$EVIDENCE/witness-summary.json" \
  --slurpfile remote "$EVIDENCE/remote-rehearsal.json" '
  {
    schemaVersion: 1,
    passed: true,
    sourceRunId: $sourceRunId,
    resumeRunId: $resumeRunId,
    dataCommitSha: $dataSha,
    candidateBranchHead: $candidateSha,
    segmentCount: $publication[0].segmentCount,
    ledgerCount: $publication[0].ledgerCount,
    terminalLedger: $publication[0].endLedgerIndex,
    terminalHash: $publication[0].endLedgerHash,
    exactIndex: $exact[0],
    witnesses: $witnesses[0],
    remoteRehearsal: $remote[0],
    productionMutation: false,
    d1Mutation: false,
    workerDeploy: false
  }
' > "$EVIDENCE/result.json"
