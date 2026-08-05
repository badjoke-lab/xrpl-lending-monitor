create table if not exists xrpl_r5_v1.memory_retry_descendant_repairs (
  run_id text not null references xrpl_r5_v1.recovery_runs(run_id) on delete cascade,
  batch_id text not null,
  schema_version integer not null default 1 check (schema_version = 1),
  source_memory_halt_run_id bigint not null check (source_memory_halt_run_id > 0),
  source_remote_probe_run_id bigint not null check (source_remote_probe_run_id > 0),
  source_failed_burst_run_id bigint not null check (source_failed_burst_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  prior_run jsonb not null,
  prior_batch jsonb not null,
  retry_audit jsonb not null,
  boundary jsonb not null,
  recovery_watermark_ledger_index bigint not null,
  recovery_watermark_ledger_hash text not null check (
    recovery_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  diagnostic_physical_watermark_ledger_index bigint not null,
  diagnostic_physical_watermark_ledger_hash text not null check (
    diagnostic_physical_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  repaired_physical_watermark_ledger_index bigint not null,
  repaired_physical_watermark_ledger_hash text not null check (
    repaired_physical_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  repaired_physical_watermark_work_id text not null,
  boundary_step_count integer not null check (boundary_step_count between 0 and 256),
  repaired_executor_ledger_count integer not null check (
    repaired_executor_ledger_count = 12
  ),
  adopted_descendant_ledger_count bigint not null check (
    adopted_descendant_ledger_count > 0
  ),
  failed_attempt_projected_egress_31d_bytes bigint not null check (
    failed_attempt_projected_egress_31d_bytes = 3482266216
  ),
  retry_projected_egress_31d_bytes bigint not null check (
    retry_projected_egress_31d_bytes = 3616483944
  ),
  failed_attempt_projected_invocations_31d bigint not null check (
    failed_attempt_projected_invocations_31d = 75795
  ),
  retry_projected_invocations_31d bigint not null check (
    retry_projected_invocations_31d = 75796
  ),
  repaired_works_digest text not null check (
    repaired_works_digest ~ '^[a-f0-9]{64}$'
  ),
  repaired_rows_digest text not null check (
    repaired_rows_digest ~ '^[a-f0-9]{64}$'
  ),
  remaining_adoption jsonb not null,
  repaired_at timestamptz not null,
  primary key (run_id, batch_id)
);

revoke all on table xrpl_r5_v1.memory_retry_descendant_repairs
  from public, anon, authenticated;

create or replace function public.xrpl_repair_r5_memory_retry_watermark_drift(
  p_run_id text,
  p_batch_id text,
  p_repaired_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, extensions, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
  v_retry xrpl_r5_v1.memory_halt_batch_retries%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_boundary jsonb;
  v_remaining_adoption jsonb;
  v_prior_run jsonb;
  v_prior_batch jsonb;
  v_completed_batch_count bigint;
  v_leased_batch_count bigint;
  v_halted_batch_count bigint;
  v_last_completed_end bigint;
  v_work_count bigint;
  v_single_ledger_chain boolean;
  v_hash_linked_chain boolean;
  v_first_previous_index bigint;
  v_first_expected_parent_hash text;
  v_first_final_index bigint;
  v_first_final_hash text;
  v_first_final_work_id text;
  v_first_works_digest text;
  v_first_rows_digest text;
  v_first_accounting_digest text;
  v_adoption_sequence bigint;
  v_boundary_step_count integer;
  v_boundary_before_index bigint;
  v_boundary_after_index bigint;
  v_remaining_ledger_count bigint;
  v_expected_remaining_batches bigint;
  v_diagnostic_hash text;
  v_diagnostic_work_id text;
  v_expected_error constant text :=
    'xrpl_complete_r5_active_recovery_batch failed (400): {"code":"P0001","details":null,"hint":null,"message":"r5_recovery_batch_completion_watermark_drift"}';
  v_expected_run_id constant text :=
    'r5-recovery-selected-revision3-entry';
  v_expected_batch_id constant text :=
    'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245';
  v_expected_recovery_hash constant text :=
    '2AFA2CE9FA58878B6E13285945B97270544FED472F50D6D08BB05EA6036A6A3B';
  v_expected_recovery_work constant text :=
    'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4138467:14A18F40E0FA2E0DB48DAA307949BE755493352509A3E40C4DF160DDF2301EEF';
  v_diagnostic_physical_hash constant text :=
    'F4520F0F615E71F5AD41D9585737542D35EED6D41A79E25470C168F7D8B2B06D';
  v_diagnostic_physical_work constant text :=
    'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4138481:5A52D7485DE41CB3F9D0E5E4905E17BE6DB4BAE92FEEB92442ADF2F1F283B2EF';
begin
  if p_run_id <> v_expected_run_id
    or p_batch_id <> v_expected_batch_id
    or p_repaired_at is null then
    raise exception 'r5_memory_retry_drift_repair_invalid_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  if exists (
    select 1
    from xrpl_r5_v1.memory_retry_descendant_repairs
    where run_id = p_run_id and batch_id = p_batch_id
  ) then
    select * into v_run
    from xrpl_r5_v1.recovery_runs
    where run_id = p_run_id;

    return jsonb_build_object(
      'repaired', true,
      'replayed', true,
      'runId', p_run_id,
      'batchId', p_batch_id,
      'status', v_run.status,
      'completedBatches', v_run.completed_batches,
      'committedLedgers', v_run.committed_ledgers,
      'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
      'failedReservationsRetained', true,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationAuthorized', false,
      'soakAuthorized', false
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
    or v_run.base_identity
      <> 'seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77'
    or v_run.batch_size <> 24
    or v_run.completed_batches <> 244
    or v_run.committed_ledgers <> 5160
    or v_run.current_watermark_ledger_index <> 4138467
    or v_run.current_watermark_ledger_hash <> v_expected_recovery_hash
    or v_run.current_watermark_work_id <> v_expected_recovery_work
    or v_run.last_error <> v_expected_error
    or v_run.started_at is null
    or v_run.completed_at is not null
    or v_run.last_accounting_digest is null then
    raise exception 'r5_memory_retry_drift_repair_run_invalid';
  end if;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id and batch_id = p_batch_id
  for update;

  if not found
    or v_batch.status <> 'halted'
    or v_batch.origin <> 'r5_executor'
    or v_batch.profile_id <> v_run.profile_id
    or v_batch.profile_revision <> v_run.profile_revision
    or v_batch.profile_identity_digest <> v_run.profile_identity_digest
    or v_batch.selection_digest <> v_run.selection_digest
    or v_batch.batch_sequence <> 245
    or v_batch.start_ledger_index <> 4138468
    or v_batch.end_ledger_index <> 4138479
    or v_batch.ledger_count <> 12
    or v_batch.expected_parent_hash <> v_expected_recovery_hash
    or v_batch.attempt_count <> 2
    or v_batch.reserved_egress_upper_bound_bytes <> 134217728
    or v_batch.prior_conservative_egress_31d_bytes <> 3482266216
    or v_batch.projected_conservative_egress_31d_bytes <> 3616483944
    or v_batch.prior_invocations_31d <> 75795
    or v_batch.projected_invocations_31d <> 75796
    or v_batch.finalized_egress_upper_bound_bytes is not null
    or v_batch.accounting_digest is not null
    or v_batch.final_ledger_hash is not null
    or v_batch.final_work_id is not null
    or v_batch.works_digest is not null
    or v_batch.rows_digest is not null
    or v_batch.error_message <> v_expected_error
    or v_batch.failure_reservation_retained is true
    or v_batch.lease_owner is not null
    or v_batch.lease_expires_at is not null
    or v_batch.completed_at is null then
    raise exception 'r5_memory_retry_drift_repair_batch_invalid';
  end if;

  select * into v_retry
  from xrpl_r5_v1.memory_halt_batch_retries
  where run_id = p_run_id
    and batch_id = p_batch_id
    and retry_sequence = 1;

  if not found
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
    raise exception 'r5_memory_retry_drift_repair_retry_audit_invalid';
  end if;

  v_prior_run := to_jsonb(v_run);
  v_prior_batch := to_jsonb(v_batch);

  select
    count(*) filter (where status = 'completed')::bigint,
    count(*) filter (where status = 'leased')::bigint,
    count(*) filter (where status = 'halted')::bigint,
    max(end_ledger_index) filter (where status = 'completed')
  into
    v_completed_batch_count,
    v_leased_batch_count,
    v_halted_batch_count,
    v_last_completed_end
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id;

  if v_completed_batch_count <> 244
    or v_leased_batch_count <> 0
    or v_halted_batch_count <> 1
    or v_last_completed_end <> 4138467 then
    raise exception 'r5_memory_retry_drift_repair_batch_set_invalid';
  end if;

  v_boundary := public.xrpl_drain_r5_checkpoint_boundary(
    'r5-memory-retry-watermark-drift-repair',
    p_repaired_at
  );
  v_boundary_step_count := (v_boundary->>'drainedStepCount')::integer;
  v_boundary_before_index :=
    (v_boundary->'watermarkBefore'->>'ledgerIndex')::bigint;
  v_boundary_after_index :=
    (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint;

  if coalesce((v_boundary->>'drained')::boolean, false) is not true
    or v_boundary_step_count < 0
    or v_boundary_step_count > 256
    or coalesce((v_boundary->'checks'->>'collectorQuiescent')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'activeStreamHealthy')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'onlyExistingCommitOrFinalizeDrained')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'noScanExecuted')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'onePendingScan')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'pendingScanBoundToWatermark')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'noInflightWork')::boolean, false) is not true
    or v_boundary->>'sourceProfileId' <> 'supabase-devnet'
    or v_boundary->>'network' <> v_run.network
    or v_boundary->>'epochId' <> v_run.epoch_id
    or v_boundary->>'baseIdentity' <> v_run.base_identity
    or v_boundary_before_index < 4138481
    or v_boundary_after_index < v_boundary_before_index
    or v_boundary_after_index > v_boundary_before_index + 1
    or v_boundary_after_index > 4138737 then
    raise exception 'r5_memory_retry_drift_repair_boundary_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  if not found
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity
    or v_watermark.ledger_index <> v_boundary_after_index
    or v_watermark.ledger_index < 4138481
    or v_watermark.ledger_index > 4138737
    or (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint
      <> v_watermark.ledger_index
    or upper(v_boundary->'watermarkAfter'->>'ledgerHash')
      <> v_watermark.ledger_hash
    or v_boundary->'watermarkAfter'->>'workId' <> v_watermark.work_id then
    raise exception 'r5_memory_retry_drift_repair_physical_watermark_invalid';
  end if;

  select work.final_ledger_hash, work.work_id
  into v_diagnostic_hash, v_diagnostic_work_id
  from public.xrpl_phase_work work
  where work.profile_id = 'supabase-devnet'
    and work.status = 'committed'
    and work.start_ledger_index = 4138481
    and work.scanned_end_ledger_index = 4138481;

  if not found
    or v_diagnostic_hash <> v_diagnostic_physical_hash
    or v_diagnostic_work_id <> v_diagnostic_physical_work then
    raise exception 'r5_memory_retry_drift_repair_diagnostic_anchor_invalid';
  end if;

  with chain as (
    select
      row_number() over (order by work.start_ledger_index, work.work_id)::bigint
        as ordinal,
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
      and work.start_ledger_index between 4138468 and 4138479
  )
  select
    count(*)::bigint,
    coalesce(bool_and(
      chain.start_ledger_index = chain.previous_ledger_index + 1
      and chain.scanned_end_ledger_index = chain.start_ledger_index
    ), false),
    coalesce(bool_and(
      case when chain.ordinal = 1 then
        chain.previous_ledger_index = 4138467
        and chain.expected_parent_hash = v_expected_recovery_hash
      else
        chain.previous_ledger_index = chain.prior_end_ledger_index
        and chain.start_ledger_index = chain.prior_end_ledger_index + 1
        and chain.expected_parent_hash = chain.prior_final_ledger_hash
      end
    ), false),
    min(chain.previous_ledger_index) filter (where chain.ordinal = 1),
    min(chain.expected_parent_hash) filter (where chain.ordinal = 1),
    max(chain.scanned_end_ledger_index),
    (array_agg(
      chain.final_ledger_hash
      order by chain.start_ledger_index desc, chain.work_id desc
    ))[1],
    (array_agg(
      chain.work_id
      order by chain.start_ledger_index desc, chain.work_id desc
    ))[1],
    encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
      'workId', chain.work_id,
      'previousLedgerIndex', chain.previous_ledger_index,
      'startLedgerIndex', chain.start_ledger_index,
      'scannedEndLedgerIndex', chain.scanned_end_ledger_index,
      'expectedParentHash', chain.expected_parent_hash,
      'finalLedgerHash', chain.final_ledger_hash,
      'payloadDigest', chain.payload_digest,
      'committedAt', chain.committed_at
    ) order by chain.start_ledger_index, chain.work_id), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  into
    v_work_count,
    v_single_ledger_chain,
    v_hash_linked_chain,
    v_first_previous_index,
    v_first_expected_parent_hash,
    v_first_final_index,
    v_first_final_hash,
    v_first_final_work_id,
    v_first_works_digest
  from chain;

  if v_work_count <> 12
    or not v_single_ledger_chain
    or not v_hash_linked_chain
    or v_first_previous_index <> 4138467
    or v_first_expected_parent_hash <> v_expected_recovery_hash
    or v_first_final_index <> 4138479
    or v_first_final_hash !~ '^[A-F0-9]{64}$'
    or v_first_final_work_id is null
    or v_first_works_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'r5_memory_retry_drift_repair_first_chunk_invalid';
  end if;

  select encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
    'workId', rows.work_id,
    'semanticClass', rows.semantic_class,
    'canonicalKey', rows.canonical_key,
    'sourceLedgerIndex', rows.source_ledger_index,
    'sourceLedgerHash', rows.source_ledger_hash,
    'sourceTransactionHash', rows.source_transaction_hash,
    'objectId', rows.object_id,
    'relationshipIds', rows.relationship_ids,
    'valueJson', rows.value_json,
    'isTombstone', rows.is_tombstone,
    'createdAt', rows.created_at
  ) order by work.start_ledger_index, rows.semantic_class, rows.canonical_key), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  into v_first_rows_digest
  from public.xrpl_phase_reference_rows rows
  join public.xrpl_phase_work work on work.work_id = rows.work_id
  where work.profile_id = 'supabase-devnet'
    and work.start_ledger_index between 4138468 and 4138479;

  if v_first_rows_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'r5_memory_retry_drift_repair_first_rows_invalid';
  end if;

  v_first_accounting_digest := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'schemaVersion', 1,
      'purpose', 'r5-memory-retry-watermark-drift-adopted-descendant',
      'runId', p_run_id,
      'batchId', p_batch_id,
      'batchSequence', 245,
      'startLedgerIndex', 4138468,
      'endLedgerIndex', 4138479,
      'ledgerCount', 12,
      'worksDigest', v_first_works_digest,
      'rowsDigest', v_first_rows_digest,
      'boundaryStepCount', v_boundary_step_count,
      'physicalWatermarkAfterDrain', v_watermark.ledger_index,
      'sourceMemoryHaltRunId', 30987685290,
      'sourceFailedBurstRunId', 30991245747,
      'failedAttemptProjectedEgress31dBytes', 3482266216,
      'retryProjectedEgress31dBytes', 3616483944,
      'failedAttemptProjectedInvocations31d', 75795,
      'retryProjectedInvocations31d', 75796,
      'failedReservationsRetained', true,
      'retainedEgressUpperBoundBytes', 134217728,
      'additionalRecoveryEgressUpperBoundBytes', 0
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  v_adoption_sequence := v_run.adopted_batches + 1;

  update xrpl_r5_v1.recovery_batches
  set status = 'completed',
      origin = 'adopted_active_descendant',
      lease_owner = null,
      lease_expires_at = null,
      finalized_egress_upper_bound_bytes = reserved_egress_upper_bound_bytes,
      accounting_digest = v_first_accounting_digest,
      final_ledger_hash = v_first_final_hash,
      final_work_id = v_first_final_work_id,
      works_digest = v_first_works_digest,
      rows_digest = v_first_rows_digest,
      error_message = null,
      failure_reservation_retained = true,
      completed_at = p_repaired_at,
      updated_at = p_repaired_at
  where run_id = p_run_id and batch_id = p_batch_id;

  insert into xrpl_r5_v1.recovery_adoptions (
    run_id, adoption_sequence,
    start_ledger_index, end_ledger_index, ledger_count,
    expected_parent_hash, final_ledger_hash, final_work_id,
    work_count, works_digest, rows_digest,
    first_batch_sequence, adopted_batch_count, adopted_at
  ) values (
    p_run_id, v_adoption_sequence,
    4138468, 4138479, 12,
    v_expected_recovery_hash, v_first_final_hash, v_first_final_work_id,
    12, v_first_works_digest, v_first_rows_digest,
    245, 1, p_repaired_at
  );

  update xrpl_r5_v1.recovery_runs
  set status = 'running',
      current_watermark_ledger_index = 4138479,
      current_watermark_ledger_hash = v_first_final_hash,
      current_watermark_work_id = v_first_final_work_id,
      completed_batches = completed_batches + 1,
      committed_ledgers = committed_ledgers + 12,
      adopted_batches = adopted_batches + 1,
      adopted_ledgers = adopted_ledgers + 12,
      last_accounting_digest = v_first_accounting_digest,
      last_error = null,
      updated_at = p_repaired_at
  where run_id = p_run_id
  returning * into v_run;

  if v_run.status <> 'running'
    or v_run.completed_batches <> 245
    or v_run.committed_ledgers <> 5172
    or v_run.current_watermark_ledger_index <> 4138479
    or v_run.committed_ledgers
      <> v_run.current_watermark_ledger_index
        - v_run.start_watermark_ledger_index then
    raise exception 'r5_memory_retry_drift_repair_first_update_invalid';
  end if;

  v_remaining_ledger_count := v_watermark.ledger_index - 4138479;
  v_expected_remaining_batches := (v_remaining_ledger_count + 23) / 24;

  if v_remaining_ledger_count < 2
    or v_remaining_ledger_count > 258
    or v_expected_remaining_batches < 1
    or v_expected_remaining_batches > 11 then
    raise exception 'r5_memory_retry_drift_repair_remaining_range_invalid';
  end if;

  v_remaining_adoption :=
    public.xrpl_adopt_r5_committed_active_descendants(
      p_run_id,
      p_repaired_at
    );

  if coalesce((v_remaining_adoption->>'adopted')::boolean, false) is not true
    or (v_remaining_adoption->>'startLedgerIndex')::bigint <> 4138480
    or (v_remaining_adoption->>'endLedgerIndex')::bigint
      <> v_watermark.ledger_index
    or (v_remaining_adoption->>'ledgerCount')::bigint
      <> v_remaining_ledger_count
    or (v_remaining_adoption->>'workCount')::bigint
      <> v_remaining_ledger_count
    or (v_remaining_adoption->>'firstBatchSequence')::bigint <> 246
    or (v_remaining_adoption->>'adoptedBatchCount')::bigint
      <> v_expected_remaining_batches
    or (v_remaining_adoption->>'currentWatermarkLedgerIndex')::bigint
      <> v_watermark.ledger_index
    or upper(v_remaining_adoption->>'currentWatermarkLedgerHash')
      <> v_watermark.ledger_hash
    or v_remaining_adoption->>'currentWatermarkWorkId'
      <> v_watermark.work_id then
    raise exception 'r5_memory_retry_drift_repair_remaining_adoption_invalid';
  end if;

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  select
    count(*) filter (where status = 'completed')::bigint,
    count(*) filter (where status = 'leased')::bigint,
    count(*) filter (where status = 'halted')::bigint,
    max(end_ledger_index) filter (where status = 'completed')
  into
    v_completed_batch_count,
    v_leased_batch_count,
    v_halted_batch_count,
    v_last_completed_end
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id;

  if v_run.status <> 'running'
    or v_run.last_error is not null
    or v_run.completed_batches <> 245 + v_expected_remaining_batches
    or v_run.committed_ledgers
      <> v_watermark.ledger_index - v_run.start_watermark_ledger_index
    or v_run.current_watermark_ledger_index <> v_watermark.ledger_index
    or v_run.current_watermark_ledger_hash <> v_watermark.ledger_hash
    or v_run.current_watermark_work_id <> v_watermark.work_id
    or v_completed_batch_count <> v_run.completed_batches
    or v_leased_batch_count <> 0
    or v_halted_batch_count <> 0
    or v_last_completed_end <> v_watermark.ledger_index then
    raise exception 'r5_memory_retry_drift_repair_final_state_invalid';
  end if;

  insert into xrpl_r5_v1.memory_retry_descendant_repairs (
    run_id, batch_id,
    source_memory_halt_run_id, source_remote_probe_run_id,
    source_failed_burst_run_id, source_commit,
    prior_run, prior_batch, retry_audit, boundary,
    recovery_watermark_ledger_index, recovery_watermark_ledger_hash,
    diagnostic_physical_watermark_ledger_index,
    diagnostic_physical_watermark_ledger_hash,
    repaired_physical_watermark_ledger_index,
    repaired_physical_watermark_ledger_hash,
    repaired_physical_watermark_work_id,
    boundary_step_count,
    repaired_executor_ledger_count, adopted_descendant_ledger_count,
    failed_attempt_projected_egress_31d_bytes,
    retry_projected_egress_31d_bytes,
    failed_attempt_projected_invocations_31d,
    retry_projected_invocations_31d,
    repaired_works_digest, repaired_rows_digest,
    remaining_adoption, repaired_at
  ) values (
    p_run_id, p_batch_id,
    30987685290, 30990491631,
    30991245747, '86ab9d2720634242d730c1e08aeb10cb26e7fdd3',
    v_prior_run, v_prior_batch, to_jsonb(v_retry), v_boundary,
    4138467, v_expected_recovery_hash,
    4138481, v_diagnostic_physical_hash,
    v_watermark.ledger_index, v_watermark.ledger_hash,
    v_watermark.work_id,
    v_boundary_step_count,
    12, v_remaining_ledger_count,
    3482266216, 3616483944,
    75795, 75796,
    v_first_works_digest, v_first_rows_digest,
    v_remaining_adoption, p_repaired_at
  );

  return jsonb_build_object(
    'repaired', true,
    'replayed', false,
    'runId', p_run_id,
    'batchId', p_batch_id,
    'sourceMemoryHaltRunId', 30987685290,
    'sourceRemoteProbeRunId', 30990491631,
    'sourceFailedBurstRunId', 30991245747,
    'recoveryWatermarkBefore', 4138467,
    'diagnosticPhysicalWatermark', 4138481,
    'boundaryWatermarkBefore', v_boundary_before_index,
    'boundaryStepCount', v_boundary_step_count,
    'repairedPhysicalWatermark', v_watermark.ledger_index,
    'repairedExecutorLedgers', 12,
    'adoptedDescendantLedgers', v_remaining_ledger_count,
    'completedBatchesAfter', v_run.completed_batches,
    'committedLedgersAfter', v_run.committed_ledgers,
    'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
    'currentWatermarkLedgerHash', v_run.current_watermark_ledger_hash,
    'currentWatermarkWorkId', v_run.current_watermark_work_id,
    'failedAttemptReservationRetained', true,
    'retryReservationRetained', true,
    'additionalRecoveryEgressUpperBoundBytes', 0,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true,
    'stabilizationAuthorized', false,
    'soakAuthorized', false
  );
end;
$$;

revoke all on function public.xrpl_repair_r5_memory_retry_watermark_drift(
  text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.xrpl_repair_r5_memory_retry_watermark_drift(
  text, text, timestamptz
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_repair_r5_memory_retry_watermark_drift(text, text, timestamptz) to supabase_admin';
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
      and run.committed_ledgers = 5160
      and run.current_watermark_ledger_index = 4138467
      and run.last_error =
        'xrpl_complete_r5_active_recovery_batch failed (400): {"code":"P0001","details":null,"hint":null,"message":"r5_recovery_batch_completion_watermark_drift"}'
      and batch.batch_id =
        'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'
      and batch.status = 'halted'
      and batch.start_ledger_index = 4138468
      and batch.end_ledger_index = 4138479
      and batch.ledger_count = 12
      and batch.error_message = run.last_error
  ) then
    perform public.xrpl_repair_r5_memory_retry_watermark_drift(
      'r5-recovery-selected-revision3-entry',
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245',
      clock_timestamp()
    );
  end if;
end;
$$;

do $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
  v_repair xrpl_r5_v1.memory_retry_descendant_repairs%rowtype;
  v_leased bigint;
  v_halted bigint;
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

  select * into v_repair
  from xrpl_r5_v1.memory_retry_descendant_repairs
  where run_id = v_run.run_id and batch_id = v_batch.batch_id;

  select
    count(*) filter (where status = 'leased')::bigint,
    count(*) filter (where status = 'halted')::bigint
  into v_leased, v_halted
  from xrpl_r5_v1.recovery_batches
  where run_id = v_run.run_id;

  if v_run.status <> 'running'
    or v_run.last_error is not null
    or v_run.current_watermark_ledger_index < 4138481
    or v_run.committed_ledgers
      <> v_run.current_watermark_ledger_index
        - v_run.start_watermark_ledger_index
    or v_batch.status <> 'completed'
    or v_batch.origin <> 'adopted_active_descendant'
    or v_batch.start_ledger_index <> 4138468
    or v_batch.end_ledger_index <> 4138479
    or v_batch.ledger_count <> 12
    or v_batch.failure_reservation_retained is not true
    or v_batch.finalized_egress_upper_bound_bytes <> 134217728
    or v_batch.error_message is not null
    or v_repair.run_id is null
    or v_repair.source_memory_halt_run_id <> 30987685290
    or v_repair.source_remote_probe_run_id <> 30990491631
    or v_repair.source_failed_burst_run_id <> 30991245747
    or v_repair.repaired_executor_ledger_count <> 12
    or v_repair.failed_attempt_projected_egress_31d_bytes <> 3482266216
    or v_repair.retry_projected_egress_31d_bytes <> 3616483944
    or v_repair.failed_attempt_projected_invocations_31d <> 75795
    or v_repair.retry_projected_invocations_31d <> 75796
    or v_leased <> 0
    or v_halted <> 0 then
    raise exception 'r5_memory_retry_drift_repair_post_state_invalid';
  end if;
end;
$$;
