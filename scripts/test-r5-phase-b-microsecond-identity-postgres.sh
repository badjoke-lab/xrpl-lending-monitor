#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-phase-b-microsecond-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --detach --rm --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres \
  "$image" >/dev/null

stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable_ready=$((stable_ready + 1))
    [[ "$stable_ready" -ge 3 ]] && break
  else
    stable_ready=0
  fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

result="$(docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atq <<'SQL'
with samples(created_at, completed_at) as (
  values (
    '2026-08-02T01:04:50.136427Z'::timestamptz,
    '2026-08-02T01:04:51.541913Z'::timestamptz
  )
), canonical as (
  select
    created_at,
    completed_at,
    to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_text,
    to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as completed_text
  from samples
)
select json_build_object(
  'createdText', created_text,
  'completedText', completed_text,
  'createdExactRoundTrip', created_at = created_text::timestamptz,
  'completedExactRoundTrip', completed_at = completed_text::timestamptz,
  'oneMicrosecondDriftRejected', created_at <> '2026-08-02T01:04:50.136428Z'::timestamptz,
  'millisecondTruncationRejected', created_at <> '2026-08-02T01:04:50.136000Z'::timestamptz
)::text
from canonical;
SQL
)"

created_text="$(printf '%s' "$result" | jq -r '.createdText')"
completed_text="$(printf '%s' "$result" | jq -r '.completedText')"
[[ "$created_text" == '2026-08-02T01:04:50.136427Z' ]]
[[ "$completed_text" == '2026-08-02T01:04:51.541913Z' ]]
[[ "$(printf '%s' "$result" | jq -r '.createdExactRoundTrip')" == true ]]
[[ "$(printf '%s' "$result" | jq -r '.completedExactRoundTrip')" == true ]]
[[ "$(printf '%s' "$result" | jq -r '.oneMicrosecondDriftRejected')" == true ]]
[[ "$(printf '%s' "$result" | jq -r '.millisecondTruncationRejected')" == true ]]

echo 'R5 Phase B microsecond candidate identity PostgreSQL PASS'
