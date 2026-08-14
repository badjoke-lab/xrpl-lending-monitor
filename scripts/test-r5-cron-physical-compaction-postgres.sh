#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-cron-compact-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_CRON_COMPACTION_OUTPUT:-r5-cron-physical-compaction-evidence}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory"; mkdir -p "$output_directory"

docker run --detach --rm --name "$container_name" --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres "$image" > "$output_directory/container-id.txt"
stable=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable=$((stable+1)); [[ "$stable" -ge 3 ]] && break
  else
    stable=0
  fi
  sleep 1
done
[[ "$stable" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "$output_directory/setup.log" <<'SQL'
create schema cron;
-- pg_cron uses its own run-ID sequence rather than an identity/serial owned by the table.
create sequence cron.runid_seq;
create table cron.job_run_details (
  jobid bigint not null,
  runid bigint primary key,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);
-- Old succeeded rows eligible for 24h retention deletion.
insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
select 1,nextval('cron.runid_seq'),1000+g,'postgres','postgres','select 1','succeeded','1 row',
       '2026-08-10 00:00:00+00'::timestamptz+g*interval '1 second',
       '2026-08-10 00:00:01+00'::timestamptz+g*interval '1 second'
from generate_series(1,18000) g;
-- Recent succeeded rows must survive.
insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
select 1,nextval('cron.runid_seq'),30000+g,'postgres','postgres','select 1','succeeded','1 row',
       '2026-08-14 14:00:00+00'::timestamptz+g*interval '1 second',
       '2026-08-14 14:00:01+00'::timestamptz+g*interval '1 second'
from generate_series(1,1440) g;
-- Recent failed rows survive 7 days.
insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
select 1,nextval('cron.runid_seq'),40000+g,'postgres','postgres','select 1','failed','boom',
       '2026-08-12 00:00:00+00'::timestamptz+g*interval '1 second',
       '2026-08-12 00:00:01+00'::timestamptz+g*interval '1 second'
from generate_series(1,220) g;
-- Old failures are eligible for 7-day deletion.
insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
select 1,nextval('cron.runid_seq'),50000+g,'postgres','postgres','select 1','failed','old boom',
       '2026-08-01 00:00:00+00'::timestamptz+g*interval '1 second',
       '2026-08-01 00:00:01+00'::timestamptz+g*interval '1 second'
from generate_series(1,20) g;
-- Open/running row with null end_time is always retained.
insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
values (1,nextval('cron.runid_seq'),99999,'postgres','postgres','select pg_sleep(1)','running',null,'2026-08-01 00:00:00+00',null);
analyze cron.job_run_details;
SQL

NOW_SQL="'2026-08-15 00:00:00+00'::timestamptz"
KEEP_PREDICATE="not ((status='succeeded' and end_time is not null and end_time < ${NOW_SQL}-interval '24 hours') or (status is distinct from 'succeeded' and end_time is not null and end_time < ${NOW_SQL}-interval '7 days'))"

before_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from cron.job_run_details')"
eligible_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from cron.job_run_details where not (${KEEP_PREDICATE})")"
retained_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from cron.job_run_details where ${KEEP_PREDICATE}")"
retained_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(concat_ws('|',jobid,runid,coalesce(job_pid::text,''),database,username,command,status,coalesce(return_message,''),start_time::text,coalesce(end_time::text,'')), E'\\n' order by runid)) from cron.job_run_details where ${KEEP_PREDICATE}")"
before_heap="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('cron.job_run_details'::regclass)")"
before_total="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('cron.job_run_details'::regclass)")"
before_db="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"
seq_name="cron.runid_seq"
seq_before="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select last_value from cron.runid_seq')"
max_before="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select max(runid) from cron.job_run_details')"
[[ "$seq_before" -ge "$max_before" ]]

cat > "$output_directory/compaction.sql" <<SQL
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
lock table cron.job_run_details in access exclusive mode;
create temporary table r5_cron_retained on commit drop as
  select * from cron.job_run_details where ${KEEP_PREDICATE};
create temporary table r5_cron_compaction_meta on commit drop as
  select (select last_value from cron.runid_seq)::bigint as sequence_before,
         (select max(runid) from cron.job_run_details)::bigint as max_runid_before;
truncate table cron.job_run_details continue identity;
insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
  select jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time
  from r5_cron_retained order by runid;
do \$\$
declare
  v_sequence_before bigint;
  v_sequence_after bigint;
  v_max_before bigint;
begin
  select sequence_before,max_runid_before into v_sequence_before,v_max_before from r5_cron_compaction_meta;
  select last_value into v_sequence_after from cron.runid_seq;
  if v_sequence_after < v_sequence_before then raise exception 'sequence moved backward'; end if;
  if v_sequence_after < v_max_before then raise exception 'sequence behind max runid'; end if;
end \$\$;
commit;
SQL
! grep -Eiq '\bsetval\s*\(' "$output_directory/compaction.sql"
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$output_directory/compaction.sql" > "$output_directory/compaction.log"

after_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from cron.job_run_details')"
after_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(concat_ws('|',jobid,runid,coalesce(job_pid::text,''),database,username,command,status,coalesce(return_message,''),start_time::text,coalesce(end_time::text,'')), E'\\n' order by runid)) from cron.job_run_details")"
after_heap="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('cron.job_run_details'::regclass)")"
after_total="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('cron.job_run_details'::regclass)")"
after_db="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"
seq_after="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select last_value from cron.runid_seq')"
remaining_eligible="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from cron.job_run_details where not (${KEEP_PREDICATE})")"
null_end_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from cron.job_run_details where end_time is null')"

[[ "$after_rows" == "$retained_rows" ]]
[[ "$after_digest" == "$retained_digest" ]]
[[ "$remaining_eligible" == 0 ]]
[[ "$null_end_rows" == 1 ]]
[[ "$seq_after" -ge "$seq_before" ]]
[[ "$seq_after" -ge "$max_before" ]]
[[ "$after_heap" -lt "$before_heap" ]]
[[ "$after_total" -lt "$before_total" ]]
[[ "$after_db" -lt "$before_db" ]]

new_runid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time) values (1,nextval('cron.runid_seq'),77777,'postgres','postgres','select 1','succeeded','1 row',${NOW_SQL},${NOW_SQL}) returning runid")"
[[ "$new_runid" -gt "$max_before" ]]

reclaimed_heap=$((before_heap-after_heap))
reclaimed_total=$((before_total-after_total))
reclaimed_db=$((before_db-after_db))
cat > "$output_directory/summary.md" <<EOF
## R5 cron physical compaction PostgreSQL proof

- rows before: \`${before_rows}\`
- eligible old rows: \`${eligible_rows}\`
- retained rows before / rows after: \`${retained_rows} / ${after_rows}\`
- retained row digest preserved exactly: \`true\`
- eligible rows after: \`${remaining_eligible}\`
- null-end running rows retained: \`${null_end_rows}\`
- pg_cron run-ID sequence: \`${seq_name}\`
- sequence last value before/after: \`${seq_before} / ${seq_after}\`
- sequence never moved backward and remained >= pre-compaction max runid: \`true\`
- no setval/reset performed: \`true\`
- next generated runid exceeds pre-compaction max: \`true\`
- heap bytes before/after/reclaimed: \`${before_heap} / ${after_heap} / ${reclaimed_heap}\`
- total relation bytes before/after/reclaimed: \`${before_total} / ${after_total} / ${reclaimed_total}\`
- database bytes before/after/reclaimed: \`${before_db} / ${after_db} / ${reclaimed_db}\`
- lock timeout / statement timeout: \`5s / 45s\`
- production database used: \`false\`
- production mutation authorized: \`false\`
EOF
cat "$output_directory/summary.md"
