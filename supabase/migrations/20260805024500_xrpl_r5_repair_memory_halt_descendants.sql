create table if not exists xrpl_r5_v1.memory_halt_descendant_repairs (
  run_id text not null references xrpl_r5_v1.recovery_runs(run_id) on delete cascade,
  batch_id text not null,
  schema_version integer not null default 1 check (schema_version = 1),
  source_diagnostic_run_id bigint not null check (source_diagnostic_run_id > 0),
  source_failed_burst_run_id bigint not null check (source_failed_burst_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  prior_batch jsonb not null,
  boundary jsonb not null,
  recovery_watermark_before_index bigint not null,
  recovery_watermark_before_hash text not null check (
    recovery_watermark_before_hash ~ '^[A-F0-9]{64}$'
  ),
  diagnostic_physical_watermark_index bigint not null,
  diagnostic_physical_watermark_hash text not null check (
    diagnostic_physical_watermark_hash ~ '^[A-F0-9]{64}$'
  ),
  repaired_batch_end_index bigint not null,
  repaired_batch_ledger_count integer not null check (
    repaired_batch_ledger_count between 1 and 24
  ),
  repaired_physical_watermark_index bigint not null,
  repaired_physical_watermark_hash text not null check (
    repaired_physical_watermark_hash ~ '^[A-F0-9]{64}$'
  ),
  repaired_physical_watermark_work_id text not null,
  boundary_step_count integer not null check (boundary_step_count between 0 and 256),
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

revoke all on table xrpl_r5_v1.memory_halt_descendant_repairs
  from public, anon, authenticated;

create or replace function public.xrpl_repair_r5_memory_halt_descendants(
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
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_boundary jsonb;
  v_remaining_adoption jsonb;
  v_prior_batch jsonb;
  v_completed_batch_count bigint;
  v_halted_batch_count bigint;
  v_last_completed_end bigint;
  v_work_count bigint;
  v_single_ledger_chain boolean;
  v_hash_linked_chain boolean;
  v_first_previous_index bigint;
  v_first_expected_parent_hash text;
  v_repaired_batch_end bigint;
  v_repaired_batch_ledger_count integer;
  v_repaired_final_hash text;
  v_repaired_final_work_id text;
  v_repaired_works_digest text;
  v_repaired_rows_digest text;
  v_repaired_accounting_digest text;
  v_adoption_sequence bigint;
  v_boundary_step_count integer;
  v_boundary_before_index bigint;
  v_boundary_after_index bigint;
  v_remaining_ledger_count bigint;
  v_expected_remaining_batches bigint;
  v_diagnostic_hash text;
  v_diagnostic_work_id text;
  v_expected_run_id constant text :=
    'r5-recovery-selected-revision3-entry';
  v_expected_batch_id constant text :=
    'r5-batch-v1-r5-recovery-selected-revision3-entry-00000238';
  v_expected_error constant text :=
    'revision3_resource_halt:memory_upper_bound_halt';
  v_expected_recovery_hash constant text :=
    '17B13E625AD7B4860D120369D3BE7CCD30A19DD4B4B803ADB49DBD9DC2E65F7A';
  v_expected_recovery_work constant text :=
    'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4138337:9FE75EC93C16A592E66C058D4E1B795224184D1E34F4C86668C2394C6324BAF5';
  v_diagnostic_physical_hash constant text :=
    '3D71549DEE5A07C5A550245E766DE1F1420317B3F5689ABE8EDDA605B897599B';
  v_diagnostic_physical_work constant text :=
    'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4138354:5F825698A1A091BE177C5CD7FCDC3B32AA1B3E66E578B8193B5D5E7283FC6EC9';
begin
  if p_run_id <> v_expected_run_id
    or p_batch_id <> v_expected_batch_id
    or p_repaired_at is null then
    raise exception 'r5_memory_halt_repair_invalid_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  if exists (
    select 1
    from xrpl_r5_v1.memory_halt_descendant_repairs
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
      'failureReservationRetained', true,
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
    or v_run.completed_batches <> 237
    or v_run.committed_ledgers <> 5030
    or v_run.adopted_batches <> 47
    or v_run.adopted_ledgers <> 470
    or v_run.current_watermark_ledger_index <> 4138337
    or v_run.current_watermark_ledger_hash <> v_expected_recovery_hash
    or v_run.current_watermark_work_id <> v_expected_recovery_work
    or v_run.last_error <> v_expected_error
    or v_run.last_accounting_digest
      <> '51c46cc939451058677220c2269f7be5b565f7560ecbecded8aed6a13317061b'
    or v_run.started_at is null
    or v_run.completed_at is not null then
    raise exception 'r5_memory_halt_repair_run_invalid';
  end if;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id and batch_id = p_batch_id
  for update;

  if not found
    or v_batch.status <> 'halted'
    or v_batch.origin <> 'r5_executor'
    or v_batch.batch_sequence <> 238
    or v_batch.start_ledger_index <> 4138338
    or v_batch.end_ledger_index <> 4138361
    or v_batch.ledger_count <> 24
    or v_batch.expected_parent_hash <> v_expected_recovery_hash
    or v_batch.attempt_count <> 1
    or v_batch.reserved_egress_upper_bound_bytes <> 134217728
    or v_batch.finalized_egress_upper_bound_bytes is not null
    or v_batch.accounting_digest is not null
    or v_batch.final_ledger_hash is not null
    or v_batch.final_work_id is not null
    or v_batch.works_digest is not null
    or v_batch.rows_digest is not null
    or v_batch.error_message <> v_expected_error
    or v_batch.failure_reservation_retained is true
    or v_batch.prior_conservative_egress_31d_bytes <> 3152793564
    or v_batch.projected_conservative_egress_31d_bytes <> 3287011292
    or v_batch.prior_invocations_31d <> 86211
    or v_batch.projected_invocations_31d <> 86211 then
    raise exception 'r5_memory_halt_repair_batch_invalid';
  end if;

  v_prior_batch := to_jsonb(v_batch);

  select
    count(*) filter (where status = 'completed')::bigint,
    count(*) filter (where status = 'halted')::bigint,
    max(end_ledger_index) filter (where status = 'completed')
  into
    v_completed_batch_count,
    v_halted_batch_count,
    v_last_completed_end
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id;

  if v_completed_batch_count <> 237
    or v_halted_batch_count <> 1
    or v_last_completed_end <> 4138337 then
    raise exception 'r5_memory_halt_repair_batch_set_invalid';
  end if;

  v_boundary := public.xrpl_drain_r5_checkpoint_boundary(
    'r5-memory-halt-descendant-repair',
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
    or v_boundary_before_index < 4138354
    or v_boundary_before_index > 4138610
    or v_boundary_after_index < v_boundary_before_index
    or v_boundary_after_index > v_boundary_before_index + 1
    or v_boundary_after_index > 4138611 then
    raise exception 'r5_memory_halt_repair_boundary_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  if not found
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity
    or v_watermark.ledger_index <> v_boundary_after_index
    or v_watermark.ledger_index < 4138354
    or v_watermark.ledger_index > 4138611
    or (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint
      <> v_watermark.ledger_index
    or upper(v_boundary->'watermarkAfter'->>'ledgerHash')
      <> v_watermark.ledger_hash
    or v_boundary->'watermarkAfter'->>'workId' <> v_watermark.work_id then
    raise exception 'r5_memory_halt_repair_physical_watermark_invalid';
  end if;

  select work.final_ledger_hash, work.work_id
  into v_diagnostic_hash, v_diagnostic_work_id
  from public.xrpl_phase_work work
  where work.profile_id = 'supabase-devnet'
    and work.status = 'committed'
    and work.start_ledger_index = 4138354
    and work.scanned_end_ledger_index = 4138354;

  if not found
    or v_diagnostic_hash <> v_diagnostic_physical_hash
    or v_diagnostic_work_id <> v_diagnostic_physical_work then
    raise exception 'r5_memory_halt_repair_diagnostic_anchor_invalid';
  end if;

  v_repaired_batch_end := least(v_watermark.ledger_index, 4138361);
  v_repaired_batch_ledger_count :=
    (v_repaired_batch_end - 4138338 + 1)::integer;

  if v_repaired_batch_end < 4138354
    or v_repaired_batch_end > 4138361
    or v_repaired_batch_ledger_count < 17
    or v_repaired_batch_ledger_count > 24 then
    raise exception 'r5_memory_halt_repair_partial_range_invalid';
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
      and work.start_ledger_index between 4138338 and v_repaired_batch_end
  )
  select
    count(*)::bigint,
    coalesce(bool_and(
      chain.start_ledger_index = chain.previous_ledger_index + 1
      and chain.scanned_end_ledger_index = chain.start_ledger_index
    ), false),
    coalesce(bool_and(
      case when chain.ordinal = 1 then
        chain.previous_ledger_index = 4138337
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
    v_repaired_batch_end,
    v_repaired_final_hash,
    v_repaired_final_work_id,
    v_repaired_works_digest
  from chain;

  if v_work_count <> v_repaired_batch_ledger_count
    or not v_single_ledger_chain
    or not v_hash_linked_chain
    or v_first_previous_index <> 4138337
    or v_first_expected_parent_hash <> v_expected_recovery_hash
    or v_repaired_batch_end <> 4138337 + v_repaired_batch_ledger_count
    or v_repaired_final_hash !~ '^[A-F0-9]{64}$'
    or v_repaired_final_work_id is null
    or v_repaired_works_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'r5_memory_halt_repair_committed_chain_invalid';
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
  into v_repaired_rows_digest
  from public.xrpl_phase_reference_rows rows
  join public.xrpl_phase_work work on work.work_id = rows.work_id
  where work.profile_id = 'supabase-devnet'
    and work.start_ledger_index between 4138338 and v_repaired_batch_end;

  if v_repaired_rows_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'r5_memory_halt_repair_rows_invalid';
  end if;

  v_repaired_accounting_digest := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'schemaVersion', 1,
      'purpose', 'r5-memory-halt-descendant-batch-adopted-after-boundary-drain',
      'runId', p_run_id,
      'batchId', p_batch_id,
      'batchSequence', 238,
      'originalStartLedgerIndex', 4138338,
      'originalEndLedgerIndex', 4138361,
      'originalLedgerCount', 24,
      'repairedEndLedgerIndex', v_repaired_batch_end,
      'repairedLedgerCount', v_repaired_batch_ledger_count,
      'worksDigest', v_repaired_works_digest,
      'rowsDigest', v_repaired_rows_digest,
      'boundaryStepCount', v_boundary_step_count,
      'physicalWatermarkAfterDrain', v_watermark.ledger_index,
      'failureReservationRetained', true,
      'retainedEgressUpperBoundBytes', 134217728,
      'standardRevision3AccountingAlreadyRetained', true,
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
      end_ledger_index = v_repaired_batch_end,
      ledger_count = v_repaired_batch_ledger_count,
      finalized_egress_upper_bound_bytes = reserved_egress_upper_bound_bytes,
      accounting_digest = v_repaired_accounting_digest,
      final_ledger_hash = v_repaired_final_hash,
      final_work_id = v_repaired_final_work_id,
      works_digest = v_repaired_works_digest,
      rows_digest = v_repaired_rows_digest,
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
    4138338, v_repaired_batch_end, v_repaired_batch_ledger_count,
    v_expected_recovery_hash, v_repaired_final_hash, v_repaired_final_work_id,
    v_repaired_batch_ledger_count, v_repaired_works_digest, v_repaired_rows_digest,
    238, 1, p_repaired_at
  );

  update xrpl_r5_v1.recovery_runs
  set status = 'running',
      current_watermark_ledger_index = v_repaired_batch_end,
      current_watermark_ledger_hash = v_repaired_final_hash,
      current_watermark_work_id = v_repaired_final_work_id,
      completed_batches = completed_batches + 1,
      committed_ledgers = committed_ledgers + v_repaired_batch_ledger_count,
      adopted_batches = adopted_batches + 1,
      adopted_ledgers = adopted_ledgers + v_repaired_batch_ledger_count,
      last_error = null,
      updated_at = p_repaired_at
  where run_id = p_run_id
  returning * into v_run;

  if v_run.status <> 'running'
    or v_run.completed_batches <> 238
    or v_run.committed_ledgers <> 5030 + v_repaired_batch_ledger_count
    or v_run.current_watermark_ledger_index <> v_repaired_batch_end
    or v_run.committed_ledgers
      <> v_run.current_watermark_ledger_index
        - v_run.start_watermark_ledger_index then
    raise exception 'r5_memory_halt_repair_first_update_invalid';
  end if;

  v_remaining_ledger_count := v_watermark.ledger_index - v_repaired_batch_end;
  v_expected_remaining_batches :=
    case when v_remaining_ledger_count = 0 then 0
      else (v_remaining_ledger_count + 23) / 24 end;

  v_remaining_adoption :=
    public.xrpl_adopt_r5_committed_active_descendants(
      p_run_id,
      p_repaired_at
    );

  if v_remaining_ledger_count = 0 then
    if coalesce((v_remaining_adoption->>'adopted')::boolean, false) is not false
      or v_remaining_adoption->>'reason' <> 'active_boundary_already_equal' then
      raise exception 'r5_memory_halt_repair_equal_adoption_invalid';
    end if;
  else
    if coalesce((v_remaining_adoption->>'adopted')::boolean, false) is not true
      or (v_remaining_adoption->>'startLedgerIndex')::bigint
        <> v_repaired_batch_end + 1
      or (v_remaining_adoption->>'endLedgerIndex')::bigint
        <> v_watermark.ledger_index
      or (v_remaining_adoption->>'ledgerCount')::bigint
        <> v_remaining_ledger_count
      or (v_remaining_adoption->>'workCount')::bigint
        <> v_remaining_ledger_count
      or (v_remaining_adoption->>'firstBatchSequence')::bigint <> 239
      or (v_remaining_adoption->>'adoptedBatchCount')::bigint
        <> v_expected_remaining_batches
      or (v_remaining_adoption->>'currentWatermarkLedgerIndex')::bigint
        <> v_watermark.ledger_index
      or upper(v_remaining_adoption->>'currentWatermarkLedgerHash')
        <> v_watermark.ledger_hash
      or v_remaining_adoption->>'currentWatermarkWorkId'
        <> v_watermark.work_id then
      raise exception 'r5_memory_halt_repair_remaining_adoption_invalid';
    end if;
  end if;

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  select
    count(*) filter (where status = 'completed')::bigint,
    count(*) filter (where status = 'halted')::bigint,
    max(end_ledger_index) filter (where status = 'completed')
  into
    v_completed_batch_count,
    v_halted_batch_count,
    v_last_completed_end
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id;

  if v_run.status <> 'running'
    or v_run.last_error is not null
    or v_run.completed_batches <> 238 + v_expected_remaining_batches
    or v_run.committed_ledgers
      <> v_watermark.ledger_index - v_run.start_watermark_ledger_index
    or v_run.current_watermark_ledger_index <> v_watermark.ledger_index
    or v_run.current_watermark_ledger_hash <> v_watermark.ledger_hash
    or v_run.current_watermark_work_id <> v_watermark.work_id
    or v_completed_batch_count <> v_run.completed_batches
    or v_halted_batch_count <> 0
    or v_last_completed_end <> v_watermark.ledger_index then
    raise exception 'r5_memory_halt_repair_final_state_invalid';
  end if;

  insert into xrpl_r5_v1.memory_halt_descendant_repairs (
    run_id, batch_id,
    source_diagnostic_run_id, source_failed_burst_run_id,
    source_commit, prior_batch, boundary,
    recovery_watermark_before_index, recovery_watermark_before_hash,
    diagnostic_physical_watermark_index, diagnostic_physical_watermark_hash,
    repaired_batch_end_index, repaired_batch_ledger_count,
    repaired_physical_watermark_index, repaired_physical_watermark_hash,
    repaired_physical_watermark_work_id,
    boundary_step_count,
    repaired_works_digest, repaired_rows_digest,
    remaining_adoption, repaired_at
  ) values (
    p_run_id, p_batch_id,
    30969285686, 30966882019,
    '7c755902c95873dc94939eff90dd9f8d019ff855',
    v_prior_batch, v_boundary,
    4138337, v_expected_recovery_hash,
    4138354, v_diagnostic_physical_hash,
    v_repaired_batch_end, v_repaired_batch_ledger_count,
    v_watermark.ledger_index, v_watermark.ledger_hash,
    v_watermark.work_id,
    v_boundary_step_count,
    v_repaired_works_digest, v_repaired_rows_digest,
    v_remaining_adoption, p_repaired_at
  );

  return jsonb_build_object(
    'repaired', true,
    'replayed', false,
    'runId', p_run_id,
    'batchId', p_batch_id,
    'sourceDiagnosticRunId', 30969285686,
    'sourceFailedBurstRunId', 30966882019,
    'recoveryWatermarkBefore', 4138337,
    'diagnosticPhysicalWatermark', 4138354,
    'boundaryWatermarkBefore', v_boundary_before_index,
    'boundaryStepCount', v_boundary_step_count,
    'repairedBatchEnd', v_repaired_batch_end,
    'repairedBatchLedgers', v_repaired_batch_ledger_count,
    'repairedPhysicalWatermark', v_watermark.ledger_index,
    'remainingAdoptedLedgers', v_remaining_ledger_count,
    'completedBatchesAfter', v_run.completed_batches,
    'committedLedgersAfter', v_run.committed_ledgers,
    'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
    'currentWatermarkLedgerHash', v_run.current_watermark_ledger_hash,
    'currentWatermarkWorkId', v_run.current_watermark_work_id,
    'failureReservationRetained', true,
    'standardRevision3AccountingAlreadyRetained', true,
    'additionalRecoveryEgressUpperBoundBytes', 0,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true,
    'stabilizationAuthorized', false,
    'soakAuthorized', false
  );
end;
$$;

revoke all on function public.xrpl_repair_r5_memory_halt_descendants(
  text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.xrpl_repair_r5_memory_halt_descendants(
  text, text, timestamptz
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_repair_r5_memory_halt_descendants(text, text, timestamptz) to supabase_admin';
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
      and run.last_error = 'revision3_resource_halt:memory_upper_bound_halt'
      and batch.batch_id =
        'r5-batch-v1-r5-recovery-selected-revision3-entry-00000238'
      and batch.status = 'halted'
  ) then
    perform public.xrpl_repair_r5_memory_halt_descendants(
      'r5-recovery-selected-revision3-entry',
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000238',
      clock_timestamp()
    );
  end if;
end;
$$;
