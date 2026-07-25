#!/usr/bin/env bash
set -euo pipefail

root="${1:-.github/workflows}"
expected="$(mktemp)"
actual="$(mktemp)"
trap 'rm -f "$expected" "$actual"' EXIT

cat > "$expected" <<'EOF'
ci.yml
rolling-checkpoint-candidate.yml
rolling-checkpoint-live-cutover.yml
EOF

find "$root" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) \
  -printf '%f\n' | sort > "$actual"

if ! diff -u "$expected" "$actual"; then
  echo "GitHub Actions workflow allowlist violation." >&2
  echo "Only CI and the two explicitly manual checkpoint workflows are permitted." >&2
  exit 1
fi

for workflow in \
  "$root/rolling-checkpoint-candidate.yml" \
  "$root/rolling-checkpoint-live-cutover.yml"
do
  grep -q '^  workflow_dispatch:' "$workflow"
  if grep -Eq '^  (schedule|push|pull_request):' "$workflow"; then
    echo "$workflow must remain workflow_dispatch-only." >&2
    exit 1
  fi
done

if grep -R -n -E '^  schedule:' "$root"; then
  echo "Scheduled GitHub Actions workflows are forbidden by the current operating policy." >&2
  exit 1
fi

echo "Actions workflow allowlist passed: CI plus two manual checkpoint workflows."
