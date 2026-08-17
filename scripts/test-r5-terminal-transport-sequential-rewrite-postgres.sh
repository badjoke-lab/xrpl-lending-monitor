#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-sequential-rewrite-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_TERMINAL_SEQUENTIAL_REWRITE_OUTPUT:-r5-terminal-transport-sequential-rewrite-evidence}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory" && mkdir -p "$output_directory"

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
  > "${output_directory}/setup.log" <<'SQL'
create role service_role nologin;
create schema proof;
create table proof.streams(profile_id text primary key);
insert into proof.streams values ('supabase_free_postgres_pgcron_edge');

create table proof.messages (
  message_id text primary key,
  schema_version integer not null default 1 check (schema_version=1),
  profile_id text not null references proof.streams(profile_id),
  phase text not null check (phase in ('scan','commit','finalize')),
  payload jsonb not null,
  status text not null check (status in ('pending','leased','retry','completed','error')),
  available_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count>=0),
  lease_owner text,
  lease_expires_at timestamptz,
  result jsonb,
  successor_message_id text,
  error_classification text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  constraint messages_lease_pair_check check ((lease_owner is null)=(lease_expires_at is null)),
  constraint messages_completed_check check (status<>'completed' or completed_at is not null),
  constraint messages_error_check check (status<>'error' or (error_classification is not null and error_message is not null))
);
create index messages_ready_idx on proof.messages(profile_id,status,available_at,created_at,message_id)
  where status in ('pending','retry','leased');

create table proof.successors (
  current_message_id text primary key references proof.messages(message_id),
  successor_message_id text not null unique references proof.messages(message_id),
  reserved_at timestamptz not null
);

alter table proof.messages enable row level security;
alter table proof.successors enable row level security;
grant select,insert,update,delete,truncate,references,trigger on proof.messages to service_role;
grant select,insert,delete,truncate,references,trigger on proof.successors to service_role;

with generated as (
  select g,
    'scan:v1:devnet:epoch:'||lpad(g::text,6,'0')||':'||repeat(md5(g::text),5) as id,
    jsonb_build_object('schemaVersion',1,'phase','scan','ordinal',g,'blob',repeat(md5('payload-'||g::text),36)) as payload,
    jsonb_build_object('status','committed','ordinal',g,'blob',repeat(md5('result-'||g::text),18)) as result
  from generate_series(1,12000) g
)
insert into proof.messages(
  message_id,schema_version,profile_id,phase,payload,status,available_at,attempt_count,
  lease_owner,lease_expires_at,result,successor_message_id,error_classification,error_message,
  created_at,updated_at,completed_at
)
select id,1,'supabase_free_postgres_pgcron_edge','scan',payload,
  case when g=12000 then 'pending' else 'completed' end,
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second',0,
  null,null,case when g=12000 then null else result end,
  case when g=12000 then null else 'scan:v1:devnet:epoch:'||lpad((g+1)::text,6,'0')||':'||repeat(md5((g+1)::text),5) end,
  null,null,
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second',
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second',
  case when g=12000 then null else '2026-08-15 00:00:02+00'::timestamptz+g*interval '1 second' end
from generated;

insert into proof.successors(current_message_id,successor_message_id,reserved_at)
select message_id,successor_message_id,completed_at from proof.messages where successor_message_id is not null;

-- Model Phase B logical deletion without physical reclamation.
delete from proof.successors where current_message_id in (
  select message_id from proof.messages where split_part(message_id,':',5)::integer <= 4000
);
delete from proof.messages where split_part(message_id,':',5)::integer <= 4000;

-- Add message update churn to model dead tuples.
update proof.messages set updated_at=updated_at+interval '1 microsecond'
where status='completed' and split_part(message_id,':',5)::integer%3=0;
update proof.messages set updated_at=updated_at-interval '1 microsecond'
where status='completed' and split_part(message_id,':',5)::integer%3=0;
analyze proof.messages;
analyze proof.successors;
SQL

schema_fingerprint_sql="select md5(string_agg(x,'' order by x)) from (\
select 'rel|'||c.relname||'|'||c.relpersistence::text||'|'||c.relreplident::text||'|'||c.relrowsecurity::text||'|'||coalesce(c.relacl::text,'') as x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='proof' and c.relname in ('messages','successors') \
union all select 'col|'||table_name||'|'||ordinal_position::text||'|'||column_name||'|'||data_type||'|'||udt_name||'|'||is_nullable||'|'||coalesce(column_default,'')||'|'||is_identity||'|'||is_generated from information_schema.columns where table_schema='proof' and table_name in ('messages','successors') \
union all select 'con|'||c.relname||'|'||con.conname||'|'||con.contype::text||'|'||con.convalidated::text||'|'||con.condeferrable::text||'|'||pg_get_constraintdef(con.oid,true) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='proof' and c.relname in ('messages','successors') \
union all select 'idx|'||t.relname||'|'||i.relname||'|'||x.indisprimary::text||'|'||x.indisunique::text||'|'||x.indisvalid::text||'|'||x.indisready::text||'|'||pg_get_indexdef(i.oid) from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class t on t.oid=x.indrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='proof' and t.relname in ('messages','successors')\
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

# Stage 1: rewrite successors alone. This is legal because successors only references messages.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/stage1.log" <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='180s';
select pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b',0));
select pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint',0));
lock table proof.successors in access exclusive mode;
create temp table snapshot_successors on commit drop as select * from proof.successors;
select 'stage1_snapshot_successor_bytes='||pg_total_relation_size('pg_temp.snapshot_successors');
select 'stage1_database_peak='||pg_database_size(current_database());
select 'stage1_snapshot_rows='||count(*) from snapshot_successors;
select 'stage1_snapshot_digest='||md5(string_agg(md5(to_jsonb(s)::text),'' order by s.current_message_id)) from snapshot_successors s;
truncate table proof.successors;
insert into proof.successors select * from snapshot_successors order by current_message_id;
commit;
select 'stage1_database_after='||pg_database_size(current_database());
SQL

metric1(){ sed -n "s/^${1}=//p" "${output_directory}/stage1.log" | tail -n1; }
stage1_snapshot_successor_bytes="$(metric1 stage1_snapshot_successor_bytes)"
stage1_database_peak="$(metric1 stage1_database_peak)"
stage1_database_after="$(metric1 stage1_database_after)"
stage1_snapshot_rows="$(metric1 stage1_snapshot_rows)"
stage1_snapshot_digest="$(metric1 stage1_snapshot_digest)"
[[ "$stage1_snapshot_rows" == "$before_successor_rows" ]]
[[ "$stage1_snapshot_digest" == "$before_successor_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$successor_digest_sql")" == "$before_successor_digest" ]]
stage1_successor_bytes_after="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.successors')")"

# Stage 2: rewrite messages after successors have already returned their bloat.
# Both FK participants are snapshotted and truncated together, but the successor snapshot is now compact.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/stage2.log" <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='180s';
select pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b',0));
select pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint',0));
lock table proof.successors in access exclusive mode;
lock table proof.messages in access exclusive mode;
create temp table snapshot_messages on commit drop as select * from proof.messages;
create temp table snapshot_successors on commit drop as select * from proof.successors;
select 'stage2_snapshot_message_bytes='||pg_total_relation_size('pg_temp.snapshot_messages');
select 'stage2_snapshot_successor_bytes='||pg_total_relation_size('pg_temp.snapshot_successors');
select 'stage2_database_peak='||pg_database_size(current_database());
select 'stage2_message_rows='||count(*) from snapshot_messages;
select 'stage2_successor_rows='||count(*) from snapshot_successors;
select 'stage2_message_digest='||md5(string_agg(md5(to_jsonb(m)::text),'' order by m.message_id)) from snapshot_messages m;
select 'stage2_successor_digest='||md5(string_agg(md5(to_jsonb(s)::text),'' order by s.current_message_id)) from snapshot_successors s;
truncate table proof.successors,proof.messages;
insert into proof.messages select * from snapshot_messages order by message_id;
insert into proof.successors select * from snapshot_successors order by current_message_id;
commit;
select 'stage2_database_after='||pg_database_size(current_database());
SQL

metric2(){ sed -n "s/^${1}=//p" "${output_directory}/stage2.log" | tail -n1; }
stage2_snapshot_message_bytes="$(metric2 stage2_snapshot_message_bytes)"
stage2_snapshot_successor_bytes="$(metric2 stage2_snapshot_successor_bytes)"
stage2_database_peak="$(metric2 stage2_database_peak)"
stage2_database_after="$(metric2 stage2_database_after)"
stage2_message_rows="$(metric2 stage2_message_rows)"
stage2_successor_rows="$(metric2 stage2_successor_rows)"
stage2_message_digest="$(metric2 stage2_message_digest)"
stage2_successor_digest="$(metric2 stage2_successor_digest)"

[[ "$stage2_message_rows" == "$before_message_rows" ]]
[[ "$stage2_successor_rows" == "$before_successor_rows" ]]
[[ "$stage2_message_digest" == "$before_message_digest" ]]
[[ "$stage2_successor_digest" == "$before_successor_digest" ]]

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
[[ "$after_database_bytes" -lt "$before_database_bytes" ]]

# Counterfactual initial dual snapshot peak uses the same compact snapshots but before
# stage 1 has reclaimed successor bloat. Sequential stage 2 must be materially lower.
counterfactual_dual_peak=$((before_database_bytes + stage2_snapshot_message_bytes + stage2_snapshot_successor_bytes))
[[ "$stage2_database_peak" -lt "$counterfactual_dual_peak" ]]
peak_reduction=$((counterfactual_dual_peak-stage2_database_peak))
[[ "$peak_reduction" -gt 0 ]]
message_saved=$((before_message_bytes-after_message_bytes))
successor_saved=$((before_successor_bytes-after_successor_bytes))
total_saved=$((message_saved+successor_saved))

cat > "${output_directory}/metrics.json" <<EOF
{
  "schemaVersion": 1,
  "productionDatabaseUsed": false,
  "productionCompactionAuthorized": false,
  "beforeDatabaseBytes": ${before_database_bytes},
  "beforeMessageBytes": ${before_message_bytes},
  "beforeSuccessorBytes": ${before_successor_bytes},
  "stage1SnapshotSuccessorBytes": ${stage1_snapshot_successor_bytes},
  "stage1DatabasePeak": ${stage1_database_peak},
  "stage1DatabaseAfter": ${stage1_database_after},
  "stage1SuccessorBytesAfter": ${stage1_successor_bytes_after},
  "stage2SnapshotMessageBytes": ${stage2_snapshot_message_bytes},
  "stage2SnapshotSuccessorBytes": ${stage2_snapshot_successor_bytes},
  "stage2DatabasePeak": ${stage2_database_peak},
  "stage2DatabaseAfter": ${stage2_database_after},
  "counterfactualInitialDualPeak": ${counterfactual_dual_peak},
  "sequentialPeakReductionBytes": ${peak_reduction},
  "afterDatabaseBytes": ${after_database_bytes},
  "afterMessageBytes": ${after_message_bytes},
  "afterSuccessorBytes": ${after_successor_bytes},
  "messageBytesSaved": ${message_saved},
  "successorBytesSaved": ${successor_saved},
  "totalRelationBytesSaved": ${total_saved},
  "messageRowsPreserved": true,
  "successorRowsPreserved": true,
  "messageDigestPreserved": true,
  "successorDigestPreserved": true,
  "schemaFingerprintPreserved": true,
  "messageOidPreserved": true,
  "successorOidPreserved": true
}
EOF

cat > "${output_directory}/summary.md" <<EOF
## R5 terminal transport sequential physical rewrite local proof

- PostgreSQL: \`15-alpine\`
- production database used: \`false\`
- production compaction authorized: \`false\`
- baseline database bytes: \`${before_database_bytes}\`
- baseline messages / successors bytes: \`${before_message_bytes} / ${before_successor_bytes}\`
- stage 1 successor snapshot / peak / post-stage DB: \`${stage1_snapshot_successor_bytes} / ${stage1_database_peak} / ${stage1_database_after}\`
- stage 2 message + compact-successor snapshots: \`${stage2_snapshot_message_bytes} + ${stage2_snapshot_successor_bytes}\`
- stage 2 peak: \`${stage2_database_peak}\`
- counterfactual initial dual-snapshot peak: \`${counterfactual_dual_peak}\`
- sequential peak reduction: \`${peak_reduction}\`
- final messages / successors bytes: \`${after_message_bytes} / ${after_successor_bytes}\`
- total relation bytes saved: \`${total_saved}\`
- row digests, schema fingerprint, OIDs preserved: \`true\`

The proof establishes only the local ordering property: compact successors first, then rewrite messages with the already-compacted successor table. Production compaction, index removal/recreation, archive movement, scheduler/deployment/public-reader/Mainnet changes, and R5 rearm remain separately unauthorized.
EOF
cat "${output_directory}/summary.md"
