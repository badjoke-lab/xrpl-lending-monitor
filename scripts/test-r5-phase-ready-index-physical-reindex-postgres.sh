#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-ready-reindex-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_READY_REINDEX_OUTPUT:-r5-phase-ready-index-physical-reindex-evidence}"
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
  else
    stable_ready=0
  fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/setup.log" <<'SQL'
create schema proof;
create table proof.messages(
  message_id text primary key,
  profile_id text not null,
  status text not null check(status in ('pending','leased','retry','completed','error')),
  available_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index messages_ready_idx on proof.messages(profile_id,status,available_at,created_at,message_id)
  where status in ('pending','retry','leased');

insert into proof.messages(message_id,profile_id,status,available_at,created_at,updated_at)
select
  'phase:v1:devnet:epoch:'||lpad(g::text,6,'0')||':'||repeat(md5(g::text),5),
  'supabase-devnet','pending',
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second',
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second',
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second'
from generate_series(1,40000) g;

-- Leave exactly two ready rows while retaining the allocated partial-index pages.
update proof.messages
set status='completed',updated_at=updated_at+interval '1 second'
where message_id not in (
  'phase:v1:devnet:epoch:039999:'||repeat(md5('39999'),5),
  'phase:v1:devnet:epoch:040000:'||repeat(md5('40000'),5)
);
analyze proof.messages;
SQL

row_digest_sql="select md5(string_agg(md5(to_jsonb(m)::text),'' order by message_id)) from proof.messages m"
index_definition_sql="select pg_get_indexdef('proof.messages_ready_idx'::regclass)"
ready_rows_sql="select count(*) from proof.messages where status in ('pending','retry','leased')"

before_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.messages')"
before_ready_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$ready_rows_sql")"
before_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")"
before_index_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages_ready_idx'::regclass::oid")"
before_table_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages'::regclass::oid")"
before_index_definition="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$index_definition_sql")"
before_index_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages_ready_idx')")"
before_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages')")"
before_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"

[[ "$before_rows" -eq 40000 ]]
[[ "$before_ready_rows" -eq 2 ]]
[[ "$before_index_bytes" -gt 1048576 ]]

# Transaction rollback proof: a failure after REINDEX must restore the pre-state.
set +e
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/rollback.log" 2>&1 <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
select pg_advisory_xact_lock(hashtextextended('xrpl-phase-ready-index-physical-reindex',0));
reindex index proof.messages_ready_idx;
do $$ begin raise exception 'injected_ready_reindex_failure'; end $$;
commit;
SQL
rollback_rc=$?
set -e
[[ "$rollback_rc" -ne 0 ]]
grep -q 'injected_ready_reindex_failure' "${output_directory}/rollback.log"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")" == "$before_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages_ready_idx'::regclass::oid")" == "$before_index_oid" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages_ready_idx')")" -eq "$before_index_bytes" ]]

# Successful bounded physical rebuild of only the partial index.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/reindex.log" <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
select pg_advisory_xact_lock(hashtextextended('xrpl-phase-ready-index-physical-reindex',0));
select 'database_before_reindex='||pg_database_size(current_database());
reindex index proof.messages_ready_idx;
select 'database_during_reindex='||pg_database_size(current_database());
commit;
select 'database_after_reindex='||pg_database_size(current_database());
SQL

metric(){ sed -n "s/^${1}=//p" "${output_directory}/reindex.log" | tail -n1; }
database_before_reindex="$(metric database_before_reindex)"
database_during_reindex="$(metric database_during_reindex)"
database_after_reindex="$(metric database_after_reindex)"
after_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.messages')"
after_ready_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$ready_rows_sql")"
after_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")"
after_index_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages_ready_idx'::regclass::oid")"
after_table_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages'::regclass::oid")"
after_index_definition="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$index_definition_sql")"
after_index_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages_ready_idx')")"
after_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages')")"
index_valid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select indisvalid and indisready from pg_index where indexrelid='proof.messages_ready_idx'::regclass")"

[[ "$after_rows" -eq "$before_rows" ]]
[[ "$after_ready_rows" -eq "$before_ready_rows" ]]
[[ "$after_digest" == "$before_digest" ]]
[[ "$after_index_oid" == "$before_index_oid" ]]
[[ "$after_table_oid" == "$before_table_oid" ]]
[[ "$after_index_definition" == "$before_index_definition" ]]
[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]
[[ "$index_valid" == 't' ]]
[[ "$after_index_bytes" -lt "$before_index_bytes" ]]
[[ "$database_after_reindex" -lt "$before_database_bytes" ]]

index_reclaimed=$((before_index_bytes-after_index_bytes))
peak_overhead=$((database_during_reindex-database_before_reindex))

cat > "${output_directory}/evidence.json" <<JSON
{
  "schemaVersion": 1,
  "purpose": "r5-phase-ready-index-physical-reindex-local-proof",
  "rows": ${after_rows},
  "readyRows": ${after_ready_rows},
  "rowDigestPreserved": true,
  "indexOidPreserved": true,
  "tableOidPreserved": true,
  "indexDefinitionPreserved": true,
  "heapBytesPreserved": true,
  "indexValidAndReady": true,
  "rollbackVerified": true,
  "indexBytesBefore": ${before_index_bytes},
  "indexBytesAfter": ${after_index_bytes},
  "indexBytesReclaimed": ${index_reclaimed},
  "databaseBytesBefore": ${before_database_bytes},
  "databaseBytesDuringReindex": ${database_during_reindex},
  "databaseBytesAfter": ${database_after_reindex},
  "peakOverheadBytes": ${peak_overhead},
  "productionDatabaseUsed": false,
  "productionReindexAuthorized": false
}
JSON
sha256sum "${output_directory}/evidence.json" > "${output_directory}/evidence.sha256"
cat "${output_directory}/evidence.json"
