#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-db-halt-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_DATABASE_HALT_OUTPUT:-r5-revision4-database-halt-evidence}"
sql='ops/production-sql/20260816163000_xrpl_r5_revision4_database_halt_guard.sql'

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -rf "$output_directory"
mkdir -p "$output_directory"
test -f "$sql"

if grep -Eiq '\b(delete|truncate|vacuum)\b' "$sql"; then
  echo 'database halt guard SQL must not delete history, truncate, or vacuum' >&2
  exit 1
fi

docker run --detach --rm \
  --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=postgres \
  "$image" > "${output_directory}/container-id.txt"

stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable_ready=$((stable_ready + 1))
    if [[ "$stable_ready" -ge 3 ]]; then
      break
    fi
  else
    stable_ready=0
  fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/setup.log" <<'SQL'
create role anon;
create role authenticated;
create role service_role;
create schema xrpl_r5_v1;

create table xrpl_r5_v1.recovery_runs (
  run_id text primary key,
  status text not null,
  started_at timestamptz,
  last_error text,
  updated_at timestamptz not null
);

create or replace function public.xrpl_claim_r5_revision4_recovery_batch(
  p_owner text,
  p_run_id text,
  p_validated_head_ledger_index bigint,
  p_validated_head_ledger_hash text,
  p_now timestamptz,
  p_lease_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark record;
  v_existing xrpl_r5_v1.recovery_runs%rowtype;
  v_inflight_work_count integer;
  v_sequence bigint;
begin
  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  v_inflight_work_count := 0;
  if v_inflight_work_count <> 0 then
    raise exception 'r5_recovery_batch_inflight_work_present';
  end if;

  if p_validated_head_ledger_index < v_watermark.ledger_index then
    raise exception 'r5_recovery_batch_head_behind_watermark';
  end if;

  if p_validated_head_ledger_index = v_watermark.ledger_index then
    update xrpl_r5_v1.recovery_runs
    set status = 'caught_up', updated_at = p_now
    where run_id = v_run.run_id;
  end if;

  select * into v_existing
  from xrpl_r5_v1.recovery_runs
  where run_id = v_run.run_id;

  v_sequence := 1;
  return jsonb_build_object('claimed', false, 'sequence', v_sequence);
end;
$$;
SQL

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$sql" > "${output_directory}/apply.log"

boundary="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "
select concat_ws(',',
  xrpl_r5_v1.database_claim_allowed(399999999::bigint)::text,
  xrpl_r5_v1.database_claim_allowed(400000000::bigint)::text,
  xrpl_r5_v1.database_claim_allowed(400000001::bigint)::text
);")"
[[ "$boundary" == 'true,false,false' ]]

function_definition="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "
select pg_get_functiondef('public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'::regprocedure);")"

grep -Fq 'v_database_bytes := pg_database_size(current_database())' <<< "$function_definition"
grep -Fq "last_error = 'r5_recovery_database_halt'" <<< "$function_definition"
grep -Fq "'databaseHaltBytes', v_database_halt" <<< "$function_definition"

measure_line="$(grep -nF 'v_database_bytes := pg_database_size(current_database())' <<< "$function_definition" | head -1 | cut -d: -f1)"
caught_up_line="$(grep -nF 'if p_validated_head_ledger_index < v_watermark.ledger_index then' <<< "$function_definition" | head -1 | cut -d: -f1)"
reclaim_line="$(grep -nF 'select * into v_existing' <<< "$function_definition" | head -1 | cut -d: -f1)"
[[ "$measure_line" -lt "$caught_up_line" ]]
[[ "$measure_line" -lt "$reclaim_line" ]]

service_role_execute="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "
select has_function_privilege('service_role', 'xrpl_r5_v1.database_claim_allowed(bigint)', 'EXECUTE');")"
[[ "$service_role_execute" == 'f' ]]

cat > "${output_directory}/summary.md" <<EOF
## R5 revision-4 database halt PostgreSQL test

- staged production SQL applied to clone-shaped revision-4 claim: \`true\`
- 399,999,999 B claim allowed: \`true\`
- 400,000,000 B claim allowed: \`false\`
- 400,000,001 B claim allowed: \`false\`
- database measurement precedes caught-up mutation: \`true\`
- database measurement precedes leased-batch lookup/reclaim: \`true\`
- helper executable by service_role: \`false\`
- production database used: \`false\`
- canonical history mutation: \`false\`
EOF

printf '%s\n' "$function_definition" > "${output_directory}/patched-function.sql"
printf '%s\n' "$boundary" > "${output_directory}/boundary.txt"
cat "${output_directory}/summary.md"
