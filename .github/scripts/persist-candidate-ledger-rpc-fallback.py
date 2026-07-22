#!/usr/bin/env python3
from pathlib import Path

path = Path('.github/scripts/run-rolling-checkpoint-candidate.sh')
text = path.read_text()
old = '''jq -n '{method:"ledger",params:[{ledger_index:"validated",transactions:false,expand:false}]}' > "${ROOT}/live-head-request.json"
curl --fail-with-body --silent --show-error --retry 3 \\
  -H 'Content-Type: application/json' \\
  --data @"${ROOT}/live-head-request.json" \\
  https://s.devnet.rippletest.net:51234/ \\
  > "${ROOT}/live-head-response.json"
LIVE_LEDGER="$(jq -r '.result.ledger_index // .result.ledger.ledger_index // empty' "${ROOT}/live-head-response.json")"
test "${LIVE_LEDGER}" -gt "${SOURCE_LEDGER}"
MAX_TARGET="$((SOURCE_LEDGER + MAX_DELTA_LEDGERS))"
if [ "${LIVE_LEDGER}" -lt "${MAX_TARGET}" ]; then TARGET="${LIVE_LEDGER}"; else TARGET="${MAX_TARGET}"; fi

jq -n --argjson ledger_index "${TARGET}" '{method:"ledger",params:[{ledger_index:$ledger_index,transactions:false,expand:false}]}' > "${ROOT}/target-request.json"
curl --fail-with-body --silent --show-error --retry 3 \\
  -H 'Content-Type: application/json' \\
  --data @"${ROOT}/target-request.json" \\
  https://s.devnet.rippletest.net:51234/ \\
  > "${ROOT}/target-response.json"
TARGET_HASH="$(jq -r '.result.ledger_hash // .result.ledger.ledger_hash // empty' "${ROOT}/target-response.json")"
printf '%s' "${TARGET_HASH}" | grep -Eq '^[A-F0-9]{64}$'
'''
new = '''rpc_ledger() {
  local request_file="$1" output_file="$2" label="$3" endpoint attempt tmp ledger_index ledger_hash
  for endpoint in \\
    https://s.devnet.rippletest.net:51234/ \\
    https://devnet.honeycluster.io/; do
    for attempt in 1 2 3; do
      tmp="${output_file}.tmp"
      if curl --fail-with-body --silent --show-error --retry 2 --retry-all-errors \\
        --connect-timeout 10 --max-time 60 \\
        -H 'Content-Type: application/json' \\
        --data @"${request_file}" \\
        "${endpoint}" > "${tmp}"; then
        ledger_index="$(jq -r '.result.ledger_index // .result.ledger.ledger_index // empty' "${tmp}" 2>/dev/null || true)"
        ledger_hash="$(jq -r '.result.ledger_hash // .result.ledger.ledger_hash // empty' "${tmp}" 2>/dev/null || true)"
        if [[ "${ledger_index}" =~ ^[0-9]+$ ]] && [[ "${ledger_hash}" =~ ^[A-F0-9]{64}$ ]]; then
          mv "${tmp}" "${output_file}"
          jq -n --arg endpoint "${endpoint}" --argjson attempt "${attempt}" --arg label "${label}" \\
            '{label:$label,endpoint:$endpoint,attempt:$attempt}' > "${output_file%.json}-transport.json"
          return 0
        fi
        cp "${tmp}" "${output_file%.json}-${label}-attempt-${attempt}.json" || true
      fi
      rm -f "${tmp}"
      sleep $((attempt * 2))
    done
  done
  return 1
}

jq -n '{method:"ledger",params:[{ledger_index:"validated",transactions:false,expand:false}]}' > "${ROOT}/live-head-request.json"
rpc_ledger "${ROOT}/live-head-request.json" "${ROOT}/live-head-response.json" live-head
LIVE_LEDGER="$(jq -r '.result.ledger_index // .result.ledger.ledger_index' "${ROOT}/live-head-response.json")"
test "${LIVE_LEDGER}" -gt "${SOURCE_LEDGER}"
MAX_TARGET="$((SOURCE_LEDGER + MAX_DELTA_LEDGERS))"
if [ "${LIVE_LEDGER}" -lt "${MAX_TARGET}" ]; then TARGET="${LIVE_LEDGER}"; else TARGET="${MAX_TARGET}"; fi

jq -n --argjson ledger_index "${TARGET}" '{method:"ledger",params:[{ledger_index:$ledger_index,transactions:false,expand:false}]}' > "${ROOT}/target-request.json"
rpc_ledger "${ROOT}/target-request.json" "${ROOT}/target-response.json" target
TARGET_HASH="$(jq -r '.result.ledger_hash // .result.ledger.ledger_hash' "${ROOT}/target-response.json")"
printf '%s' "${TARGET_HASH}" | grep -Eq '^[A-F0-9]{64}$'
'''
if old in text:
    text = text.replace(old, new, 1)
elif 'rpc_ledger() {' not in text:
    raise SystemExit('candidate ledger RPC block not found')
path.write_text(text)
