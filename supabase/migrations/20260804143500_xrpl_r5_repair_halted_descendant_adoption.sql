alter table xrpl_r5_v1.recovery_batches
  add column if not exists failure_reservation_retained boolean not null default false;

alter table xrpl_r5_v1.recovery_batches
  drop constraint if exists recovery_batches_finalized_egress_upper_bound_bytes_check;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'xrpl_r5_v1.recovery_batches'::regclass
      and contype = 'c'
      and conname <> 'xrpl_r5_recovery_batch_finalized_egress'
      and pg_get_constraintdef(oid) like '%finalized_egress_upper_bound_bytes%'
      and pg_get_constraintdef(oid) like '%33554431%'
  ) then
    raise exception 'r5_repair_obsolete_finalized_egress_constraint_present';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'xrpl_r5_v1.recovery_batches'::regclass
      and conname = 'xrpl_r5_recovery_batch_finalized_egress'
  ) then
    alter table xrpl_r5_v1.recovery_batches
      add constraint xrpl_r5_recovery_batch_finalized_egress check (
        (
          failure_reservation_retained is false
          and (
            finalized_egress_upper_bound_bytes is null
            or finalized_egress_upper_bound_bytes between 0 and 33554431
          )
        )
        or (
          failure_reservation_retained is true
          and status = 'completed'
          and origin = 'adopted_active_descendant'
          and finalized_egress_upper_bound_bytes
            = reserved_egress_upper_bound_bytes
          and finalized_egress_upper_bound_bytes = 134217728
        )
      );
  end if;
end;
$$;

create table if not exists xrpl_r5_v1.halted_descendant_repairs (
  run_id text not null references xrpl_r5_v1.recovery_runs(run_id) on delete cascade,
  batch_id text not null,
  schema_version integer not null default 1 check (schema_version = 1),
  source_diagnostic_run_id bigint not null check (source_diagnostic_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  prior_batch jsonb not null,
  recovery_watermark_ledger_index bigint not null,
  recovery_watermark_ledger_hash text not null check (
    recovery_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  physical_watermark_ledger_index bigint not null,
  physical_watermark_ledger_hash text not null check (
    physical_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  physical_watermark_work_id text not null,
  repaired_executor_ledger_count integer not null check (
    repaired_executor_ledger_count between 1 and 24
  ),
  adopted_descendant_ledger_count integer not null check (
    adopted_descendant_ledger_count > 0
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

revoke all on table xrpl_r5_v1.halted_descendant_repairs
  from public, anon, authenticated;

create or replace function public.xrpl_repair_r5_halted_batch_with_committed_descendants(
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
  v_first_final_index bigint;
  v_first_final_hash text;
  v_first_final_work_id text;
  v_first_works_digest text;
  v_first_rows_digest text;
  v_first_accounting_digest text;
  v_adoption_sequence bigint;
  v_expected_error constant text :=
    'xrpl_complete_r5_active_recovery_batch failed (400): {"code":"P0001","details":null,"hint":null,"message":"r5_recovery_batch_completion_pending_scan_invalid"}';
  v_expected_run_id constant text :=
    'r5-recovery-selected-revision3-entry';
  v_expected_batch_id constant text :=
    'r5-batch-v1-r5-recovery-selected-revision3-entry-00000087';
  v_expected_recovery_hash constant text :=
    'CEEF4D2066C19A58D2BB51E6BCD56DFE61A5D216B6529C216C0AC9DA4CBE4C8E';
  v_expected_recovery_work constant text :=
    'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4135112:5666A88243D6CF44A5BB3C08B517C2AB30FFE39AD8F58A88AE9CFA0F4F61E44D';
  v_expected_physical_hash constant text :=
    '82EE12132C2752B9E915D874B50042323E19C2C4E423F5EA411AF32F11C02F46';
  v_expected_physical_work constant text :=
    'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4135151:3CD23A0CFDAE0F96A535A58504A7293DFC6B85ED46779DD24C617ADF5AD34B4E';
begin
  if p_run_id <> v_expected_run_id
    or p_batch_id <> v_expected_batch_id
    or p_repaired_at is null then
    raise exception 'r5_halted_descendant_repair_invalid_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  if exists (
    select 1
    from xrpl_r5_v1.halted_descendant_repairs
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
    or v_run.completed_batches <> 86
    or v_run.committed_ledgers <> 1805
    or v_run.current_watermark_ledger_index <> 4135112
    or v_run.current_watermark_ledger_hash <> v_expected_recovery_hash
    or v_run.current_watermark_work_id <> v_expected_recovery_work
    or v_run.last_error <> v_expected_error
    or v_run.started_at is null
    or v_run.completed_at is not null
    or v_run.last_accounting_digest is null then
    raise exception 'r5_halted_descendant_repair_run_invalid';
  end if;

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id and batch_id = p_batch_id
  for update;

  if not found
    or v_batch.status <> 'halted'
    or v_batch.origin <> 'r5_executor'
    or v_batch.batch_sequence <> 87
    or v_batch.start_ledger_index <> 4135113
    or v_batch.end_ledger_index <> 4135136
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
    or v_batch.failure_reservation_retained is true then
    raise exception 'r5_halted_descendant_repair_batch_invalid';
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

  if v_completed_batch_count <> 86
    or v_halted_batch_count <> 1
    or v_last_completed_end <> 4135112 then
    raise exception 'r5_halted_descendant_repair_batch_set_invalid';
  end if;

  v_boundary := public.xrpl_drain_r5_checkpoint_boundary(
    'r5-halted-descendant-repair',
    p_repaired_at
  );

  if coalesce((v_boundary->>'drained')::boolean, false) is not true
    or (v_boundary->>'drainedStepCount')::integer <> 0
    or coalesce((v_boundary->'checks'->>'collectorQuiescent')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'activeStreamHealthy')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'noScanExecuted')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'onePendingScan')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'pendingScanBoundToWatermark')::boolean, false) is not true
    or coalesce((v_boundary->'checks'->>'noInflightWork')::boolean, false) is not true
    or v_boundary->>'sourceProfileId' <> 'supabase-devnet'
    or v_boundary->>'network' <> v_run.network
    or v_boundary->>'epochId' <> v_run.epoch_id
    or v_boundary->>'baseIdentity' <> v_run.base_identity then
    raise exception 'r5_halted_descendant_repair_boundary_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  if not found
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity
    or v_watermark.ledger_index <> 4135151
    or v_watermark.ledger_hash <> v_expected_physical_hash
    or v_watermark.work_id <> v_expected_physical_work
    or (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint
      <> v_watermark.ledger_index
    or upper(v_boundary->'watermarkAfter'->>'ledgerHash')
      <> v_watermark.ledger_hash
    or v_boundary->'watermarkAfter'->>'workId' <> v_watermark.work_id then
    raise exception 'r5_halted_descendant_repair_physical_watermark_invalid';
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
      and work.start_ledger_index between 4135113 and 4135136
  )
  select
    count(*)::bigint,
    coalesce(bool_and(
      chain.start_ledger_index = chain.previous_ledger_index + 1
      and chain.scanned_end_ledger_index = chain.start_ledger_index
    ), false),
    coalesce(bool_and(
      case when chain.ordinal = 1 then
        chain.previous_ledger_index = 4135112
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

  if v_work_count <> 24
    or not v_single_ledger_chain
    or not v_hash_linked_chain
    or v_first_previous_index <> 4135112
    or v_first_expected_parent_hash <> v_expected_recovery_hash
    or v_first_final_index <> 4135136
    or v_first_final_hash !~ '^[A-F0-9]{64}$'
    or v_first_final_work_id is null
    or v_first_works_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'r5_halted_descendant_repair_first_chunk_invalid';
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
    and work.start_ledger_index between 4135113 and 4135136;

  if v_first_rows_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'r5_halted_descendant_repair_first_rows_invalid';
  end if;

  v_first_accounting_digest := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'schemaVersion', 1,
      'purpose', 'r5-halted-executor-batch-adopted-after-boundary-race',
      'runId', p_run_id,
      'batchId', p_batch_id,
      'batchSequence', 87,
      'startLedgerIndex', 4135113,
      'endLedgerIndex', 4135136,
      'ledgerCount', 24,
      'worksDigest', v_first_works_digest,
      'rowsDigest', v_first_rows_digest,
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
    4135113, 4135136, 24,
    v_expected_recovery_hash, v_first_final_hash, v_first_final_work_id,
    24, v_first_works_digest, v_first_rows_digest,
    87, 1, p_repaired_at
  );

  update xrpl_r5_v1.recovery_runs
  set status = 'running',
      current_watermark_ledger_index = 4135136,
      current_watermark_ledger_hash = v_first_final_hash,
      current_watermark_work_id = v_first_final_work_id,
      completed_batches = completed_batches + 1,
      committed_ledgers = committed_ledgers + 24,
      adopted_batches = adopted_batches + 1,
      adopted_ledgers = adopted_ledgers + 24,
      last_error = null,
      updated_at = p_repaired_at
  where run_id = p_run_id
  returning * into v_run;

  if v_run.status <> 'running'
    or v_run.completed_batches <> 87
    or v_run.committed_ledgers <> 1829
    or v_run.current_watermark_ledger_index <> 4135136
    or v_run.committed_ledgers
      <> v_run.current_watermark_ledger_index
        - v_run.start_watermark_ledger_index then
    raise exception 'r5_halted_descendant_repair_first_update_invalid';
  end if;

  v_remaining_adoption :=
    public.xrpl_adopt_r5_committed_active_descendants(
      p_run_id,
      p_repaired_at
    );

  if coalesce((v_remaining_adoption->>'adopted')::boolean, false) is not true
    or (v_remaining_adoption->>'startLedgerIndex')::bigint <> 4135137
    or (v_remaining_adoption->>'endLedgerIndex')::bigint <> 4135151
    or (v_remaining_adoption->>'ledgerCount')::bigint <> 15
    or (v_remaining_adoption->>'workCount')::bigint <> 15
    or (v_remaining_adoption->>'firstBatchSequence')::bigint <> 88
    or (v_remaining_adoption->>'adoptedBatchCount')::bigint <> 1
    or (v_remaining_adoption->>'currentWatermarkLedgerIndex')::bigint
      <> 4135151
    or upper(v_remaining_adoption->>'currentWatermarkLedgerHash')
      <> v_expected_physical_hash
    or v_remaining_adoption->>'currentWatermarkWorkId'
      <> v_expected_physical_work then
    raise exception 'r5_halted_descendant_repair_remaining_adoption_invalid';
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
    or v_run.completed_batches <> 88
    or v_run.committed_ledgers <> 1844
    or v_run.current_watermark_ledger_index <> 4135151
    or v_run.current_watermark_ledger_hash <> v_expected_physical_hash
    or v_run.current_watermark_work_id <> v_expected_physical_work
    or v_run.committed_ledgers
      <> v_run.current_watermark_ledger_index
        - v_run.start_watermark_ledger_index
    or v_completed_batch_count <> 88
    or v_halted_batch_count <> 0
    or v_last_completed_end <> 4135151 then
    raise exception 'r5_halted_descendant_repair_final_state_invalid';
  end if;

  insert into xrpl_r5_v1.halted_descendant_repairs (
    run_id, batch_id,
    source_diagnostic_run_id, source_commit, prior_batch,
    recovery_watermark_ledger_index, recovery_watermark_ledger_hash,
    physical_watermark_ledger_index, physical_watermark_ledger_hash,
    physical_watermark_work_id,
    repaired_executor_ledger_count, adopted_descendant_ledger_count,
    repaired_works_digest, repaired_rows_digest,
    remaining_adoption, repaired_at
  ) values (
    p_run_id, p_batch_id,
    30918725807, 'bfa69a4aba02ae718b6af394fa1997d90b8e5186',
    v_prior_batch,
    4135112, v_expected_recovery_hash,
    4135151, v_expected_physical_hash, v_expected_physical_work,
    24, 15,
    v_first_works_digest, v_first_rows_digest,
    v_remaining_adoption, p_repaired_at
  );

  return jsonb_build_object(
    'repaired', true,
    'replayed', false,
    'runId', p_run_id,
    'batchId', p_batch_id,
    'sourceDiagnosticRunId', 30918725807,
    'recoveryWatermarkBefore', 4135112,
    'physicalWatermarkBefore', 4135151,
    'repairedExecutorLedgers', 24,
    'adoptedDescendantLedgers', 15,
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

revoke all on function public.xrpl_repair_r5_halted_batch_with_committed_descendants(
  text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.xrpl_repair_r5_halted_batch_with_committed_descendants(
  text, text, timestamptz
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_repair_r5_halted_batch_with_committed_descendants(text, text, timestamptz) to supabase_admin';
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
      and batch.batch_id =
        'r5-batch-v1-r5-recovery-selected-revision3-entry-00000087'
      and batch.status = 'halted'
  ) then
    perform public.xrpl_repair_r5_halted_batch_with_committed_descendants(
      'r5-recovery-selected-revision3-entry',
      'r5-batch-v1-r5-recovery-selected-revision3-entry-00000087',
      clock_timestamp()
    );
  end if;
end;
$$;
