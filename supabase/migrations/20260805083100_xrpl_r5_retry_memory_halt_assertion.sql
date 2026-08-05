do $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
  v_retry xrpl_r5_v1.memory_halt_batch_retries%rowtype;
  v_prior_run jsonb;
  v_prior_batch jsonb;
  v_completed_count bigint;
  v_halted_count bigint;
  v_last_completed_end bigint;
  v_prior_egress bigint;
  v_projected_egress bigint;
  v_prior_invocations bigint;
  v_projected_invocations bigint;
  v_scheduled_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = 'r5-recovery-selected-revision3-entry'
  for update;

  if not found then
    return;
  end if;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = v_run.run_id
    and batch_id =
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'
  for update;

  select * into v_retry
  from xrpl_r5_v1.memory_halt_batch_retries
  where run_id = v_run.run_id
    and batch_id =
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'
    and retry_sequence = 1;

  if v_retry.run_id is null then
    if v_run.status <> 'halted'
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
      or v_run.committed_ledgers <> 5160
      or v_run.current_watermark_ledger_index <> 4138467
      or v_run.last_error
        <> 'revision3_resource_halt:memory_upper_bound_halt'
      or v_run.last_accounting_digest is null
      or v_run.started_at is null
      or v_run.completed_at is not null
      or v_batch.run_id is null
      or v_batch.status <> 'halted'
      or v_batch.origin <> 'r5_executor'
      or v_batch.profile_id <> v_run.profile_id
      or v_batch.profile_revision <> v_run.profile_revision
      or v_batch.profile_identity_digest <> v_run.profile_identity_digest
      or v_batch.selection_digest <> v_run.selection_digest
      or v_batch.batch_sequence <> 245
      or v_batch.start_ledger_index <> 4138468
      or v_batch.end_ledger_index <> 4138491
      or v_batch.ledger_count <> 24
      or v_batch.expected_parent_hash <> v_run.current_watermark_ledger_hash
      or v_batch.observed_head_ledger_index is null
      or v_batch.observed_head_ledger_index < 4138491
      or v_batch.attempt_count < 1
      or v_batch.lease_owner is not null
      or v_batch.lease_expires_at is not null
      or v_batch.completed_at is null
      or v_batch.error_message
        <> 'revision3_resource_halt:memory_upper_bound_halt'
      or v_batch.reserved_egress_upper_bound_bytes <> 134217728
      or v_batch.finalized_egress_upper_bound_bytes is not null
      or v_batch.accounting_digest is not null
      or v_batch.final_ledger_hash is not null
      or v_batch.final_work_id is not null
      or v_batch.works_digest is not null
      or v_batch.rows_digest is not null
      or v_batch.projected_conservative_egress_31d_bytes <> 3482266216
      or v_batch.projected_invocations_31d <> 75795 then
      raise exception 'r5_memory_retry_exact_pre_state_invalid'
        using detail = jsonb_build_object(
          'runStatus', v_run.status,
          'completedBatches', v_run.completed_batches,
          'committedLedgers', v_run.committed_ledgers,
          'runWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
          'runLastError', v_run.last_error,
          'batchFound', v_batch.run_id is not null,
          'batchStatus', v_batch.status,
          'batchSequence', v_batch.batch_sequence,
          'batchStartLedgerIndex', v_batch.start_ledger_index,
          'batchEndLedgerIndex', v_batch.end_ledger_index,
          'batchLedgerCount', v_batch.ledger_count,
          'batchAttemptCount', v_batch.attempt_count,
          'batchError', v_batch.error_message,
          'batchReservedEgress', v_batch.reserved_egress_upper_bound_bytes,
          'batchProjectedEgress31d',
            v_batch.projected_conservative_egress_31d_bytes,
          'batchProjectedInvocations31d', v_batch.projected_invocations_31d
        )::text;
    end if;

    select
      count(*) filter (where status = 'completed')::bigint,
      count(*) filter (where status = 'halted')::bigint,
      max(end_ledger_index) filter (where status = 'completed')
    into v_completed_count, v_halted_count, v_last_completed_end
    from xrpl_r5_v1.recovery_batches
    where run_id = v_run.run_id;

    if v_completed_count <> 244
      or v_halted_count <> 1
      or v_last_completed_end <> 4138467 then
      raise exception 'r5_memory_retry_exact_batch_set_invalid';
    end if;

    v_prior_run := to_jsonb(v_run);
    v_prior_batch := to_jsonb(v_batch);
    v_prior_egress := v_batch.projected_conservative_egress_31d_bytes;
    v_projected_egress :=
      v_prior_egress + v_batch.reserved_egress_upper_bound_bytes;
    v_prior_invocations := v_batch.projected_invocations_31d;
    v_projected_invocations := v_prior_invocations + 1;

    if v_prior_egress <> 3482266216
      or v_projected_egress <> 3616483944
      or v_projected_egress >= 4294967296
      or v_prior_invocations <> 75795
      or v_projected_invocations <> 75796
      or v_projected_invocations >= 400000 then
      raise exception 'r5_memory_retry_exact_additional_reservation_halt';
    end if;

    update xrpl_r5_v1.recovery_batches
    set end_ledger_index = 4138479,
        ledger_count = 12,
        prior_conservative_egress_31d_bytes = v_prior_egress,
        projected_conservative_egress_31d_bytes = v_projected_egress,
        prior_invocations_31d = v_prior_invocations,
        projected_invocations_31d = v_projected_invocations,
        updated_at = v_scheduled_at
    where run_id = v_batch.run_id and batch_id = v_batch.batch_id
    returning * into v_batch;

    update xrpl_r5_v1.recovery_runs
    set status = 'running',
        last_error = null,
        updated_at = v_scheduled_at
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
      v_run.run_id, v_batch.batch_id, 1,
      30987685290,
      'b4f267944bd076659b4c1db29208dcdc35eb532c',
      'revision3_resource_halt:memory_upper_bound_halt',
      v_prior_run, v_prior_batch,
      24, 12,
      v_prior_egress, v_projected_egress,
      v_prior_invocations, v_projected_invocations,
      v_scheduled_at
    ) returning * into v_retry;
  end if;

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = 'r5-recovery-selected-revision3-entry'
  for update;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = v_run.run_id
    and batch_id =
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'
  for update;

  select * into v_retry
  from xrpl_r5_v1.memory_halt_batch_retries
  where run_id = v_run.run_id
    and batch_id = v_batch.batch_id
    and retry_sequence = 1;

  if v_run.status <> 'running'
    or v_run.completed_batches <> 244
    or v_run.committed_ledgers <> 5160
    or v_run.current_watermark_ledger_index <> 4138467
    or v_run.last_error is not null
    or v_run.completed_at is not null
    or v_batch.status <> 'halted'
    or v_batch.batch_sequence <> 245
    or v_batch.start_ledger_index <> 4138468
    or v_batch.end_ledger_index <> 4138479
    or v_batch.ledger_count <> 12
    or v_batch.expected_parent_hash <> v_run.current_watermark_ledger_hash
    or v_batch.error_message
      <> 'revision3_resource_halt:memory_upper_bound_halt'
    or v_batch.completed_at is null
    or v_batch.lease_owner is not null
    or v_batch.lease_expires_at is not null
    or v_batch.reserved_egress_upper_bound_bytes <> 134217728
    or v_batch.prior_conservative_egress_31d_bytes <> 3482266216
    or v_batch.projected_conservative_egress_31d_bytes <> 3616483944
    or v_batch.prior_invocations_31d <> 75795
    or v_batch.projected_invocations_31d <> 75796
    or v_retry.run_id is null
    or v_retry.source_failed_burst_run_id <> 30987685290
    or v_retry.source_commit
      <> 'b4f267944bd076659b4c1db29208dcdc35eb532c'
    or v_retry.reason
      <> 'revision3_resource_halt:memory_upper_bound_halt'
    or v_retry.prior_ledger_count <> 24
    or v_retry.retry_ledger_count <> 12
    or v_retry.prior_conservative_egress_31d_bytes <> 3482266216
    or v_retry.projected_conservative_egress_31d_bytes <> 3616483944
    or v_retry.prior_invocations_31d <> 75795
    or v_retry.projected_invocations_31d <> 75796 then
    raise exception 'r5_memory_retry_post_migration_state_invalid'
      using detail = jsonb_build_object(
        'runStatus', v_run.status,
        'completedBatches', v_run.completed_batches,
        'committedLedgers', v_run.committed_ledgers,
        'runWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
        'runLastError', v_run.last_error,
        'batchStatus', v_batch.status,
        'batchSequence', v_batch.batch_sequence,
        'batchStartLedgerIndex', v_batch.start_ledger_index,
        'batchEndLedgerIndex', v_batch.end_ledger_index,
        'batchLedgerCount', v_batch.ledger_count,
        'batchError', v_batch.error_message,
        'batchPriorEgress31d', v_batch.prior_conservative_egress_31d_bytes,
        'batchProjectedEgress31d',
          v_batch.projected_conservative_egress_31d_bytes,
        'batchPriorInvocations31d', v_batch.prior_invocations_31d,
        'batchProjectedInvocations31d', v_batch.projected_invocations_31d,
        'retryFound', v_retry.run_id is not null,
        'retryLedgerCount', v_retry.retry_ledger_count
      )::text;
  end if;
end;
$$;

drop function if exists public.xrpl_schedule_r5_memory_retry_half(
  text, text, bigint, text, timestamptz
);
