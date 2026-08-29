#!/usr/bin/env bash
set -euo pipefail

container_name="${CURRENT_FIRST_POSTGRES_CONTAINER:?CURRENT_FIRST_POSTGRES_CONTAINER is required}"
output_directory="${CURRENT_FIRST_OUTPUT:-current-first-postgres-evidence}"
parent_hash="$(printf 'A%.0s' {1..64})"
source_hash="$(printf 'B%.0s' {1..64})"
current_hash="$(printf 'C%.0s' {1..64})"
tx_hash="$(printf 'D%.0s' {1..64})"
object_id="$(printf 'E%.0s' {1..64})"
owner='current-first-local-owner'

rm -rf "$output_directory"
mkdir -p "$output_directory"

cat > "${output_directory}/phase-fixture.sql" <<'SQL'
\set ON_ERROR_STOP on

-- The current-first candidate depends only on the committed phase boundary
-- contract, not on the legacy phase-chain bootstrap side effects. Define the
-- smallest production-shaped fixture needed to prove that boundary locally.
create table if not exists public.xrpl_phase_streams (
  profile_id text primary key,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  immutable_base_ledger_index bigint not null,
  immutable_base_ledger_hash text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.xrpl_phase_work (
  work_id text primary key,
  profile_id text not null references public.xrpl_phase_streams(profile_id),
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  expected_parent_hash text not null,
  planned_end_ledger_index bigint not null,
  scanned_end_ledger_index bigint,
  final_ledger_hash text,
  status text not null,
  plan_json text not null,
  semantic_counts_json text,
  payload_digest text,
  expected_payload_chunks integer not null default 0,
  expected_commit_chunks integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  committed_at timestamptz
);

create table if not exists public.xrpl_phase_watermarks (
  profile_id text primary key references public.xrpl_phase_streams(profile_id),
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  ledger_index bigint not null,
  ledger_hash text not null,
  work_id text not null references public.xrpl_phase_work(work_id),
  updated_at timestamptz not null
);

create table if not exists public.xrpl_phase_messages (
  message_id text primary key
);

create table if not exists public.xrpl_phase_reference_rows (
  work_id text not null,
  semantic_class text not null,
  canonical_key text not null,
  primary key (work_id, semantic_class, canonical_key)
);
SQL

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "${output_directory}/phase-fixture.sql" \
  > "${output_directory}/phase-fixture.log"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < supabase/candidates/current-first/001_xrpl_current_first_lane.sql \
  > "${output_directory}/candidate-lane.log"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < supabase/candidates/current-first/002_xrpl_current_first_lane_control.sql \
  > "${output_directory}/candidate-control.log"

cat > "${output_directory}/integration.sql" <<SQL
\set ON_ERROR_STOP on

insert into public.xrpl_phase_streams (
  profile_id, network, epoch_id, base_identity,
  immutable_base_ledger_index, immutable_base_ledger_hash,
  status, created_at, updated_at
) values (
  'supabase-devnet', 'devnet', 'epoch-current-first', 'base-current-first',
  99, '${parent_hash}', 'active', now(), now()
);

insert into public.xrpl_phase_work (
  work_id, profile_id, network, epoch_id, base_identity,
  previous_ledger_index, start_ledger_index, expected_parent_hash,
  planned_end_ledger_index, scanned_end_ledger_index, final_ledger_hash,
  status, plan_json, semantic_counts_json, payload_digest,
  expected_payload_chunks, expected_commit_chunks,
  created_at, updated_at, committed_at
) values (
  'source-work-current-first', 'supabase-devnet', 'devnet',
  'epoch-current-first', 'base-current-first',
  99, 100, '${parent_hash}',
  100, 100, '${source_hash}',
  'committed', '{}', '{"totalRecords":1}', '${source_hash}',
  0, 0, now(), now(), now()
);

insert into public.xrpl_phase_watermarks (
  profile_id, network, epoch_id, base_identity,
  ledger_index, ledger_hash, work_id, updated_at
) values (
  'supabase-devnet', 'devnet', 'epoch-current-first', 'base-current-first',
  100, '${source_hash}', 'source-work-current-first', now()
);

select public.xrpl_prepare_current_first_lane(
  'epoch-current-first',
  'base-current-first',
  100,
  '${source_hash}',
  'source-work-current-first',
  now()
) as prepare_result;

select public.xrpl_claim_current_first_lane(
  '${owner}', now(), 120
) as claim_result;

select public.xrpl_complete_current_first_lane(
  '${owner}',
  100,
  '${source_hash}',
  '[{"ledgerIndex":101,"ledgerHash":"${current_hash}","parentHash":"${source_hash}"}]',
  '[{"semanticClass":"current-projection","canonicalKey":"projection:loan:${object_id}","sourceLedgerIndex":101,"sourceLedgerHash":"${current_hash}","sourceTransactionHash":"${tx_hash}","objectId":"${object_id}","relationshipIds":["loan:${object_id}"],"valueJson":"{\\"LoanID\\":\\"${object_id}\\"}","isTombstone":false}]',
  7,
  now()
) as complete_result;

do \$verify\$
declare
  v_current xrpl_current_v1.state%rowtype;
  v_history public.xrpl_phase_watermarks%rowtype;
  v_object_count integer;
  v_message_count integer;
  v_reference_count integer;
  v_page jsonb;
begin
  select * into v_current
  from xrpl_current_v1.state
  where profile_id = 'supabase-current-devnet';
  select * into v_history
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  select count(*)::integer into v_object_count
  from xrpl_current_v1.objects
  where profile_id = 'supabase-current-devnet';
  select count(*)::integer into v_message_count from public.xrpl_phase_messages;
  select count(*)::integer into v_reference_count from public.xrpl_phase_reference_rows;
  v_page := public.xrpl_read_current_first_page(null, 0, 50, 101, '${current_hash}');

  if v_current.ledger_index <> 101
    or v_current.ledger_hash <> '${current_hash}'
    or v_current.history_complete_through_ledger <> 100
    or v_current.history_deferred_from_ledger <> 101
    or v_current.history_deferred_through_ledger <> 101
    or v_current.history_deferred_ledgers <> 1
    or v_current.history_deferred_records <> 7
    or v_current.lease_owner is not null
    or v_current.lease_expires_at is not null then
    raise exception 'current-first state boundary verification failed';
  end if;

  if v_history.ledger_index <> 100
    or v_history.ledger_hash <> '${source_hash}'
    or v_history.work_id <> 'source-work-current-first' then
    raise exception 'history watermark changed with current-first completion';
  end if;

  if v_object_count <> 1 then
    raise exception 'current-first object upsert count mismatch';
  end if;
  if v_message_count <> 0 or v_reference_count <> 0 then
    raise exception 'current-first completion wrote history transport rows';
  end if;
  if coalesce((v_page #>> '{history,complete}')::boolean, true) is not false
    or (v_page #>> '{history,completeThroughLedger}')::bigint <> 100
    or (v_page #>> '{fence,ledgerIndex}')::bigint <> 101
    or jsonb_array_length(v_page->'rows') <> 1 then
    raise exception 'current-first reader did not expose split freshness';
  end if;

  if has_function_privilege('anon', 'public.xrpl_complete_current_first_lane(text,bigint,text,text,text,bigint,timestamp with time zone)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.xrpl_complete_current_first_lane(text,bigint,text,text,text,bigint,timestamp with time zone)', 'EXECUTE') then
    raise exception 'current-first mutator leaked to a public role';
  end if;
end
\$verify\$;

select jsonb_build_object(
  'postgresIntegrationPassed', true,
  'currentWatermarkLedgerIndex', (
    select ledger_index from xrpl_current_v1.state
    where profile_id = 'supabase-current-devnet'
  ),
  'historyWatermarkLedgerIndex', (
    select ledger_index from public.xrpl_phase_watermarks
    where profile_id = 'supabase-devnet'
  ),
  'historyWatermarkAdvanced', false,
  'historyTransportRowsWritten', false,
  'publicMutationGrant', false,
  'productionMutation', false
) as result;
SQL

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "${output_directory}/integration.sql" \
  | tee "${output_directory}/integration.log"

grep -q 'postgresIntegrationPassed' "${output_directory}/integration.log"
grep -q 'currentWatermarkLedgerIndex' "${output_directory}/integration.log"
grep -q 'historyWatermarkLedgerIndex' "${output_directory}/integration.log"
grep -q 'true' "${output_directory}/integration.log"

cat > "${output_directory}/summary.md" <<'EOF'
## Current-first PostgreSQL integration

- production connection used: `false`
- production mutation: `false`
- candidate SQL auto-deploy path: `false`
- production-shaped source boundary fixture only: `true`
- legacy phase bootstrap side effects required: `false`
- current watermark advanced independently: `true`
- history watermark advanced: `false`
- phase message/reference history rows written by current completion: `false`
- current object persisted by bounded upsert: `true`
- history deferral exposed by reader: `true`
- public mutation grant: `false`
EOF