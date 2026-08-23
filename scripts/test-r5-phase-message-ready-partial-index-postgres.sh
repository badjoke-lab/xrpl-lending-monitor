#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-ready-index-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_READY_INDEX_OUTPUT:-r5-phase-message-ready-partial-index-evidence}"
migration='supabase/migrations/20260814130000_xrpl_phase_messages_ready_partial_index.sql'

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -rf "$output_directory"
mkdir -p "$output_directory"

test -f "$migration"
if grep -Eiq '\b(delete|truncate|update|vacuum)\b' "$migration"; then
  echo 'index migration must not contain row mutation or vacuum statements' >&2
  exit 1
fi

docker run --detach --rm \
  --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=postgres \
  "$image" > "${output_directory}/container-id.txt"

stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable_ready=$((stable_ready + 1))
    if [[ "$stable_ready" -ge 3 ]]; then
      break
    fi
  else
    stable_ready=0
  fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/setup.log" <<'SQL'
create table public.xrpl_phase_messages (
  message_id text primary key,
  profile_id text not null,
  phase text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('pending', 'leased', 'retry', 'completed', 'error')),
  available_at timestamptz not null,
  attempt_count integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  result jsonb,
  successor_message_id text,
  error_classification text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz
);

create index xrpl_phase_messages_ready_idx
  on public.xrpl_phase_messages(profile_id, status, available_at, created_at, message_id);

insert into public.xrpl_phase_messages(
  message_id, profile_id, phase, status, available_at,
  lease_owner, lease_expires_at, error_classification, error_message,
  created_at, updated_at, completed_at
)
select
  'completed-' || g::text,
  'supabase-devnet',
  'scan',
  'completed',
  '2026-08-13 00:00:00+00'::timestamptz + g * interval '1 second',
  null,
  null,
  null,
  null,
  '2026-08-13 00:00:00+00'::timestamptz + g * interval '1 second',
  '2026-08-13 00:00:00+00'::timestamptz + g * interval '1 second',
  '2026-08-13 00:00:01+00'::timestamptz + g * interval '1 second'
from generate_series(1, 20000) g;

insert into public.xrpl_phase_messages(
  message_id, profile_id, phase, status, available_at,
  lease_owner, lease_expires_at, error_classification, error_message,
  created_at, updated_at, completed_at
) values
  ('pending-ready', 'supabase-devnet', 'scan', 'pending', '2026-08-13 23:59:55+00', null, null, null, null, '2026-08-13 23:59:55+00', '2026-08-13 23:59:55+00', null),
  ('retry-ready', 'supabase-devnet', 'scan', 'retry', '2026-08-13 23:59:56+00', null, null, 'retryable_transport', 'retry', '2026-08-13 23:59:56+00', '2026-08-13 23:59:56+00', null),
  ('leased-expired', 'supabase-devnet', 'scan', 'leased', '2026-08-13 23:59:57+00', 'worker-old', '2026-08-13 23:59:59+00', null, null, '2026-08-13 23:59:57+00', '2026-08-13 23:59:57+00', null),
  ('leased-live', 'supabase-devnet', 'scan', 'leased', '2026-08-13 23:59:58+00', 'worker-live', '2026-08-14 00:05:00+00', null, null, '2026-08-13 23:59:58+00', '2026-08-13 23:59:58+00', null),
  ('error-terminal', 'supabase-devnet', 'scan', 'error', '2026-08-13 23:59:59+00', null, null, 'terminal_internal', 'terminal', '2026-08-13 23:59:59+00', '2026-08-13 23:59:59+00', null);
SQL

before_count="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages")"
before_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(message_id || ':' || status, ',' order by message_id)) from public.xrpl_phase_messages")"
before_index_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_messages_ready_idx'::regclass)")"

printf '%s\n' "$before_count" > "${output_directory}/before-count.txt"
printf '%s\n' "$before_digest" > "${output_directory}/before-digest.txt"
printf '%s\n' "$before_index_bytes" > "${output_directory}/before-index-bytes.txt"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$migration" > "${output_directory}/migration.log"

after_count="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages")"
after_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(message_id || ':' || status, ',' order by message_id)) from public.xrpl_phase_messages")"
after_index_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_messages_ready_idx'::regclass)")"
predicate="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_get_expr(i.indpred, i.indrelid) from pg_index i where i.indexrelid = 'public.xrpl_phase_messages_ready_idx'::regclass")"

[[ "$after_count" == "$before_count" ]]
[[ "$after_digest" == "$before_digest" ]]
[[ "$after_index_bytes" -lt "$before_index_bytes" ]]
grep -q 'pending' <<< "$predicate"
grep -q 'retry' <<< "$predicate"
grep -q 'leased' <<< "$predicate"
! grep -q 'completed' <<< "$predicate"
! grep -q 'error' <<< "$predicate"

claimable="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "
select string_agg(message_id, ',' order by available_at, created_at, message_id)
from public.xrpl_phase_messages
where profile_id = 'supabase-devnet'
  and (
    (status in ('pending', 'retry') and available_at <= '2026-08-14 00:00:00+00'::timestamptz)
    or (status = 'leased' and lease_expires_at <= '2026-08-14 00:00:00+00'::timestamptz)
  );")"
[[ "$claimable" == 'pending-ready,retry-ready,leased-expired' ]]

plan="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "
set enable_seqscan = off;
explain (costs off)
select *
from public.xrpl_phase_messages
where profile_id = 'supabase-devnet'
  and (
    (status in ('pending', 'retry') and available_at <= '2026-08-14 00:00:00+00'::timestamptz)
    or (status = 'leased' and lease_expires_at <= '2026-08-14 00:00:00+00'::timestamptz)
  )
order by available_at, created_at, message_id
limit 1;")"
grep -q 'xrpl_phase_messages_ready_idx' <<< "$plan"

status_counts="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "
select jsonb_build_object(
  'pending', count(*) filter (where status='pending'),
  'retry', count(*) filter (where status='retry'),
  'leased', count(*) filter (where status='leased'),
  'completed', count(*) filter (where status='completed'),
  'error', count(*) filter (where status='error')
)::text from public.xrpl_phase_messages;")"

cat > "${output_directory}/summary.md" <<EOF
## R5 phase message ready partial-index PostgreSQL test

- historical rows before: \`${before_count}\`
- historical rows after: \`${after_count}\`
- row identity/status digest preserved: \`true\`
- full ready index bytes before: \`${before_index_bytes}\`
- partial ready index bytes after: \`${after_index_bytes}\`
- replacement predicate: \`${predicate}\`
- claimable order: \`${claimable}\`
- status counts: \`${status_counts}\`
- completed/error rows deleted: \`false\`
- canonical history mutation: \`false\`
- production database used: \`false\`
EOF

printf '%s\n' "$plan" > "${output_directory}/claim-plan.txt"
printf '%s\n' "$predicate" > "${output_directory}/predicate.txt"
cat "${output_directory}/summary.md"

node scripts/r5-terminal-certificate-archive-atomic-bundle.mjs \
  --source-commit ce4e50b65eb80df69ff7ebd3489d270e61785ff3 \
  --output-dir "${output_directory}/terminal-certificate-archive-atomic"
