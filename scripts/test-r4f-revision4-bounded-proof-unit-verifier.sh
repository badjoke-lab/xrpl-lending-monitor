#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_CONFIG="$ROOT_DIR/vite.r4f-revision4-bounded-proof-unit-verifier.config.ts"
BUNDLE_PATH="$ROOT_DIR/.tmp/r4f-revision4-bounded-proof-unit-verifier.mjs"
INPUT_PATH="$ROOT_DIR/ops/r4f/revision4-bounded-proof-unit-synthetic.json"
OUTPUT_PATH="${TMPDIR:-/tmp}/xrpl-lending-r4f-revision4-bounded-proof-unit-output.json"
cleanup() { rm -f "$BUNDLE_PATH" "$OUTPUT_PATH"; rmdir "$ROOT_DIR/.tmp" 2>/dev/null || true; }
trap cleanup EXIT
cd "$ROOT_DIR"
npx vite build --config "$BUNDLE_CONFIG"
node "$BUNDLE_PATH" --input "$INPUT_PATH" --output "$OUTPUT_PATH"
test -s "$OUTPUT_PATH"
node -e '
const fs=require("node:fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if(x.proofReady!==false) throw new Error("synthetic G9 unexpectedly qualified");
for(const b of ["synthetic_or_unbounded_evidence_not_qualifying","g3_not_passed","g8_not_passed","owner_authorization_missing","proof_unit_execution_not_completed"]){if(!x.blockingReasons.includes(b)) throw new Error(`missing G9 blocker: ${b}`)}
if(x.machineSummary.releaseBoundaryClosed!==true) throw new Error("G9 release boundary changed");
' "$OUTPUT_PATH"
set +e
node "$BUNDLE_PATH" --input "$INPUT_PATH" --require-proof-ready
status=$?
set -e
if [[ "$status" -ne 2 ]]; then echo "Synthetic G9 evidence must fail closed with exit code 2; got $status" >&2; exit 1; fi
