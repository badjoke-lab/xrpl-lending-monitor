#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-successor-reindex-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_SUCCESSOR_INDEX_REINDEX_OUTPUT:-r5-successor-constraint-index-reindex-evidence}"
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
create table proof.messages(message_id text primary key);
create table proof.successors(
  current_message_id text primary key references proof.messages(message_id),
  successor_message_id text not null unique references proof.messages(message_id),
  reserved_at timestamptz not null
);

insert into proof.messages(message_id)
select 'phase:v1:devnet:supabase-r4c2c-v1:'||lpad(g::text,8,'0')||':'||repeat(md5(g::text),5)||':r4'
from generate_series(1,65235) g;

insert into proof.successors(current_message_id,successor_message_id,reserved_at)
select
  'phase:v1:devnet:supabase-r4c2c-v1:'||lpad(g::text,8,'0')||':'||repeat(md5(g::text),5)||':r4',
  'phase:v1:devnet:supabase-r4c2c-v1:'||lpad((g+1)::text,8,'0')||':'||repeat(md5((g+1)::text),5)||':r4',
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second'
from generate_series(1,65234) g;

-- Model a live table of 50,235 rows with older deleted entries still occupying
-- btree pages. The production read-only footprint has 50,235 live successor rows.
delete from proof.successors
where current_message_id in (
  select current_message_id from proof.successors order by current_message_id limit 14999
);
analyze proof.successors;
SQL

row_digest_sql="select md5(string_agg(md5(to_jsonb(s)::text),'' order by current_message_id)) from proof.successors s"
constraint_digest_sql="select md5(string_agg(conname||'|'||contype||'|'||pg_get_constraintdef(oid,true),'' order by conname)) from pg_constraint where conrelid='proof.successors'::regclass"

before_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.successors')"
before_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")"
before_constraints="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")"
before_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.successors')")"
before_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.successors_pkey')")"
before_unique_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.successors_successor_message_id_key')")"
before_pkey_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.successors_pkey'::regclass::oid")"
before_unique_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.successors_successor_message_id_key'::regclass::oid")"
before_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"
avg_current_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select round(avg(octet_length(current_message_id))::numeric,3) from proof.successors')"
avg_successor_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select round(avg(octet_length(successor_message_id))::numeric,3) from proof.successors')"

[[ "$before_rows" -eq 50235 ]]

# Build compact shadow indexes while the bloated constraint indexes still exist.
# Their relation sizes conservatively model the additional relation storage that
# a non-concurrent REINDEX needs while building a replacement btree.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/shadow.log" <<'SQL'
create unique index successor_shadow_current_idx on proof.successors(current_message_id);
select 'shadow_current_bytes='||pg_relation_size('proof.successor_shadow_current_idx');
select 'database_with_shadow_current='||pg_database_size(current_database());
drop index proof.successor_shadow_current_idx;
create unique index successor_shadow_successor_idx on proof.successors(successor_message_id);
select 'shadow_successor_bytes='||pg_relation_size('proof.successor_shadow_successor_idx');
select 'database_with_shadow_successor='||pg_database_size(current_database());
drop index proof.successor_shadow_successor_idx;
SQL
metric_shadow(){ sed -n "s/^${1}=//p" "${output_directory}/shadow.log" | tail -n1; }
shadow_current_bytes="$(metric_shadow shadow_current_bytes)"
shadow_successor_bytes="$(metric_shadow shadow_successor_bytes)"
database_with_shadow_current="$(metric_shadow database_with_shadow_current)"
database_with_shadow_successor="$(metric_shadow database_with_shadow_successor)"

# Rollback proof for the primary constraint index.
set +e
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/rollback-pkey.log" 2>&1 <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-successor-constraint-index-reindex',0));
reindex index proof.successors_pkey;
do $$ begin raise exception 'injected_successor_pkey_reindex_failure'; end $$;
commit;
SQL
rollback_pkey_rc=$?
set -e
[[ "$rollback_pkey_rc" -ne 0 ]]
grep -q 'injected_successor_pkey_reindex_failure' "${output_directory}/rollback-pkey.log"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")" == "$before_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.successors_pkey'::regclass::oid")" == "$before_pkey_oid" ]]

# Successful primary-index REINDEX.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/pkey.log" <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-successor-constraint-index-reindex',0));
reindex index proof.successors_pkey;
commit;
select 'database_after_pkey='||pg_database_size(current_database());
SQL
database_after_pkey="$(sed -n 's/^database_after_pkey=//p' "${output_directory}/pkey.log" | tail -n1)"
after_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.successors_pkey')")"
after_pkey_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.successors_pkey'::regclass::oid")"
unique_after_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.successors_successor_message_id_key')")"
[[ "$after_pkey_bytes" -lt "$before_pkey_bytes" ]]
[[ "$after_pkey_oid" == "$before_pkey_oid" ]]
[[ "$unique_after_pkey_bytes" -eq "$before_unique_bytes" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")" == "$before_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")" == "$before_constraints" ]]

# Rollback proof for the successor-message unique constraint index.
set +e
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/rollback-unique.log" 2>&1 <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-successor-constraint-index-reindex',0));
reindex index proof.successors_successor_message_id_key;
do $$ begin raise exception 'injected_successor_unique_reindex_failure'; end $$;
commit;
SQL
rollback_unique_rc=$?
set -e
[[ "$rollback_unique_rc" -ne 0 ]]
grep -q 'injected_successor_unique_reindex_failure' "${output_directory}/rollback-unique.log"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")" == "$before_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.successors_successor_message_id_key'::regclass::oid")" == "$before_unique_oid" ]]

# Successful unique-index REINDEX.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/unique.log" <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-successor-constraint-index-reindex',0));
reindex index proof.successors_successor_message_id_key;
commit;
select 'database_after_unique='||pg_database_size(current_database());
SQL
database_after_unique="$(sed -n 's/^database_after_unique=//p' "${output_directory}/unique.log" | tail -n1)"
after_unique_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.successors_successor_message_id_key')")"
after_unique_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.successors_successor_message_id_key'::regclass::oid")"
after_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.successors')")"
after_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")"
after_constraints="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")"

[[ "$after_unique_bytes" -lt "$before_unique_bytes" ]]
[[ "$after_unique_oid" == "$before_unique_oid" ]]
[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]
[[ "$after_digest" == "$before_digest" ]]
[[ "$after_constraints" == "$before_constraints" ]]

pkey_reclaimed=$((before_pkey_bytes-after_pkey_bytes))
unique_reclaimed=$((before_unique_bytes-after_unique_bytes))
shadow_current_overhead=$((database_with_shadow_current-before_database_bytes))
shadow_successor_overhead=$((database_with_shadow_successor-before_database_bytes))

cat > "${output_directory}/evidence.json" <<JSON
{
  "schemaVersion": 1,
  "purpose": "r5-successor-constraint-index-reindex-local-proof",
  "liveRows": ${before_rows},
  "avgCurrentMessageIdBytes": ${avg_current_bytes},
  "avgSuccessorMessageIdBytes": ${avg_successor_bytes},
  "rowDigestPreserved": true,
  "constraintDigestPreserved": true,
  "heapBytesPreserved": true,
  "pkeyOidPreserved": true,
  "uniqueOidPreserved": true,
  "pkeyRollbackVerified": true,
  "uniqueRollbackVerified": true,
  "pkeyBytesBefore": ${before_pkey_bytes},
  "pkeyBytesAfter": ${after_pkey_bytes},
  "pkeyBytesReclaimed": ${pkey_reclaimed},
  "uniqueBytesBefore": ${before_unique_bytes},
  "uniqueBytesAfter": ${after_unique_bytes},
  "uniqueBytesReclaimed": ${unique_reclaimed},
  "compactShadowCurrentBytes": ${shadow_current_bytes},
  "compactShadowSuccessorBytes": ${shadow_successor_bytes},
  "conservativeCurrentBuildOverheadBytes": ${shadow_current_overhead},
  "conservativeSuccessorBuildOverheadBytes": ${shadow_successor_overhead},
  "databaseBytesBefore": ${before_database_bytes},
  "databaseBytesAfterPkey": ${database_after_pkey},
  "databaseBytesAfterUnique": ${database_after_unique},
  "productionDatabaseUsed": false,
  "productionReindexAuthorized": false
}
JSON
sha256sum "${output_directory}/evidence.json" > "${output_directory}/evidence.sha256"
cat "${output_directory}/evidence.json"
