create or replace function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
  p_run_id text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_checkpoint xrpl_r5_v1.active_checkpoints%rowtype;
  v_runtime public.xrpl_collector_runtime%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_pending_scan public.xrpl_phase_messages%rowtype;
  v_pending_count integer;
  v_leased_count integer;
  v_retry_count integer;
  v_inflight_work_count integer;
  v_batch_count bigint;
  v_checkpoint_to_start bigint;
  v_initial_lag bigint;
  v_descendant_count bigint := 0;
  v_single_ledger_chain boolean := true;
  v_hash_linked_chain boolean := true;
  v_first_previous_index bigint;
  v_first_expected_parent_hash text;
  v_last_ledger_index bigint;
  v_last_ledger_hash text;
  v_last_work_id text;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_now is null then
    raise exception 'r5_recovery_prebatch_rebind_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  lock table public.xrpl_collector_runtime in share mode;
  lock table public.xrpl_phase_streams in share mode;
  lock table public.xrpl_phase_messages in share mode;
  lock table public.xrpl_phase_successors in share mode;
  lock table public.xrpl_phase_work in share mode;
  lock table public.xrpl_phase_watermarks in share mode;
  lock table xrpl_r5_v1.active_checkpoints in share mode;

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_run.profile_revision <> 3
    or v_run.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_run.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_run.source_profile_id <> 'supabase-devnet'
    or v_run.network <> 'devnet'
    or v_run.epoch_id <> 'supabase-r4c2c-v1'
    or v_run.batch_size <> 24 then
    raise exception 'r5_recovery_prebatch_rebind_run_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity then
    raise exception 'r5_recovery_prebatch_rebind_watermark_invalid';
  end if;

  if v_watermark.ledger_index = v_run.current_watermark_ledger_index then
    if v_watermark.ledger_hash <> v_run.current_watermark_ledger_hash
      or v_watermark.work_id <> v_run.current_watermark_work_id then
      raise exception 'r5_recovery_prebatch_rebind_same_ledger_identity_conflict';
    end if;
    return jsonb_build_object(
      'rebound', false,
      'reason', 'already_bound',
      'runId', v_run.run_id,
      'watermarkLedgerIndex', v_watermark.ledger_index,
      'watermarkLedgerHash', v_watermark.ledger_hash,
      'watermarkWorkId', v_watermark.work_id
    );
  end if;

  if v_watermark.ledger_index < v_run.current_watermark_ledger_index then
    raise exception 'r5_recovery_prebatch_rebind_watermark_regression';
  end if;

  if v_run.status <> 'prepared'
    or v_run.completed_batches <> 0
    or v_run.committed_ledgers <> 0
    or v_run.last_accounting_digest is not null
    or v_run.last_error is not null
    or v_run.started_at is not null
    or v_run.completed_at is not null then
    raise exception 'r5_recovery_prebatch_rebind_progress_forbidden';
  end if;

  select count(*)::bigint into v_batch_count
  from xrpl_r5_v1.recovery_batches
  where run_id = v_run.run_id;
  if v_batch_count <> 0 then
    raise exception 'r5_recovery_prebatch_rebind_batch_present';
  end if;

  select * into v_checkpoint
  from xrpl_r5_v1.active_checkpoints
  where checkpoint_id = v_run.checkpoint_id;
  if not found
    or v_checkpoint.state_digest <> v_run.checkpoint_state_digest
    or public.xrpl_transfer_json_digest(v_checkpoint.state) <> v_checkpoint.state_digest
    or v_checkpoint.profile_id <> v_run.profile_id
    or v_checkpoint.profile_revision <> v_run.profile_revision
    or v_checkpoint.profile_identity_digest <> v_run.profile_identity_digest
    or v_checkpoint.selection_digest <> v_run.selection_digest
    or v_checkpoint.source_profile_id <> v_run.source_profile_id
    or v_checkpoint.network <> v_run.network
    or v_checkpoint.epoch_id <> v_run.epoch_id
    or v_checkpoint.base_identity <> v_run.base_identity then
    raise exception 'r5_recovery_prebatch_rebind_checkpoint_invalid';
  end if;

  select * into v_runtime
  from public.xrpl_collector_runtime
  where profile_id = 'supabase-devnet';
  if not found
    or v_runtime.network <> 'devnet'
    or v_runtime.status <> 'stopped'
    or v_runtime.lease_owner is not null
    or v_runtime.lease_expires_at is not null
    or v_runtime.last_error is not null
    or v_runtime.consecutive_failures <> 0 then
    raise exception 'r5_recovery_prebatch_rebind_collector_not_quiescent';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> v_run.network
    or v_stream.epoch_id <> v_run.epoch_id
    or v_stream.base_identity <> v_run.base_identity
    or v_stream.last_error_classification is not null
    or v_stream.last_error_message is not null then
    raise exception 'r5_recovery_prebatch_rebind_stream_invalid';
  end if;

  select
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'leased')::integer,
    count(*) filter (where status = 'retry')::integer
  into v_pending_count, v_leased_count, v_retry_count
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet';
  if v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0 then
    raise exception 'r5_recovery_prebatch_rebind_scheduler_not_quiescent';
  end if;

  select * into v_pending_scan
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet' and status = 'pending';
  if not found
    or v_pending_scan.phase <> 'scan'
    or (v_pending_scan.payload->>'expectedPreviousLedgerIndex')::bigint
      <> v_watermark.ledger_index
    or upper(v_pending_scan.payload->>'expectedPreviousLedgerHash')
      <> v_watermark.ledger_hash
    or v_pending_scan.payload->>'epochId' <> v_run.epoch_id
    or v_pending_scan.payload->>'baseIdentity' <> v_run.base_identity then
    raise exception 'r5_recovery_prebatch_rebind_pending_scan_invalid';
  end if;

  select count(*)::integer into v_inflight_work_count
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
    and status in ('planned', 'staged', 'committing', 'finalizing');
  if v_inflight_work_count <> 0 then
    raise exception 'r5_recovery_prebatch_rebind_inflight_work_present';
  end if;

  if v_watermark.ledger_index >= v_run.initial_validated_head_ledger_index then
    raise exception 'r5_recovery_prebatch_rebind_retained_head_exhausted';
  end if;

  v_checkpoint_to_start :=
    v_watermark.ledger_index - v_checkpoint.watermark_ledger_index;
  if v_checkpoint_to_start <= 0 then
    raise exception 'r5_recovery_prebatch_rebind_not_descendant';
  end if;

  with chain as (
    select
      row_number() over (order by work.start_ledger_index, work.work_id)::bigint as ordinal,
      work.*,
      lag(work.scanned_end_ledger_index) over (
        order by work.start_ledger_index, work.work_id
      ) as prior_end_ledger_index,
      lag(work.final_ledger_hash) over (
        order by work.start_ledger_index, work.work_id
      ) as prior_final_ledger_hash
    from public.xrpl_phase_work work
    where work.profile_id = 'supabase-devnet'
      and work.status = 'committed'
      and work.start_ledger_index > v_checkpoint.watermark_ledger_index
      and work.scanned_end_ledger_index <= v_watermark.ledger_index
  )
  select
    count(*)::bigint,
    coalesce(bool_and(
      chain.start_ledger_index = chain.previous_ledger_index + 1
      and chain.scanned_end_ledger_index = chain.start_ledger_index
    ), false),
    coalesce(bool_and(
      case when chain.ordinal = 1 then
        chain.previous_ledger_index = v_checkpoint.watermark_ledger_index
        and chain.expected_parent_hash = v_checkpoint.watermark_ledger_hash
      else
        chain.previous_ledger_index = chain.prior_end_ledger_index
        and chain.start_ledger_index = chain.prior_end_ledger_index + 1
        and chain.expected_parent_hash = chain.prior_final_ledger_hash
      end
    ), false),
    min(chain.previous_ledger_index) filter (where chain.ordinal = 1),
    min(chain.expected_parent_hash) filter (where chain.ordinal = 1),
    max(chain.scanned_end_ledger_index),
    (array_agg(chain.final_ledger_hash order by chain.start_ledger_index desc, chain.work_id desc))[1],
    (array_agg(chain.work_id order by chain.start_ledger_index desc, chain.work_id desc))[1]
  into
    v_descendant_count,
    v_single_ledger_chain,
    v_hash_linked_chain,
    v_first_previous_index,
    v_first_expected_parent_hash,
    v_last_ledger_index,
    v_last_ledger_hash,
    v_last_work_id
  from chain;

  if v_descendant_count <> v_checkpoint_to_start
    or not v_single_ledger_chain
    or not v_hash_linked_chain
    or v_first_previous_index <> v_checkpoint.watermark_ledger_index
    or v_first_expected_parent_hash <> v_checkpoint.watermark_ledger_hash
    or v_last_ledger_index <> v_watermark.ledger_index
    or v_last_ledger_hash <> v_watermark.ledger_hash
    or v_last_work_id <> v_watermark.work_id then
    raise exception 'r5_recovery_prebatch_rebind_descendant_chain_invalid';
  end if;

  v_initial_lag :=
    v_run.initial_validated_head_ledger_index - v_watermark.ledger_index;

  update xrpl_r5_v1.recovery_runs
  set start_watermark_ledger_index = v_watermark.ledger_index,
      start_watermark_ledger_hash = v_watermark.ledger_hash,
      start_watermark_work_id = v_watermark.work_id,
      checkpoint_to_start_ledgers = v_checkpoint_to_start,
      initial_lag_ledgers = v_initial_lag,
      descendant_work_count = v_descendant_count,
      current_watermark_ledger_index = v_watermark.ledger_index,
      current_watermark_ledger_hash = v_watermark.ledger_hash,
      current_watermark_work_id = v_watermark.work_id,
      updated_at = p_now
  where run_id = v_run.run_id;

  return public.xrpl_read_r5_active_recovery(v_run.run_id)
    || jsonb_build_object(
      'prebatchRebound', true,
      'reboundFromLedgerIndex', v_run.current_watermark_ledger_index,
      'reboundToLedgerIndex', v_watermark.ledger_index,
      'reboundLedgerCount',
        v_watermark.ledger_index - v_run.current_watermark_ledger_index,
      'checkpointDescendantChainReproved', true,
      'zeroRecoveryBatchesPreserved', true,
      'networkReadOccurredBeforeRebind', false
    );
end;
$$;

create or replace function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  p_run_id text,
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer default 55
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_rebind jsonb;
  v_claim jsonb;
  v_projected_invocations bigint;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_now is null
    or p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'r5_recovery_prepared_head_claim_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  v_rebind := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
    p_run_id,
    p_now
  );

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_run.profile_revision <> 3
    or v_run.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_run.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_run.source_profile_id <> 'supabase-devnet'
    or v_run.network <> 'devnet'
    or v_run.epoch_id <> 'supabase-r4c2c-v1'
    or v_run.batch_size <> 24 then
    raise exception 'r5_recovery_prepared_head_run_invalid';
  end if;

  if v_run.status = 'caught_up' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'recovery_already_caught_up',
      'runId', v_run.run_id,
      'watermarkLedgerIndex', v_run.current_watermark_ledger_index,
      'prebatchRebind', v_rebind
    );
  end if;
  if v_run.status = 'halted' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'recovery_halted',
      'runId', v_run.run_id,
      'error', v_run.last_error,
      'prebatchRebind', v_rebind
    );
  end if;
  if v_run.status not in ('prepared', 'running') then
    raise exception 'r5_recovery_prepared_head_run_not_claimable';
  end if;

  if v_run.current_watermark_ledger_index
      >= v_run.initial_validated_head_ledger_index then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'fresh_head_refresh_required',
      'runId', v_run.run_id,
      'watermarkLedgerIndex', v_run.current_watermark_ledger_index,
      'retainedValidatedHeadLedgerIndex',
        v_run.initial_validated_head_ledger_index,
      'activeRecoveryStarted', v_run.status = 'running',
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationNotStarted', true,
      'soakNotStarted', true,
      'prebatchRebind', v_rebind
    );
  end if;

  v_claim := public.xrpl_claim_r5_active_recovery_batch(
    p_run_id,
    p_owner,
    v_run.initial_validated_head_ledger_index,
    v_run.initial_validated_head_ledger_hash,
    p_now,
    p_lease_seconds
  );

  if coalesce((v_claim->>'claimed')::boolean, false) is not true then
    return v_claim || jsonb_build_object(
      'retainedPreparedHeadUsed', true,
      'networkReadOccurredBeforeReservation', false,
      'prebatchRebind', v_rebind
    );
  end if;

  v_projected_invocations := (v_claim->>'projectedInvocations31d')::bigint;
  if v_projected_invocations <= 0 then
    raise exception 'r5_recovery_prepared_head_invocation_context_invalid';
  end if;

  return v_claim || jsonb_build_object(
    'network', v_run.network,
    'epochId', v_run.epoch_id,
    'baseIdentity', v_run.base_identity,
    'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
    'currentWatermarkLedgerHash', v_run.current_watermark_ledger_hash,
    'currentWatermarkWorkId', v_run.current_watermark_work_id,
    'priorInvocations31d', v_projected_invocations - 1,
    'retainedPreparedHeadUsed', true,
    'retainedValidatedHeadLedgerIndex',
      v_run.initial_validated_head_ledger_index,
    'retainedValidatedHeadLedgerHash',
      v_run.initial_validated_head_ledger_hash,
    'reservationBeforeAnyNetworkRead', true,
    'freshHeadMustCoverReservedEndBeforeFetch', true,
    'prebatchRebind', v_rebind
  );
end;
$$;

revoke all on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
  text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) from public, anon, authenticated;

grant execute on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
  text, timestamptz
) to service_role;
grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(text, timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text, text, timestamptz, integer) to supabase_admin';
  end if;
end;
$$;
