alter table xrpl_r5_v1.recovery_runs
  add column if not exists adopted_batches bigint not null default 0;
alter table xrpl_r5_v1.recovery_runs
  add column if not exists adopted_ledgers bigint not null default 0;

alter table xrpl_r5_v1.recovery_batches
  add column if not exists origin text not null default 'r5_executor';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'xrpl_r5_v1.recovery_runs'::regclass
      and conname = 'xrpl_r5_recovery_adopted_counts'
  ) then
    alter table xrpl_r5_v1.recovery_runs
      add constraint xrpl_r5_recovery_adopted_counts check (
        adopted_batches >= 0 and adopted_ledgers >= 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'xrpl_r5_v1.recovery_batches'::regclass
      and conname = 'xrpl_r5_recovery_batch_origin'
  ) then
    alter table xrpl_r5_v1.recovery_batches
      add constraint xrpl_r5_recovery_batch_origin check (
        origin in ('r5_executor', 'adopted_active_descendant')
      );
  end if;
end;
$$;

create table if not exists xrpl_r5_v1.recovery_adoptions (
  run_id text not null references xrpl_r5_v1.recovery_runs(run_id) on delete cascade,
  adoption_sequence bigint not null check (adoption_sequence > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  start_ledger_index bigint not null check (start_ledger_index > 0),
  end_ledger_index bigint not null check (end_ledger_index >= start_ledger_index),
  ledger_count bigint not null check (ledger_count > 0),
  expected_parent_hash text not null check (expected_parent_hash ~ '^[A-F0-9]{64}$'),
  final_ledger_hash text not null check (final_ledger_hash ~ '^[A-F0-9]{64}$'),
  final_work_id text not null,
  work_count bigint not null check (work_count > 0),
  works_digest text not null check (works_digest ~ '^[a-f0-9]{64}$'),
  rows_digest text not null check (rows_digest ~ '^[a-f0-9]{64}$'),
  first_batch_sequence bigint not null check (first_batch_sequence > 0),
  adopted_batch_count bigint not null check (adopted_batch_count > 0),
  adopted_at timestamptz not null,
  primary key (run_id, adoption_sequence),
  unique (run_id, start_ledger_index),
  constraint xrpl_r5_recovery_adoption_range check (
    end_ledger_index = start_ledger_index + ledger_count - 1
  ),
  constraint xrpl_r5_recovery_adoption_work_parity check (
    work_count = ledger_count
  )
);

revoke all on table xrpl_r5_v1.recovery_adoptions
  from public, anon, authenticated;

create or replace function public.xrpl_adopt_r5_committed_active_descendants(
  p_run_id text,
  p_adopted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, extensions, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_boundary jsonb;
  v_completed_batch_count bigint;
  v_leased_batch_count bigint;
  v_halted_batch_count bigint;
  v_last_batch_end bigint;
  v_delta bigint;
  v_work_count bigint;
  v_single_ledger_chain boolean;
  v_hash_linked_chain boolean;
  v_first_previous_index bigint;
  v_first_expected_parent_hash text;
  v_last_ledger_index bigint;
  v_last_ledger_hash text;
  v_last_work_id text;
  v_works_digest text;
  v_rows_digest text;
  v_adoption_sequence bigint;
  v_first_batch_sequence bigint;
  v_adopted_batch_count bigint;
  v_cursor_start bigint;
  v_cursor_end bigint;
  v_chunk_count integer;
  v_chunk_work_count bigint;
  v_chunk_expected_parent_hash text;
  v_chunk_final_hash text;
  v_chunk_final_work_id text;
  v_chunk_works_digest text;
  v_chunk_rows_digest text;
  v_chunk_accounting_digest text;
  v_batch_sequence bigint;
  v_batch_id text;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_adopted_at is null then
    raise exception 'r5_recovery_adoption_invalid_request';
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
    raise exception 'r5_recovery_adoption_run_invalid';
  end if;

  v_boundary := public.xrpl_drain_r5_checkpoint_boundary(
    'r5-adopt-active-descendants',
    p_adopted_at
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
    raise exception 'r5_recovery_adoption_boundary_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  if not found
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity
    or v_watermark.ledger_index < v_run.current_watermark_ledger_index
    or (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint <> v_watermark.ledger_index
    or upper(v_boundary->'watermarkAfter'->>'ledgerHash') <> v_watermark.ledger_hash
    or v_boundary->'watermarkAfter'->>'workId' <> v_watermark.work_id then
    raise exception 'r5_recovery_adoption_watermark_invalid';
  end if;

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

  if v_completed_batch_count <> v_run.completed_batches
    or v_leased_batch_count <> 0
    or v_halted_batch_count <> 0
    or v_last_batch_end <> v_run.current_watermark_ledger_index then
    raise exception 'r5_recovery_adoption_batch_state_invalid';
  end if;

  if v_watermark.ledger_index = v_run.current_watermark_ledger_index then
    if v_watermark.ledger_hash <> v_run.current_watermark_ledger_hash
      or v_watermark.work_id <> v_run.current_watermark_work_id then
      raise exception 'r5_recovery_adoption_equal_watermark_identity_changed';
    end if;
    return jsonb_build_object(
      'adopted', false,
      'reason', 'active_boundary_already_equal',
      'runId', v_run.run_id,
      'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
      'adoptedBatches', v_run.adopted_batches,
      'adoptedLedgers', v_run.adopted_ledgers,
      'pendingScanAttemptCountPreserved', true,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationAuthorized', false,
      'soakAuthorized', false
    );
  end if;

  v_delta := v_watermark.ledger_index - v_run.current_watermark_ledger_index;

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
      and work.start_ledger_index > v_run.current_watermark_ledger_index
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
        chain.previous_ledger_index = v_run.current_watermark_ledger_index
        and chain.expected_parent_hash = v_run.current_watermark_ledger_hash
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
    (array_agg(chain.work_id order by chain.start_ledger_index desc, chain.work_id desc))[1],
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
    v_last_ledger_index,
    v_last_ledger_hash,
    v_last_work_id,
    v_works_digest
  from chain;

  if v_work_count <> v_delta
    or not v_single_ledger_chain
    or not v_hash_linked_chain
    or v_first_previous_index <> v_run.current_watermark_ledger_index
    or v_first_expected_parent_hash <> v_run.current_watermark_ledger_hash
    or v_last_ledger_index <> v_watermark.ledger_index
    or v_last_ledger_hash <> v_watermark.ledger_hash
    or v_last_work_id <> v_watermark.work_id then
    raise exception 'r5_recovery_adoption_descendant_chain_invalid';
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
  into v_rows_digest
  from public.xrpl_phase_reference_rows rows
  join public.xrpl_phase_work work on work.work_id = rows.work_id
  where work.profile_id = 'supabase-devnet'
    and work.start_ledger_index > v_run.current_watermark_ledger_index
    and work.scanned_end_ledger_index <= v_watermark.ledger_index;

  v_adoption_sequence := v_run.adopted_batches + 1;
  v_first_batch_sequence := v_run.completed_batches + 1;
  v_adopted_batch_count := (v_delta + 23) / 24;
  v_cursor_start := v_run.current_watermark_ledger_index + 1;
  v_batch_sequence := v_first_batch_sequence;

  while v_cursor_start <= v_watermark.ledger_index loop
    v_cursor_end := least(v_cursor_start + 23, v_watermark.ledger_index);
    v_chunk_count := (v_cursor_end - v_cursor_start + 1)::integer;

    select
      count(*)::bigint,
      (array_agg(work.expected_parent_hash order by work.start_ledger_index, work.work_id))[1],
      (array_agg(work.final_ledger_hash order by work.start_ledger_index desc, work.work_id desc))[1],
      (array_agg(work.work_id order by work.start_ledger_index desc, work.work_id desc))[1],
      encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
        'workId', work.work_id,
        'previousLedgerIndex', work.previous_ledger_index,
        'startLedgerIndex', work.start_ledger_index,
        'scannedEndLedgerIndex', work.scanned_end_ledger_index,
        'expectedParentHash', work.expected_parent_hash,
        'finalLedgerHash', work.final_ledger_hash,
        'payloadDigest', work.payload_digest,
        'committedAt', work.committed_at
      ) order by work.start_ledger_index, work.work_id), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
    into
      v_chunk_work_count,
      v_chunk_expected_parent_hash,
      v_chunk_final_hash,
      v_chunk_final_work_id,
      v_chunk_works_digest
    from public.xrpl_phase_work work
    where work.profile_id = 'supabase-devnet'
      and work.status = 'committed'
      and work.start_ledger_index between v_cursor_start and v_cursor_end;

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
    into v_chunk_rows_digest
    from public.xrpl_phase_reference_rows rows
    join public.xrpl_phase_work work on work.work_id = rows.work_id
    where work.profile_id = 'supabase-devnet'
      and work.start_ledger_index between v_cursor_start and v_cursor_end;

    if v_chunk_work_count <> v_chunk_count
      or v_chunk_expected_parent_hash is null
      or v_chunk_final_hash is null
      or v_chunk_final_work_id is null
      or v_chunk_works_digest !~ '^[a-f0-9]{64}$'
      or v_chunk_rows_digest !~ '^[a-f0-9]{64}$' then
      raise exception 'r5_recovery_adoption_chunk_digest_invalid';
    end if;

    v_chunk_accounting_digest := encode(extensions.digest(convert_to(jsonb_build_object(
      'schemaVersion', 1,
      'purpose', 'r5-adopted-active-descendant-batch',
      'runId', v_run.run_id,
      'batchSequence', v_batch_sequence,
      'startLedgerIndex', v_cursor_start,
      'endLedgerIndex', v_cursor_end,
      'ledgerCount', v_chunk_count,
      'worksDigest', v_chunk_works_digest,
      'rowsDigest', v_chunk_rows_digest,
      'standardRevision3AccountingAlreadyRetained', true,
      'additionalRecoveryEgressUpperBoundBytes', 0
    )::text, 'UTF8'), 'sha256'), 'hex');

    v_batch_id := concat(
      'r5-batch-v1-', v_run.run_id, '-', lpad(v_batch_sequence::text, 8, '0')
    );

    insert into xrpl_r5_v1.recovery_batches (
      run_id, batch_id, batch_sequence, status, origin,
      lease_owner, lease_expires_at, attempt_count,
      start_ledger_index, end_ledger_index, ledger_count,
      expected_parent_hash, observed_head_ledger_index, observed_head_ledger_hash,
      profile_id, profile_revision, profile_identity_digest, selection_digest,
      reserved_egress_upper_bound_bytes, finalized_egress_upper_bound_bytes,
      prior_conservative_egress_31d_bytes,
      projected_conservative_egress_31d_bytes,
      prior_invocations_31d, projected_invocations_31d,
      accounting_digest, final_ledger_hash, final_work_id,
      works_digest, rows_digest, error_message,
      claimed_at, completed_at, updated_at
    ) values (
      v_run.run_id, v_batch_id, v_batch_sequence, 'completed',
      'adopted_active_descendant',
      null, null, 1,
      v_cursor_start, v_cursor_end, v_chunk_count,
      v_chunk_expected_parent_hash,
      greatest(v_run.initial_validated_head_ledger_index, v_cursor_end),
      case
        when v_run.initial_validated_head_ledger_index >= v_cursor_end
          then v_run.initial_validated_head_ledger_hash
        else v_chunk_final_hash
      end,
      'supabase_free_postgres_pgcron_edge', 3,
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
      134217728, 0, 0, 134217728, 0, 2,
      v_chunk_accounting_digest, v_chunk_final_hash, v_chunk_final_work_id,
      v_chunk_works_digest, v_chunk_rows_digest, null,
      p_adopted_at, p_adopted_at, p_adopted_at
    );

    v_cursor_start := v_cursor_end + 1;
    v_batch_sequence := v_batch_sequence + 1;
  end loop;

  if v_batch_sequence - v_first_batch_sequence <> v_adopted_batch_count then
    raise exception 'r5_recovery_adoption_batch_count_invalid';
  end if;

  insert into xrpl_r5_v1.recovery_adoptions (
    run_id, adoption_sequence,
    start_ledger_index, end_ledger_index, ledger_count,
    expected_parent_hash, final_ledger_hash, final_work_id,
    work_count, works_digest, rows_digest,
    first_batch_sequence, adopted_batch_count, adopted_at
  ) values (
    v_run.run_id, v_adoption_sequence,
    v_run.current_watermark_ledger_index + 1,
    v_watermark.ledger_index, v_delta,
    v_run.current_watermark_ledger_hash,
    v_watermark.ledger_hash, v_watermark.work_id,
    v_work_count, v_works_digest, v_rows_digest,
    v_first_batch_sequence, v_adopted_batch_count, p_adopted_at
  );

  update xrpl_r5_v1.recovery_runs
  set current_watermark_ledger_index = v_watermark.ledger_index,
      current_watermark_ledger_hash = v_watermark.ledger_hash,
      current_watermark_work_id = v_watermark.work_id,
      completed_batches = completed_batches + v_adopted_batch_count,
      committed_ledgers = committed_ledgers + v_delta,
      adopted_batches = adopted_batches + v_adopted_batch_count,
      adopted_ledgers = adopted_ledgers + v_delta,
      last_error = null,
      updated_at = p_adopted_at
  where run_id = v_run.run_id
  returning * into v_run;

  if v_run.committed_ledgers
      <> v_run.current_watermark_ledger_index - v_run.start_watermark_ledger_index
    or v_run.completed_batches * 24 < v_run.committed_ledgers then
    raise exception 'r5_recovery_adoption_final_arithmetic_invalid';
  end if;

  return jsonb_build_object(
    'adopted', true,
    'runId', v_run.run_id,
    'adoptionSequence', v_adoption_sequence,
    'startLedgerIndex', v_run.current_watermark_ledger_index - v_delta + 1,
    'endLedgerIndex', v_run.current_watermark_ledger_index,
    'ledgerCount', v_delta,
    'workCount', v_work_count,
    'worksDigest', v_works_digest,
    'rowsDigest', v_rows_digest,
    'firstBatchSequence', v_first_batch_sequence,
    'adoptedBatchCount', v_adopted_batch_count,
    'completedBatchesAfter', v_run.completed_batches,
    'committedLedgersAfter', v_run.committed_ledgers,
    'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
    'currentWatermarkLedgerHash', v_run.current_watermark_ledger_hash,
    'currentWatermarkWorkId', v_run.current_watermark_work_id,
    'pendingScanAttemptCountPreserved', true,
    'standardRevision3AccountingAlreadyRetained', true,
    'additionalRecoveryEgressUpperBoundBytes', 0,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true,
    'stabilizationAuthorized', false,
    'soakAuthorized', false
  );
end;
$$;

create or replace function public.xrpl_read_r5_active_recovery_adoptions(
  p_run_id text
)
returns jsonb
language sql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r5-active-descendant-adoption-summary',
    'runId', p_run_id,
    'adoptionCount', count(*),
    'adoptedLedgerCount', coalesce(sum(ledger_count), 0),
    'adoptedBatchCount', coalesce(sum(adopted_batch_count), 0),
    'adoptions', coalesce(jsonb_agg(jsonb_build_object(
      'adoptionSequence', adoption_sequence,
      'startLedgerIndex', start_ledger_index,
      'endLedgerIndex', end_ledger_index,
      'ledgerCount', ledger_count,
      'expectedParentHash', expected_parent_hash,
      'finalLedgerHash', final_ledger_hash,
      'finalWorkId', final_work_id,
      'workCount', work_count,
      'worksDigest', works_digest,
      'rowsDigest', rows_digest,
      'firstBatchSequence', first_batch_sequence,
      'adoptedBatchCount', adopted_batch_count,
      'adoptedAt', adopted_at
    ) order by adoption_sequence), '[]'::jsonb)
  )
  from xrpl_r5_v1.recovery_adoptions
  where run_id = p_run_id
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
  v_reconcile jsonb;
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
      'watermarkLedgerIndex', v_run.current_watermark_ledger_index
    );
  end if;
  if v_run.status = 'halted' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'recovery_halted',
      'runId', v_run.run_id,
      'error', v_run.last_error
    );
  end if;
  if v_run.status not in ('prepared', 'running') then
    raise exception 'r5_recovery_prepared_head_run_not_claimable';
  end if;

  if v_run.status = 'prepared' then
    v_reconcile := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
      p_run_id,
      p_now
    );
  else
    v_reconcile := public.xrpl_adopt_r5_committed_active_descendants(
      p_run_id,
      p_now
    );
  end if;

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run.status not in ('prepared', 'running')
    or v_run.last_error is not null then
    raise exception 'r5_recovery_prepared_head_run_changed_during_reconcile';
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
      'prebatchReconcile', v_reconcile
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
      'prebatchReconcile', v_reconcile
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
    'prebatchReconcile', v_reconcile
  );
end;
$$;

revoke all on function public.xrpl_adopt_r5_committed_active_descendants(
  text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_read_r5_active_recovery_adoptions(text)
  from public, anon, authenticated;
revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) from public, anon, authenticated;

grant execute on function public.xrpl_adopt_r5_committed_active_descendants(
  text, timestamptz
) to service_role;
grant execute on function public.xrpl_read_r5_active_recovery_adoptions(text)
  to service_role;
grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_adopt_r5_committed_active_descendants(text, timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_read_r5_active_recovery_adoptions(text) to supabase_admin';
    execute 'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text, text, timestamptz, integer) to supabase_admin';
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    execute 'grant execute on function public.xrpl_read_r5_active_recovery_adoptions(text) to supabase_read_only_user';
  end if;
end;
$$;

-- The exact production R5 run may already have a small committed active descendant
-- range from the interval before the ownership guard became effective. Adopt only
-- that fully proved range; fresh/local databases have no matching run and skip.
do $$
begin
  if exists (
    select 1
    from xrpl_r5_v1.recovery_runs
    where run_id = 'r5-recovery-selected-revision3-entry'
      and status = 'running'
  ) then
    perform public.xrpl_adopt_r5_committed_active_descendants(
      'r5-recovery-selected-revision3-entry',
      clock_timestamp()
    );
  end if;
end;
$$;
