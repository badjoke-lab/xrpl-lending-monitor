#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-work-reindex-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_WORK_INDEX_REINDEX_OUTPUT:-r5-work-index-reindex-evidence}"
cleanup(){ docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory" && mkdir -p "$output_directory"

docker run --detach --rm --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres \
  "$image" > "${output_directory}/container-id.txt"

stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable_ready=$((stable_ready+1)); [[ "$stable_ready" -ge 3 ]] && break
  else stable_ready=0; fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/setup.log" <<'SQL'
create schema proof;
create table proof.xrpl_phase_work (
  work_id text primary key,
  profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  expected_parent_hash text not null,
  planned_end_ledger_index bigint not null,
  scanned_end_ledger_index bigint,
  final_ledger_hash text,
  status text not null check(status in ('planned','staged','committing','finalizing','committed','error')),
  plan_json text not null,
  payload_digest text,
  expected_payload_chunks integer not null default 0,
  expected_commit_chunks integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  committed_at timestamptz,
  unique(profile_id,start_ledger_index,expected_parent_hash)
);
create index xrpl_phase_work_committed_reader_idx on proof.xrpl_phase_work(
  profile_id,network,epoch_id,base_identity,status,scanned_end_ledger_index,work_id
);
create index xrpl_phase_work_status_idx on proof.xrpl_phase_work(profile_id,status,updated_at,work_id)
  where status <> 'committed';

-- Use production-shaped long identities. 17,064 live rows matches the current production table.
insert into proof.xrpl_phase_work(
  work_id,profile_id,network,epoch_id,base_identity,previous_ledger_index,start_ledger_index,
  expected_parent_hash,planned_end_ledger_index,scanned_end_ledger_index,final_ledger_hash,status,
  plan_json,payload_digest,expected_payload_chunks,expected_commit_chunks,created_at,updated_at,committed_at
)
select
  'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-'||repeat(md5(g::text),4)||':'||lpad(g::text,8,'0')||':'||repeat(md5('work-'||g::text),2),
  'supabase-devnet','devnet','supabase-r4c2c-v1',
  'seven-class-base-4132417-'||repeat(md5('base'),2),
  4132416+g,4132417+g,upper(repeat(substr(md5(g::text),1,1),64)),4132417+g,
  null,null,'planned',
  jsonb_build_object('schemaVersion',1,'ordinal',g,'blob',repeat(md5('plan-'||g::text),3))::text,
  null,0,0,
  '2026-08-01 00:00:00+00'::timestamptz+g*interval '1 second',
  '2026-08-01 00:00:00+00'::timestamptz+g*interval '1 second',null
from generate_series(1,17064) g;

-- Reproduce the normal status churn that prevents HOT updates because status is indexed.
update proof.xrpl_phase_work set status='staged',scanned_end_ledger_index=start_ledger_index,
  payload_digest=md5(work_id)||md5(work_id),expected_payload_chunks=1,
  updated_at=updated_at+interval '1 second'
where start_ledger_index < 4132417+17064;
update proof.xrpl_phase_work set status='committing',expected_commit_chunks=1,
  updated_at=updated_at+interval '1 second'
where status='staged' and start_ledger_index < 4132417+17064;
update proof.xrpl_phase_work set status='finalizing',final_ledger_hash=upper(repeat('A',64)),
  updated_at=updated_at+interval '1 second'
where status='committing';
update proof.xrpl_phase_work set status='committed',committed_at=updated_at+interval '1 second',
  updated_at=updated_at+interval '1 second'
where status='finalizing';
-- Leave one live staged row, matching the production-shaped boundary seen in prior probes.
update proof.xrpl_phase_work set status='staged',scanned_end_ledger_index=start_ledger_index,
  payload_digest=md5(work_id)||md5(work_id),expected_payload_chunks=1,
  updated_at=updated_at+interval '1 second'
where start_ledger_index = 4132417+17064;

vacuum analyze proof.xrpl_phase_work;
SQL

row_digest_sql="select md5(string_agg(md5(to_jsonb(w)::text),'' order by work_id)) from proof.xrpl_phase_work w"
constraint_digest_sql="select md5(string_agg(conname||'|'||contype::text||'|'||pg_get_constraintdef(oid,true),'' order by conname)) from pg_constraint where conrelid='proof.xrpl_phase_work'::regclass"

before_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.xrpl_phase_work')"
before_committed="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from proof.xrpl_phase_work where status='committed'")"
before_staged="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from proof.xrpl_phase_work where status='staged'")"
before_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")"
before_constraints="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")"
before_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work')")"
before_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_pkey')")"
before_unique_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key')")"
before_reader_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_committed_reader_idx')")"
before_status_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_status_idx')")"
before_pkey_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_work_pkey'::regclass::oid")"
before_unique_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key'::regclass::oid")"
before_reader_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_work_committed_reader_idx'::regclass::oid")"
before_status_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_work_status_idx'::regclass::oid")"
before_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"

[[ "$before_rows" -eq 17064 ]]
[[ "$before_committed" -eq 17063 ]]
[[ "$before_staged" -eq 1 ]]

# Build compact shadow indexes to measure the storage needed by fresh btrees.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/shadow.log" <<'SQL'
create unique index shadow_pkey on proof.xrpl_phase_work(work_id);
select 'shadow_pkey_bytes='||pg_relation_size('proof.shadow_pkey');
drop index proof.shadow_pkey;
create unique index shadow_unique on proof.xrpl_phase_work(profile_id,start_ledger_index,expected_parent_hash);
select 'shadow_unique_bytes='||pg_relation_size('proof.shadow_unique');
drop index proof.shadow_unique;
create index shadow_reader on proof.xrpl_phase_work(profile_id,network,epoch_id,base_identity,status,scanned_end_ledger_index,work_id);
select 'shadow_reader_bytes='||pg_relation_size('proof.shadow_reader');
drop index proof.shadow_reader;
SQL
metric_shadow(){ sed -n "s/^${1}=//p" "${output_directory}/shadow.log" | tail -n1; }
shadow_pkey_bytes="$(metric_shadow shadow_pkey_bytes)"
shadow_unique_bytes="$(metric_shadow shadow_unique_bytes)"
shadow_reader_bytes="$(metric_shadow shadow_reader_bytes)"

# Reindex the three large persistent indexes one at a time. Peer indexes and heap must not change.
reindex_one(){
  local target="$1" marker="$2" output="$3"
  set +e
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/rollback-${output}.log" 2>&1 <<SQL
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-work-index-physical-reindex',0));
reindex index proof.${target};
do \$\$ begin raise exception '${marker}'; end \$\$;
commit;
SQL
  local rc=$?
  set -e
  [[ "$rc" -ne 0 ]]
  grep -q "$marker" "${output_directory}/rollback-${output}.log"
  [[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")" == "$before_digest" ]]
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/${output}.log" <<SQL
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-work-index-physical-reindex',0));
reindex index proof.${target};
commit;
SQL
}

reindex_one xrpl_phase_work_pkey injected_work_pkey_reindex_failure pkey
after_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_pkey')")"
unique_after_pkey="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key')")"
reader_after_pkey="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_committed_reader_idx')")"
[[ "$after_pkey_bytes" -lt "$before_pkey_bytes" ]]
[[ "$unique_after_pkey" -eq "$before_unique_bytes" ]]
[[ "$reader_after_pkey" -eq "$before_reader_bytes" ]]

reindex_one xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key injected_work_unique_reindex_failure unique
after_unique_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key')")"
reader_after_unique="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_committed_reader_idx')")"
[[ "$after_unique_bytes" -lt "$before_unique_bytes" ]]
[[ "$reader_after_unique" -eq "$before_reader_bytes" ]]

reindex_one xrpl_phase_work_committed_reader_idx injected_work_reader_reindex_failure reader
after_reader_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_committed_reader_idx')")"
[[ "$after_reader_bytes" -lt "$before_reader_bytes" ]]

# Exact preservation checks after all three target reindexes.
after_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work')")"
after_status_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_work_status_idx')")"
after_pkey_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_work_pkey'::regclass::oid")"
after_unique_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key'::regclass::oid")"
after_reader_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_work_committed_reader_idx'::regclass::oid")"
after_status_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_work_status_idx'::regclass::oid")"
after_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"
[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]
[[ "$after_status_bytes" -eq "$before_status_bytes" ]]
[[ "$after_pkey_oid" == "$before_pkey_oid" ]]
[[ "$after_unique_oid" == "$before_unique_oid" ]]
[[ "$after_reader_oid" == "$before_reader_oid" ]]
[[ "$after_status_oid" == "$before_status_oid" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")" == "$before_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")" == "$before_constraints" ]]
[[ "$after_database_bytes" -lt "$before_database_bytes" ]]

pkey_reclaimed=$((before_pkey_bytes-after_pkey_bytes))
unique_reclaimed=$((before_unique_bytes-after_unique_bytes))
reader_reclaimed=$((before_reader_bytes-after_reader_bytes))
total_reclaimed=$((pkey_reclaimed+unique_reclaimed+reader_reclaimed))
cat > "${output_directory}/metrics.json" <<EOF
{
  "schemaVersion": 1,
  "productionDatabaseUsed": false,
  "productionReindexAuthorized": false,
  "rows": ${before_rows},
  "committedRows": ${before_committed},
  "stagedRows": ${before_staged},
  "heapBytesPreserved": true,
  "statusIndexBytesPreserved": true,
  "rowDigestPreserved": true,
  "constraintDigestPreserved": true,
  "pkeyOidPreserved": true,
  "uniqueOidPreserved": true,
  "readerOidPreserved": true,
  "statusOidPreserved": true,
  "pkeyBytesBefore": ${before_pkey_bytes},
  "compactShadowPkeyBytes": ${shadow_pkey_bytes},
  "pkeyBytesAfter": ${after_pkey_bytes},
  "pkeyBytesReclaimed": ${pkey_reclaimed},
  "uniqueBytesBefore": ${before_unique_bytes},
  "compactShadowUniqueBytes": ${shadow_unique_bytes},
  "uniqueBytesAfter": ${after_unique_bytes},
  "uniqueBytesReclaimed": ${unique_reclaimed},
  "readerBytesBefore": ${before_reader_bytes},
  "compactShadowReaderBytes": ${shadow_reader_bytes},
  "readerBytesAfter": ${after_reader_bytes},
  "readerBytesReclaimed": ${reader_reclaimed},
  "totalTargetIndexBytesReclaimed": ${total_reclaimed},
  "databaseBytesBefore": ${before_database_bytes},
  "databaseBytesAfter": ${after_database_bytes}
}
EOF
cat > "${output_directory}/summary.md" <<EOF
## R5 phase-work index REINDEX local proof

- PostgreSQL: \`15-alpine\`
- production database used: \`false\`
- production REINDEX authorized: \`false\`
- live rows / committed / staged: \`${before_rows} / ${before_committed} / ${before_staged}\`
- pkey before / compact / after / reclaimed: \`${before_pkey_bytes} / ${shadow_pkey_bytes} / ${after_pkey_bytes} / ${pkey_reclaimed}\`
- unique before / compact / after / reclaimed: \`${before_unique_bytes} / ${shadow_unique_bytes} / ${after_unique_bytes} / ${unique_reclaimed}\`
- committed-reader before / compact / after / reclaimed: \`${before_reader_bytes} / ${shadow_reader_bytes} / ${after_reader_bytes} / ${reader_reclaimed}\`
- total target-index bytes reclaimed: \`${total_reclaimed}\`
- heap/status-index/row-digest/constraint-digest/all OIDs preserved: \`true\`
EOF
cat "${output_directory}/summary.md"
