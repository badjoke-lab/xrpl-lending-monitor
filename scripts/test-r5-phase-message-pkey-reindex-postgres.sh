#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-message-pkey-reindex-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_MESSAGE_PKEY_REINDEX_OUTPUT:-r5-phase-message-pkey-reindex-evidence}"
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
  payload jsonb not null,
  result jsonb,
  completed_at timestamptz
);
create index messages_ready_idx on proof.messages(profile_id,status,available_at,created_at,message_id)
  where status in ('pending','retry','leased');

insert into proof.messages(message_id,profile_id,status,available_at,created_at,payload,result,completed_at)
select
  'phase:v1:devnet:supabase-r4c2c-v1:'||lpad(g::text,8,'0')||':'||repeat(md5(g::text),5)||':r4'||repeat('x',21),
  'supabase-devnet',
  case when g in (65236,65237) then 'pending' when g=65235 then 'error' else 'completed' end,
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second',
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second',
  jsonb_build_object('g',g,'blob',repeat(md5('payload-'||g::text),4)),
  case when g<=65234 then jsonb_build_object('g',g,'status','committed') else null end,
  case when g<=65234 then '2026-08-15 00:00:01+00'::timestamptz+g*interval '1 second' else null end
from generate_series(1,65237) g;

-- Model production-shaped historical btree bloat while leaving 50,238 live rows.
delete from proof.messages
where message_id in (select message_id from proof.messages order by message_id limit 14999);
analyze proof.messages;
SQL

row_digest_sql="select md5(string_agg(md5(to_jsonb(m)::text),'' order by message_id)) from proof.messages m"
constraint_digest_sql="select md5(string_agg(conname||'|'||contype::text||'|'||pg_get_constraintdef(oid,true),'' order by conname)) from pg_constraint where conrelid='proof.messages'::regclass"

before_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.messages')"
before_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")"
before_constraints="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")"
before_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages')")"
before_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages_pkey')")"
before_ready_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages_ready_idx')")"
before_pkey_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages_pkey'::regclass::oid")"
before_ready_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages_ready_idx'::regclass::oid")"
before_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"
avg_key_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select round(avg(octet_length(message_id))::numeric,3) from proof.messages')"
ready_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from proof.messages where status in ('pending','retry','leased')")"

[[ "$before_rows" -eq 50238 ]]
[[ "$avg_key_bytes" == '227.000' ]]
[[ "$ready_rows" -eq 2 ]]

# Measure compact replacement-btree storage while the bloated pkey still exists.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/shadow.log" <<'SQL'
create unique index message_shadow_pkey_idx on proof.messages(message_id);
select 'compact_shadow_bytes='||pg_relation_size('proof.message_shadow_pkey_idx');
select 'database_with_shadow='||pg_database_size(current_database());
drop index proof.message_shadow_pkey_idx;
SQL
compact_shadow_bytes="$(sed -n 's/^compact_shadow_bytes=//p' "${output_directory}/shadow.log" | tail -n1)"
database_with_shadow="$(sed -n 's/^database_with_shadow=//p' "${output_directory}/shadow.log" | tail -n1)"

# Rollback proof: REINDEX plus an injected error must leave the original pkey intact.
set +e
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/rollback.log" 2>&1 <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-phase-message-pkey-physical-reindex',0));
reindex index proof.messages_pkey;
do $$ begin raise exception 'injected_message_pkey_reindex_failure'; end $$;
commit;
SQL
rollback_rc=$?
set -e
[[ "$rollback_rc" -ne 0 ]]
grep -q 'injected_message_pkey_reindex_failure' "${output_directory}/rollback.log"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")" == "$before_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages_pkey'::regclass::oid")" == "$before_pkey_oid" ]]

# Successful pkey-only REINDEX.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/reindex.log" <<'SQL'
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-phase-message-pkey-physical-reindex',0));
reindex index proof.messages_pkey;
commit;
select 'database_after='||pg_database_size(current_database());
SQL

after_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages_pkey')")"
after_ready_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages_ready_idx')")"
after_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.messages')")"
after_pkey_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages_pkey'::regclass::oid")"
after_ready_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.messages_ready_idx'::regclass::oid")"
after_database_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"

[[ "$after_pkey_bytes" -lt "$before_pkey_bytes" ]]
[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]
[[ "$after_ready_bytes" -eq "$before_ready_bytes" ]]
[[ "$after_pkey_oid" == "$before_pkey_oid" ]]
[[ "$after_ready_oid" == "$before_ready_oid" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")" == "$before_digest" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")" == "$before_constraints" ]]

reclaimed=$((before_pkey_bytes-after_pkey_bytes))
conservative_build_overhead=$((compact_shadow_bytes+1048576))
cat > "${output_directory}/metrics.json" <<EOF
{
  "schemaVersion": 1,
  "productionDatabaseUsed": false,
  "productionReindexAuthorized": false,
  "rows": ${before_rows},
  "averageMessageIdBytes": 227,
  "readyRows": ${ready_rows},
  "databaseBytesBefore": ${before_database_bytes},
  "databaseBytesWithCompactShadow": ${database_with_shadow},
  "databaseBytesAfter": ${after_database_bytes},
  "heapBytesPreserved": true,
  "pkeyBytesBefore": ${before_pkey_bytes},
  "compactShadowBytes": ${compact_shadow_bytes},
  "pkeyBytesAfter": ${after_pkey_bytes},
  "pkeyBytesReclaimed": ${reclaimed},
  "conservativeBuildOverheadBytes": ${conservative_build_overhead},
  "readyIndexBytesPreserved": true,
  "rowDigestPreserved": true,
  "constraintDigestPreserved": true,
  "pkeyOidPreserved": true,
  "readyIndexOidPreserved": true
}
EOF
cat > "${output_directory}/summary.md" <<EOF
## R5 phase-message pkey REINDEX local proof

- PostgreSQL: \`15-alpine\`
- production database used: \`false\`
- production REINDEX authorized: \`false\`
- live rows / ready rows: \`${before_rows} / ${ready_rows}\`
- message ID bytes avg: \`${avg_key_bytes}\`
- pkey before / compact shadow / after: \`${before_pkey_bytes} / ${compact_shadow_bytes} / ${after_pkey_bytes}\`
- pkey bytes reclaimed: \`${reclaimed}\`
- conservative replacement-build overhead: \`${conservative_build_overhead}\`
- heap, ready index, row/constraint digests, pkey/ready OIDs preserved: \`true\`
EOF
cat "${output_directory}/summary.md"
