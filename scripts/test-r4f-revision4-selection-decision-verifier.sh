#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_CONFIG="$ROOT_DIR/vite.r4f-revision4-selection-decision-verifier.config.ts"
BUNDLE_PATH="$ROOT_DIR/.tmp/r4f-revision4-selection-decision-verifier.mjs"
INPUT_PATH="$ROOT_DIR/ops/r4f/revision4-selection-decision-synthetic.json"
OUTPUT_PATH="${TMPDIR:-/tmp}/xrpl-lending-r4f-revision4-selection-decision-output.json"
cleanup() { rm -f "$BUNDLE_PATH" "$OUTPUT_PATH"; rmdir "$ROOT_DIR/.tmp" 2>/dev/null || true; }
trap cleanup EXIT
cd "$ROOT_DIR"
npx vite build --config "$BUNDLE_CONFIG"
node "$BUNDLE_PATH" --input "$INPUT_PATH" --output "$OUTPUT_PATH"
test -s "$OUTPUT_PATH"
node -e '
const fs=require("node:fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if(x.proofReady!==false || x.decisionReady!==false) throw new Error("unresolved G10 unexpectedly finalized");
for(const b of ["synthetic_or_nonfinal_decision_not_qualifying","qualification_still_unresolved"]){if(!x.blockingReasons.includes(b)) throw new Error(`missing G10 blocker: ${b}`)}
if(x.machineSummary.unresolvedGateCount!==6) throw new Error("current G10 unresolved gate count changed");
if(x.machineSummary.r5RequiresSeparateOwnerAuthorization!==true) throw new Error("G10 R5 authorization boundary changed");
if(x.machineSummary.releaseBoundaryClosed!==true) throw new Error("G10 release boundary changed");
' "$OUTPUT_PATH"
set +e
node "$BUNDLE_PATH" --input "$INPUT_PATH" --require-proof-ready
status=$?
set -e
if [[ "$status" -ne 2 ]]; then echo "Unresolved G10 evidence must fail closed with exit code 2; got $status" >&2; exit 1; fi
