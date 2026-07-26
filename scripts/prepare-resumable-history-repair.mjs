import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function replaceExactlyOnce(source, target, replacement, label) {
  const first = source.indexOf(target)
  if (first < 0) throw new Error(`Missing resumable repair patch target: ${label}`)
  if (source.indexOf(target, first + target.length) >= 0) {
    throw new Error(`Duplicate resumable repair patch target: ${label}`)
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`
}

const GENERATION_START = [
  '  PASSED=false',
  '  ATTEMPTS=0',
  '  SEGMENT_STARTED="$(date +%s)"',
  '  for ATTEMPT in 1 2 3 4; do',
].join('\n')

const RESUMABLE_GENERATION_START = [
  '  PASSED=false',
  '  REUSED=false',
  '  ATTEMPTS=0',
  '  SEGMENT_STARTED="$(date +%s)"',
  '  if [[ -f "$OUT/manifest.json" ]] && jq -e \\',
  '    --arg epoch "$EPOCH" \\',
  '    --arg segmentId "$SEGMENT_ID" \\',
  '    --arg previousId "$PREV_ID" \\',
  '    --arg previousHash "$PREV_HASH" \\',
  '    --argjson start "$START" \\',
  '    --argjson end "$END" \'',
  "    '.schemaVersion == 1",
  "      and .network == \"devnet\"",
  "      and .epochId == $epoch",
  "      and .segmentId == $segmentId",
  "      and .startLedgerIndex == $start",
  "      and .endLedgerIndex == $end",
  "      and .previousSegmentId == $previousId",
  "      and .previousSegmentEndHash == $previousHash",
  "      and .startParentHash == $previousHash' \\",
  '    "$OUT/manifest.json" >/dev/null; then',
  '    PASSED=true',
  '    REUSED=true',
  "    while IFS=$'\\t' read -r FILE_PATH FILE_SHA; do",
  '      if [[ ! -f "$OUT/$FILE_PATH" ]] || [[ "$(sha256sum "$OUT/$FILE_PATH" | cut -d\x27 \x27 -f1)" != "${FILE_SHA,,}" ]]; then',
  '        PASSED=false',
  '        REUSED=false',
  '        break',
  '      fi',
  "    done < <(jq -r '.files[] | [.path, .sha256] | @tsv' \"$OUT/manifest.json\")",
  '    if [[ "$REUSED" = true ]]; then',
  '      echo "reusing verified segment ${ORDINAL}/263 through ledger ${END}"',
  '    fi',
  '  fi',
  '  if [[ "$PASSED" != true ]]; then',
  '    for ATTEMPT in 1 2 3 4; do',
].join('\n')

const GENERATION_END = [
  '    sleep "$((ATTEMPT * 5))"',
  '  done',
  '  test "$PASSED" = true',
].join('\n')

const RESUMABLE_GENERATION_END = [
  '      sleep "$((ATTEMPT * 5))"',
  '    done',
  '  fi',
  '  test "$PASSED" = true',
].join('\n')

const PROGRESS_BLOCK = [
  '  if (( ORDINAL % 10 == 0 )); then',
  '    echo "generated ${ORDINAL}/263 segments through ledger ${END}"',
  '  fi',
].join('\n')

const CHECKPOINT_BLOCK = [
  '  if (( ORDINAL % 10 == 0 || ORDINAL == 263 )); then',
  '    git -C "$HISTORY_ROOT" add "history/${EPOCH}"',
  '    if ! git -C "$HISTORY_ROOT" diff --cached --quiet; then',
  '      git -C "$HISTORY_ROOT" -c user.name=github-actions[bot] -c user.email=41898282+github-actions[bot]@users.noreply.github.com commit -m "Checkpoint immutable history repair through segment ${ORDINAL}"',
  '    fi',
  '    git -C "$HISTORY_ROOT" push origin "HEAD:refs/heads/${CANDIDATE_BRANCH}"',
  '    echo "checkpointed ${ORDINAL}/263 segments through ledger ${END}"',
  '  fi',
].join('\n')

export function patchHistoryRepairRunner(source) {
  let result = replaceExactlyOnce(
    source,
    GENERATION_START,
    RESUMABLE_GENERATION_START,
    'segment generation start',
  )
  result = replaceExactlyOnce(
    result,
    GENERATION_END,
    RESUMABLE_GENERATION_END,
    'segment generation end',
  )
  return replaceExactlyOnce(result, PROGRESS_BLOCK, CHECKPOINT_BLOCK, 'checkpoint progress block')
}

async function main() {
  const input = resolve(process.argv[2] ?? 'scripts/run-history-repair-3932301.sh')
  const output = resolve(process.argv[3] ?? '.local/run-history-repair-resumable-3932301.sh')
  const source = await readFile(input, 'utf8')
  const patched = patchHistoryRepairRunner(source)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, patched, { encoding: 'utf8', mode: 0o755 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
