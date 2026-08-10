-- Persist exactly one latest completed 12-ledger revision-4 accounting payload.
--
-- The accounting JSON already crosses the Edge -> Postgres boundary as part of
-- the atomic completion RPC. This wrapper captures that same payload inside the
-- same database transaction, so qualification evidence does not change the
-- executor request body or success response bytes.
--
-- Repository-only until an explicitly authorized Supabase deployment.

create table if not exists xrpl_r5_v1.revision4_accounting_qualification_evidence (
  qualification_key text primary key,
  run_id text not null,
  batch_id text not null,
  batch_sequence bigint not null,
  start_ledger_index bigint not null,
  end_ledger_index bigint not null,
  ledger_count integer not null,
  profile_id text not null,
  profile_revision integer not null,
  profile_identity_digest text not null,
  selection_digest text not null,
  accounting_json text not null,
  accounting_digest text not null,
  finalized_egress_upper_bound_bytes bigint not null,
  completed_at timestamptz not null,
  captured_at timestamptz not null default clock_timestamp(),
  constraint xrpl_r5_revision4_accounting_qualification_singleton_check check (
    qualification_key = 'r4f-revision4-r5-12-ledger-accounting-v1'
  ),
  constraint xrpl_r5_revision4_accounting_qualification_run_check check (
    run_id = 'r5-recovery-selected-revision4-entry'
  ),
  constraint xrpl_r5_revision4_accounting_qualification_batch_check check (
    batch_id ~ '^r5-batch-v1-r5-recovery-[a-z0-9][a-z0-9-]{7,79}-[0-9]{8}$'
    and batch_sequence between 1 and 99999999
  ),
  constraint xrpl_r5_revision4_accounting_qualification_range_check check (
    ledger_count = 12
    and start_ledger_index >= 1
    and end_ledger_index = start_ledger_index + 11
  ),
  constraint xrpl_r5_revision4_accounting_qualification_profile_check check (
    profile_id = 'supabase_free_postgres_pgcron_edge'
    and profile_revision = 4
    and profile_identity_digest =
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    and selection_digest ~ '^[a-f0-9]{64}$'
  ),
  constraint xrpl_r5_revision4_accounting_qualification_digest_check check (
    accounting_digest ~ '^[a-f0-9]{64}$'
  ),
  constraint xrpl_r5_revision4_accounting_qualification_json_bound_check check (
    octet_length(accounting_json) between 1 and 16384
  ),
  constraint xrpl_r5_revision4_accounting_qualification_egress_check check (
    finalized_egress_upper_bound_bytes >= 0
  )
);

revoke all on table xrpl_r5_v1.revision4_accounting_qualification_evidence
  from public, anon, authenticated;

do $rename_completion$
declare
  v_outer regprocedure := to_regprocedure(
    'public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
  );
  v_inner regprocedure := to_regprocedure(
    'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
  );
begin
  if v_outer is null then
    raise exception 'r5_revision4_qualification_completion_source_missing';
  end if;
  if v_inner is not null then
    raise exception 'r5_revision4_qualification_completion_inner_already_exists';
  end if;

  execute $sql$
    alter function public.xrpl_complete_r5_revision4_recovery_batch(
      text, text, text, timestamptz, text, text, text, text,
      bigint, numeric, numeric, numeric
    ) rename to xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture
  $sql$;
end;
$rename_completion$;

create or replace function public.xrpl_complete_r5_revision4_recovery_batch(
  p_run_id text,
  p_batch_id text,
  p_owner text,
  p_completed_at timestamptz,
  p_works_json text,
  p_works_digest text,
  p_accounting_json text,
  p_accounting_digest text,
  p_finalized_egress_upper_bound_bytes bigint,
  p_fetch_milliseconds numeric,
  p_normalize_milliseconds numeric,
  p_edge_wall_milliseconds numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_result jsonb;
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
  v_accounting jsonb;
begin
  if p_accounting_json is null
    or octet_length(p_accounting_json) not between 1 and 16384
    or p_accounting_digest !~ '^[a-f0-9]{64}$'
    or p_finalized_egress_upper_bound_bytes is null
    or p_finalized_egress_upper_bound_bytes < 0 then
    raise exception 'r5_revision4_qualification_accounting_envelope_invalid';
  end if;

  begin
    v_accounting := p_accounting_json::jsonb;
  exception when others then
    raise exception 'r5_revision4_qualification_accounting_json_invalid';
  end;

  if v_accounting->>'profileId' <> 'supabase_free_postgres_pgcron_edge'
    or v_accounting->>'profileRevision' <> '4'
    or v_accounting->>'profileIdentityDigest' <>
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    or v_accounting->>'disposition' <> 'runtime_precommit_completed'
    or (v_accounting->>'rollingBillableEgressUpperBoundBytes')::bigint < 0
    or (v_accounting->>'rollingBillableEgressUpperBoundBytes')::bigint
      <> p_finalized_egress_upper_bound_bytes then
    raise exception 'r5_revision4_qualification_accounting_identity_invalid';
  end if;

  v_result := public.xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture(
    p_run_id,
    p_batch_id,
    p_owner,
    p_completed_at,
    p_works_json,
    p_works_digest,
    p_accounting_json,
    p_accounting_digest,
    p_finalized_egress_upper_bound_bytes,
    p_fetch_milliseconds,
    p_normalize_milliseconds,
    p_edge_wall_milliseconds
  );

  if v_result->>'completed' <> 'true'
    or v_result->>'runId' <> p_run_id
    or v_result->>'batchId' <> p_batch_id
    or v_result->>'accountingDigest' <> p_accounting_digest then
    raise exception 'r5_revision4_qualification_completion_parity_failed';
  end if;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id
    and batch_id = p_batch_id;

  if not found
    or v_batch.status <> 'completed'
    or v_batch.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_batch.profile_revision <> 4
    or v_batch.profile_identity_digest <>
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    or v_batch.accounting_digest <> p_accounting_digest
    or v_batch.finalized_egress_upper_bound_bytes <> p_finalized_egress_upper_bound_bytes
    or v_batch.end_ledger_index <> v_batch.start_ledger_index + v_batch.ledger_count - 1 then
    raise exception 'r5_revision4_qualification_completed_batch_parity_failed';
  end if;

  if v_batch.ledger_count = 12 then
    insert into xrpl_r5_v1.revision4_accounting_qualification_evidence (
      qualification_key,
      run_id,
      batch_id,
      batch_sequence,
      start_ledger_index,
      end_ledger_index,
      ledger_count,
      profile_id,
      profile_revision,
      profile_identity_digest,
      selection_digest,
      accounting_json,
      accounting_digest,
      finalized_egress_upper_bound_bytes,
      completed_at,
      captured_at
    ) values (
      'r4f-revision4-r5-12-ledger-accounting-v1',
      v_batch.run_id,
      v_batch.batch_id,
      v_batch.batch_sequence,
      v_batch.start_ledger_index,
      v_batch.end_ledger_index,
      v_batch.ledger_count,
      v_batch.profile_id,
      v_batch.profile_revision,
      v_batch.profile_identity_digest,
      v_batch.selection_digest,
      p_accounting_json,
      p_accounting_digest,
      p_finalized_egress_upper_bound_bytes,
      p_completed_at,
      clock_timestamp()
    )
    on conflict (qualification_key) do update
    set run_id = excluded.run_id,
        batch_id = excluded.batch_id,
        batch_sequence = excluded.batch_sequence,
        start_ledger_index = excluded.start_ledger_index,
        end_ledger_index = excluded.end_ledger_index,
        ledger_count = excluded.ledger_count,
        profile_id = excluded.profile_id,
        profile_revision = excluded.profile_revision,
        profile_identity_digest = excluded.profile_identity_digest,
        selection_digest = excluded.selection_digest,
        accounting_json = excluded.accounting_json,
        accounting_digest = excluded.accounting_digest,
        finalized_egress_upper_bound_bytes = excluded.finalized_egress_upper_bound_bytes,
        completed_at = excluded.completed_at,
        captured_at = excluded.captured_at
    where xrpl_r5_v1.revision4_accounting_qualification_evidence.completed_at
      <= excluded.completed_at;
  end if;

  return v_result;
end;
$$;

create or replace function public.xrpl_read_r5_revision4_accounting_qualification_evidence()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_evidence xrpl_r5_v1.revision4_accounting_qualification_evidence%rowtype;
begin
  select * into v_evidence
  from xrpl_r5_v1.revision4_accounting_qualification_evidence
  where qualification_key = 'r4f-revision4-r5-12-ledger-accounting-v1';

  if not found then
    return jsonb_build_object(
      'schemaVersion', 1,
      'purpose', 'r4f-revision4-r5-accounting-qualification-evidence',
      'found', false,
      'profileRevision', 4,
      'profileIdentityDigest',
        '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
      'publicReaderUnchanged', true,
      'mainnetDisabled', true
    );
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r4f-revision4-r5-accounting-qualification-evidence',
    'found', true,
    'qualificationKey', v_evidence.qualification_key,
    'runId', v_evidence.run_id,
    'batchId', v_evidence.batch_id,
    'batchSequence', v_evidence.batch_sequence,
    'startLedgerIndex', v_evidence.start_ledger_index,
    'endLedgerIndex', v_evidence.end_ledger_index,
    'ledgerCount', v_evidence.ledger_count,
    'profileId', v_evidence.profile_id,
    'profileRevision', v_evidence.profile_revision,
    'profileIdentityDigest', v_evidence.profile_identity_digest,
    'selectionDigest', v_evidence.selection_digest,
    'accountingJson', v_evidence.accounting_json,
    'accountingJsonBytes', octet_length(v_evidence.accounting_json),
    'accountingDigest', v_evidence.accounting_digest,
    'finalizedEgressUpperBoundBytes', v_evidence.finalized_egress_upper_bound_bytes,
    'completedAt', to_char(v_evidence.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'capturedAt', to_char(v_evidence.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'boundedSingletonStorage', true,
    'completionRequestBodyUnchanged', true,
    'completionResponseBodyUnchanged', true,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true
  );
end;
$$;

revoke all on function public.xrpl_complete_r5_revision4_recovery_batch(
  text, text, text, timestamptz, text, text, text, text,
  bigint, numeric, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.xrpl_read_r5_revision4_accounting_qualification_evidence()
  from public, anon, authenticated;

grant execute on function public.xrpl_complete_r5_revision4_recovery_batch(
  text, text, text, timestamptz, text, text, text, text,
  bigint, numeric, numeric, numeric
) to service_role;
grant execute on function public.xrpl_read_r5_revision4_accounting_qualification_evidence()
  to service_role;

do $admin_grants$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamptz,text,text,text,text,bigint,numeric,numeric,numeric) to supabase_admin';
    execute 'grant execute on function public.xrpl_read_r5_revision4_accounting_qualification_evidence() to supabase_admin';
  end if;
end;
$admin_grants$;

comment on table xrpl_r5_v1.revision4_accounting_qualification_evidence is
  'Bounded singleton retaining the latest completed 12-ledger revision-4 accounting JSON for formal free-tier qualification.';
