#!/usr/bin/env bash
set -euo pipefail

source_script='scripts/check-actions-workflow-allowlist.sh'
generated_script="$(mktemp)"
trap 'rm -f "$generated_script"' EXIT

python scripts/generate-actions-policy-r4f-g3-dual.py "$source_script" "$generated_script"
python scripts/normalize-actions-policy-r4f-g3-dual.py "$generated_script"
chmod 700 "$generated_script"
bash "$generated_script" "$@"
node scripts/check-r4f-g3-isolation-control-policy.mjs
node scripts/check-r4f-g3-dual-runner-policy.mjs
