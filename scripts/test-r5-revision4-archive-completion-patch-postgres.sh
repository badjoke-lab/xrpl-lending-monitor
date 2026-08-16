#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-archive-completion-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_ARCHIVE_COMPLETION_PATCH_OUTPUT:-r5-archive-completion-patch-evidence}"
contract_sql='ops/production-sql/20260816183000_xrpl_phase_terminal_archive_contract.sql'
window_sql='ops/production-sql/20260816190000_xrpl_phase_terminal_archive_window.sql'
patch_sql='ops/production-sql/20260816193000_xrpl_r5_revision4_terminal_archive_completion_patch.sql'
production_before='d759dfef8b11de9379af3d72cf28caba2f109e28f7aa83b36ece32e230a2b150'
production_after='a7114afea201a32bd90c3f6ee08ae666e033e83bcc99384eb2a5b4a415f814b7'
signature='public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory" && mkdir -p "$output_directory"

for file in "$contract_sql" "$window_sql" "$patch_sql"; do test -s "$file"; done
grep -Fq "$production_before" "$patch_sql"
grep -Fq "$production_after" "$patch_sql"
grep -Fq 'terminalize_completed_window' "$patch_sql"
grep -Fq 'source drift' "$patch_sql"
grep -Fq 'patched digest mismatch' "$patch_sql"

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
create schema xrpl_r5_v1;
create table xrpl_r5_v1.recovery_runs(run_id text primary key,status text not null);
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
insert into public.xrpl_phase_streams(profile_id) values ('supabase-devnet');
insert into xrpl_r5_v1.recovery_runs(run_id,status) values ('r5-recovery-proof0001','leased');
SQL

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$contract_sql" > "${output_directory}/contract.log"
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$window_sql" > "${output_directory}/window.log"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/clone.log" <<'SQL'
create or replace function public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(
  p_run_id text,
  p_batch_id text,
  p_owner text,
  p_completed_at timestamptz,
  p_works_json text,
  p_works_digest text,
  p_accounting_json text,
  p_accounting_digest text,
  p_finalized_egress_upper_bound_bytes bigint,
  p_fetch_milliseconds numeric,
  p_normalize_milliseconds numeric,
  p_edge_wall_milliseconds numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $function$
begin
  update xrpl_r5_v1.recovery_runs
  set status = 'completed'
  where run_id = p_run_id;

  return jsonb_build_object(
    'completed', true,
    'batchId', p_batch_id,
    'owner', p_owner
  );
end;
$function$;
SQL

before_sha="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select encode(extensions.digest(convert_to(pg_get_functiondef('$signature'::regprocedure),'UTF8'),'sha256'),'hex')")"
after_sha="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select encode(extensions.digest(convert_to(replace(pg_get_functiondef('$signature'::regprocedure), E'  where run_id = p_run_id;\\n\\n  return jsonb_build_object(', E'  where run_id = p_run_id;\\n\\n  perform xrpl_phase_archive_v1.terminalize_completed_window(\\n    ''supabase-devnet'', p_completed_at, p_completed_at\\n  );\\n\\n  return jsonb_build_object('),'UTF8'),'sha256'),'hex')")"
[[ "$before_sha" =~ ^[a-f0-9]{64}$ ]]
[[ "$after_sha" =~ ^[a-f0-9]{64}$ ]]
[[ "$before_sha" != "$after_sha" ]]

sed \
  -e "s/$production_before/$before_sha/g" \
  -e "s/$production_after/$after_sha/g" \
  "$patch_sql" > "${output_directory}/clone-patch.sql"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "${output_directory}/clone-patch.sql" > "${output_directory}/patch-apply.log"
patched_sha="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select encode(extensions.digest(convert_to(pg_get_functiondef('$signature'::regprocedure),'UTF8'),'sha256'),'hex')")"
[[ "$patched_sha" == "$after_sha" ]]
archive_call_count="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select (length(pg_get_functiondef('$signature'::regprocedure))-length(replace(pg_get_functiondef('$signature'::regprocedure),'xrpl_phase_archive_v1.terminalize_completed_window','')))/length('xrpl_phase_archive_v1.terminalize_completed_window')")"
[[ "$archive_call_count" == 1 ]]

# Reapplying the exact patch is idempotent once the patched SHA is present.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "${output_directory}/clone-patch.sql" > "${output_directory}/patch-reapply.log"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select encode(extensions.digest(convert_to(pg_get_functiondef('$signature'::regprocedure),'UTF8'),'sha256'),'hex')")" == "$after_sha" ]]

# A source change outside the authorized definition must fail closed.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > /dev/null <<'SQL'
create or replace function public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(
  p_run_id text,p_batch_id text,p_owner text,p_completed_at timestamptz,
  p_works_json text,p_works_digest text,p_accounting_json text,p_accounting_digest text,
  p_finalized_egress_upper_bound_bytes bigint,p_fetch_milliseconds numeric,
  p_normalize_milliseconds numeric,p_edge_wall_milliseconds numeric
) returns jsonb language plpgsql security definer set search_path=public,xrpl_r5_v1,pg_temp as $function$
begin
  perform 1;
  update xrpl_r5_v1.recovery_runs set status='completed' where run_id=p_run_id;
  return jsonb_build_object('completed',true,'batchId',p_batch_id,'owner',p_owner);
end;
$function$;
SQL
set +e
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "${output_directory}/clone-patch.sql" > "${output_directory}/drift.stdout" 2> "${output_directory}/drift.stderr"
drift_rc=$?
set -e
[[ "$drift_rc" -ne 0 ]]
grep -Fq 'revision4 terminal archive completion source drift' "${output_directory}/drift.stderr"

# Restore the authorized clone and patch it again for integration behavior.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > /dev/null <<'SQL'
create or replace function public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(
  p_run_id text,
  p_batch_id text,
  p_owner text,
  p_completed_at timestamptz,
  p_works_json text,
  p_works_digest text,
  p_accounting_json text,
  p_accounting_digest text,
  p_finalized_egress_upper_bound_bytes bigint,
  p_fetch_milliseconds numeric,
  p_normalize_milliseconds numeric,
  p_edge_wall_milliseconds numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $function$
begin
  update xrpl_r5_v1.recovery_runs
  set status = 'completed'
  where run_id = p_run_id;

  return jsonb_build_object(
    'completed', true,
    'batchId', p_batch_id,
    'owner', p_owner
  );
end;
$function$;
SQL
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "${output_directory}/clone-patch.sql" > /dev/null

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > /dev/null <<'SQL'
insert into public.xrpl_phase_messages(message_id,profile_id,phase,payload,status,available_at,result,successor_message_id,created_at,updated_at,completed_at) values
('s1','supabase-devnet','scan',jsonb_build_object('id','s1'),'completed','2026-08-16 01:00:00+00',jsonb_build_object('status','staged'),'c1','2026-08-16 01:00:00+00','2026-08-16 01:00:00+00','2026-08-16 01:00:00+00'),
('c1','supabase-devnet','commit',jsonb_build_object('id','c1'),'completed','2026-08-16 01:00:00+00',jsonb_build_object('status','committing'),'f1','2026-08-16 01:00:01+00','2026-08-16 01:00:01+00','2026-08-16 01:00:00+00'),
('f1','supabase-devnet','finalize',jsonb_build_object('id','f1'),'completed','2026-08-16 01:00:00+00',jsonb_build_object('status','committed'),'next1','2026-08-16 01:00:02+00','2026-08-16 01:00:02+00','2026-08-16 01:00:00+00'),
('next1','supabase-devnet','scan',jsonb_build_object('id','next1'),'pending','2026-08-16 01:00:00+00',null,null,'2026-08-16 01:00:03+00','2026-08-16 01:00:03+00',null);
insert into public.xrpl_phase_successors(current_message_id,successor_message_id,reserved_at) values
('s1','c1','2026-08-16 01:00:00+00'),('c1','f1','2026-08-16 01:00:00+00'),('f1','next1','2026-08-16 01:00:00+00');
update xrpl_r5_v1.recovery_runs set status='leased' where run_id='r5-recovery-proof0001';
SQL

success_json="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select public.xrpl_complete_r5_revision4_recovery_batch_without_qualification('r5-recovery-proof0001','batch0001','owner0001','2026-08-16 01:00:00+00','[]','x','{}','y',0,0,0,0)::text")"
[[ "$(printf '%s' "$success_json" | jq -r '.completed')" == true ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select status from xrpl_r5_v1.recovery_runs where run_id='r5-recovery-proof0001'")" == completed ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='completed'")" == 0 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where message_id='next1' and status='pending'")" == 1 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_phase_archive_v1.terminal_messages where profile_id='supabase-devnet'")" == 3 ]]

# Integration failure after the run update must roll the run update and partial terminalization back.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > /dev/null <<'SQL'
insert into public.xrpl_phase_messages(message_id,profile_id,phase,payload,status,available_at,result,successor_message_id,created_at,updated_at,completed_at) values
('bad1','supabase-devnet','scan',jsonb_build_object('id','bad1'),'completed','2026-08-16 02:00:00+00',jsonb_build_object('status','staged'),'bad2','2026-08-16 02:00:00+00','2026-08-16 02:00:00+00','2026-08-16 02:00:00+00'),
('bad2','supabase-devnet','commit',jsonb_build_object('id','bad2'),'completed','2026-08-16 02:00:00+00',jsonb_build_object('status','committing'),'bad3','2026-08-16 02:00:01+00','2026-08-16 02:00:01+00','2026-08-16 02:00:00+00'),
('bad3','supabase-devnet','finalize',jsonb_build_object('id','bad3'),'pending','2026-08-16 02:00:00+00',null,null,'2026-08-16 02:00:02+00','2026-08-16 02:00:02+00',null),
('bad4','supabase-devnet','finalize',jsonb_build_object('id','bad4'),'pending','2026-08-16 02:00:00+00',null,null,'2026-08-16 02:00:03+00','2026-08-16 02:00:03+00',null);
insert into public.xrpl_phase_successors(current_message_id,successor_message_id,reserved_at) values
('bad1','bad2','2026-08-16 02:00:00+00'),('bad2','bad4','2026-08-16 02:00:00+00');
update xrpl_r5_v1.recovery_runs set status='leased' where run_id='r5-recovery-proof0001';
SQL
set +e
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "select public.xrpl_complete_r5_revision4_recovery_batch_without_qualification('r5-recovery-proof0001','batch0002','owner0001','2026-08-16 02:00:00+00','[]','x','{}','y',0,0,0,0)" > "${output_directory}/integration-failure.stdout" 2> "${output_directory}/integration-failure.stderr"
integration_rc=$?
set -e
[[ "$integration_rc" -ne 0 ]]
grep -Fq 'phase successor mapping missing or mismatched: bad2' "${output_directory}/integration-failure.stderr"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select status from xrpl_r5_v1.recovery_runs where run_id='r5-recovery-proof0001'")" == leased ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_messages where message_id in ('bad1','bad2') and status='completed'")" == 2 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_phase_archive_v1.terminal_messages where message_id in ('bad1','bad2')")" == 0 ]]

cat > "${output_directory}/summary.md" <<EOF
## R5 revision-4 archive-on-completion patch PostgreSQL proof

- production definition SHA bound before patch: \`${production_before}\`
- production expected SHA after patch: \`${production_after}\`
- clone patch source SHA drift rejected: \`true\`
- clone patched definition contains one archive-window call: \`true\`
- exact patch reapply idempotent: \`true\`
- successful completion leaves zero completed live transport rows: \`true\`
- successful completion preserves final pending scan: \`true\`
- successful completion archives terminal chain: \`true\`
- archive-window failure rolls back earlier run update: \`true\`
- archive-window failure rolls back partial terminalization: \`true\`
- production database used: \`false\`
- production completion patch authorized: \`false\`
- R5 rearm authorized: \`false\`
EOF
cat "${output_directory}/summary.md"
