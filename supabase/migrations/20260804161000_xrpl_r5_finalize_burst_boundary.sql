create table if not exists xrpl_r5_v1.recovery_burst_finalizations (
  run_id text not null references xrpl_r5_v1.recovery_runs(run_id) on delete cascade,
  source_run_id bigint not null check (source_run_id > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  recovery_before_ledger_index bigint not null check (recovery_before_ledger_index > 0),
  recovery_before_ledger_hash text not null check (
    recovery_before_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  physical_before_ledger_index bigint not null check (physical_before_ledger_index > 0),
  physical_before_ledger_hash text not null check (
    physical_before_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  recovery_after_ledger_index bigint not null check (recovery_after_ledger_index > 0),
  recovery_after_ledger_hash text not null check (
    recovery_after_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  recovery_after_work_id text not null,
  drained_step_count integer not null check (drained_step_count between 0 and 256),
  boundary jsonb not null,
  adoption jsonb not null,
  finalized_at timestamptz not null,
  primary key (run_id, source_run_id)
);

revoke all on table xrpl_r5_v1.recovery_burst_finalizations
  from public, anon, authenticated;

create or replace function public.xrpl_finalize_r5_recovery_burst_boundary(
  p_run_id text,
  p_source_run_id bigint,
  p_owner text,
  p_finalized_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_run_before xrpl_r5_v1.recovery_runs%rowtype;
  v_run_after xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark_before public.xrpl_phase_watermarks%rowtype;
  v_watermark_after public.xrpl_phase_watermarks%rowtype;
  v_boundary jsonb;
  v_adoption jsonb;
  v_drained_step_count integer;
  v_completed_batch_count bigint;
  v_leased_batch_count bigint;
  v_halted_batch_count bigint;
  v_last_batch_end bigint;
  v_existing xrpl_r5_v1.recovery_burst_finalizations%rowtype;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_source_run_id is null
    or p_source_run_id < 1
    or p_owner !~ '^r5-burst-finalize-[0-9]{8,20}$'
    or p_finalized_at is null then
    raise exception 'r5_burst_final_boundary_invalid_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_existing
  from xrpl_r5_v1.recovery_burst_finalizations
  where run_id = p_run_id and source_run_id = p_source_run_id;

  if found then
    return jsonb_build_object(
      'finalized', true,
      'replayed', true,
      'runId', v_existing.run_id,
      'sourceRunId', v_existing.source_run_id,
      'recoveryBeforeLedgerIndex', v_existing.recovery_before_ledger_index,
      'physicalBeforeLedgerIndex', v_existing.physical_before_ledger_index,
      'currentWatermarkLedgerIndex', v_existing.recovery_after_ledger_index,
      'currentWatermarkLedgerHash', v_existing.recovery_after_ledger_hash,
      'currentWatermarkWorkId', v_existing.recovery_after_work_id,
      'drainedStepCount', v_existing.drained_step_count,
      'adoption', v_existing.adoption,
      'noScanExecuted', true,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationAuthorized', false,
      'soakAuthorized', false
    );
  end if;

  select * into v_run_before
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run_before.status <> 'running'
    or v_run_before.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_run_before.profile_revision <> 3
    or v_run_before.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_run_before.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_run_before.source_profile_id <> 'supabase-devnet'
    or v_run_before.network <> 'devnet'
    or v_run_before.epoch_id <> 'supabase-r4c2c-v1'
    or v_run_before.completed_batches < 1
    or v_run_before.committed_ledgers < 1
    or v_run_before.last_accounting_digest is null
    or v_run_before.last_error is not null
    or v_run_before.started_at is null
    or v_run_before.completed_at is not null then
    raise exception 'r5_burst_final_boundary_run_invalid';
  end if;

  select * into v_watermark_before
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  if not found
    or v_watermark_before.network <> v_run_before.network
    or v_watermark_before.epoch_id <> v_run_before.epoch_id
    or v_watermark_before.base_identity <> v_run_before.base_identity
    or v_watermark_before.ledger_index < v_run_before.current_watermark_ledger_index
    or v_watermark_before.ledger_index
      > v_run_before.current_watermark_ledger_index + 24 then
    raise exception 'r5_burst_final_boundary_initial_watermark_invalid';
  end if;

  v_boundary := public.xrpl_drain_r5_checkpoint_boundary(
    p_owner,
    p_finalized_at
  );
  v_drained_step_count := (v_boundary->>'drainedStepCount')::integer;

  if coalesce((v_boundary->>'drained')::boolean, false) is not true
    or v_drained_step_count < 0
    or v_drained_step_count > 256
    or coalesce((v_boundary->'checks'->>'collectorQuiescent')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'activeStreamHealthy')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'onlyExistingCommitOrFinalizeDrained')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'noScanExecuted')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'onePendingScan')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'pendingScanBoundToWatermark')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'noInflightWork')::boolean, false) is not true
    or v_boundary->>'sourceProfileId' <> 'supabase-devnet'
    or v_boundary->>'network' <> v_run_before.network
    or v_boundary->>'epochId' <> v_run_before.epoch_id
    or v_boundary->>'baseIdentity' <> v_run_before.base_identity
    or (v_boundary->'watermarkBefore'->>'ledgerIndex')::bigint
      <> v_watermark_before.ledger_index
    or upper(v_boundary->'watermarkBefore'->>'ledgerHash')
      <> v_watermark_before.ledger_hash
    or v_boundary->'watermarkBefore'->>'workId' <> v_watermark_before.work_id
    or (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint
      < v_watermark_before.ledger_index
    or (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint
      > v_watermark_before.ledger_index + 24 then
    raise exception 'r5_burst_final_boundary_drain_invalid';
  end if;

  v_adoption := public.xrpl_adopt_r5_committed_active_descendants(
    p_run_id,
    p_finalized_at + interval '1 millisecond'
  );

  if coalesce((v_adoption->>'adopted')::boolean, false) is not true
    and v_adoption->>'reason' <> 'active_boundary_already_equal' then
    raise exception 'r5_burst_final_boundary_adoption_invalid';
  end if;

  select * into v_run_after
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  select * into v_watermark_after
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  select
    count(*) filter (where status = 'completed')::bigint,
    count(*) filter (where status = 'leased')::bigint,
    count(*) filter (where status = 'halted')::bigint,
    max(end_ledger_index) filter (where status = 'completed')
  into
    v_completed_batch_count,
    v_leased_batch_count,
    v_halted_batch_count,
    v_last_batch_end
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id;

  if v_run_after.status <> 'running'
    or v_run_after.last_error is not null
    or v_watermark_after.ledger_index < v_watermark_before.ledger_index
    or v_watermark_after.ledger_index > v_watermark_before.ledger_index + 24
    or v_run_after.current_watermark_ledger_index <> v_watermark_after.ledger_index
    or v_run_after.current_watermark_ledger_hash <> v_watermark_after.ledger_hash
    or v_run_after.current_watermark_work_id <> v_watermark_after.work_id
    or v_run_after.committed_ledgers
      <> v_run_after.current_watermark_ledger_index
        - v_run_after.start_watermark_ledger_index
    or v_completed_batch_count <> v_run_after.completed_batches
    or v_leased_batch_count <> 0
    or v_halted_batch_count <> 0
    or v_last_batch_end <> v_run_after.current_watermark_ledger_index then
    raise exception 'r5_burst_final_boundary_final_parity_invalid';
  end if;

  insert into xrpl_r5_v1.recovery_burst_finalizations (
    run_id,
    source_run_id,
    recovery_before_ledger_index,
    recovery_before_ledger_hash,
    physical_before_ledger_index,
    physical_before_ledger_hash,
    recovery_after_ledger_index,
    recovery_after_ledger_hash,
    recovery_after_work_id,
    drained_step_count,
    boundary,
    adoption,
    finalized_at
  ) values (
    p_run_id,
    p_source_run_id,
    v_run_before.current_watermark_ledger_index,
    v_run_before.current_watermark_ledger_hash,
    v_watermark_before.ledger_index,
    v_watermark_before.ledger_hash,
    v_run_after.current_watermark_ledger_index,
    v_run_after.current_watermark_ledger_hash,
    v_run_after.current_watermark_work_id,
    v_drained_step_count,
    v_boundary,
    v_adoption,
    p_finalized_at
  );

  return jsonb_build_object(
    'finalized', true,
    'replayed', false,
    'runId', p_run_id,
    'sourceRunId', p_source_run_id,
    'recoveryBeforeLedgerIndex', v_run_before.current_watermark_ledger_index,
    'physicalBeforeLedgerIndex', v_watermark_before.ledger_index,
    'currentWatermarkLedgerIndex', v_run_after.current_watermark_ledger_index,
    'currentWatermarkLedgerHash', v_run_after.current_watermark_ledger_hash,
    'currentWatermarkWorkId', v_run_after.current_watermark_work_id,
    'drainedStepCount', v_drained_step_count,
    'adoption', v_adoption,
    'noScanExecuted', true,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true,
    'stabilizationAuthorized', false,
    'soakAuthorized', false
  );
end;
$$;

revoke all on function public.xrpl_finalize_r5_recovery_burst_boundary(
  text, bigint, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.xrpl_finalize_r5_recovery_burst_boundary(
  text, bigint, text, timestamptz
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_finalize_r5_recovery_burst_boundary(text, bigint, text, timestamptz) to supabase_admin';
  end if;
end;
$$;

do $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_pending_count bigint;
  v_finalize_count bigint;
  v_inflight_count bigint;
begin
  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = 'r5-recovery-selected-revision3-entry';

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  select
    count(*) filter (where status = 'pending')::bigint,
    count(*) filter (where status = 'pending' and phase = 'finalize')::bigint
  into v_pending_count, v_finalize_count
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet';

  select count(*)::bigint into v_inflight_count
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
    and status in ('planned', 'staged', 'committing', 'finalizing');

  if v_run.status = 'running'
    and v_run.completed_batches = 108
    and v_run.committed_ledgers = 2256
    and v_run.current_watermark_ledger_index = 4135563
    and v_run.current_watermark_ledger_hash
      = '951A1FF6D7CD62E8E6E7F24973B3F474DA1F42DE1383C232957366D45CDFA5D0'
    and v_run.current_watermark_work_id
      = 'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4135563:76EB9DD28ED40783B0E4E2AA396BD055E3912DFD1042305BB968E1A281E600DB'
    and v_watermark.ledger_index = 4135567
    and v_watermark.ledger_hash
      = '14C608434FAEB5102F202D8C9135635454E29EB698AEBD6B75012CA0C29D8204'
    and v_watermark.work_id
      = 'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4135567:D334E20D29F200E9BDC48AB0C8991991E0E46491B5C4314AD721464864E7F93C'
    and v_pending_count = 1
    and v_finalize_count = 1
    and v_inflight_count = 1 then
    perform public.xrpl_finalize_r5_recovery_burst_boundary(
      'r5-recovery-selected-revision3-entry',
      30925522885,
      'r5-burst-finalize-30925522885',
      clock_timestamp()
    );
  end if;
end;
$$;
