#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-dual-rewrite-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_TERMINAL_DUAL_REWRITE_OUTPUT:-r5-terminal-transport-dual-rewrite-evidence}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory" && mkdir -p "$output_directory"

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

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/setup.log" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema proof;
create table proof.streams (
  profile_id text primary key
);
insert into proof.streams(profile_id) values ('supabase_free_postgres_pgcron_edge');

create table proof.messages (
  message_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null references proof.streams(profile_id),
  phase text not null check (phase in ('scan','commit','finalize')),
  payload jsonb not null,
  status text not null check (status in ('pending','leased','retry','completed','error')),
  available_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  result jsonb,
  successor_message_id text,
  error_classification text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  constraint messages_lease_pair_check check ((lease_owner is null) = (lease_expires_at is null)),
  constraint messages_completed_check check (status <> 'completed' or completed_at is not null),
  constraint messages_error_check check (status <> 'error' or (error_classification is not null and error_message is not null))
);

create index messages_ready_idx
  on proof.messages(profile_id,status,available_at,created_at,message_id)
  where status in ('pending','retry','leased');

create table proof.successors (
  current_message_id text primary key references proof.messages(message_id),
  successor_message_id text not null unique references proof.messages(message_id),
  reserved_at timestamptz not null
);

alter table proof.messages enable row level security;
alter table proof.successors enable row level security;
grant select, insert, update, delete, truncate, references, trigger on proof.messages to service_role;
grant select, insert, delete, truncate, references, trigger on proof.successors to service_role;

with generated as (
  select g,
    'scan:v1:devnet:epoch:'||lpad(g::text,6,'0')||':'||repeat(md5(g::text),5) as id,
    jsonb_build_object(
      'schemaVersion',1,
      'phase','scan',
      'ordinal',g,
      'blob',repeat(md5('payload-'||g::text),36)
    ) as payload,
    jsonb_build_object(
      'status','committed',
      'ordinal',g,
      'blob',repeat(md5('result-'||g::text),18)
    ) as result
  from generate_series(1,12000) g
)
insert into proof.messages(
  message_id,schema_version,profile_id,phase,payload,status,available_at,attempt_count,
  lease_owner,lease_expires_at,result,successor_message_id,error_classification,error_message,
  created_at,updated_at,completed_at
)
select
  id,1,'supabase_free_postgres_pgcron_edge','scan',payload,
  case when g=12000 then 'pending' else 'completed' end,
  '2026-08-15 00:00:00+00'::timestamptz + g*interval '1 second',0,
  null,null,
  case when g=12000 then null else result end,
  case when g=12000 then null else 'scan:v1:devnet:epoch:'||lpad((g+1)::text,6,'0')||':'||repeat(md5((g+1)::text),5) end,
  null,null,
  '2026-08-15 00:00:00+00'::timestamptz + g*interval '1 second',
  '2026-08-15 00:00:00+00'::timestamptz + g*interval '1 second',
  case when g=12000 then null else '2026-08-15 00:00:02+00'::timestamptz + g*interval '1 second' end
from generated;

insert into proof.successors(current_message_id,successor_message_id,reserved_at)
select message_id,successor_message_id,completed_at
from proof.messages
where successor_message_id is not null;

analyze proof.messages;
analyze proof.successors;

-- Simulate Phase B history removal while retaining physical bloat.
delete from proof.successors
where current_message_id in (
  select message_id from proof.messages
  where split_part(message_id,':',5)::integer <= 4000
);
delete from proof.messages
where split_part(message_id,':',5)::integer <= 4000;

-- Add update churn comparable to a live transport table. This increases dead tuples
-- without changing retained row identity at the start of the rewrite proof.
update proof.messages
set updated_at = updated_at + interval '1 microsecond'
where status='completed' and split_part(message_id,':',5)::integer % 3 = 0;
update proof.messages
set updated_at = updated_at - interval '1 microsecond'
where status='completed' and split_part(message_id,':',5)::integer % 3 = 0;

analyze proof.messages;
analyze proof.successors;
SQL

schema_fingerprint_sql="select md5(string_agg(x,'' order by x)) from (\
select 'rel|'||c.relname||'|'||c.relpersistence::text||'|'||c.relreplident::text||'|'||c.relrowsecurity::text||'|'||coalesce(c.relacl::text,'') as x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='proof' and c.relname in ('messages','successors') \
union all select 'col|'||table_name||'|'||ordinal_position::text||'|'||column_name||'|'||data_type||'|'||udt_name||'|'||is_nullable||'|'||coalesce(column_default,'')||'|'||is_identity||'|'||is_generated from information_schema.columns where table_schema='proof' and table_name in ('messages','successors') \
union all select 'con|'||c.relname||'|'||con.conname||'|'||con.contype::text||'|'||con.convalidated::text||'|'||con.condeferrable::text||'|'||pg_get_constraintdef(con.oid,true) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='proof' and c.relname in ('messages','successors') \
union all select 'idx|'||t.relname||'|'||i.relname||'|'||x.indisprimary::text||'|'||x.indisunique::text||'|'||x.indisvalid::text||'|'||x.indisready::text||'|'||x.indisclustered::text||'|'||pg_get_indexdef(i.oid) from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class t on t.oid=x.indrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='proof' and t.relname in ('messages','successors')\
) q"

message_digest_sql="select md5(string_agg(md5(to_jsonb(m)::text),'' order by m.message_id)) from proof.messages m"
successor_digest_sql="select md5(string_agg(md5(to_jsonb(s)::text),'' order by s.current_message_id)) from proof.successors s"

before_schema="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$schema_fingerprint_sql")"
before_message_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$message_digest_sql")"
before_successor_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$successor_digest_sql")"
before_message_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.messages')"
before_successor_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.successors')"
before_message_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages'::regclass::oid")"
before_successor_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.successors'::regclass::oid")"
before_message_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.messages')")"
before_successor_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.successors')")"
before_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"

# Prove all-or-nothing rollback first. Both FK participants are truncated together;
# an injected exception after message restore must restore the original live state.
set +e
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/rollback.log" 2>&1 <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='180s';
select pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b',0));
select pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint',0));
lock table proof.successors in access exclusive mode;
lock table proof.messages in access exclusive mode;
create temp table snapshot_messages on commit drop as select * from proof.messages;
create temp table snapshot_successors on commit drop as select * from proof.successors;
truncate table proof.successors, proof.messages;
insert into proof.messages select * from snapshot_messages;
do $$ begin raise exception 'injected_dual_rewrite_failure'; end $$;
commit;
SQL
rollback_rc=$?
set -e
[[ "$rollback_rc" -ne 0 ]]
grep -q 'injected_dual_rewrite_failure' "${output_directory}/rollback.log"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(md5(to_jsonb(m)::text),'' order by m.message_id)) from proof.messages m")" == "$before_message_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(md5(to_jsonb(s)::text),'' order by s.current_message_id)) from proof.successors s")" == "$before_successor_digest" ]]

# Successful row-preserving physical rewrite. Temporary snapshots contain no indexes
# or constraints, minimizing working-set storage before TRUNCATE releases live files.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/rewrite.log" <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='180s';
select pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b',0));
select pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint',0));
lock table proof.successors in access exclusive mode;
lock table proof.messages in access exclusive mode;

create temp table snapshot_messages on commit drop as select * from proof.messages;
create temp table snapshot_successors on commit drop as select * from proof.successors;

select 'snapshot_message_bytes='||pg_total_relation_size('pg_temp.snapshot_messages');
select 'snapshot_successor_bytes='||pg_total_relation_size('pg_temp.snapshot_successors');
select 'database_bytes_after_snapshot='||pg_database_size(current_database());
select 'snapshot_message_rows='||count(*) from snapshot_messages;
select 'snapshot_successor_rows='||count(*) from snapshot_successors;
select 'snapshot_message_digest='||md5(string_agg(md5(to_jsonb(m)::text),'' order by m.message_id)) from snapshot_messages m;
select 'snapshot_successor_digest='||md5(string_agg(md5(to_jsonb(s)::text),'' order by s.current_message_id)) from snapshot_successors s;

truncate table proof.successors, proof.messages;
select 'database_bytes_after_truncate='||pg_database_size(current_database());

insert into proof.messages select * from snapshot_messages order by message_id;
insert into proof.successors select * from snapshot_successors order by current_message_id;

select 'database_bytes_after_restore='||pg_database_size(current_database());
select 'restored_message_rows='||count(*) from proof.messages;
select 'restored_successor_rows='||count(*) from proof.successors;
select 'restored_message_digest='||md5(string_agg(md5(to_jsonb(m)::text),'' order by m.message_id)) from proof.messages m;
select 'restored_successor_digest='||md5(string_agg(md5(to_jsonb(s)::text),'' order by s.current_message_id)) from proof.successors s;
commit;
select 'database_bytes_after_commit='||pg_database_size(current_database());
SQL

metric() { sed -n "s/^${1}=//p" "${output_directory}/rewrite.log" | tail -n1; }
snapshot_message_bytes="$(metric snapshot_message_bytes)"
snapshot_successor_bytes="$(metric snapshot_successor_bytes)"
database_after_snapshot="$(metric database_bytes_after_snapshot)"
database_after_truncate="$(metric database_bytes_after_truncate)"
database_after_restore="$(metric database_bytes_after_restore)"
database_after_commit="$(metric database_bytes_after_commit)"
snapshot_message_rows="$(metric snapshot_message_rows)"
snapshot_successor_rows="$(metric snapshot_successor_rows)"
snapshot_message_digest="$(metric snapshot_message_digest)"
snapshot_successor_digest="$(metric snapshot_successor_digest)"
restored_message_rows="$(metric restored_message_rows)"
restored_successor_rows="$(metric restored_successor_rows)"
restored_message_digest="$(metric restored_message_digest)"
restored_successor_digest="$(metric restored_successor_digest)"

[[ "$snapshot_message_rows" == "$before_message_rows" ]]
[[ "$snapshot_successor_rows" == "$before_successor_rows" ]]
[[ "$restored_message_rows" == "$before_message_rows" ]]
[[ "$restored_successor_rows" == "$before_successor_rows" ]]
[[ "$snapshot_message_digest" == "$before_message_digest" ]]
[[ "$snapshot_successor_digest" == "$before_successor_digest" ]]
[[ "$restored_message_digest" == "$before_message_digest" ]]
[[ "$restored_successor_digest" == "$before_successor_digest" ]]

after_schema="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$schema_fingerprint_sql")"
after_message_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$message_digest_sql")"
after_successor_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$successor_digest_sql")"
after_message_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages'::regclass::oid")"
after_successor_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.successors'::regclass::oid")"
after_message_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.messages')")"
after_successor_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.successors')")"
after_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"

[[ "$after_schema" == "$before_schema" ]]
[[ "$after_message_digest" == "$before_message_digest" ]]
[[ "$after_successor_digest" == "$before_successor_digest" ]]
[[ "$after_message_oid" == "$before_message_oid" ]]
[[ "$after_successor_oid" == "$before_successor_oid" ]]
[[ "$after_message_bytes" -lt "$before_message_bytes" ]]
[[ "$after_successor_bytes" -lt "$before_successor_bytes" ]]

before_target_bytes=$((before_message_bytes + before_successor_bytes))
after_target_bytes=$((after_message_bytes + after_successor_bytes))
reclaimed_target_bytes=$((before_target_bytes - after_target_bytes))
snapshot_bytes=$((snapshot_message_bytes + snapshot_successor_bytes))
peak_database_bytes="$before_database_bytes"
for value in "$database_after_snapshot" "$database_after_truncate" "$database_after_restore" "$database_after_commit" "$after_database_bytes"; do
  [[ "$value" -gt "$peak_database_bytes" ]] && peak_database_bytes="$value"
done
peak_over_baseline=$((peak_database_bytes - before_database_bytes))
reclaimed_percent=$((reclaimed_target_bytes * 100 / before_target_bytes))

[[ "$reclaimed_target_bytes" -gt 0 ]]
[[ "$reclaimed_percent" -ge 15 ]]
[[ "$snapshot_bytes" -gt 0 ]]
[[ "$peak_over_baseline" -gt 0 ]]

cat > "${output_directory}/summary.md" <<EOF
## R5 terminal transport dual-table physical rewrite local PostgreSQL proof

- PostgreSQL: \`15-alpine\`
- production database used: \`false\`
- production compaction authorized: \`false\`
- synthetic live messages / successors: \`${before_message_rows} / ${before_successor_rows}\`
- exact row digests preserved: \`true\`
- relation OIDs preserved: \`true\`
- columns / constraints / FKs / indexes / RLS / ACL fingerprint preserved: \`true\`
- injected mid-rewrite failure rolls back both tables: \`true\`
- advisory-lock order matches Phase B: \`phase-b -> r5-checkpoint\`
- lock timeout / statement timeout: \`5s / 180s\`
- temporary snapshot has indexes/constraints: \`false\`
- snapshot message / successor bytes: \`${snapshot_message_bytes} / ${snapshot_successor_bytes}\`
- snapshot working bytes total: \`${snapshot_bytes}\`
- target relation bytes before / after: \`${before_target_bytes} / ${after_target_bytes}\`
- target bytes reclaimed / percent: \`${reclaimed_target_bytes} / ${reclaimed_percent}%\`
- database bytes before: \`${before_database_bytes}\`
- database bytes after snapshot: \`${database_after_snapshot}\`
- database bytes after truncate: \`${database_after_truncate}\`
- database bytes after restore: \`${database_after_restore}\`
- database bytes after commit: \`${database_after_commit}\`
- database bytes final: \`${after_database_bytes}\`
- measured peak database bytes: \`${peak_database_bytes}\`
- measured peak bytes over baseline: \`${peak_over_baseline}\`

The proof establishes transactional dual-table TRUNCATE+restore semantics only. Production execution remains prohibited until a separate provider-headroom gate proves the measured/derived temporary-storage peak is safe and an exact prepare/authorize/apply workflow is reviewed.
EOF

cat > "${output_directory}/metrics.json" <<EOF
{
  "schemaVersion": 1,
  "productionDatabaseUsed": false,
  "productionCompactionAuthorized": false,
  "messageRows": ${before_message_rows},
  "successorRows": ${before_successor_rows},
  "snapshotMessageBytes": ${snapshot_message_bytes},
  "snapshotSuccessorBytes": ${snapshot_successor_bytes},
  "snapshotBytes": ${snapshot_bytes},
  "targetBytesBefore": ${before_target_bytes},
  "targetBytesAfter": ${after_target_bytes},
  "targetBytesReclaimed": ${reclaimed_target_bytes},
  "databaseBytesBefore": ${before_database_bytes},
  "databaseBytesAfterSnapshot": ${database_after_snapshot},
  "databaseBytesAfterTruncate": ${database_after_truncate},
  "databaseBytesAfterRestore": ${database_after_restore},
  "databaseBytesAfterCommit": ${database_after_commit},
  "databaseBytesFinal": ${after_database_bytes},
  "peakDatabaseBytes": ${peak_database_bytes},
  "peakBytesOverBaseline": ${peak_over_baseline},
  "rowDigestsPreserved": true,
  "schemaFingerprintPreserved": true,
  "relationOidsPreserved": true,
  "rollbackVerified": true
}
EOF

cat "${output_directory}/summary.md"
