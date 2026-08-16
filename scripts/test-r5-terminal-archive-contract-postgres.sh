#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-terminal-archive-contract-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_TERMINAL_ARCHIVE_CONTRACT_OUTPUT:-r5-terminal-archive-contract-evidence}"
staged_sql='ops/production-sql/20260816183000_xrpl_phase_terminal_archive_contract.sql'
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory"
mkdir -p "$output_directory"

test -s "$staged_sql"
for required in \
  'create schema if not exists xrpl_phase_archive_v1' \
  'message_hash bytea primary key' \
  'successor_hash bytea not null unique' \
  'payload jsonb not null' \
  'result_digest text' \
  'create or replace function xrpl_phase_archive_v1.terminalize_message' \
  'phase archive predecessor edge is still live' \
  'revoke all on table xrpl_phase_archive_v1.terminal_messages from anon, authenticated, service_role'; do
  grep -Fq "$required" "$staged_sql"
done
if grep -Eq '^\s*grant\s+.*(anon|authenticated|service_role)' "$staged_sql"; then
  echo 'terminal archive contract must not grant direct archive access' >&2
  exit 1
fi

docker run --detach --rm --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres \
  "$image" > "${output_directory}/container-id.txt"

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

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/base-schema.log" <<'SQL'
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.xrpl_phase_streams (
  profile_id text primary key
);
create table public.xrpl_phase_messages (
  message_id text primary key,
  schema_version integer not null default 1 check (schema_version=1),
  profile_id text not null references public.xrpl_phase_streams(profile_id),
  phase text not null check (phase in ('scan','commit','finalize')),
  payload jsonb not null,
  status text not null check (status in ('pending','leased','retry','completed','error')),
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
create table public.xrpl_phase_successors (
  current_message_id text primary key references public.xrpl_phase_messages(message_id),
  successor_message_id text not null unique references public.xrpl_phase_messages(message_id),
  reserved_at timestamptz not null
);
insert into public.xrpl_phase_streams(profile_id) values ('supabase-devnet');
SQL

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$staged_sql" > "${output_directory}/apply.log"

archive_schema_usage="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select has_schema_privilege('service_role','xrpl_phase_archive_v1','USAGE')")"
archive_table_select="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select has_table_privilege('service_role','xrpl_phase_archive_v1.terminal_messages','SELECT')")"
archive_terminalize_exec="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select has_function_privilege('service_role','xrpl_phase_archive_v1.terminalize_message(text,timestamptz)','EXECUTE')")"
[[ "$archive_schema_usage" == f ]]
[[ "$archive_table_select" == f ]]
[[ "$archive_terminalize_exec" == f ]]

archive_columns="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_schema='xrpl_phase_archive_v1' and table_name='terminal_messages'")"
[[ "$archive_columns" == 'schema_version,message_hash,successor_hash,message_id,profile_id,phase,payload,successor_message_id,completed_at,result_digest,archived_at' ]]
archive_indexes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select string_agg(indexdef,E'\n' order by indexname) from pg_indexes where schemaname='xrpl_phase_archive_v1' and tablename='terminal_messages'")"
[[ "$archive_indexes" == *'message_hash'* ]]
[[ "$archive_indexes" == *'successor_hash'* ]]
if [[ "$archive_indexes" == *'(message_id)'* || "$archive_indexes" == *'(successor_message_id)'* ]]; then
  echo 'archive must not recreate wide text identity indexes' >&2
  exit 1
fi

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/seed.log" <<'SQL'
insert into public.xrpl_phase_messages(
  message_id,profile_id,phase,payload,status,available_at,result,successor_message_id,created_at,updated_at,completed_at
) values
('m1','supabase-devnet','scan','{"k":1}'::jsonb,'completed','2026-08-16 00:00:00+00','{"ok":true,"rows":12}'::jsonb,'m2','2026-08-16 00:00:00+00','2026-08-16 00:01:00+00','2026-08-16 00:01:00+00'),
('m2','supabase-devnet','commit','{"k":2}'::jsonb,'pending','2026-08-16 00:01:00+00',null,null,'2026-08-16 00:01:00+00','2026-08-16 00:01:00+00',null),
('pred','supabase-devnet','finalize','{"k":0}'::jsonb,'completed','2026-08-16 00:00:00+00','{"ok":true}'::jsonb,'m3','2026-08-16 00:00:00+00','2026-08-16 00:01:00+00','2026-08-16 00:01:00+00'),
('m3','supabase-devnet','scan','{"k":3}'::jsonb,'completed','2026-08-16 00:01:00+00','{"ok":true}'::jsonb,'m4','2026-08-16 00:01:00+00','2026-08-16 00:02:00+00','2026-08-16 00:02:00+00'),
('m4','supabase-devnet','commit','{"k":4}'::jsonb,'pending','2026-08-16 00:02:00+00',null,null,'2026-08-16 00:02:00+00','2026-08-16 00:02:00+00',null);
insert into public.xrpl_phase_successors(current_message_id,successor_message_id,reserved_at) values
('m1','m2','2026-08-16 00:01:00+00'),
('pred','m3','2026-08-16 00:01:00+00'),
('m3','m4','2026-08-16 00:02:00+00');
SQL

m1_result="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.terminalize_message('m1','2026-08-17 00:00:00+00')::text")"
[[ "$(printf '%s' "$m1_result" | jq -r '.archived')" == true ]]
[[ "$(printf '%s' "$m1_result" | jq -r '.duplicate')" == false ]]
[[ "$(printf '%s' "$m1_result" | jq -r '.successor_message_id')" == m2 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where message_id='m1'")" == 0 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_successors where current_message_id='m1'")" == 0 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where message_id='m2' and status='pending'")" == 1 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_phase_archive_v1.terminal_messages where message_id='m1' and payload='{"k":1}'::jsonb and successor_message_id='m2' and result_digest ~ '^[a-f0-9]{64}$'")" == 1 ]]

identity_json="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.assert_message_identity('supabase-devnet','scan','m1','{"k":1}'::jsonb)::text")"
[[ "$(printf '%s' "$identity_json" | jq -r '.archived')" == true ]]
[[ "$(printf '%s' "$identity_json" | jq -r '.successor_message_id')" == m2 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.assert_successor_identity('m1','m2')")" == t ]]
duplicate_json="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.duplicate_completion('m1','scan')::text")"
[[ "$(printf '%s' "$duplicate_json" | jq -r '.duplicate')" == true ]]
[[ "$(printf '%s' "$duplicate_json" | jq -r '.successor_message_id')" == m2 ]]
second_terminalize="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.terminalize_message('m1','2026-08-17 00:01:00+00')::text")"
[[ "$(printf '%s' "$second_terminalize" | jq -r '.duplicate')" == true ]]

expect_failure() {
  local name="$1"
  local sql="$2"
  local pattern="$3"
  set +e
  docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "$sql" \
    > "${output_directory}/${name}.stdout" 2> "${output_directory}/${name}.stderr"
  local rc=$?
  set -e
  [[ "$rc" -ne 0 ]]
  grep -Fq "$pattern" "${output_directory}/${name}.stderr"
}

expect_failure payload_conflict \
  "select xrpl_phase_archive_v1.assert_message_identity('supabase-devnet','scan','m1','{\"k\":999}'::jsonb)" \
  'phase message identity conflict: m1'
expect_failure phase_conflict \
  "select xrpl_phase_archive_v1.duplicate_completion('m1','commit')" \
  'message phase mismatch'
expect_failure successor_conflict \
  "select xrpl_phase_archive_v1.assert_successor_identity('m1','m4')" \
  'phase successor identity conflict: m1'
expect_failure successor_reuse \
  "select xrpl_phase_archive_v1.assert_successor_identity('m3','m2')" \
  'phase successor identity conflict: m3'
expect_failure pending_terminalize \
  "select xrpl_phase_archive_v1.terminalize_message('m2','2026-08-17 00:00:00+00')" \
  'only completed phase messages may be archived: m2'
expect_failure predecessor_edge \
  "select xrpl_phase_archive_v1.terminalize_message('m3','2026-08-17 00:00:00+00')" \
  'phase archive predecessor edge is still live: m3'

# Remove predecessor first, then m3 can be terminalized while m4 remains live.
pred_result="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.terminalize_message('pred','2026-08-17 00:02:00+00')::text")"
[[ "$(printf '%s' "$pred_result" | jq -r '.successor_message_id')" == m3 ]]
m3_result="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.terminalize_message('m3','2026-08-17 00:03:00+00')::text")"
[[ "$(printf '%s' "$m3_result" | jq -r '.successor_message_id')" == m4 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where message_id='m4' and status='pending'")" == 1 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_phase_archive_v1.terminal_messages")" == 3 ]]

cat > "${output_directory}/summary.md" <<EOF
## R5 terminal archive contract PostgreSQL proof

- PostgreSQL: \`15-alpine\`
- staged SQL: \`${staged_sql}\`
- archive schema private from service_role: \`true\`
- archive table direct service_role SELECT: \`false\`
- archive terminalize direct service_role EXECUTE: \`false\`
- fixed-width digest PK/UNIQUE: \`true\`
- wide text identity index recreated: \`false\`
- full message ID/profile/phase/payload retained: \`true\`
- exact successor ID retained: \`true\`
- terminal result retained only as SHA-256 digest: \`true\`
- exact archived message identity replay converges: \`true\`
- payload/phase drift fails closed: \`true\`
- successor drift/reuse fails closed: \`true\`
- pending message terminalization fails closed: \`true\`
- live predecessor edge blocks terminalization: \`true\`
- predecessor-first terminalization preserves live cutoff successor: \`true\`
- duplicate terminalization is idempotent: \`true\`
- production database used: \`false\`
- production archive apply authorized: \`false\`
- R5 rearm authorized: \`false\`
EOF
cat "${output_directory}/summary.md"
