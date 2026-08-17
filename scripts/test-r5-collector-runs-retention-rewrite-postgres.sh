#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-collector-retention-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_COLLECTOR_RETENTION_REWRITE_OUTPUT:-r5-collector-runs-retention-rewrite-evidence}"
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
create schema proof;
create table proof.xrpl_collector_runtime(profile_id text primary key);
insert into proof.xrpl_collector_runtime values ('supabase-devnet');

create table proof.xrpl_collector_runs (
  id bigint generated always as identity primary key,
  profile_id text not null references proof.xrpl_collector_runtime(profile_id),
  invocation_id text not null,
  lease_owner text not null,
  source text not null,
  status text not null check (status in ('completed','failed','skipped')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  validated_ledger_index bigint,
  validated_ledger_hash text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint xrpl_collector_runs_hash_check check (validated_ledger_hash is null or validated_ledger_hash ~ '^[A-F0-9]{64}$'),
  constraint xrpl_collector_runs_time_check check (completed_at >= started_at)
);
create index xrpl_collector_runs_profile_completed_idx
  on proof.xrpl_collector_runs(profile_id,completed_at desc,id desc);
alter table proof.xrpl_collector_runs enable row level security;

insert into proof.xrpl_collector_runs(
  profile_id,invocation_id,lease_owner,source,status,started_at,completed_at,
  validated_ledger_index,validated_ledger_hash,error_message,created_at
)
select
  'supabase-devnet','invocation-'||lpad(g::text,6,'0'),'lease-'||lpad(g::text,6,'0'),'cron',
  case when g%89=0 then 'failed' else 'completed' end,
  '2026-08-01 00:00:00+00'::timestamptz+g*interval '1 minute',
  '2026-08-01 00:00:01+00'::timestamptz+g*interval '1 minute',
  case when g%89=0 then null else 4100000+g end,
  case when g%89=0 then null else upper(md5(g::text)||md5('hash-'||g::text)) end,
  case when g%89=0 then 'synthetic failure '||g::text else null end,
  '2026-08-01 00:00:01+00'::timestamptz+g*interval '1 minute'
from generate_series(1,21329) g;
analyze proof.xrpl_collector_runs;
SQL

schema_fingerprint_sql="select md5(string_agg(x,'' order by x)) from (\
select 'rel|'||c.relname||'|'||c.relpersistence::text||'|'||c.relrowsecurity::text||'|'||coalesce(c.relacl::text,'') as x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='proof' and c.relname='xrpl_collector_runs' \
union all select 'col|'||ordinal_position::text||'|'||column_name||'|'||data_type||'|'||udt_name||'|'||is_nullable||'|'||coalesce(column_default,'')||'|'||is_identity||'|'||coalesce(identity_generation,'') from information_schema.columns where table_schema='proof' and table_name='xrpl_collector_runs' \
union all select 'con|'||con.conname||'|'||con.contype::text||'|'||con.convalidated::text||'|'||pg_get_constraintdef(con.oid,true) from pg_constraint con where con.conrelid='proof.xrpl_collector_runs'::regclass \
union all select 'idx|'||i.relname||'|'||x.indisprimary::text||'|'||x.indisunique::text||'|'||x.indisvalid::text||'|'||x.indisready::text||'|'||pg_get_indexdef(i.oid) from pg_index x join pg_class i on i.oid=x.indexrelid where x.indrelid='proof.xrpl_collector_runs'::regclass\
) q"
all_digest_sql="select md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from proof.xrpl_collector_runs r"
retained_digest_sql="select md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from (select * from proof.xrpl_collector_runs order by completed_at desc,id desc limit 256) r"

before_schema="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$schema_fingerprint_sql")"
before_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_collector_runs'::regclass::oid")"
before_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.xrpl_collector_runs')"
before_relation_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.xrpl_collector_runs')")"
before_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"
before_sequence="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select last_value from proof.xrpl_collector_runs_id_seq")"
expected_retained_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$retained_digest_sql")"
expected_retained_min_id="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select min(id) from (select id from proof.xrpl_collector_runs order by completed_at desc,id desc limit 256) q')"
expected_retained_max_id="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select max(id) from (select id from proof.xrpl_collector_runs order by completed_at desc,id desc limit 256) q')"

[[ "$before_rows" -eq 21329 ]]
[[ "$before_sequence" -eq 21329 ]]
[[ "$expected_retained_min_id" -eq 21074 ]]
[[ "$expected_retained_max_id" -eq 21329 ]]

# Rollback proof: injected failure after TRUNCATE must restore the original table.
set +e
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/rollback.log" 2>&1 <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
lock table proof.xrpl_collector_runs in access exclusive mode;
create temp table retained on commit drop as
  select * from proof.xrpl_collector_runs order by completed_at desc,id desc limit 256;
truncate table proof.xrpl_collector_runs;
do $$ begin raise exception 'injected_collector_retention_failure'; end $$;
commit;
SQL
rollback_rc=$?
set -e
[[ "$rollback_rc" -ne 0 ]]
grep -q 'injected_collector_retention_failure' "${output_directory}/rollback.log"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.xrpl_collector_runs')" -eq 21329 ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select last_value from proof.xrpl_collector_runs_id_seq")" -eq 21329 ]]

# Successful bounded retention + physical rewrite. TRUNCATE does not restart the
# identity sequence; retained IDs are restored explicitly with OVERRIDING SYSTEM VALUE.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/rewrite.log" <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
lock table proof.xrpl_collector_runs in access exclusive mode;
create temp table retained on commit drop as
  select * from proof.xrpl_collector_runs order by completed_at desc,id desc limit 256;
select 'snapshot_rows='||count(*) from retained;
select 'snapshot_bytes='||pg_total_relation_size('pg_temp.retained');
select 'snapshot_digest='||md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from retained r;
select 'database_peak='||pg_database_size(current_database());
truncate table proof.xrpl_collector_runs;
insert into proof.xrpl_collector_runs(
  id,profile_id,invocation_id,lease_owner,source,status,started_at,completed_at,
  validated_ledger_index,validated_ledger_hash,error_message,created_at
) overriding system value
select id,profile_id,invocation_id,lease_owner,source,status,started_at,completed_at,
  validated_ledger_index,validated_ledger_hash,error_message,created_at
from retained order by id;
select 'restored_rows='||count(*) from proof.xrpl_collector_runs;
select 'restored_digest='||md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from proof.xrpl_collector_runs r;
select 'sequence_after_restore='||last_value from proof.xrpl_collector_runs_id_seq;
commit;
select 'database_after_commit='||pg_database_size(current_database());
SQL

metric(){ sed -n "s/^${1}=//p" "${output_directory}/rewrite.log" | tail -n1; }
snapshot_rows="$(metric snapshot_rows)"
snapshot_bytes="$(metric snapshot_bytes)"
snapshot_digest="$(metric snapshot_digest)"
database_peak="$(metric database_peak)"
restored_rows="$(metric restored_rows)"
restored_digest="$(metric restored_digest)"
sequence_after_restore="$(metric sequence_after_restore)"
database_after_commit="$(metric database_after_commit)"

[[ "$snapshot_rows" -eq 256 ]]
[[ "$restored_rows" -eq 256 ]]
[[ "$snapshot_digest" == "$expected_retained_digest" ]]
[[ "$restored_digest" == "$expected_retained_digest" ]]
[[ "$sequence_after_restore" -eq 21329 ]]

after_schema="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$schema_fingerprint_sql")"
after_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_collector_runs'::regclass::oid")"
after_relation_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.xrpl_collector_runs')")"
after_sequence="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select last_value from proof.xrpl_collector_runs_id_seq")"
after_min_id="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select min(id) from proof.xrpl_collector_runs')"
after_max_id="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select max(id) from proof.xrpl_collector_runs')"
next_id="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select nextval('proof.xrpl_collector_runs_id_seq')")"

[[ "$after_schema" == "$before_schema" ]]
[[ "$after_oid" == "$before_oid" ]]
[[ "$after_sequence" -eq 21329 ]]
[[ "$after_min_id" -eq 21074 ]]
[[ "$after_max_id" -eq 21329 ]]
[[ "$next_id" -eq 21330 ]]
[[ "$after_relation_bytes" -lt "$before_relation_bytes" ]]
[[ "$database_after_commit" -lt "$before_database_bytes" ]]

saved_relation=$((before_relation_bytes-after_relation_bytes))
saved_database=$((before_database_bytes-database_after_commit))
peak_overhead=$((database_peak-before_database_bytes))

cat > "${output_directory}/metrics.json" <<EOF
{
  "schemaVersion": 1,
  "productionDatabaseUsed": false,
  "productionRetentionAuthorized": false,
  "productionPhysicalRewriteAuthorized": false,
  "beforeRows": ${before_rows},
  "retainedRows": 256,
  "beforeRelationBytes": ${before_relation_bytes},
  "afterRelationBytes": ${after_relation_bytes},
  "savedRelationBytes": ${saved_relation},
  "beforeDatabaseBytes": ${before_database_bytes},
  "databasePeak": ${database_peak},
  "peakOverheadBytes": ${peak_overhead},
  "databaseAfterCommit": ${database_after_commit},
  "savedDatabaseBytes": ${saved_database},
  "snapshotBytes": ${snapshot_bytes},
  "retainedMinId": ${after_min_id},
  "retainedMaxId": ${after_max_id},
  "sequenceBefore": ${before_sequence},
  "sequenceAfter": ${after_sequence},
  "nextIdentityValue": ${next_id},
  "retainedDigestPreserved": true,
  "schemaFingerprintPreserved": true,
  "relationOidPreserved": true,
  "rollbackVerified": true
}
EOF

cat > "${output_directory}/summary.md" <<EOF
## R5 collector run retention physical rewrite local proof

- PostgreSQL: \`15-alpine\`
- production database used: \`false\`
- production retention / physical rewrite authorized: \`false / false\`
- rows before / retained: \`${before_rows} / 256\`
- relation bytes before / after: \`${before_relation_bytes} / ${after_relation_bytes}\`
- saved relation bytes: \`${saved_relation}\`
- database bytes before / peak / after: \`${before_database_bytes} / ${database_peak} / ${database_after_commit}\`
- peak overhead bytes: \`${peak_overhead}\`
- retained ID range: \`${after_min_id}..${after_max_id}\`
- identity sequence before / after / next value: \`${before_sequence} / ${after_sequence} / ${next_id}\`
- retained digest, schema fingerprint, OID, rollback: \`preserved / preserved / preserved / verified\`

This proves only the local rewrite mechanics for keeping the latest 256 collector-run records while physically releasing historical storage. Production retention/rewrite, scheduler/deployment/public-reader/Mainnet changes, and R5 rearm remain separately unauthorized.
EOF
cat "${output_directory}/summary.md"
