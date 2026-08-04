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
  deploy-queue-minute-cadence-fix.yml
  r4c2c-devnet-historical-witness.yml
  r5-bounded-recovery-burst.yml
  read-only-production-qualification.yml
  rolling-checkpoint-candidate.yml
  rolling-checkpoint-live-cutover.yml
  start-continuous-fast-lane-catch-up.yml
  supabase-remote-probe.yml
)
printf '%s\n' "${expected[@]}" > "$evidence/expected-workflows.txt"

if [[ "${#actual[@]}" -ne "${#expected[@]}" ]]; then
  echo "GitHub Actions workflow count must remain exactly nine while the guarded R5 recovery workflows are active." >&2
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
historical_witness = "r4c2c-devnet-historical-witness.yml"
r5_burst = "r5-bounded-recovery-burst.yml"
supabase_remote = "supabase-remote-probe.yml"
policies = {
    "deploy-queue-minute-cadence-fix.yml": ["pull_request", "push"],
    historical_witness: ["workflow_dispatch", "push"],
    r5_burst: ["workflow_dispatch"],
    "read-only-production-qualification.yml": ["pull_request", "workflow_dispatch", "issue_comment"],
    "rolling-checkpoint-candidate.yml": ["workflow_dispatch", "issue_comment"],
    "rolling-checkpoint-live-cutover.yml": ["workflow_dispatch"],
    "start-continuous-fast-lane-catch-up.yml": ["pull_request", "push"],
    supabase_remote: ["workflow_dispatch", "push"],
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
for required in (
    "actions: read",
    "contents: read",
    "issues: write",
    "CLOUDFLARE_API_TOKEN",
    "DATABASE_ID",
    "gh issue comment 995",
):
    if required not in qualification:
        raise SystemExit(f"read-only qualification is missing required bounded capability: {required}")

witness = (root / historical_witness).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "scripts/qualify-devnet-historical-witness.ts",
    "bun build scripts/qualify-devnet-historical-witness.ts",
    "node /tmp/qualify-devnet-historical-witness.mjs",
    "r4c2c-devnet-historical-witness",
    "retention-days: 14",
    "gh issue comment 1118",
    "transaction submission: `none`",
    "database mutation: `none`",
):
    if required not in witness:
        raise SystemExit(f"historical witness workflow is missing a bounded read-only requirement: {required}")
for forbidden in (
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "CLOUDFLARE_API_TOKEN",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "wrangler deploy",
    "supabase db",
    "supabase functions deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in witness:
        raise SystemExit(f"historical witness workflow contains forbidden capability: {forbidden.strip()}")
if witness.count("issues: write") != 1 or witness.count("gh issue comment 1118") != 1:
    raise SystemExit("historical witness issue-write capability must remain bound to one permission and Issue #1118")

burst = (root / r5_burst).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "RUN_R5_BOUNDED_BURST",
    "R5_RECOVERY_BURST_BATCH_LIMIT",
    "R5_RECOVERY_BURST_WALL_SECONDS",
    "timeout-minutes: 40",
    "supabase secrets set XRPL_R5_RECOVERY_VERIFY_TOKEN",
    "node scripts/verify-supabase-r5-recovery-burst.mjs",
    "node scripts/publish-supabase-r5-recovery-burst-run-locator.mjs",
    "retention-days: 14",
    "gh issue comment 1175",
):
    if required not in burst:
        raise SystemExit(f"R5 bounded burst workflow is missing a guarded recovery requirement: {required}")
for forbidden in (
    "  schedule:",
    "  push:",
    "pull_request_target",
    "contents: write",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "supabase db",
    "supabase functions deploy",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in burst:
        raise SystemExit(f"R5 bounded burst workflow contains forbidden capability: {forbidden.strip()}")
if burst.count("issues: write") != 1 or burst.count("gh issue comment 1175") != 1:
    raise SystemExit("R5 bounded burst issue-write capability must remain bound to one permission and Issue #1175")
if burst.count("supabase secrets set XRPL_R5_RECOVERY_VERIFY_TOKEN") != 1:
    raise SystemExit("R5 bounded burst token rotation must remain exactly once per workflow run")

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

supabase = (root / supabase_remote).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_DB_PASSWORD",
    "supabase link --project-ref",
    "supabase db push --linked --yes",
    "Rotate one-run committed reader verifier token",
    "supabase secrets set XRPL_READER_VERIFY_TOKEN",
    "supabase/functions/xrpl-collector-tick/index.ts",
    "supabase/functions/xrpl-committed-reader/index.ts",
    "supabase/functions/xrpl-historical-witness/index.ts",
    "supabase/functions/xrpl-historical-witness-reader/index.ts",
    "supabase/functions/xrpl-multichunk-witness/index.ts",
    "supabase/functions/xrpl-multichunk-witness-reader/index.ts",
    "historical-loader-bundle.json",
    "historical-reader-bundle.json",
    "multichunk-executor-bundle.json",
    "multichunk-reader-bundle.json",
    "supabase functions deploy xrpl-collector-tick",
    "supabase functions deploy xrpl-committed-reader",
    "supabase functions deploy xrpl-historical-witness",
    "supabase functions deploy xrpl-historical-witness-reader",
    "supabase functions deploy xrpl-multichunk-witness",
    "supabase functions deploy xrpl-multichunk-witness-reader",
    "--use-api",
    "--no-verify-jwt",
    "node scripts/verify-supabase-remote-probe.mjs",
    "node scripts/verify-supabase-committed-reader.mjs",
    "node scripts/verify-supabase-historical-witness.mjs",
    "node scripts/verify-supabase-multichunk-witness.mjs",
    "retention-days: 7",
    "Publish sanitized run locator",
    "if: always()",
    "gh issue comment 1109",
    "verified-health.json",
    "failed-verification.json",
    "verified-reader.json",
    "failed-reader-verification.json",
    "verified-historical-witness.json",
    "failed-historical-witness-verification.json",
    "verified-multichunk-witness.json",
    "failed-multichunk-witness-verification.json",
    "historical witness verifier: `success`",
    "multi-chunk witness verifier: `success`",
):
    if required not in supabase:
        raise SystemExit(f"Supabase remote workflow is missing a guarded deployment requirement: {required}")
for forbidden in (
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "MAINNET_ENABLED: 'true'",
    "wrangler deploy",
):
    if forbidden in supabase:
        raise SystemExit(f"Supabase remote workflow contains forbidden capability: {forbidden.strip()}")
if supabase.count("issues: write") != 1 or supabase.count("gh issue comment 1109") != 1:
    raise SystemExit("Supabase remote issue-write capability must remain bound to one permission and Issue #1109")
if supabase.count("supabase secrets set XRPL_READER_VERIFY_TOKEN") != 1:
    raise SystemExit("Supabase reader token rotation must remain exactly once per workflow run")

scheduled = []
for path in root.glob("*.y*ml"):
    if re.search(r"^  schedule:", path.read_text(), flags=re.MULTILINE):
        scheduled.append(path.name)
scheduled.sort()
(evidence / "workflow-triggers.json").write_text(json.dumps(parsed, indent=2) + "\n")
(evidence / "scheduled-workflows.json").write_text(json.dumps(scheduled, indent=2) + "\n")
if scheduled:
    raise SystemExit(f"no scheduled workflow is allowed during active R5 recovery: {scheduled}")
PY

echo "Actions workflow allowlist passed: CI, guarded legacy recovery workflows, one read-only production probe, one read-only R4C2c witness discovery, one guarded Supabase deployment verifier, and one manual finite R5 recovery burst; no scheduled workflows."
