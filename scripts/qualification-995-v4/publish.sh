#!/usr/bin/env bash
set -euo pipefail
result=complete-history-12-slot-qualification-995-v4.json
if [ ! -s "$result" ]; then
  jq -n --arg checkedAt "$(date -u +%FT%TZ)" --arg runUrl "https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" \
    '{checkedAt:$checkedAt,status:"failed",passed:false,failures:["qualification_result_missing"],runUrl:$runUrl}' > "$result"
fi
tmp="$(mktemp)"
jq --arg runUrl "https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" --arg runId "$GITHUB_RUN_ID" \
  '. + {runUrl:$runUrl,runId:($runId|tonumber)}' "$result" > "$tmp"
mv "$tmp" "$result"
status="$(jq -r '.status' "$result")"
if [ "$status" = passed ]; then title='P0 PASSED — complete-history 12-slot pre-soak qualification v4'; else title='P0 FAILED — complete-history 12-slot pre-soak qualification v4'; fi
gh issue edit "$STATUS_ISSUE" --title "$title"
{ echo '## Complete-history 12-slot qualification v4 result'; echo; echo '```json'; cat "$result"; echo '```'; } > issue-result.md
gh issue comment "$STATUS_ISSUE" --body-file issue-result.md
api="repos/${GITHUB_REPOSITORY}/contents/.github/complete-history-12-slot-qualification-995-v4.json"
sha="$(gh api "$api" --jq .sha 2>/dev/null || true)"
content="$(base64 -w0 "$result")"
if [ -n "$sha" ]; then
  gh api --method PUT "$api" -f message="Record ${status} complete-history qualification 995 v4" -f content="$content" -f sha="$sha" -f branch=main >/dev/null
else
  gh api --method PUT "$api" -f message="Record ${status} complete-history qualification 995 v4" -f content="$content" -f branch=main >/dev/null
fi
test "$status" = passed
