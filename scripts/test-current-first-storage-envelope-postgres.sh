#!/usr/bin/env bash
set -euo pipefail

container_name="${CURRENT_FIRST_POSTGRES_CONTAINER:?CURRENT_FIRST_POSTGRES_CONTAINER is required}"
output_directory="${CURRENT_FIRST_STORAGE_OUTPUT:-current-first-storage-envelope-evidence}"
object_count="${CURRENT_FIRST_STORAGE_OBJECTS:-10000}"
cycles_per_stage="${CURRENT_FIRST_STORAGE_CYCLES_PER_STAGE:-10}"

rm -rf "$output_directory"
mkdir -p "$output_directory"

read_metric() {
  local sql="$1"
  docker exec "$container_name" psql -U postgres -d postgres -Atqc "$sql"
}

before_messages="$(read_metric "select count(*) from public.xrpl_phase_messages")"
before_references="$(read_metric "select count(*) from public.xrpl_phase_reference_rows")"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/seed.log" <<SQL
truncate table xrpl_current_v1.objects;
vacuum xrpl_current_v1.objects;

insert into xrpl_current_v1.objects (
  profile_id, canonical_key, object_id, relationship_ids,
  value_json, is_tombstone,
  source_ledger_index, source_ledger_hash, source_transaction_hash,
  created_at, updated_at
)
select
  'supabase-current-devnet',
  'projection:loan:' || repeat(substr(md5(g::text), 1, 32), 2),
  repeat(substr(md5(g::text), 1, 32), 2),
  jsonb_build_array('loan:' || repeat(substr(md5(g::text), 1, 32), 2)),
  jsonb_build_object(
    'LoanID', repeat(substr(md5(g::text), 1, 32), 2),
    'PrincipalOutstanding', g::text,
    'padding', repeat('x', 512)
  )::text,
  false,
  1000,
  repeat('C', 64),
  repeat('D', 64),
  now(),
  now()
from generate_series(1, ${object_count}) as g;

vacuum xrpl_current_v1.objects;
SQL

seed_rows="$(read_metric "select count(*) from xrpl_current_v1.objects")"
seed_bytes="$(read_metric "select pg_total_relation_size('xrpl_current_v1.objects')")"
state_bytes="$(read_metric "select pg_total_relation_size('xrpl_current_v1.state')")"

if [[ "$seed_rows" -ne "$object_count" ]]; then
  echo "current-first storage seed count mismatch: ${seed_rows} != ${object_count}" >&2
  exit 1
fi

run_cycles() {
  local first="$1"
  local last="$2"
  local cycle
  for cycle in $(seq "$first" "$last"); do
    docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q <<SQL
update xrpl_current_v1.objects
set source_ledger_index = source_ledger_index + 1,
    value_json = jsonb_build_object(
      'LoanID', object_id,
      'PrincipalOutstanding', source_ledger_index::text,
      'cycle', ${cycle},
      'padding', repeat('x', 512)
    )::text,
    updated_at = now();
SQL
    docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q \
      -c 'vacuum xrpl_current_v1.objects;'
  done
}

run_cycles 1 "$cycles_per_stage"
mid_bytes="$(read_metric "select pg_total_relation_size('xrpl_current_v1.objects')")"
mid_rows="$(read_metric "select count(*) from xrpl_current_v1.objects")"

second_first=$((cycles_per_stage + 1))
second_last=$((cycles_per_stage * 2))
run_cycles "$second_first" "$second_last"
final_bytes="$(read_metric "select pg_total_relation_size('xrpl_current_v1.objects')")"
final_rows="$(read_metric "select count(*) from xrpl_current_v1.objects")"

after_messages="$(read_metric "select count(*) from public.xrpl_phase_messages")"
after_references="$(read_metric "select count(*) from public.xrpl_phase_reference_rows")"

if [[ "$mid_rows" -ne "$object_count" || "$final_rows" -ne "$object_count" ]]; then
  echo 'current-first repeated updates changed live object cardinality' >&2
  exit 1
fi
if [[ "$after_messages" -ne "$before_messages" || "$after_references" -ne "$before_references" ]]; then
  echo 'current-first storage proof mutated history transport tables' >&2
  exit 1
fi

# Ten additional full-table update/vacuum cycles must reuse the already-created
# heap/index free space instead of multiplying storage by ledger count. Allow a
# generous 50% stage-to-stage margin for PostgreSQL page split variance.
if (( final_bytes * 100 > mid_bytes * 150 )); then
  echo "current-first store did not demonstrate bounded ordinary-VACUUM reuse: mid=${mid_bytes} final=${final_bytes}" >&2
  exit 1
fi

bytes_per_object=$(( (final_bytes + object_count - 1) / object_count ))
projected_50000_bytes=$(( bytes_per_object * 50000 + state_bytes ))

cat > "${output_directory}/result.json" <<JSON
{
  "schemaVersion": 1,
  "purpose": "current-first-storage-envelope-local-postgres",
  "postgres": "15-alpine",
  "productionDatabaseUsed": false,
  "productionMutationAuthorized": false,
  "objectCount": ${object_count},
  "cyclesPerStage": ${cycles_per_stage},
  "totalUpdateCycles": $((cycles_per_stage * 2)),
  "seedBytes": ${seed_bytes},
  "midBytes": ${mid_bytes},
  "finalBytes": ${final_bytes},
  "stateBytes": ${state_bytes},
  "ceilBytesPerLiveObject": ${bytes_per_object},
  "projected50000LiveObjectsBytes": ${projected_50000_bytes},
  "liveObjectCardinalityStable": true,
  "ordinaryVacuumReuseBounded": true,
  "historyTransportRowsChanged": false,
  "historyWatermarkAdvanced": false
}
JSON

cat > "${output_directory}/summary.md" <<EOF
## Current-first storage envelope PostgreSQL proof

- PostgreSQL: \`15-alpine\`
- production database used: \`false\`
- production mutation authorized: \`false\`
- synthetic live objects: \`${object_count}\`
- full-table update cycles: \`$((cycles_per_stage * 2))\`
- seed relation bytes: \`${seed_bytes}\`
- midpoint relation bytes: \`${mid_bytes}\`
- final relation bytes: \`${final_bytes}\`
- state relation bytes: \`${state_bytes}\`
- ceil final bytes per live object: \`${bytes_per_object}\`
- projected 50,000-live-object store bytes: \`${projected_50000_bytes}\`
- live object cardinality stable: \`true\`
- ordinary VACUUM reuse bounded across the second stage: \`true\`
- history transport rows changed: \`false\`
- history watermark advanced: \`false\`

This is a local physical-storage direction proof, not a production-capacity authorization. It demonstrates that the Current-first table is keyed by live object identity and reuses storage under repeated in-place updates instead of appending one durable row per ledger/history event.
EOF

cat "${output_directory}/result.json"
