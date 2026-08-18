#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-reference-reindex-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_REFERENCE_INDEX_REINDEX_OUTPUT:-r5-reference-index-reindex-evidence}"
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
create table proof.xrpl_phase_work (
  work_id text primary key
);
create table proof.xrpl_phase_reference_rows (
  work_id text not null references proof.xrpl_phase_work(work_id) on delete cascade,
  semantic_class text not null check (semantic_class = 'validated-ledger'),
  canonical_key text not null,
  source_ledger_index bigint not null check (source_ledger_index > 0),
  source_ledger_hash text not null,
  source_transaction_hash text,
  object_id text,
  relationship_ids jsonb not null default '[]'::jsonb,
  value_json text,
  is_tombstone boolean not null default false,
  created_at timestamptz not null,
  primary key (work_id, semantic_class, canonical_key)
);
create index xrpl_phase_reference_lookup_idx
  on proof.xrpl_phase_reference_rows(semantic_class, canonical_key, source_ledger_index);

-- Production read-only evidence on main 43459bd91b00f2b1b49c4b97b97cb6f6d62127b0 measured:
-- 87,885 rows; work_id avg/p95/max 204.915/205/205 bytes;
-- canonical_key avg/p95/max 69.493/91/164 bytes.
-- This synthetic shape is intentionally conservative: every work_id is 205 bytes,
-- 99% of canonical keys are 91 bytes and 1% are 164 bytes.
insert into proof.xrpl_phase_work(work_id)
select lpad(g::text,10,'0') || ':' || repeat('w',194)
from generate_series(1,87885) g;

insert into proof.xrpl_phase_reference_rows(
  work_id,semantic_class,canonical_key,source_ledger_index,source_ledger_hash,
  relationship_ids,value_json,is_tombstone,created_at
)
select
  lpad(g::text,10,'0') || ':' || repeat('w',194),
  'validated-ledger',
  case when g % 100 = 0
    then lpad(g::text,10,'0') || ':' || repeat('k',153)
    else lpad(g::text,10,'0') || ':' || repeat('k',80)
  end,
  4149454 + g,
  upper(repeat(substr(md5(g::text),1,1),64)),
  '[]'::jsonb,
  null,
  false,
  '2026-08-01 00:00:00+00'::timestamptz + g * interval '1 second'
from generate_series(1,87885) g;

vacuum analyze proof.xrpl_phase_reference_rows;
SQL

row_digest_sql="select md5(string_agg(md5(to_jsonb(r)::text),'' order by work_id,semantic_class,canonical_key)) from proof.xrpl_phase_reference_rows r"
constraint_digest_sql="select md5(string_agg(conname||'|'||contype::text||'|'||pg_get_constraintdef(oid,true),'' order by conname)) from pg_constraint where conrelid='proof.xrpl_phase_reference_rows'::regclass"

rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.xrpl_phase_reference_rows')"
work_min="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select min(octet_length(work_id)) from proof.xrpl_phase_reference_rows')"
work_max="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select max(octet_length(work_id)) from proof.xrpl_phase_reference_rows')"
canonical_p95="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select percentile_disc(0.95) within group(order by octet_length(canonical_key)) from proof.xrpl_phase_reference_rows")"
canonical_max="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select max(octet_length(canonical_key)) from proof.xrpl_phase_reference_rows')"
[[ "$rows" -eq 87885 ]]
[[ "$work_min" -eq 205 && "$work_max" -eq 205 ]]
[[ "$canonical_p95" -eq 91 && "$canonical_max" -eq 164 ]]

# Model historical key churn locally so the operation itself is exercised against bloated btrees.
for prefix in A B C D; do
  docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -qc \
    "update proof.xrpl_phase_reference_rows set canonical_key='${prefix}'||substr(canonical_key,2)"
done
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -qc \
  'vacuum analyze proof.xrpl_phase_reference_rows'

before_rows="$rows"
before_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")"
before_constraints="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")"
before_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_reference_rows')")"
before_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_reference_rows_pkey')")"
before_lookup_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_reference_lookup_idx')")"
before_pkey_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_reference_rows_pkey'::regclass::oid")"
before_lookup_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_reference_lookup_idx'::regclass::oid")"

# Build compact shadow indexes from the current live rows. These are the storage estimate
# used against the production read-only index sizes; no production database is contacted.
docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/shadow.log" <<'SQL'
create unique index shadow_reference_pkey
  on proof.xrpl_phase_reference_rows(work_id,semantic_class,canonical_key);
select 'shadow_pkey_bytes='||pg_relation_size('proof.shadow_reference_pkey');
drop index proof.shadow_reference_pkey;
create index shadow_reference_lookup
  on proof.xrpl_phase_reference_rows(semantic_class,canonical_key,source_ledger_index);
select 'shadow_lookup_bytes='||pg_relation_size('proof.shadow_reference_lookup');
drop index proof.shadow_reference_lookup;
SQL
metric_shadow(){ sed -n "s/^${1}=//p" "${output_directory}/shadow.log" | tail -n1; }
shadow_pkey_bytes="$(metric_shadow shadow_pkey_bytes)"
shadow_lookup_bytes="$(metric_shadow shadow_lookup_bytes)"
[[ "$shadow_pkey_bytes" =~ ^[0-9]+$ && "$shadow_lookup_bytes" =~ ^[0-9]+$ ]]

reindex_one(){
  local target="$1" marker="$2" output="$3"
  set +e
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/rollback-${output}.log" 2>&1 <<SQL
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-reference-index-physical-reindex',0));
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
select pg_advisory_xact_lock(hashtextextended('xrpl-reference-index-physical-reindex',0));
reindex index proof.${target};
commit;
SQL
}

reindex_one xrpl_phase_reference_rows_pkey injected_reference_pkey_reindex_failure pkey
after_pkey_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_reference_rows_pkey')")"
lookup_after_pkey="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_reference_lookup_idx')")"
[[ "$after_pkey_bytes" -lt "$before_pkey_bytes" ]]
[[ "$lookup_after_pkey" -eq "$before_lookup_bytes" ]]

reindex_one xrpl_phase_reference_lookup_idx injected_reference_lookup_reindex_failure lookup
after_lookup_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_reference_lookup_idx')")"
[[ "$after_lookup_bytes" -lt "$before_lookup_bytes" ]]

after_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from proof.xrpl_phase_reference_rows')"
after_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$row_digest_sql")"
after_constraints="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "$constraint_digest_sql")"
after_heap_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('proof.xrpl_phase_reference_rows')")"
after_pkey_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_reference_rows_pkey'::regclass::oid")"
after_lookup_oid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select 'proof.xrpl_phase_reference_lookup_idx'::regclass::oid")"

[[ "$after_rows" -eq "$before_rows" ]]
[[ "$after_digest" == "$before_digest" ]]
[[ "$after_constraints" == "$before_constraints" ]]
[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]
[[ "$after_pkey_oid" == "$before_pkey_oid" ]]
[[ "$after_lookup_oid" == "$before_lookup_oid" ]]

# Fresh REINDEX output should be close to a freshly built shadow btree.
abs_diff(){ local a="$1" b="$2"; if (( a >= b )); then echo $((a-b)); else echo $((b-a)); fi; }
pkey_shadow_delta="$(abs_diff "$after_pkey_bytes" "$shadow_pkey_bytes")"
lookup_shadow_delta="$(abs_diff "$after_lookup_bytes" "$shadow_lookup_bytes")"
[[ "$pkey_shadow_delta" -le 32768 ]]
[[ "$lookup_shadow_delta" -le 32768 ]]

production_database_bytes=405073043
production_halt_bytes=400000000
production_pkey_bytes=42287104
production_lookup_bytes=14680064
required_reclaim_bytes=$((production_database_bytes-production_halt_bytes))
observed_pkey_reclaim=$((production_pkey_bytes-shadow_pkey_bytes))
observed_lookup_reclaim=$((production_lookup_bytes-shadow_lookup_bytes))
observed_combined_reclaim=$((observed_pkey_reclaim+observed_lookup_reclaim))
estimated_database_after_pkey=$((production_database_bytes-production_pkey_bytes+shadow_pkey_bytes))
estimated_database_after_both=$((estimated_database_after_pkey-production_lookup_bytes+shadow_lookup_bytes))
conservative_pkey_peak=$((production_database_bytes+shadow_pkey_bytes))
conservative_lookup_peak_after_pkey=$((estimated_database_after_pkey+shadow_lookup_bytes))
pkey_crosses_target=false
sequential_crosses_target=false
[[ "$estimated_database_after_pkey" -lt "$production_halt_bytes" ]] && pkey_crosses_target=true
[[ "$estimated_database_after_both" -lt "$production_halt_bytes" ]] && sequential_crosses_target=true

cat > "${output_directory}/metrics.json" <<EOF
{
  "schemaVersion": 1,
  "productionDatabaseUsed": false,
  "productionReindexAuthorized": false,
  "sourceProductionCommit": "43459bd91b00f2b1b49c4b97b97cb6f6d62127b0",
  "productionReferenceRowsObserved": 87885,
  "productionReferenceDeadRowsObserved": 297,
  "productionDatabaseBytesObserved": ${production_database_bytes},
  "productionHaltBytes": ${production_halt_bytes},
  "requiredReclaimBytes": ${required_reclaim_bytes},
  "productionPkeyBytesObserved": ${production_pkey_bytes},
  "productionLookupBytesObserved": ${production_lookup_bytes},
  "syntheticRows": ${rows},
  "syntheticWorkIdBytes": 205,
  "syntheticCanonicalP95Bytes": ${canonical_p95},
  "syntheticCanonicalMaxBytes": ${canonical_max},
  "syntheticShapeConservative": true,
  "shadowPkeyBytes": ${shadow_pkey_bytes},
  "shadowLookupBytes": ${shadow_lookup_bytes},
  "observedPkeyReclaimBytes": ${observed_pkey_reclaim},
  "observedLookupReclaimBytes": ${observed_lookup_reclaim},
  "observedCombinedReclaimBytes": ${observed_combined_reclaim},
  "estimatedDatabaseAfterPkeyBytes": ${estimated_database_after_pkey},
  "estimatedDatabaseAfterBothBytes": ${estimated_database_after_both},
  "conservativePkeyPeakBytes": ${conservative_pkey_peak},
  "conservativeLookupPeakAfterPkeyBytes": ${conservative_lookup_peak_after_pkey},
  "pkeyAloneWouldCross400MB": ${pkey_crosses_target},
  "sequentialPkeyThenLookupWouldCross400MB": ${sequential_crosses_target},
  "localPkeyBytesBefore": ${before_pkey_bytes},
  "localPkeyBytesAfter": ${after_pkey_bytes},
  "localLookupBytesBefore": ${before_lookup_bytes},
  "localLookupBytesAfter": ${after_lookup_bytes},
  "rowDigestPreserved": true,
  "constraintDigestPreserved": true,
  "heapBytesPreserved": true,
  "pkeyOidPreserved": true,
  "lookupOidPreserved": true,
  "peerLookupBytesPreservedDuringPkey": true,
  "rollbackVerified": true
}
EOF

cat > "${output_directory}/summary.md" <<EOF
## R5 reference index local reindex headroom proof

- production database used: \`false\`
- production reindex authorized: \`false\`
- production observed DB / halt / deficit: \`${production_database_bytes} / ${production_halt_bytes} / ${required_reclaim_bytes} B\`
- production observed pkey / lookup: \`${production_pkey_bytes} / ${production_lookup_bytes} B\`
- synthetic rows / work-id bytes / canonical p95 / max: \`${rows} / 205 / ${canonical_p95} / ${canonical_max}\`
- compact shadow pkey / lookup: \`${shadow_pkey_bytes} / ${shadow_lookup_bytes} B\`
- projected pkey / lookup / combined reclaim: \`${observed_pkey_reclaim} / ${observed_lookup_reclaim} / ${observed_combined_reclaim} B\`
- estimated DB after pkey / after both: \`${estimated_database_after_pkey} / ${estimated_database_after_both} B\`
- conservative peak pkey / lookup-after-pkey: \`${conservative_pkey_peak} / ${conservative_lookup_peak_after_pkey} B\`
- pkey alone below 400MB: \`${pkey_crosses_target}\`
- sequential pkey+lookup below 400MB: \`${sequential_crosses_target}\`
- rows/digest/constraints/heap/OIDs preserved: \`true\`
- rollback injection verified: \`true\`
EOF

cat "${output_directory}/summary.md"
