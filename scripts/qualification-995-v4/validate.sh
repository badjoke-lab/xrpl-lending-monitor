#!/usr/bin/env bash
# Validation-only PR marker: fixed v4 boundaries must remain internally identical.
set -euo pipefail
test "$(cat .github/complete-history-12-slot-qualification-995-v4-trigger)" = \
  "qualify-v4-${START_MS}-${END_MS}-${RUNTIME_SHA}"
jq -e --arg runtime "$RUNTIME_SHA" '
  .passed==true
  and .runtimeSha==$runtime
  and .identityOutcome=="success"
  and .witnessOutcome=="success"
  and .slotOutcome=="success"
  and .finalIdentityOutcome=="success"
' "$DEPLOY_PROOF_PATH" >/dev/null
jq -e '
  .main=="src/worker/p0-redundant-scheduler-entry.ts"
  and .triggers.crons==["*/5 * * * *"]
  and .vars.APP_NETWORK=="devnet"
  and .vars.MAINNET_ENABLED=="false"
  and .vars.FAST_LANE_MAX_LEDGERS_PER_RUN=="96"
  and (.queues.producers|length)==1
  and (.queues.consumers|length)==1
  and .queues.consumers[0].max_batch_size==1
  and .queues.consumers[0].max_concurrency==1
  and (.vars|has("REPLACEMENT_BASE_CUTOVER_TOKEN")|not)
' wrangler.jsonc >/dev/null
python - <<'PY'
from datetime import datetime, timezone
start=datetime.fromisoformat('2026-07-25T08:30:00+00:00')
end=datetime.fromisoformat('2026-07-25T09:25:00+00:00')
evaluate=datetime.fromisoformat('2026-07-25T09:30:30+00:00')
assert int(start.timestamp()*1000)==1784968200000
assert int(end.timestamp()*1000)==1784971500000
assert (end-start).total_seconds()==55*60
assert (evaluate-end).total_seconds()>=300
prepare=datetime.fromisoformat('2026-07-25T08:25:00+00:00')
timeout_seconds=180*60
finalization_seconds=1200
assert (evaluate-prepare).total_seconds()+finalization_seconds < timeout_seconds-300
assert not any(start <= datetime(2026,7,25,hour,0,tzinfo=timezone.utc) <= end for hour in (0,4,8,12,16,20))
assert datetime.now(timezone.utc)<start
PY
