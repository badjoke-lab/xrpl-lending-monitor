#!/usr/bin/env bash
set -euo pipefail

build_directory='.r4f-revision4-provider-capture-verifier-build'
output_directory='r4f-revision4-provider-capture-verifier-evidence'
fixture='ops/r4f/revision4-provider-capture-synthetic.json'
verifier="${build_directory}/verify-r4f-revision4-provider-capture.mjs"

unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_PASSWORD || true
rm -rf "$build_directory" "$output_directory"
mkdir -p "$output_directory"

pnpm exec vite build --config vite.r4f-revision4-provider-capture-verifier.config.ts \
  > "${output_directory}/build.log"

node "$verifier" \
  --input "$fixture" \
  --output "${output_directory}/synthetic-evidence.json" \
  > "${output_directory}/synthetic-summary.json"

grep -q '"captureState": "synthetic_test"' "${output_directory}/synthetic-evidence.json"
grep -q '"authorizationVerified": false' "${output_directory}/synthetic-evidence.json"
grep -q '"g3Qualified": false' "${output_directory}/synthetic-evidence.json"
grep -q '"profileSelected": false' "${output_directory}/synthetic-evidence.json"
grep -q '"r5Authorized": false' "${output_directory}/synthetic-evidence.json"

set +e
node "$verifier" \
  --input "$fixture" \
  --output "${output_directory}/required-qualified-evidence.json" \
  --require-qualified \
  > "${output_directory}/required-qualified-summary.json"
status=$?
set -e

if [[ "$status" -ne 2 ]]; then
  echo "synthetic capture must exit 2 when qualification is required; got ${status}" >&2
  exit 1
fi

test -s "${output_directory}/required-qualified-evidence.json"
grep -q '"g3Qualified": false' "${output_directory}/required-qualified-evidence.json"

cat > "${output_directory}/summary.md" <<'EOF'
## R4F revision-4 provider capture verifier

- verifier bundle built: `true`
- provider connection used: `false`
- provider credential used: `false`
- synthetic evidence retained: `true`
- synthetic G3 qualification: `false`
- require-qualified fail-closed exit: `2`
- profile selected: `false`
- R5 authorized: `false`
EOF
