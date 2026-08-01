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
  complete-history-12-slot-qualification-995-v5.yml
  continuous-catch-up-checkpoint.yml
  deploy-queue-minute-cadence-fix.yml
  read-only-production-qualification.yml
  rolling-checkpoint-candidate.yml
  rolling-checkpoint-live-cutover.yml
  start-continuous-fast-lane-catch-up.yml
)
printf '%s\n' "${expected[@]}" > "$evidence/expected-workflows.txt"

if [[ "${#actual[@]}" -ne "${#expected[@]}" ]]; then
  echo "GitHub Actions workflow count must remain exactly eight while the Queue deployment, continuous catch-up promotion, and read-only checkpoint workflows are armed." >&2
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
qualification_v5 = "complete-history-12-slot-qualification-995-v5.yml"
checkpoint_name = "continuous-catch-up-checkpoint.yml"
policies = {
    "deploy-queue-minute-cadence-fix.yml": ["pull_request", "push"],
    "start-continuous-fast-lane-catch-up.yml": ["pull_request", "push"],
    checkpoint_name: ["pull_request", "issue_comment"],
    "rolling-checkpoint-candidate.yml": ["workflow_dispatch", "issue_comment"],
    "rolling-checkpoint-live-cutover.yml": ["workflow_dispatch"],
    "read-only-production-qualification.yml": ["pull_request", "workflow_dispatch", "issue_comment"],
    qualification_v5: ["workflow_dispatch", "schedule", "pull_request"],
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

checkpoint = (root / checkpoint_name).read_text()
for forbidden in ("  schedule:", "  push:", "contents: write", "wrangler deploy", "d1 execute"):
    if forbidden in checkpoint:
        raise SystemExit(f"continuous catch-up checkpoint contains forbidden capability: {forbidden.strip()}")
for required in (
    "github.event.issue.number == 1079",
    "github.actor == 'badjoke-lab'",
    "github.event.comment.body == '/catch-up checkpoint'",
    "Capture read-only production checkpoint",
    "gh issue comment 1079",
    "EXPECTED_WORKER_VERSION",
    "issues: write",
):
    if required not in checkpoint:
        raise SystemExit(f"continuous catch-up checkpoint is missing bounded read-only boundary: {required}")

v5 = (root / qualification_v5).read_text()
for required in (
    "cron: '5 16 28 7 *'",
    "HISTORY_HEAD: 5d7bf6d330407c7ead237b3885d4330a8d268ce6",
    "HISTORY_DATA_SHA: 12252ce9df0d5ab50adc51e2743edb8ff03989dd",
    "HISTORY_BUCKETS: '1024'",
    "HISTORY_RECORDS: '33811930'",
    "START_UTC: '2026-07-28T16:30:00Z'",
    "END_UTC: '2026-07-28T17:25:00Z'",
    "EVALUATE_UTC: '2026-07-28T17:30:30Z'",
    "MAINNET",
    "formal",
):
    if required not in v5:
        raise SystemExit(f"qualification v5 workflow is missing bounded identity or non-release marker: {required}")
for forbidden in ("  push:", "MAINNET_ENABLED: 'true'", "wrangler deploy", "d1 execute"):
    if forbidden in v5:
        raise SystemExit(f"qualification v5 workflow contains forbidden mutation capability: {forbidden.strip()}")

candidate = (root / "rolling-checkpoint-candidate.yml").read_text()
for required in (
    "github.event.issue.number == 995",
    "github.actor == 'badjoke-lab'",
    "github.event.comment.body == '/history-reconstruction run'",
    "history-repair-3932301-work",
    "history-repair-3932301-data",
    "production history mutation: none",
    "D1 mutation: none",
    "Worker deploy: none",
):
    if required not in candidate:
        raise SystemExit(f"candidate workflow is missing immutable-history command boundary: {required}")

promotion = (root / "start-continuous-fast-lane-catch-up.yml").read_text()
for required in (
    "production-worker-write",
    "Deploy exact runtime and prove one controlled delivery",
    "Promote continuous catch-up after three exact minute slots",
    "gh issue comment 1072",
    "issues: write",
):
    if required not in promotion:
        raise SystemExit(f"continuous catch-up promotion is missing fail-closed boundary: {required}")

scheduled = []
for path in root.glob("*.y*ml"):
    if re.search(r"^  schedule:", path.read_text(), flags=re.MULTILINE):
        scheduled.append(path.name)
scheduled.sort()
(evidence / "workflow-triggers.json").write_text(json.dumps(parsed, indent=2) + "\n")
(evidence / "scheduled-workflows.json").write_text(json.dumps(scheduled, indent=2) + "\n")
if scheduled != [qualification_v5]:
    raise SystemExit(f"only the fixed qualification v5 workflow may be scheduled: {scheduled}")
PY

echo "Actions workflow allowlist passed: CI, guarded Queue deployment, guarded continuous catch-up promotion, one guarded read-only catch-up checkpoint, one read-only runner, one bounded candidate builder, one manual cutover workflow, and one fixed-window qualification v5 exception."
