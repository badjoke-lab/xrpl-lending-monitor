#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_CONFIG="$ROOT_DIR/vite.r4f-revision4-restore-operator-verifier.config.ts"
BUNDLE_PATH="$ROOT_DIR/.tmp/r4f-revision4-restore-operator-verifier.mjs"
INPUT_PATH="$ROOT_DIR/ops/r4f/revision4-restore-operator-synthetic.json"
OUTPUT_PATH="${TMPDIR:-/tmp}/xrpl-lending-r4f-revision4-restore-operator-output.json"

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
if (result.proofReady !== false) throw new Error("synthetic G8 evidence unexpectedly qualified")
for (const blocker of [
  "synthetic_or_unbounded_evidence_not_qualifying",
  "g3_provider_reconciliation_not_passed",
  "g5_steady_convergence_not_passed",
  "g6_catchup_convergence_not_passed",
  "g7_failure_accounting_not_passed",
]) {
  if (!result.blockingReasons.includes(blocker)) {
    throw new Error(`synthetic G8 blocker missing: ${blocker}`)
  }
}
if (result.machineSummary.allProofsBoundToRevision4Identity !== true) {
  throw new Error("synthetic G8 proof identities are not revision-4 bound")
}
if (result.machineSummary.releaseBoundaryClosed !== true) {
  throw new Error("synthetic G8 release boundary changed")
}
' "$OUTPUT_PATH"

set +e
node "$BUNDLE_PATH" --input "$INPUT_PATH" --require-proof-ready
status=$?
set -e
if [[ "$status" -ne 2 ]]; then
  echo "Synthetic G8 evidence must fail closed with exit code 2; got $status" >&2
  exit 1
fi
