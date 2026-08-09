#!/usr/bin/env bash
set -euo pipefail

: "${FINALIZE_BODY:?FINALIZE_BODY is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
QUALIFICATION_ISSUE="${QUALIFICATION_ISSUE:-1261}"
PROJECT_IDENTITY_DIGEST="${PROJECT_IDENTITY_DIGEST:-81378864f4d6650a60a2c09a95629a18780d49fc23836e0f6a024b70f13f88a8}"
output_dir='r4f-g3-formal-verdict'
mkdir -p "$output_dir"

regex='^/r4f-g3-finalize run=([0-9]+) resume_run=([0-9]+) pause_run=([0-9]+) before_comment=([0-9]+) after_comment=([0-9]+) dashboard_auth=([0-9]+) log_run=([0-9]+) project=([a-f0-9]{64}) billing_start=([^ ]+) billing_end=([^ ]+) before_egress=([0-9]+([.][0-9]+)?) after_egress=([0-9]+([.][0-9]+)?) unit=(bytes|kB|MB|GB|KiB|MiB|GiB) decimals=([0-9]+) rounding=(exact|nearest_half_up|truncate_down)$'
[[ "$FINALIZE_BODY" =~ $regex ]] || { echo 'formal G3 finalize command shape mismatch' >&2; exit 1; }
one_shot_run="${BASH_REMATCH[1]}"
resume_run="${BASH_REMATCH[2]}"
pause_run="${BASH_REMATCH[3]}"
before_comment="${BASH_REMATCH[4]}"
after_comment="${BASH_REMATCH[5]}"
dashboard_auth="${BASH_REMATCH[6]}"
log_run="${BASH_REMATCH[7]}"
project_digest="${BASH_REMATCH[8]}"
billing_start="${BASH_REMATCH[9]}"
billing_end="${BASH_REMATCH[10]}"
before_egress="${BASH_REMATCH[11]}"
after_egress="${BASH_REMATCH[13]}"
unit="${BASH_REMATCH[15]}"
decimals="${BASH_REMATCH[16]}"
rounding="${BASH_REMATCH[17]}"
for value in "$one_shot_run" "$resume_run" "$pause_run" "$before_comment" "$after_comment" "$dashboard_auth" "$log_run"; do
  test "$value" -gt 0
done
test "$project_digest" = "$PROJECT_IDENTITY_DIGEST"
test "$decimals" -le 9

gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${one_shot_run}" > /tmp/one-shot-run.json
gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${resume_run}" > /tmp/resume-run.json
gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${log_run}" > /tmp/log-run.json
gh api --paginate "repos/${GITHUB_REPOSITORY}/issues/${QUALIFICATION_ISSUE}/comments?per_page=100" | jq -s 'add' > /tmp/issue-comments.json
test "$(jq -r '.name' /tmp/log-run.json)" = 'R4F G3 One-Shot Probe'
test "$(jq -r '.event' /tmp/log-run.json)" = 'issue_comment'
test "$(jq -r '.conclusion' /tmp/log-run.json)" = 'success'

node scripts/verify-r4f-g3-after-sequence.mjs \
  --comments /tmp/issue-comments.json \
  --one-shot-run /tmp/one-shot-run.json \
  --resume-run /tmp/resume-run.json \
  --pause-run-id "$pause_run" \
  --before-comment-id "$before_comment" \
  --after-comment-id "$after_comment" \
  --project-digest "$project_digest" > /tmp/after-sequence.json
test "$(jq -r '.oneShotRun' /tmp/after-sequence.json)" = "$one_shot_run"
test "$(jq -r '.resumeRun' /tmp/after-sequence.json)" = "$resume_run"
test "$(jq -r '.dashboardAuthorizationCommentId' /tmp/after-sequence.json)" = "$dashboard_auth"
test "$(jq -r '.usageFresh' /tmp/after-sequence.json)" = 'true'

rm -rf /tmp/one-shot-artifact /tmp/log-artifact
mkdir -p /tmp/one-shot-artifact /tmp/log-artifact
gh run download "$one_shot_run" --repo "$GITHUB_REPOSITORY" --name r4f-g3-one-shot-evidence --dir /tmp/one-shot-artifact
gh run download "$log_run" --repo "$GITHUB_REPOSITORY" --name r4f-g3-concurrent-traffic-evidence --dir /tmp/log-artifact
test -s /tmp/one-shot-artifact/summary.json
test -s /tmp/log-artifact/log-window.json

node scripts/assemble-r4f-g3-provider-capture.mjs \
  --after-sequence /tmp/after-sequence.json \
  --comments /tmp/issue-comments.json \
  --one-shot-summary /tmp/one-shot-artifact/summary.json \
  --log-window /tmp/log-artifact/log-window.json \
  --billing-start "$billing_start" \
  --billing-end "$billing_end" \
  --before-egress "$before_egress" \
  --after-egress "$after_egress" \
  --unit "$unit" \
  --decimals "$decimals" \
  --rounding "$rounding" \
  --retained-reserve 0 \
  --output "$output_dir/raw-capture.json"
cp /tmp/after-sequence.json "$output_dir/after-sequence.json"
cp /tmp/one-shot-artifact/summary.json "$output_dir/one-shot-summary.json"
cp /tmp/log-artifact/log-window.json "$output_dir/log-window.json"
jq -r --argjson id "$dashboard_auth" '.[] | select(.id == $id) | .body' /tmp/issue-comments.json > "$output_dir/dashboard-authorization.txt"
test -s "$output_dir/dashboard-authorization.txt"

pnpm exec vite build --config vite.r4f-revision4-provider-capture-verifier.config.ts
node .r4f-revision4-provider-capture-verifier-build/verify-r4f-revision4-provider-capture.mjs \
  --input "$output_dir/raw-capture.json" \
  --output "$output_dir/production-verdict.json"
node scripts/verify-r4f-g3-provider-capture-independent.mjs \
  --input "$output_dir/raw-capture.json" \
  --output "$output_dir/independent-verdict.json"
node scripts/compare-r4f-g3-provider-verdicts.mjs \
  --production "$output_dir/production-verdict.json" \
  --independent "$output_dir/independent-verdict.json" \
  --output "$output_dir/dual-verdict.json"

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'
const production = JSON.parse(readFileSync('r4f-g3-formal-verdict/production-verdict.json', 'utf8'))
const independent = JSON.parse(readFileSync('r4f-g3-formal-verdict/independent-verdict.json', 'utf8'))
const dual = JSON.parse(readFileSync('r4f-g3-formal-verdict/dual-verdict.json', 'utf8'))
const summary = {
  schemaVersion: 1,
  gate: 'R4F-G3',
  productionQualified: production.g3Qualified === true,
  independentQualified: independent.auditQualified === true,
  dualAgreement: dual.agreement === true,
  dualQualified: dual.dualQualified === true,
  providerDeltaInterval: production.reconciliation?.providerDeltaInterval ?? null,
  selectedUnexplainedDeltaReserveBytes: production.reconciliation?.selectedUnexplainedDeltaReserveBytes ?? null,
  profileSelected: false,
  r5Authorized: false,
  publicReaderUnchanged: true,
  mainnetDisabled: true,
}
writeFileSync('r4f-g3-formal-verdict/summary.json', `${JSON.stringify(summary, null, 2)}\n`)
NODE

production="$(jq -r '.productionQualified' "$output_dir/summary.json")"
independent="$(jq -r '.independentQualified' "$output_dir/summary.json")"
agreement="$(jq -r '.dualAgreement' "$output_dir/summary.json")"
qualified="$(jq -r '.dualQualified' "$output_dir/summary.json")"
interval="$(jq -c '.providerDeltaInterval' "$output_dir/summary.json")"
reserve="$(jq -r '.selectedUnexplainedDeltaReserveBytes' "$output_dir/summary.json")"
cat > /tmp/g3-formal-result.md <<EOF
## R4F G3 formal dual provider verdict

Run: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}
Target one-shot run: \`${one_shot_run}\`
Concurrent-traffic capture run: \`${log_run}\`
Production verifier qualified: \`${production}\`
Independent verifier qualified: \`${independent}\`
Dual-verdict agreement: \`${agreement}\`
**G3 dual-qualified: \`${qualified}\`**
Provider delta interval: \`${interval}\`
Selected unexplained-delta reserve bytes: \`${reserve}\`
Profile selected: \`false\`
R5 authorized: \`false\`
Public reader unchanged: \`true\`
Mainnet disabled: \`true\`

G3 is eligible to be marked passed only when this run completes successfully with both verifiers independently qualified and the comparator in exact agreement.
EOF
gh issue comment "$QUALIFICATION_ISSUE" --repo "$GITHUB_REPOSITORY" --body-file /tmp/g3-formal-result.md

test "$agreement" = 'true'
test "$production" = 'true'
test "$independent" = 'true'
test "$qualified" = 'true'
