#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_CONFIG="$ROOT_DIR/vite.r4f-revision4-memory-evidence-verifier.config.ts"
BUNDLE_PATH="$ROOT_DIR/.tmp/r4f-revision4-memory-evidence-verifier.mjs"
INPUT_PATH="$ROOT_DIR/ops/r4f/revision4-memory-evidence-synthetic.json"
OUTPUT_PATH="${TMPDIR:-/tmp}/xrpl-lending-r4f-revision4-memory-evidence-output.json"

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
  throw new Error("synthetic G4 evidence unexpectedly qualified")
}
if (!result.blockingReasons.includes("synthetic_or_unbounded_evidence_not_qualifying")) {
  throw new Error("synthetic G4 blocker missing")
}
if (result.machineSummary.memoryHaltBytes !== 234881024) {
  throw new Error("G4 memory halt changed")
}
if (result.machineSummary.claimCapLedgers !== 12) {
  throw new Error("G4 claim cap changed")
}
' "$OUTPUT_PATH"

set +e
node "$BUNDLE_PATH" --input "$INPUT_PATH" --require-proof-ready
status=$?
set -e
if [[ "$status" -ne 2 ]]; then
  echo "Synthetic G4 evidence must fail closed with exit code 2; got $status" >&2
  exit 1
fi
