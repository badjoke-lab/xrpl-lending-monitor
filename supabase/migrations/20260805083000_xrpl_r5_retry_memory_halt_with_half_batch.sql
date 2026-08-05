create table if not exists xrpl_r5_v1.memory_halt_batch_retries (
  run_id text not null references xrpl_r5_v1.recovery_runs(run_id) on delete cascade,
  batch_id text not null,
  retry_sequence integer not null check (retry_sequence between 1 and 8),
  schema_version integer not null default 1 check (schema_version = 1),
  source_failed_burst_run_id bigint not null check (source_failed_burst_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  reason text not null check (reason = 'revision3_resource_halt:memory_upper_bound_halt'),
  prior_run jsonb not null,
  prior_batch jsonb not null,
  prior_ledger_count integer not null check (prior_ledger_count between 2 and 24),
  retry_ledger_count integer not null check (retry_ledger_count between 1 and 12),
  prior_conservative_egress_31d_bytes bigint not null check (
    prior_conservative_egress_31d_bytes >= 0
  ),
  projected_conservative_egress_31d_bytes bigint not null check (
    projected_conservative_egress_31d_bytes > prior_conservative_egress_31d_bytes
    and projected_conservative_egress_31d_bytes < 4294967296
  ),
  prior_invocations_31d bigint not null check (prior_invocations_31d >= 0),
  projected_invocations_31d bigint not null check (
    projected_invocations_31d = prior_invocations_31d + 1
    and projected_invocations_31d < 400000
  ),
  scheduled_at timestamptz not null,
  primary key (run_id, batch_id, retry_sequence)
);

revoke all on table xrpl_r5_v1.memory_halt_batch_retries
  from public, anon, authenticated;

create or replace function public.xrpl_claim_r5_memory_retry_batch(
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
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_now is null
    or p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'r5_memory_retry_claim_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run.status <> 'running'
    or v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_run.profile_revision <> 3
    or v_run.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_run.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_run.source_profile_id <> 'supabase-devnet'
    or v_run.network <> 'devnet'
    or v_run.epoch_id <> 'supabase-r4c2c-v1'
    or v_run.batch_size <> 24
    or v_run.completed_batches < 1
    or v_run.committed_ledgers < 1
    or v_run.last_accounting_digest is null
    or v_run.last_error is not null
    or v_run.started_at is null
    or v_run.completed_at is not null then
    raise exception 'r5_memory_retry_claim_run_invalid';
  end if;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id
    and batch_sequence = v_run.completed_batches + 1
    and status = 'halted'
    and error_message = 'revision3_resource_halt:memory_upper_bound_halt'
  for update;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'no_memory_retry',
      'runId', v_run.run_id
    );
  end if;

  if v_batch.origin <> 'r5_executor'
    or v_batch.profile_id <> v_run.profile_id
    or v_batch.profile_revision <> v_run.profile_revision
    or v_batch.profile_identity_digest <> v_run.profile_identity_digest
    or v_batch.selection_digest <> v_run.selection_digest
    or v_batch.start_ledger_index <> v_run.current_watermark_ledger_index + 1
    or v_batch.expected_parent_hash <> v_run.current_watermark_ledger_hash
    or v_batch.ledger_count not in (1, 3, 6, 12)
    or v_batch.end_ledger_index
      <> v_batch.start_ledger_index + v_batch.ledger_count - 1
    or v_batch.observed_head_ledger_index < v_batch.end_ledger_index
    or v_batch.lease_owner is not null
    or v_batch.lease_expires_at is not null
    or v_batch.completed_at is null
    or v_batch.finalized_egress_upper_bound_bytes is not null
    or v_batch.accounting_digest is not null
    or v_batch.final_ledger_hash is not null
    or v_batch.final_work_id is not null
    or v_batch.works_digest is not null
    or v_batch.rows_digest is not null
    or v_batch.reserved_egress_upper_bound_bytes <> 134217728
    or v_batch.projected_conservative_egress_31d_bytes >= 4294967296
    or v_batch.projected_invocations_31d >= 400000 then
    raise exception 'r5_memory_retry_claim_batch_invalid';
  end if;

  update xrpl_r5_v1.recovery_batches
  set status = 'leased',
      lease_owner = p_owner,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      error_message = null,
      completed_at = null,
      claimed_at = p_now,
      updated_at = p_now
  where run_id = v_batch.run_id and batch_id = v_batch.batch_id
  returning * into v_batch;

  return jsonb_build_object(
    'claimed', true,
    'reclaimed', true,
    'memoryRetry', true,
    'runId', v_batch.run_id,
    'batchId', v_batch.batch_id,
    'batchSequence', v_batch.batch_sequence,
    'startLedgerIndex', v_batch.start_ledger_index,
    'endLedgerIndex', v_batch.end_ledger_index,
    'ledgerCount', v_batch.ledger_count,
    'expectedParentHash', v_batch.expected_parent_hash,
    'observedHeadLedgerIndex', v_batch.observed_head_ledger_index,
    'observedHeadLedgerHash', v_batch.observed_head_ledger_hash,
    'leaseExpiresAt', v_batch.lease_expires_at,
    'profileRevision', v_batch.profile_revision,
    'profileIdentityDigest', v_batch.profile_identity_digest,
    'selectionDigest', v_batch.selection_digest,
    'reservedEgressUpperBoundBytes', v_batch.reserved_egress_upper_bound_bytes,
    'priorConservativeEgress31dBytes',
      v_batch.prior_conservative_egress_31d_bytes,
    'projectedConservativeEgress31dBytes',
      v_batch.projected_conservative_egress_31d_bytes,
    'priorInvocations31d', v_batch.prior_invocations_31d,
    'projectedInvocations31d', v_batch.projected_invocations_31d,
    'checks', jsonb_build_object(
      'sameBatchIdentityRetained', true,
      'sameBatchSequenceRetained', true,
      'failedAttemptReservationRetained', true,
      'additionalRetryReservationRecorded', true,
      'memoryThresholdUnchanged', true,
      'oneLedgerRemainsTerminal', v_batch.ledger_count = 1,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationNotStarted', true,
      'soakNotStarted', true
    )
  );
end;
$$;

create or replace function public.xrpl_schedule_r5_memory_retry_half(
  p_run_id text,
  p_batch_id text,
  p_source_failed_burst_run_id bigint,
  p_source_commit text,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
  v_prior_run jsonb;
  v_prior_batch jsonb;
  v_retry_sequence integer;
  v_retry_count integer;
  v_completed_count bigint;
  v_halted_count bigint;
  v_last_completed_end bigint;
  v_prior_egress bigint;
  v_projected_egress bigint;
  v_prior_invocations bigint;
  v_projected_invocations bigint;
begin
  if p_run_id <> 'r5-recovery-selected-revision3-entry'
    or p_batch_id
      <> 'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'
    or p_source_failed_burst_run_id <> 30987685290
    or p_source_commit <> 'b4f267944bd076659b4c1db29208dcdc35eb532c'
    or p_scheduled_at is null then
    raise exception 'r5_memory_retry_schedule_invalid_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select count(*)::integer into v_retry_sequence
  from xrpl_r5_v1.memory_halt_batch_retries
  where run_id = p_run_id and batch_id = p_batch_id;

  if v_retry_sequence > 0 then
    select * into v_run
    from xrpl_r5_v1.recovery_runs
    where run_id = p_run_id;
    select * into v_batch
    from xrpl_r5_v1.recovery_batches
    where run_id = p_run_id and batch_id = p_batch_id;
    return jsonb_build_object(
      'scheduled', true,
      'replayed', true,
      'runId', p_run_id,
      'batchId', p_batch_id,
      'status', v_run.status,
      'ledgerCount', v_batch.ledger_count,
      'completedBatches', v_run.completed_batches,
      'committedLedgers', v_run.committed_ledgers,
      'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index
    );
  end if;

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run.status <> 'halted'
    or v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_run.profile_revision <> 3
    or v_run.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_run.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_run.source_profile_id <> 'supabase-devnet'
    or v_run.network <> 'devnet'
    or v_run.epoch_id <> 'supabase-r4c2c-v1'
    or v_run.batch_size <> 24
    or v_run.completed_batches <> 244
    or v_run.committed_ledgers <> 5175
    or v_run.current_watermark_ledger_index <> 4138482
    or v_run.last_error <> 'revision3_resource_halt:memory_upper_bound_halt'
    or v_run.last_accounting_digest is null
    or v_run.started_at is null
    or v_run.completed_at is not null then
    raise exception 'r5_memory_retry_schedule_run_invalid';
  end if;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id and batch_id = p_batch_id
  for update;

  if not found
    or v_batch.status <> 'halted'
    or v_batch.origin <> 'r5_executor'
    or v_batch.batch_sequence <> 245
    or v_batch.start_ledger_index <> 4138483
    or v_batch.end_ledger_index <> 4138506
    or v_batch.ledger_count <> 24
    or v_batch.expected_parent_hash <> v_run.current_watermark_ledger_hash
    or v_batch.observed_head_ledger_index < 4138506
    or v_batch.attempt_count <> 1
    or v_batch.lease_owner is not null
    or v_batch.lease_expires_at is not null
    or v_batch.completed_at is null
    or v_batch.error_message <> 'revision3_resource_halt:memory_upper_bound_halt'
    or v_batch.reserved_egress_upper_bound_bytes <> 134217728
    or v_batch.finalized_egress_upper_bound_bytes is not null
    or v_batch.accounting_digest is not null
    or v_batch.final_ledger_hash is not null
    or v_batch.final_work_id is not null
    or v_batch.works_digest is not null
    or v_batch.rows_digest is not null then
    raise exception 'r5_memory_retry_schedule_batch_invalid';
  end if;

  select
    count(*) filter (where status = 'completed')::bigint,
    count(*) filter (where status = 'halted')::bigint,
    max(end_ledger_index) filter (where status = 'completed')
  into v_completed_count, v_halted_count, v_last_completed_end
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id;

  if v_completed_count <> 244
    or v_halted_count <> 1
    or v_last_completed_end <> 4138482 then
    raise exception 'r5_memory_retry_schedule_batch_set_invalid';
  end if;

  v_prior_run := to_jsonb(v_run);
  v_prior_batch := to_jsonb(v_batch);
  v_retry_count := 12;
  v_prior_egress := v_batch.projected_conservative_egress_31d_bytes;
  v_projected_egress := v_prior_egress + v_batch.reserved_egress_upper_bound_bytes;
  v_prior_invocations := v_batch.projected_invocations_31d;
  v_projected_invocations := v_prior_invocations + 1;

  if v_projected_egress >= 4294967296
    or v_projected_invocations >= 400000 then
    raise exception 'r5_memory_retry_schedule_additional_reservation_halt';
  end if;

  update xrpl_r5_v1.recovery_batches
  set end_ledger_index = start_ledger_index + v_retry_count - 1,
      ledger_count = v_retry_count,
      prior_conservative_egress_31d_bytes = v_prior_egress,
      projected_conservative_egress_31d_bytes = v_projected_egress,
      prior_invocations_31d = v_prior_invocations,
      projected_invocations_31d = v_projected_invocations,
      updated_at = p_scheduled_at
  where run_id = v_batch.run_id and batch_id = v_batch.batch_id
  returning * into v_batch;

  update xrpl_r5_v1.recovery_runs
  set status = 'running',
      last_error = null,
      updated_at = p_scheduled_at
  where run_id = v_run.run_id
  returning * into v_run;

  insert into xrpl_r5_v1.memory_halt_batch_retries (
    run_id, batch_id, retry_sequence,
    source_failed_burst_run_id, source_commit, reason,
    prior_run, prior_batch,
    prior_ledger_count, retry_ledger_count,
    prior_conservative_egress_31d_bytes,
    projected_conservative_egress_31d_bytes,
    prior_invocations_31d, projected_invocations_31d,
    scheduled_at
  ) values (
    p_run_id, p_batch_id, 1,
    p_source_failed_burst_run_id, p_source_commit,
    'revision3_resource_halt:memory_upper_bound_halt',
    v_prior_run, v_prior_batch,
    24, v_retry_count,
    v_prior_egress, v_projected_egress,
    v_prior_invocations, v_projected_invocations,
    p_scheduled_at
  );

  return jsonb_build_object(
    'scheduled', true,
    'replayed', false,
    'runId', v_run.run_id,
    'batchId', v_batch.batch_id,
    'sourceFailedBurstRunId', p_source_failed_burst_run_id,
    'priorLedgerCount', 24,
    'retryLedgerCount', v_batch.ledger_count,
    'retryEndLedgerIndex', v_batch.end_ledger_index,
    'status', v_run.status,
    'completedBatches', v_run.completed_batches,
    'committedLedgers', v_run.committed_ledgers,
    'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
    'failedAttemptReservationRetained', true,
    'additionalRetryReservationRecorded', true,
    'memoryThresholdUnchanged', true,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true,
    'stabilizationAuthorized', false,
    'soakAuthorized', false
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
      'prebatchRebind', jsonb_build_object(
        'rebound', false,
        'reason', 'terminal_recovery_state'
      )
    );
  end if;
  if v_run.status = 'halted' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'recovery_halted',
      'runId', v_run.run_id,
      'error', v_run.last_error,
      'prebatchRebind', jsonb_build_object(
        'rebound', false,
        'reason', 'terminal_recovery_state'
      )
    );
  end if;
  if v_run.status not in ('prepared', 'running') then
    raise exception 'r5_recovery_prepared_head_run_not_claimable';
  end if;

  if v_run.status = 'prepared' then
    if v_run.completed_batches <> 0
      or v_run.committed_ledgers <> 0
      or v_run.last_accounting_digest is not null
      or v_run.last_error is not null
      or v_run.started_at is not null
      or v_run.completed_at is not null then
      raise exception 'r5_recovery_prepared_state_progress_invalid';
    end if;

    v_rebind := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
      p_run_id,
      p_now
    );

    select * into v_run
    from xrpl_r5_v1.recovery_runs
    where run_id = p_run_id
    for update;

    if not found
      or v_run.status <> 'prepared'
      or v_run.completed_batches <> 0
      or v_run.committed_ledgers <> 0
      or v_run.last_accounting_digest is not null
      or v_run.last_error is not null
      or v_run.started_at is not null
      or v_run.completed_at is not null then
      raise exception 'r5_recovery_prepared_state_changed_during_rebind';
    end if;
  else
    if v_run.completed_batches < 1
      or v_run.committed_ledgers < 1
      or v_run.last_accounting_digest is null
      or v_run.last_error is not null
      or v_run.started_at is null
      or v_run.completed_at is not null then
      raise exception 'r5_recovery_running_progress_invalid';
    end if;

    v_rebind := jsonb_build_object(
      'rebound', false,
      'reason', 'recovery_progress_present',
      'runId', v_run.run_id,
      'completedBatches', v_run.completed_batches,
      'committedLedgers', v_run.committed_ledgers,
      'watermarkLedgerIndex', v_run.current_watermark_ledger_index,
      'watermarkLedgerHash', v_run.current_watermark_ledger_hash,
      'watermarkWorkId', v_run.current_watermark_work_id,
      'prebatchRebindSkippedAfterProgress', true
    );

    v_claim := public.xrpl_claim_r5_memory_retry_batch(
      p_run_id,
      p_owner,
      p_now,
      p_lease_seconds
    );

    if coalesce((v_claim->>'claimed')::boolean, false) is true then
      v_projected_invocations := (v_claim->>'projectedInvocations31d')::bigint;
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
    end if;

    if v_claim->>'reason' <> 'no_memory_retry' then
      raise exception 'r5_recovery_memory_retry_claim_unexpected';
    end if;
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

revoke all on function public.xrpl_claim_r5_memory_retry_batch(
  text, text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.xrpl_schedule_r5_memory_retry_half(
  text, text, bigint, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) from public, anon, authenticated;

grant execute on function public.xrpl_claim_r5_memory_retry_batch(
  text, text, timestamptz, integer
) to service_role;
grant execute on function public.xrpl_schedule_r5_memory_retry_half(
  text, text, bigint, text, timestamptz
) to service_role;
grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_claim_r5_memory_retry_batch(text, text, timestamptz, integer) to supabase_admin';
    execute 'grant execute on function public.xrpl_schedule_r5_memory_retry_half(text, text, bigint, text, timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text, text, timestamptz, integer) to supabase_admin';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from xrpl_r5_v1.recovery_runs run
    join xrpl_r5_v1.recovery_batches batch
      on batch.run_id = run.run_id
    where run.run_id = 'r5-recovery-selected-revision3-entry'
      and run.status = 'halted'
      and run.completed_batches = 244
      and run.committed_ledgers = 5175
      and run.current_watermark_ledger_index = 4138482
      and run.last_error = 'revision3_resource_halt:memory_upper_bound_halt'
      and batch.batch_id =
        'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'
      and batch.status = 'halted'
      and batch.batch_sequence = 245
      and batch.start_ledger_index = 4138483
      and batch.end_ledger_index = 4138506
      and batch.ledger_count = 24
      and batch.error_message = run.last_error
  ) then
    perform public.xrpl_schedule_r5_memory_retry_half(
      'r5-recovery-selected-revision3-entry',
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245',
      30987685290,
      'b4f267944bd076659b4c1db29208dcdc35eb532c',
      clock_timestamp()
    );
  end if;
end;
$$;
