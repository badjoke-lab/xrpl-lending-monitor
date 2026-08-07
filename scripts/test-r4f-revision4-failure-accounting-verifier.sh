#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_CONFIG="$ROOT_DIR/vite.r4f-revision4-failure-accounting-verifier.config.ts"
BUNDLE_PATH="$ROOT_DIR/.tmp/r4f-revision4-failure-accounting-verifier.mjs"
INPUT_PATH="$ROOT_DIR/ops/r4f/revision4-failure-accounting-synthetic.json"
OUTPUT_PATH="${TMPDIR:-/tmp}/xrpl-lending-r4f-revision4-failure-accounting-output.json"

cleanup() {
  rm -f "$BUNDLE_PATH"
  rmdir "$ROOT_DIR/.tmp" 2>/dev/null || true
  rm -f "$OUTPUT_PATH"
}
trap cleanup EXIT

cd "$ROOT_DIR"
npx vite build --config "$BUNDLE_CONFIG"
node "$BUNDLE_PATH" --input "$INPUT_PATH" --output "$OUTPUT_PATH"

test -s "$OUTPUT_PATH"
node -e '
const fs = require("node:fs")
const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
if (result.proofReady !== false) {
  throw new Error("synthetic G7 evidence unexpectedly qualified")
}
for (const blocker of [
  "synthetic_or_unbounded_evidence_not_qualifying",
  "g3_provider_reconciliation_not_passed",
  "g5_steady_convergence_not_passed",
  "g6_catchup_convergence_not_passed",
]) {
  if (!result.blockingReasons.includes(blocker)) {
    throw new Error(`synthetic G7 blocker missing: ${blocker}`)
  }
}
for (const check of [
  "failedReservationsPreserved",
  "retryAccountingAppended",
  "rollbackAccountingPreserved",
  "leaseReclaimAccountingPreserved",
  "adoptedSourceAccountingPreserved",
  "repairOnlySeparatedFromOrdinarySuccess",
]) {
  if (result.machineSummary[check] !== true) {
    throw new Error(`synthetic G7 structural check failed: ${check}`)
  }
}
' "$OUTPUT_PATH"

set +e
node "$BUNDLE_PATH" --input "$INPUT_PATH" --require-proof-ready
status=$?
set -e
if [[ "$status" -ne 2 ]]; then
  echo "Synthetic G7 evidence must fail closed with exit code 2; got $status" >&2
  exit 1
fi
