#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-raw-recurring-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_RAW_RECURRING_OUTPUT:-r5-raw-recurring-retention-evidence}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory"; mkdir -p "$output_directory"

docker run --detach --rm --name "$container_name" --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres "$image" > "$output_directory/container-id.txt"
stable=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable=$((stable+1)); [[ "$stable" -ge 3 ]] && break
  else stable=0; fi
  sleep 1
done
[[ "$stable" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "$output_directory/setup.log" <<'SQL'
create table public.xrpl_phase_work (
  work_id text primary key,
  profile_id text not null,
  status text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  scanned_end_ledger_index bigint not null,
  expected_parent_hash text not null,
  final_ledger_hash text not null,
  expected_payload_chunks integer not null,
  expected_commit_chunks integer not null,
  committed_at timestamptz
);
create table public.xrpl_phase_payload_chunks (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  chunk_index integer not null,
  payload_json text not null,
  primary key(work_id,chunk_index)
);
create table public.xrpl_phase_commit_chunks (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  chunk_index integer not null,
  status text not null,
  primary key(work_id,chunk_index)
);
create table public.xrpl_phase_reference_rows (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  canonical_key text not null,
  value_json text not null,
  primary key(work_id,canonical_key)
);
create table public.xrpl_phase_watermarks (
  profile_id text primary key,
  ledger_index bigint not null,
  ledger_hash text not null,
  work_id text not null references public.xrpl_phase_work(work_id)
);

insert into public.xrpl_phase_work values
 ('old-complete','supabase-devnet','committed',98,99,99,'H098','H099',2,2,'2026-08-12 00:00:00+00'),
 ('old-incomplete','supabase-devnet','committed',99,100,100,'H099','H100',2,2,'2026-08-12 01:00:00+00'),
 ('recent','supabase-devnet','committed',100,101,101,'H100','H101',1,1,'2026-08-14 12:00:00+00'),
 ('predecessor','supabase-devnet','committed',101,102,102,'H101','H102',1,1,'2026-08-14 23:58:00+00'),
 ('current','supabase-devnet','committed',102,103,103,'H102','H103',2,2,'2026-08-14 23:59:00+00');
insert into public.xrpl_phase_payload_chunks values
 ('old-complete',0,'p99-a'),('old-complete',1,'p99-b'),
 ('old-incomplete',0,'p100-a'),
 ('recent',0,'p101'),('predecessor',0,'p102'),('current',0,'p103-a'),('current',1,'p103-b');
insert into public.xrpl_phase_commit_chunks values
 ('old-complete',0,'completed'),('old-complete',1,'completed'),
 ('old-incomplete',0,'completed'),
 ('recent',0,'completed'),('predecessor',0,'completed'),('current',0,'completed'),('current',1,'completed');
insert into public.xrpl_phase_reference_rows values
 ('old-complete','k99','v99'),('old-incomplete','k100','v100'),('recent','k101','v101'),('predecessor','k102','v102'),('current','k103','v103');
insert into public.xrpl_phase_watermarks values ('supabase-devnet',103,'H103','current');
SQL

cat > "$output_directory/cleanup.sql" <<'SQL'
with active_watermark as (
  select * from public.xrpl_phase_watermarks where profile_id='supabase-devnet'
),
current_work as (
  select w.* from public.xrpl_phase_work w join active_watermark wm on wm.work_id=w.work_id
  where w.profile_id='supabase-devnet' and w.status='committed' and w.committed_at is not null
    and w.scanned_end_ledger_index=wm.ledger_index and w.final_ledger_hash=wm.ledger_hash
),
predecessor_work as (
  select p.* from current_work c join public.xrpl_phase_work p
    on p.profile_id=c.profile_id and p.status='committed' and p.committed_at is not null
   and p.scanned_end_ledger_index=c.previous_ledger_index and p.final_ledger_hash=c.expected_parent_hash
  order by p.committed_at desc,p.work_id desc limit 1
),
protected_work as (
  select work_id from current_work union select work_id from predecessor_work
),
candidate_work_ids as (
  select w.work_id
  from public.xrpl_phase_work w
  where w.profile_id='supabase-devnet'
    and w.status='committed'
    and w.committed_at is not null
    and w.committed_at < '2026-08-15 00:00:00+00'::timestamptz - interval '24 hours'
    and not exists(select 1 from protected_work p where p.work_id=w.work_id)
    and (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=w.work_id)=w.expected_payload_chunks
    and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id)=w.expected_commit_chunks
    and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id and c.status='completed')=w.expected_commit_chunks
),
deleted_payload as (
  delete from public.xrpl_phase_payload_chunks p using candidate_work_ids c
  where p.work_id=c.work_id returning p.work_id
),
deleted_commit as (
  delete from public.xrpl_phase_commit_chunks c using candidate_work_ids x
  where c.work_id=x.work_id returning c.work_id
)
select json_build_object(
  'payloadDeleted',(select count(*) from deleted_payload),
  'commitDeleted',(select count(*) from deleted_commit),
  'workIds',(select coalesce(json_agg(work_id order by work_id),'[]'::json) from candidate_work_ids)
);
SQL

if grep -Eiq '\b(delete|update|insert|truncate|alter|drop|vacuum|create)\b' "$output_directory/cleanup.sql"; then
  delete_count="$(grep -Eio '\bdelete\s+from\b' "$output_directory/cleanup.sql" | wc -l | tr -d ' ')"
  [[ "$delete_count" == 2 ]]
  ! grep -Eiq '\b(delete\s+from\s+public\.(xrpl_phase_work|xrpl_phase_reference_rows|xrpl_phase_messages|xrpl_phase_successors)|update|insert|truncate|alter|drop|vacuum|create)\b' "$output_directory/cleanup.sql"
fi

work_digest_before="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(row_to_json(w)::text,',' order by work_id)) from public.xrpl_phase_work w")"
reference_digest_before="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(row_to_json(r)::text,',' order by work_id,canonical_key)) from public.xrpl_phase_reference_rows r")"
watermark_before="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select row_to_json(w)::text from public.xrpl_phase_watermarks w where profile_id='supabase-devnet'")"

run_cleanup() {
  local name="$1"
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At < "$output_directory/cleanup.sql" | tee "$output_directory/${name}.json"
}
run_cleanup first
first_payload="$(python -c 'import json; print(json.load(open("'$output_directory'/first.json"))["payloadDeleted"])')"
first_commit="$(python -c 'import json; print(json.load(open("'$output_directory'/first.json"))["commitDeleted"])')"
[[ "$first_payload" == 2 && "$first_commit" == 2 ]]

# The complete old work is pruned; incomplete old evidence, recent work, predecessor and current stay intact.
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_payload_chunks where work_id='old-complete'")" == 0 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_commit_chunks where work_id='old-complete'")" == 0 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_payload_chunks where work_id='old-incomplete'")" == 1 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_commit_chunks where work_id='old-incomplete'")" == 1 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_payload_chunks where work_id in ('recent','predecessor','current')")" == 4 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_commit_chunks where work_id in ('recent','predecessor','current')")" == 4 ]]

run_cleanup second
second_payload="$(python -c 'import json; print(json.load(open("'$output_directory'/second.json"))["payloadDeleted"])')"
second_commit="$(python -c 'import json; print(json.load(open("'$output_directory'/second.json"))["commitDeleted"])')"
[[ "$second_payload" == 0 && "$second_commit" == 0 ]]

# Add another complete old committed work and prove the same command catches it without touching canonical history.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
insert into public.xrpl_phase_work values ('old-later','supabase-devnet','committed',50,51,51,'H050','H051',1,1,'2026-08-12 02:00:00+00');
insert into public.xrpl_phase_payload_chunks values ('old-later',0,'p51');
insert into public.xrpl_phase_commit_chunks values ('old-later',0,'completed');
insert into public.xrpl_phase_reference_rows values ('old-later','k51','v51');
SQL
reference_digest_after_insert="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(row_to_json(r)::text,',' order by work_id,canonical_key)) from public.xrpl_phase_reference_rows r")"
run_cleanup third
third_payload="$(python -c 'import json; print(json.load(open("'$output_directory'/third.json"))["payloadDeleted"])')"
third_commit="$(python -c 'import json; print(json.load(open("'$output_directory'/third.json"))["commitDeleted"])')"
[[ "$third_payload" == 1 && "$third_commit" == 1 ]]

work_digest_after="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(row_to_json(w)::text,',' order by work_id)) from public.xrpl_phase_work w")"
reference_digest_after="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(row_to_json(r)::text,',' order by work_id,canonical_key)) from public.xrpl_phase_reference_rows r")"
watermark_after="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select row_to_json(w)::text from public.xrpl_phase_watermarks w where profile_id='supabase-devnet'")"
[[ "$reference_digest_after" == "$reference_digest_after_insert" ]]
[[ "$watermark_after" == "$watermark_before" ]]
# Work changed only by the explicitly inserted synthetic old-later row, never by cleanup.
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from public.xrpl_phase_work')" == 6 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from public.xrpl_phase_reference_rows')" == 6 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_payload_chunks where work_id in ('predecessor','current')")" == 3 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_commit_chunks where work_id in ('predecessor','current')")" == 3 ]]

cat > "$output_directory/summary.md" <<EOF
## R5 recurring raw-evidence retention PostgreSQL proof

- cutoff: \`24h\`
- cleanup SQL is one snapshot statement: \`true\`
- writable targets: \`xrpl_phase_payload_chunks / xrpl_phase_commit_chunks only\`
- complete old work pruned: \`true\`
- incomplete old work fail-closed retained: \`true\`
- current + predecessor protected: \`true\`
- recent <24h work retained: \`true\`
- committed work rows retained: \`true\`
- canonical reference rows retained: \`true\`
- watermark unchanged: \`true\`
- second identical run is idempotent: \`true\`
- later old complete work pruned on next run: \`true\`
- production database used: \`false\`
- production deletion authorized: \`false\`
EOF
cat "$output_directory/summary.md"
