#!/usr/bin/env python3
from pathlib import Path
import re

PARENT = Path('.github/scripts/run-four-hour-history-maintenance.sh')
CANDIDATE = Path('.github/scripts/run-rolling-checkpoint-candidate.sh')

parent_text = PARENT.read_text()
parent_text = parent_text.replace('read_window_size:"4"', 'read_window_size:"16"')

live_head = r'''live_head() {
  local request response endpoint value attempt
  request='{"method":"ledger","params":[{"ledger_index":"validated","transactions":false,"expand":false}]}'
  for endpoint in \
    https://s.devnet.rippletest.net:51234/ \
    https://devnet.honeycluster.io/; do
    for attempt in 1 2 3; do
      if response="$(printf '%s' "$request" \
        | curl --fail-with-body --silent --show-error --retry 2 --retry-all-errors \
            --connect-timeout 10 --max-time 45 \
            -H 'content-type: application/json' \
            --data-binary @- "$endpoint" 2>/dev/null)"; then
        value="$(printf '%s' "$response" \
          | jq -er '.result.ledger_index // .result.ledger.ledger_index // empty' 2>/dev/null || true)"
        if [[ "$value" =~ ^[0-9]+$ ]]; then
          printf '%s\n' "$value"
          return 0
        fi
      fi
      sleep $((attempt * 2))
    done
  done
  return 1
}'''
parent_text, count = re.subn(
    r'live_head\(\) \{\n.*?\n\}\n\ncancel_obsolete_runs\(\)',
    live_head + '\n\ncancel_obsolete_runs()',
    parent_text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'expected one live_head function, found {count}')
PARENT.write_text(parent_text)

candidate_text = CANDIDATE.read_text()
old = '''  PASSED=false
  for ATTEMPT in 1 2 3; do
    if node .history-segment-build/run-history-segment.mjs \\
      --local \\
      --endpoint https://s.devnet.rippletest.net:51234/ \\
      --timeout-ms 12000 \\
      --read-window-size "${READ_WINDOW_SIZE}" \\
      --start-ledger "${START}" \\
      --end-ledger "${END}" \\
      --epoch-id "${EPOCH}" \\
      --segment-id "${SEGMENT_ID}" \\
      --previous-segment-id "${PREV_ID}" \\
      --previous-segment-end-hash "${PREV_HASH}" \\
      --source-revision "${GITHUB_SHA}" \\
      --output-dir "${OUT}" \\
      > "${ROOT}/segment-${ORDINAL}.stdout.json"; then
      PASSED=true
      break
    fi
    sleep $((ATTEMPT * 10))
  done
  test "${PASSED}" = true
'''
new = '''  PASSED=false
  : > "${ROOT}/segment-${ORDINAL}.attempts.log"
  WINDOWS=("${READ_WINDOW_SIZE}" 8 4 2 1)
  ENDPOINTS=("https://s.devnet.rippletest.net:51234/" "https://devnet.honeycluster.io/")
  LAST_WINDOW=""
  for WINDOW in "${WINDOWS[@]}"; do
    if [ "${WINDOW}" -gt "${READ_WINDOW_SIZE}" ] || [ "${WINDOW}" = "${LAST_WINDOW}" ]; then
      continue
    fi
    LAST_WINDOW="${WINDOW}"
    for ENDPOINT in "${ENDPOINTS[@]}"; do
      for ATTEMPT in 1 2; do
        rm -rf "${OUT}"
        ATTEMPT_STDOUT="${ROOT}/segment-${ORDINAL}-w${WINDOW}-a${ATTEMPT}.stdout.json"
        printf 'segment=%s window=%s endpoint=%s attempt=%s\\n' "${ORDINAL}" "${WINDOW}" "${ENDPOINT}" "${ATTEMPT}" >> "${ROOT}/segment-${ORDINAL}.attempts.log"
        if node .history-segment-build/run-history-segment.mjs \\
          --local \\
          --endpoint "${ENDPOINT}" \\
          --timeout-ms 20000 \\
          --read-window-size "${WINDOW}" \\
          --start-ledger "${START}" \\
          --end-ledger "${END}" \\
          --epoch-id "${EPOCH}" \\
          --segment-id "${SEGMENT_ID}" \\
          --previous-segment-id "${PREV_ID}" \\
          --previous-segment-end-hash "${PREV_HASH}" \\
          --source-revision "${GITHUB_SHA}" \\
          --output-dir "${OUT}" \\
          > "${ATTEMPT_STDOUT}" 2>> "${ROOT}/segment-${ORDINAL}.attempts.log"; then
          cp "${ATTEMPT_STDOUT}" "${ROOT}/segment-${ORDINAL}.stdout.json"
          jq -n --arg endpoint "${ENDPOINT}" --argjson readWindowSize "${WINDOW}" --argjson attempt "${ATTEMPT}" \\
            '{endpoint:$endpoint,readWindowSize:$readWindowSize,attempt:$attempt}' \\
            > "${ROOT}/segment-${ORDINAL}.transport.json"
          PASSED=true
          break 3
        fi
        sleep $((ATTEMPT * 5))
      done
    done
  done
  if [ "${PASSED}" != true ]; then
    cat "${ROOT}/segment-${ORDINAL}.attempts.log" >&2
    exit 1
  fi
'''
if old in candidate_text:
    candidate_text = candidate_text.replace(old, new, 1)
elif 'segment-${ORDINAL}.attempts.log' not in candidate_text:
    raise SystemExit('candidate retry block not found')
CANDIDATE.write_text(candidate_text)
