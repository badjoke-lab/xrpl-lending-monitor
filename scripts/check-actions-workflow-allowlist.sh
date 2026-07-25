#!/usr/bin/env bash
set -euo pipefail

root="${1:-.github/workflows}"
evidence="actions-workflow-policy-evidence"
rm -rf "$evidence"
mkdir -p "$evidence"

mapfile -t actual < <(
  find "$root" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) \
    -printf '%f\n' | LC_ALL=C sort
)
printf '%s\n' "${actual[@]}" > "$evidence/actual-workflows.txt"

printf 'Detected workflow files (%s):\n' "${#actual[@]}"
printf '  %s\n' "${actual[@]}"

expected=(
  ci.yml
  read-only-production-qualification.yml
  rolling-checkpoint-candidate.yml
  rolling-checkpoint-live-cutover.yml
)
printf '%s\n' "${expected[@]}" > "$evidence/expected-workflows.txt"

if [[ "${#actual[@]}" -ne "${#expected[@]}" ]]; then
  echo "GitHub Actions workflow count must remain exactly four." >&2
  exit 1
fi

for index in "${!expected[@]}"; do
  if [[ "${actual[$index]}" != "${expected[$index]}" ]]; then
    echo "Unexpected workflow file: expected ${expected[$index]}, found ${actual[$index]}." >&2
    exit 1
  fi
done

python - "$root" "$evidence" <<'PY'
from pathlib import Path
import json
import re
import sys

root = Path(sys.argv[1])
evidence = Path(sys.argv[2])
policies = {
    "rolling-checkpoint-candidate.yml": ["workflow_dispatch"],
    "rolling-checkpoint-live-cutover.yml": ["workflow_dispatch"],
    "read-only-production-qualification.yml": ["pull_request", "workflow_dispatch", "issue_comment"],
}
parsed = {}

for name, expected in policies.items():
    path = root / name
    lines = path.read_text().splitlines()
    try:
        start = lines.index("on:") + 1
    except ValueError as exc:
        raise SystemExit(f"{path} has no top-level on block") from exc
    triggers = []
    for line in lines[start:]:
        if line and not line.startswith(" "):
            break
        match = re.match(r"^  ([A-Za-z_]+):", line)
        if match:
            triggers.append(match.group(1))
    parsed[name] = triggers
    if triggers != expected:
        raise SystemExit(f"{name} trigger policy violation: expected={expected}, found={triggers}")

qualification = (root / "read-only-production-qualification.yml").read_text()
for forbidden in ("  schedule:", "  push:", "  workflow_run:", "contents: write"):
    if forbidden in qualification:
        raise SystemExit(f"read-only qualification contains forbidden capability: {forbidden.strip()}")
for required in ("actions: read", "contents: read", "issues: write", "CLOUDFLARE_API_TOKEN", "DATABASE_ID", "gh issue comment 995"):
    if required not in qualification:
        raise SystemExit(f"read-only qualification is missing required bounded capability: {required}")

scheduled = []
for path in root.glob("*.y*ml"):
    if re.search(r"^  schedule:", path.read_text(), flags=re.MULTILINE):
        scheduled.append(path.name)
(evidence / "workflow-triggers.json").write_text(json.dumps(parsed, indent=2) + "\n")
(evidence / "scheduled-workflows.json").write_text(json.dumps(scheduled, indent=2) + "\n")
if scheduled:
    raise SystemExit(f"scheduled workflows are forbidden: {scheduled}")
PY

echo "Actions workflow allowlist passed: CI, one production-read qualification runner with Issue-only reporting, and two manual checkpoint workflows."
