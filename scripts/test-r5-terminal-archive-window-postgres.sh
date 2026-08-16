#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-terminal-window-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_TERMINAL_ARCHIVE_WINDOW_OUTPUT:-r5-terminal-archive-window-evidence}"
contract_sql='ops/production-sql/20260816183000_xrpl_phase_terminal_archive_contract.sql'
window_sql='ops/production-sql/20260816190000_xrpl_phase_terminal_archive_window.sql'
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory" && mkdir -p "$output_directory"

test -s "$contract_sql"
test -s "$window_sql"
grep -Fq 'terminal archive window has unresolved predecessor chain' "$window_sql"
grep -Fq 'for update of messages' "$window_sql"
grep -Fq 'terminalize_message' "$window_sql"

docker run --detach --rm --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres \
  "$image" > "${output_directory}/container-id.txt"

stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable_ready=$((stable_ready + 1)); [[ "$stable_ready" -ge 3 ]] && break
  else stable_ready=0; fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/base.log" <<'SQL'
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.xrpl_phase_streams(profile_id text primary key);
create table public.xrpl_phase_messages(
  message_id text primary key,
  schema_version integer not null default 1,
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
create table public.xrpl_phase_successors(
  current_message_id text primary key references public.xrpl_phase_messages(message_id),
  successor_message_id text not null unique references public.xrpl_phase_messages(message_id),
  reserved_at timestamptz not null
);
insert into public.xrpl_phase_streams(profile_id) values ('supabase-devnet'),('rollback-profile');
SQL

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$contract_sql" > "${output_directory}/contract.log"
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$window_sql" > "${output_directory}/window.log"

window_exec="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select has_function_privilege('service_role','xrpl_phase_archive_v1.terminalize_completed_window(text,timestamptz,timestamptz)','EXECUTE')")"
[[ "$window_exec" == f ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/seed.log" <<'SQL'
insert into public.xrpl_phase_messages(message_id,profile_id,phase,payload,status,available_at,result,successor_message_id,created_at,updated_at,completed_at) values
('oldpred','supabase-devnet','finalize',jsonb_build_object('id','oldpred'),'completed','2026-08-16 00:00:00+00',jsonb_build_object('status','committed'),'s1','2026-08-16 00:00:00+00','2026-08-16 00:00:00+00','2026-08-16 00:00:00+00'),
('s1','supabase-devnet','scan',jsonb_build_object('id','s1'),'completed','2026-08-16 00:01:00+00',jsonb_build_object('status','staged'),'c1','2026-08-16 00:01:00+00','2026-08-16 00:01:00+00','2026-08-16 00:01:00+00'),
('c1','supabase-devnet','commit',jsonb_build_object('id','c1'),'completed','2026-08-16 00:01:00+00',jsonb_build_object('status','committing'),'f1','2026-08-16 00:01:01+00','2026-08-16 00:01:01+00','2026-08-16 00:01:00+00'),
('f1','supabase-devnet','finalize',jsonb_build_object('id','f1'),'completed','2026-08-16 00:01:00+00',jsonb_build_object('status','committed'),'next1','2026-08-16 00:01:02+00','2026-08-16 00:01:02+00','2026-08-16 00:01:00+00'),
('next1','supabase-devnet','scan',jsonb_build_object('id','next1'),'pending','2026-08-16 00:01:00+00',null,null,'2026-08-16 00:01:03+00','2026-08-16 00:01:03+00',null),
('x1','rollback-profile','scan',jsonb_build_object('id','x1'),'completed','2026-08-16 00:02:00+00',jsonb_build_object('status','staged'),'x2','2026-08-16 00:02:00+00','2026-08-16 00:02:00+00','2026-08-16 00:02:00+00'),
('x2','rollback-profile','commit',jsonb_build_object('id','x2'),'completed','2026-08-16 00:02:00+00',jsonb_build_object('status','committing'),'x3','2026-08-16 00:02:01+00','2026-08-16 00:02:01+00','2026-08-16 00:02:00+00'),
('x3','rollback-profile','finalize',jsonb_build_object('id','x3'),'pending','2026-08-16 00:02:00+00',null,null,'2026-08-16 00:02:02+00','2026-08-16 00:02:02+00',null),
('x4','rollback-profile','finalize',jsonb_build_object('id','x4'),'pending','2026-08-16 00:02:00+00',null,null,'2026-08-16 00:02:03+00','2026-08-16 00:02:03+00',null);
insert into public.xrpl_phase_successors(current_message_id,successor_message_id,reserved_at) values
('oldpred','s1','2026-08-16 00:00:00+00'),
('s1','c1','2026-08-16 00:01:00+00'),
('c1','f1','2026-08-16 00:01:00+00'),
('f1','next1','2026-08-16 00:01:00+00'),
('x1','x2','2026-08-16 00:02:00+00'),
('x2','x4','2026-08-16 00:02:00+00');
SQL

expect_failure() {
  local name="$1" sql="$2" pattern="$3"
  set +e
  docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "$sql" > "${output_directory}/${name}.stdout" 2> "${output_directory}/${name}.stderr"
  local rc=$?
  set -e
  [[ "$rc" -ne 0 ]]
  grep -Fq "$pattern" "${output_directory}/${name}.stderr"
}

# A retained predecessor outside the completion window blocks the whole window.
expect_failure retained_predecessor \
  "select xrpl_phase_archive_v1.terminalize_completed_window('supabase-devnet','2026-08-16 00:01:00+00','2026-08-17 00:00:00+00')" \
  'terminal archive window has unresolved predecessor chain'
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_phase_archive_v1.terminal_messages")" == 0 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='completed'")" == 4 ]]

# Once the predecessor is archived, the exact completion window drains oldest-to-newest.
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.terminalize_message('oldpred','2026-08-17 00:00:01+00')" >/dev/null
archived_count="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select xrpl_phase_archive_v1.terminalize_completed_window('supabase-devnet','2026-08-16 00:01:00+00','2026-08-17 00:00:02+00')")"
[[ "$archived_count" == 3 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='completed'")" == 0 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where message_id='next1' and status='pending'")" == 1 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_phase_archive_v1.terminal_messages where profile_id='supabase-devnet'")" == 4 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select string_agg(message_id,',' order by completed_at,message_id) from xrpl_phase_archive_v1.terminal_messages where profile_id='supabase-devnet'")" == 'oldpred,c1,f1,s1' ]]

# Mid-window failure must roll back the earlier terminalization in the same function call.
expect_failure atomic_rollback \
  "select xrpl_phase_archive_v1.terminalize_completed_window('rollback-profile','2026-08-16 00:02:00+00','2026-08-17 00:00:03+00')" \
  'phase successor mapping missing or mismatched: x2'
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where message_id in ('x1','x2') and status='completed'")" == 2 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_successors where current_message_id='x1' and successor_message_id='x2'")" == 1 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_phase_archive_v1.terminal_messages where profile_id='rollback-profile'")" == 0 ]]

cat > "${output_directory}/summary.md" <<EOF
## R5 terminal archive window PostgreSQL proof

- PostgreSQL: \`15-alpine\`
- window helper direct service_role EXECUTE: \`false\`
- retained predecessor blocks entire window: \`true\`
- blocked window mutates zero archive/live rows: \`true\`
- predecessor-first transition: \`true\`
- one completion window archived rows: \`${archived_count}\`
- final pending successor preserved: \`true\`
- completed rows left in successful window: \`0\`
- mid-window mapping failure rolls back prior terminalization: \`true\`
- production database used: \`false\`
- production window apply authorized: \`false\`
- R5 rearm authorized: \`false\`
EOF
cat "${output_directory}/summary.md"
