do $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
  v_retry xrpl_r5_v1.memory_halt_batch_retries%rowtype;
begin
  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = 'r5-recovery-selected-revision3-entry';

  if not found then
    return;
  end if;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = v_run.run_id
    and batch_id =
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245';

  select * into v_retry
  from xrpl_r5_v1.memory_halt_batch_retries
  where run_id = v_run.run_id
    and batch_id =
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'
    and retry_sequence = 1;

  if v_run.status <> 'running'
    or v_run.completed_batches <> 244
    or v_run.committed_ledgers <> 5175
    or v_run.current_watermark_ledger_index <> 4138482
    or v_run.last_error is not null
    or v_run.completed_at is not null
    or v_batch.run_id is null
    or v_batch.status <> 'halted'
    or v_batch.batch_sequence <> 245
    or v_batch.start_ledger_index <> 4138483
    or v_batch.end_ledger_index <> 4138494
    or v_batch.ledger_count <> 12
    or v_batch.expected_parent_hash <> v_run.current_watermark_ledger_hash
    or v_batch.error_message
      <> 'revision3_resource_halt:memory_upper_bound_halt'
    or v_batch.completed_at is null
    or v_batch.lease_owner is not null
    or v_batch.lease_expires_at is not null
    or v_batch.reserved_egress_upper_bound_bytes <> 134217728
    or v_batch.projected_conservative_egress_31d_bytes >= 4294967296
    or v_batch.projected_invocations_31d >= 400000
    or v_retry.run_id is null
    or v_retry.source_failed_burst_run_id <> 30987685290
    or v_retry.source_commit
      <> 'b4f267944bd076659b4c1db29208dcdc35eb532c'
    or v_retry.reason
      <> 'revision3_resource_halt:memory_upper_bound_halt'
    or v_retry.prior_ledger_count <> 24
    or v_retry.retry_ledger_count <> 12
    or v_retry.projected_conservative_egress_31d_bytes
      <> v_batch.projected_conservative_egress_31d_bytes
    or v_retry.projected_invocations_31d
      <> v_batch.projected_invocations_31d then
    raise exception 'r5_memory_retry_post_migration_state_invalid'
      using detail = jsonb_build_object(
        'runStatus', v_run.status,
        'completedBatches', v_run.completed_batches,
        'committedLedgers', v_run.committed_ledgers,
        'runWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
        'runLastError', v_run.last_error,
        'runCompleted', v_run.completed_at is not null,
        'batchFound', v_batch.run_id is not null,
        'batchStatus', v_batch.status,
        'batchSequence', v_batch.batch_sequence,
        'batchStartLedgerIndex', v_batch.start_ledger_index,
        'batchEndLedgerIndex', v_batch.end_ledger_index,
        'batchLedgerCount', v_batch.ledger_count,
        'batchParentMatchesRun',
          v_batch.expected_parent_hash = v_run.current_watermark_ledger_hash,
        'batchError', v_batch.error_message,
        'batchCompletedAtPresent', v_batch.completed_at is not null,
        'batchLeaseOwnerPresent', v_batch.lease_owner is not null,
        'batchLeaseExpiryPresent', v_batch.lease_expires_at is not null,
        'batchReservedEgress', v_batch.reserved_egress_upper_bound_bytes,
        'batchProjectedEgress31d',
          v_batch.projected_conservative_egress_31d_bytes,
        'batchProjectedInvocations31d', v_batch.projected_invocations_31d,
        'retryFound', v_retry.run_id is not null,
        'retrySourceRunId', v_retry.source_failed_burst_run_id,
        'retrySourceCommit', v_retry.source_commit,
        'retryReason', v_retry.reason,
        'retryPriorLedgerCount', v_retry.prior_ledger_count,
        'retryLedgerCount', v_retry.retry_ledger_count,
        'retryProjectedEgress31d',
          v_retry.projected_conservative_egress_31d_bytes,
        'retryProjectedInvocations31d', v_retry.projected_invocations_31d
      )::text;
  end if;
end;
$$;
