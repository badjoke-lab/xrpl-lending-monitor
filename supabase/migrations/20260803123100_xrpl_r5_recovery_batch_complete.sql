create or replace function public.xrpl_complete_r5_active_recovery_batch(
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
set search_path = public, xrpl_r5_v1, extensions, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
  v_runtime public.xrpl_collector_runtime%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_pending_scan public.xrpl_phase_messages%rowtype;
  v_works jsonb;
  v_accounting jsonb;
  v_accounting_input jsonb;
  v_accounting_result jsonb;
  v_accounting_checks jsonb;
  v_accounting_thresholds jsonb;
  v_item record;
  v_chunk record;
  v_row record;
  v_plan jsonb;
  v_counts jsonb;
  v_payload jsonb;
  v_rows jsonb;
  v_payload_record jsonb;
  v_ordinal integer;
  v_chunk_index integer;
  v_chunk_count integer;
  v_record_count integer;
  v_work_row_count integer;
  v_total_rows integer := 0;
  v_total_chunks integer := 0;
  v_total_relationships integer := 0;
  v_work_id text;
  v_expected_work_id text;
  v_previous_index bigint;
  v_start_index bigint;
  v_end_index bigint;
  v_expected_parent text;
  v_final_hash text;
  v_last_index bigint;
  v_last_hash text;
  v_final_work_id text;
  v_scan_id text;
  v_commit_id text;
  v_finalize_id text;
  v_next_scan_id text;
  v_previous_message_id text;
  v_chunk_payload_json text;
  v_chunk_digest text;
  v_encoded_digest text;
  v_reference_rows_json text;
  v_reference_rows_digest text;
  v_semantic_class text;
  v_canonical_key text;
  v_source_ledger_index bigint;
  v_source_ledger_hash text;
  v_source_transaction_hash text;
  v_object_id text;
  v_relationship_ids jsonb;
  v_value_json text;
  v_is_tombstone boolean;
  v_rows_digest text;
  v_database_started timestamptz := clock_timestamp();
  v_database_milliseconds numeric;
  v_expected_rolling_egress bigint;
  v_new_completed_batches bigint;
  v_new_committed_ledgers bigint;
  v_pending_count integer;
  v_leased_count integer;
  v_retry_count integer;
  v_inflight_work_count integer;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_batch_id !~ '^r5-batch-v1-r5-recovery-[a-z0-9][a-z0-9-]{7,79}-[0-9]{8}$'
    or p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_completed_at is null
    or p_works_digest !~ '^[a-f0-9]{64}$'
    or p_accounting_digest !~ '^[a-f0-9]{64}$'
    or p_finalized_egress_upper_bound_bytes < 0
    or p_finalized_egress_upper_bound_bytes >= 33554432
    or p_fetch_milliseconds < 0
    or p_normalize_milliseconds < 0
    or p_edge_wall_milliseconds < 0 then
    raise exception 'r5_recovery_batch_invalid_completion';
  end if;

  if encode(digest(convert_to(p_works_json, 'UTF8'), 'sha256'), 'hex')
      <> p_works_digest then
    raise exception 'r5_recovery_batch_works_digest_mismatch';
  end if;
  if encode(digest(convert_to(p_accounting_json, 'UTF8'), 'sha256'), 'hex')
      <> p_accounting_digest then
    raise exception 'r5_recovery_batch_accounting_digest_mismatch';
  end if;

  begin
    v_works := p_works_json::jsonb;
    v_accounting := p_accounting_json::jsonb;
  exception when others then
    raise exception 'r5_recovery_batch_completion_json_invalid';
  end;
  if jsonb_typeof(v_works) <> 'array'
    or jsonb_typeof(v_accounting) <> 'object' then
    raise exception 'r5_recovery_batch_completion_json_shape_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id and batch_id = p_batch_id
  for update;
  if not found then
    raise exception 'r5_recovery_batch_missing';
  end if;

  if v_batch.status = 'completed' then
    if v_batch.works_digest <> p_works_digest
      or v_batch.accounting_digest <> p_accounting_digest
      or v_batch.finalized_egress_upper_bound_bytes
        <> p_finalized_egress_upper_bound_bytes then
      raise exception 'r5_recovery_batch_completed_replay_conflict';
    end if;
    return jsonb_build_object(
      'completed', true,
      'replayed', true,
      'runId', v_batch.run_id,
      'batchId', v_batch.batch_id,
      'batchSequence', v_batch.batch_sequence,
      'startLedgerIndex', v_batch.start_ledger_index,
      'endLedgerIndex', v_batch.end_ledger_index,
      'ledgerCount', v_batch.ledger_count,
      'finalLedgerHash', v_batch.final_ledger_hash,
      'finalWorkId', v_batch.final_work_id,
      'worksDigest', v_batch.works_digest,
      'rowsDigest', v_batch.rows_digest,
      'accountingDigest', v_batch.accounting_digest,
      'effectiveEgressUpperBoundBytes',
        v_batch.finalized_egress_upper_bound_bytes
    );
  end if;
  if v_batch.status <> 'leased'
    or v_batch.lease_owner is distinct from p_owner
    or v_batch.lease_expires_at is null
    or v_batch.lease_expires_at <= p_completed_at then
    raise exception 'r5_recovery_batch_completion_lease_lost';
  end if;

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;
  if not found
    or v_run.status <> 'running'
    or v_run.profile_id <> v_batch.profile_id
    or v_run.profile_revision <> v_batch.profile_revision
    or v_run.profile_identity_digest <> v_batch.profile_identity_digest
    or v_run.selection_digest <> v_batch.selection_digest
    or v_run.source_profile_id <> 'supabase-devnet'
    or v_run.network <> 'devnet'
    or v_run.epoch_id <> 'supabase-r4c2c-v1'
    or v_run.batch_size <> 24 then
    raise exception 'r5_recovery_batch_completion_run_invalid';
  end if;

  if jsonb_array_length(v_works) <> v_batch.ledger_count then
    raise exception 'r5_recovery_batch_work_count_mismatch';
  end if;
  if v_batch.start_ledger_index <> v_run.current_watermark_ledger_index + 1
    or v_batch.expected_parent_hash <> v_run.current_watermark_ledger_hash then
    raise exception 'r5_recovery_batch_completion_run_boundary_changed';
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
    raise exception 'r5_recovery_batch_completion_collector_not_quiescent';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet'
  for update;
  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> v_run.network
    or v_stream.epoch_id <> v_run.epoch_id
    or v_stream.base_identity <> v_run.base_identity
    or v_stream.last_error_classification is not null
    or v_stream.last_error_message is not null then
    raise exception 'r5_recovery_batch_completion_stream_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet'
  for update;
  if not found
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity
    or v_watermark.ledger_index <> v_run.current_watermark_ledger_index
    or v_watermark.ledger_hash <> v_run.current_watermark_ledger_hash
    or v_watermark.work_id <> v_run.current_watermark_work_id
    or v_watermark.ledger_index <> v_batch.start_ledger_index - 1
    or v_watermark.ledger_hash <> v_batch.expected_parent_hash then
    raise exception 'r5_recovery_batch_completion_watermark_drift';
  end if;

  select
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'leased')::integer,
    count(*) filter (where status = 'retry')::integer
  into v_pending_count, v_leased_count, v_retry_count
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet';
  if v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0 then
    raise exception 'r5_recovery_batch_completion_scheduler_not_quiescent';
  end if;

  select * into v_pending_scan
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet' and status = 'pending'
  for update;
  if not found
    or v_pending_scan.phase <> 'scan'
    or v_pending_scan.attempt_count <> 0
    or (v_pending_scan.payload->>'expectedPreviousLedgerIndex')::bigint
      <> v_watermark.ledger_index
    or upper(v_pending_scan.payload->>'expectedPreviousLedgerHash')
      <> v_watermark.ledger_hash
    or v_pending_scan.payload->>'epochId' <> v_run.epoch_id
    or v_pending_scan.payload->>'baseIdentity' <> v_run.base_identity then
    raise exception 'r5_recovery_batch_completion_pending_scan_invalid';
  end if;

  select count(*)::integer into v_inflight_work_count
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
    and status in ('planned', 'staged', 'committing', 'finalizing');
  if v_inflight_work_count <> 0 then
    raise exception 'r5_recovery_batch_completion_inflight_work_present';
  end if;

  v_accounting_input := v_accounting->'input';
  v_accounting_result := v_accounting->'result';
  if v_accounting->>'profileId' <> 'supabase_free_postgres_pgcron_edge'
    or (v_accounting->>'profileRevision')::integer <> 3
    or v_accounting->>'profileIdentityDigest'
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or jsonb_typeof(v_accounting_input) <> 'object'
    or jsonb_typeof(v_accounting_result) <> 'object' then
    raise exception 'r5_recovery_batch_accounting_identity_invalid';
  end if;

  v_accounting_checks := v_accounting_result->'checks';
  v_accounting_thresholds := v_accounting_result->'thresholds';
  v_expected_rolling_egress := v_batch.prior_conservative_egress_31d_bytes
    + p_finalized_egress_upper_bound_bytes;

  if coalesce((v_accounting_result->>'allowed')::boolean, false) is not true
    or jsonb_typeof(v_accounting_result->'failures') <> 'array'
    or jsonb_array_length(v_accounting_result->'failures') <> 0
    or jsonb_typeof(v_accounting_checks) <> 'object'
    or jsonb_typeof(v_accounting_thresholds) <> 'object'
    or coalesce((v_accounting_checks->>'unavailableProviderMemoryNotClaimed')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'unavailableProviderEgressNotClaimed')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'fixedRuntimeReserveApplied')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'serializedBytesAmplified')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'objectOverheadApplied')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'allNetworkDirectionsCounted')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'preMutationDecision')::boolean, false) is not true then
    raise exception 'r5_recovery_batch_accounting_checks_invalid';
  end if;

  if (v_accounting_thresholds->>'projectMemoryHaltBytes')::bigint <> 234881024
    or (v_accounting_thresholds->>'providerMemoryHardBytes')::bigint <> 268435456
    or (v_accounting_thresholds->>'projectTickEgressHaltBytes')::bigint <> 33554432
    or (v_accounting_thresholds->>'projectEgressHalt31dBytes')::bigint <> 4294967296
    or (v_accounting_thresholds->>'providerEgressHard31dBytes')::bigint <> 5368709120
    or (v_accounting_thresholds->>'projectInvocationHalt31d')::bigint <> 400000
    or (v_accounting_thresholds->>'providerInvocationHard31d')::bigint <> 500000
    or (v_accounting_input->>'ledgerCount')::integer <> v_batch.ledger_count
    or (v_accounting_input->>'networkRequestCount')::integer not between 1 and 64
    or (v_accounting_input->>'databaseRequestCount')::integer not between 1 and 16
    or (v_accounting_input->>'transactionCount')::integer not between 0 and 4096
    or (v_accounting_input->>'metadataNodeCount')::integer not between 0 and 32768
    or (v_accounting_input->>'normalizedRecordCount')::integer not between 0 and 16384
    or (v_accounting_input->>'payloadChunkCount')::integer not between 0 and 1024
    or (v_accounting_input->>'relationshipCount')::integer not between 0 and 65536
    or (v_accounting_result->>'conservativeMemoryUpperBoundBytes')::bigint >= 234881024
    or (v_accounting_result->>'conservativeTickEgressUpperBoundBytes')::bigint
      <> p_finalized_egress_upper_bound_bytes
    or (v_accounting_result->>'conservativeEgress31dUpperBoundBytes')::bigint
      <> v_expected_rolling_egress
    or v_expected_rolling_egress >= 4294967296
    or (v_accounting_result->>'projectedInvocations31d')::bigint
      <> v_batch.projected_invocations_31d
    or v_batch.projected_invocations_31d >= 400000
    or p_finalized_egress_upper_bound_bytes
      >= v_batch.reserved_egress_upper_bound_bytes then
    raise exception 'r5_recovery_batch_accounting_threshold_invalid';
  end if;

  v_last_index := v_watermark.ledger_index;
  v_last_hash := v_watermark.ledger_hash;
  v_scan_id := public.xrpl_phase_scan_message_id(
    v_run.network, v_run.epoch_id, v_run.base_identity,
    v_last_index, v_last_hash, 0
  );
  if v_pending_scan.message_id <> v_scan_id then
    raise exception 'r5_recovery_batch_initial_scan_identity_invalid';
  end if;

  for v_item in
    select value, ordinality::integer as ordinal
    from jsonb_array_elements(v_works) with ordinality
    order by ordinality
  loop
    v_ordinal := v_item.ordinal;
    if jsonb_typeof(v_item.value) <> 'object'
      or jsonb_typeof(v_item.value->'chunks') <> 'array' then
      raise exception 'r5_recovery_batch_work_shape_invalid';
    end if;

    v_work_id := v_item.value->>'workId';
    v_previous_index := (v_item.value->>'previousLedgerIndex')::bigint;
    v_start_index := (v_item.value->>'startLedgerIndex')::bigint;
    v_end_index := (v_item.value->>'scannedEndLedgerIndex')::bigint;
    v_expected_parent := upper(v_item.value->>'expectedParentHash');
    v_final_hash := upper(v_item.value->>'finalLedgerHash');
    v_chunk_count := jsonb_array_length(v_item.value->'chunks');

    v_expected_work_id := public.xrpl_phase_work_id(
      v_run.network, v_run.epoch_id, v_run.base_identity,
      v_previous_index, v_expected_parent
    );

    if v_work_id <> v_expected_work_id
      or v_previous_index <> v_last_index
      or v_start_index <> v_previous_index + 1
      or v_end_index <> v_start_index
      or v_start_index <> v_batch.start_ledger_index + v_ordinal - 1
      or v_expected_parent <> v_last_hash
      or v_final_hash !~ '^[A-F0-9]{64}$'
      or v_chunk_count < 1 or v_chunk_count > 256
      or (v_item.value->>'payloadDigest') !~ '^[a-f0-9]{64}$' then
      raise exception 'r5_recovery_batch_work_identity_invalid_at_%', v_ordinal;
    end if;

    begin
      v_plan := (v_item.value->>'planJson')::jsonb;
      v_counts := (v_item.value->>'semanticCountsJson')::jsonb;
    exception when others then
      raise exception 'r5_recovery_batch_work_json_invalid_at_%', v_ordinal;
    end;
    if jsonb_typeof(v_plan) <> 'object'
      or jsonb_typeof(v_counts) <> 'object'
      or (v_plan->>'schemaVersion')::integer <> 1
      or v_plan->>'network' <> v_run.network
      or v_plan->>'epochId' <> v_run.epoch_id
      or v_plan->>'baseIdentity' <> v_run.base_identity
      or (v_plan->>'previousLedgerIndex')::bigint <> v_previous_index
      or (v_plan->>'plannedEndLedgerIndex')::bigint <> v_end_index
      or upper(v_plan->>'expectedParentHash') <> v_expected_parent
      or coalesce((v_counts->>'validatedLedgers')::integer, -1) <> 1 then
      raise exception 'r5_recovery_batch_work_plan_invalid_at_%', v_ordinal;
    end if;

    insert into public.xrpl_phase_work (
      work_id, profile_id, network, epoch_id, base_identity,
      previous_ledger_index, start_ledger_index, expected_parent_hash,
      planned_end_ledger_index, scanned_end_ledger_index, final_ledger_hash,
      status, plan_json, semantic_counts_json, payload_digest,
      expected_payload_chunks, expected_commit_chunks,
      created_at, updated_at, committed_at
    ) values (
      v_work_id, 'supabase-devnet', v_run.network, v_run.epoch_id,
      v_run.base_identity, v_previous_index, v_start_index,
      v_expected_parent, v_end_index, v_end_index, v_final_hash,
      'committed', v_item.value->>'planJson',
      v_item.value->>'semanticCountsJson', v_item.value->>'payloadDigest',
      v_chunk_count, v_chunk_count,
      p_completed_at, p_completed_at, p_completed_at
    );

    v_work_row_count := 0;
    v_previous_message_id := v_scan_id;

    for v_chunk in
      select value, ordinality::integer as ordinal
      from jsonb_array_elements(v_item.value->'chunks') with ordinality
      order by ordinality
    loop
      v_chunk_index := v_chunk.ordinal - 1;
      v_chunk_payload_json := v_chunk.value->>'payloadJson';
      v_chunk_digest := v_chunk.value->>'chunkDigest';
      v_encoded_digest := v_chunk.value->>'encodedDigest';
      v_record_count := (v_chunk.value->>'recordCount')::integer;
      v_reference_rows_json := v_chunk.value->>'referenceRowsJson';
      v_reference_rows_digest := v_chunk.value->>'referenceRowsDigest';

      if jsonb_typeof(v_chunk.value) <> 'object'
        or (v_chunk.value->>'chunkIndex')::integer <> v_chunk_index
        or (v_chunk.value->>'totalChunks')::integer <> v_chunk_count
        or v_record_count < 1 or v_record_count > 40
        or v_chunk_digest !~ '^[a-f0-9]{64}$'
        or v_encoded_digest !~ '^[a-f0-9]{64}$'
        or v_reference_rows_digest !~ '^[a-f0-9]{64}$'
        or encode(digest(convert_to(v_chunk_payload_json, 'UTF8'), 'sha256'), 'hex')
          <> v_encoded_digest
        or octet_length(convert_to(v_chunk_payload_json, 'UTF8'))
          <> (v_chunk.value->>'byteCount')::integer
        or octet_length(convert_to(v_chunk_payload_json, 'UTF8')) > 512000
        or encode(digest(convert_to(v_reference_rows_json, 'UTF8'), 'sha256'), 'hex')
          <> v_reference_rows_digest then
        raise exception 'r5_recovery_batch_chunk_invalid_at_%_%',
          v_ordinal, v_chunk_index;
      end if;

      begin
        v_payload := v_chunk_payload_json::jsonb;
        v_rows := v_reference_rows_json::jsonb;
      exception when others then
        raise exception 'r5_recovery_batch_chunk_json_invalid_at_%_%',
          v_ordinal, v_chunk_index;
      end;
      if jsonb_typeof(v_payload) <> 'object'
        or jsonb_typeof(v_payload->'records') <> 'array'
        or jsonb_typeof(v_rows) <> 'array'
        or v_payload->>'workId' <> v_work_id
        or (v_payload->>'chunkIndex')::integer <> v_chunk_index
        or (v_payload->>'totalChunks')::integer <> v_chunk_count
        or v_payload->>'payloadDigest'
          <> concat('sha256:', v_item.value->>'payloadDigest')
        or v_payload->>'chunkDigest' <> concat('sha256:', v_chunk_digest)
        or jsonb_array_length(v_payload->'records') <> v_record_count
        or jsonb_array_length(v_rows) <> v_record_count then
        raise exception 'r5_recovery_batch_chunk_content_invalid_at_%_%',
          v_ordinal, v_chunk_index;
      end if;

      insert into public.xrpl_phase_payload_chunks (
        work_id, chunk_index, encoding, payload_json, payload_digest,
        encoded_digest, byte_count, record_count, created_at
      ) values (
        v_work_id, v_chunk_index, 'normalized-payload-chunk-json-v1',
        v_chunk_payload_json, v_chunk_digest, v_encoded_digest,
        octet_length(convert_to(v_chunk_payload_json, 'UTF8')),
        v_record_count, p_completed_at
      );

      for v_row in select value from jsonb_array_elements(v_rows)
      loop
        v_semantic_class := v_row.value->>'semanticClass';
        v_canonical_key := v_row.value->>'canonicalKey';
        v_source_ledger_index := (v_row.value->>'sourceLedgerIndex')::bigint;
        v_source_ledger_hash := upper(v_row.value->>'sourceLedgerHash');
        v_source_transaction_hash := nullif(
          upper(v_row.value->>'sourceTransactionHash'), ''
        );
        v_object_id := nullif(v_row.value->>'objectId', '');
        v_relationship_ids := coalesce(
          v_row.value->'relationshipIds', '[]'::jsonb
        );
        v_value_json := case
          when v_row.value->'valueJson' = 'null'::jsonb then null
          else v_row.value->>'valueJson'
        end;
        v_is_tombstone := (v_row.value->>'isTombstone')::boolean;

        if v_semantic_class not in (
          'validated-ledger', 'protocol-event', 'object-change',
          'loan-lifecycle', 'archived-object', 'balance-history',
          'current-projection'
        )
          or v_canonical_key is null or length(v_canonical_key) = 0
          or v_source_ledger_index <> v_start_index
          or v_source_ledger_hash <> v_final_hash
          or jsonb_typeof(v_relationship_ids) <> 'array' then
          raise exception 'r5_recovery_batch_row_identity_invalid_at_%',
            v_ordinal;
        end if;
        if v_semantic_class = 'validated-ledger' then
          if v_source_transaction_hash is not null
            or v_object_id is not null or v_is_tombstone then
            raise exception 'r5_recovery_batch_validated_row_invalid_at_%',
              v_ordinal;
          end if;
        elsif v_source_transaction_hash is null
          or v_source_transaction_hash !~ '^[A-F0-9]{64}$' then
          raise exception 'r5_recovery_batch_transaction_row_invalid_at_%',
            v_ordinal;
        end if;
        if v_semantic_class in (
          'object-change', 'loan-lifecycle', 'archived-object',
          'current-projection'
        ) and v_object_id is null then
          raise exception 'r5_recovery_batch_object_row_invalid_at_%',
            v_ordinal;
        end if;
        if v_semantic_class = 'current-projection' and v_is_tombstone then
          if v_value_json is not null then
            raise exception 'r5_recovery_batch_tombstone_value_invalid_at_%',
              v_ordinal;
          end if;
        elsif v_value_json is null then
          raise exception 'r5_recovery_batch_row_value_missing_at_%',
            v_ordinal;
        else
          perform v_value_json::jsonb;
        end if;

        select payload_record into v_payload_record
        from jsonb_array_elements(v_payload->'records') payload_record
        where payload_record->>'semanticClass' = v_semantic_class
          and payload_record->>'canonicalKey' = v_canonical_key
        limit 1;
        if not found
          or (v_payload_record->>'sourceLedgerIndex')::bigint
            <> v_source_ledger_index
          or upper(v_payload_record->>'sourceLedgerHash')
            <> v_source_ledger_hash
          or coalesce(nullif(upper(
            v_payload_record->>'sourceTransactionHash'
          ), ''), '') <> coalesce(v_source_transaction_hash, '')
          or coalesce(nullif(v_payload_record->>'objectId', ''), '')
            <> coalesce(v_object_id, '')
          or v_payload_record->'relationshipIds' <> v_relationship_ids
          or (v_payload_record->>'isTombstone')::boolean
            <> v_is_tombstone
          or (v_value_json is null
            and v_payload_record->'value' <> 'null'::jsonb)
          or (v_value_json is not null
            and v_payload_record->'value' <> v_value_json::jsonb) then
          raise exception 'r5_recovery_batch_row_payload_mismatch_at_%',
            v_ordinal;
        end if;

        insert into public.xrpl_phase_reference_rows (
          work_id, semantic_class, canonical_key, source_ledger_index,
          source_ledger_hash, source_transaction_hash, object_id,
          relationship_ids, value_json, is_tombstone, created_at
        ) values (
          v_work_id, v_semantic_class, v_canonical_key,
          v_source_ledger_index, v_source_ledger_hash,
          v_source_transaction_hash, v_object_id, v_relationship_ids,
          v_value_json, v_is_tombstone, p_completed_at
        );

        v_work_row_count := v_work_row_count + 1;
        v_total_rows := v_total_rows + 1;
        v_total_relationships := v_total_relationships
          + jsonb_array_length(v_relationship_ids);
      end loop;

      v_commit_id := public.xrpl_phase_commit_message_id(
        v_work_id, v_chunk_index
      );
      insert into public.xrpl_phase_messages (
        message_id, profile_id, phase, payload, status, available_at,
        attempt_count, result, created_at, updated_at, completed_at
      ) values (
        v_commit_id, 'supabase-devnet', 'commit',
        jsonb_build_object(
          'schemaVersion', 1, 'phase', 'commit',
          'messageId', v_commit_id, 'workId', v_work_id,
          'chunkIndex', v_chunk_index
        ),
        'completed', p_completed_at, 1,
        jsonb_build_object(
          'status', 'committing', 'workId', v_work_id,
          'chunkIndex', v_chunk_index,
          'operationCount', v_record_count,
          'rowMutationCount', v_record_count,
          'chunkDigest', concat('sha256:', v_chunk_digest)
        ),
        p_completed_at, p_completed_at, p_completed_at
      );

      insert into public.xrpl_phase_successors (
        current_message_id, successor_message_id, reserved_at
      ) values (
        v_previous_message_id, v_commit_id, p_completed_at
      );
      update public.xrpl_phase_messages
      set successor_message_id = v_commit_id,
          updated_at = p_completed_at
      where message_id = v_previous_message_id;

      insert into public.xrpl_phase_commit_chunks (
        work_id, chunk_index, status, operation_count,
        row_mutation_count, chunk_digest,
        created_at, updated_at, completed_at
      ) values (
        v_work_id, v_chunk_index, 'completed',
        v_record_count, v_record_count, v_chunk_digest,
        p_completed_at, p_completed_at, p_completed_at
      );

      v_previous_message_id := v_commit_id;
      v_total_chunks := v_total_chunks + 1;
    end loop;

    if v_work_row_count <> coalesce(
      (v_counts->>'totalRecords')::integer, -1
    ) then
      raise exception 'r5_recovery_batch_semantic_count_invalid_at_%',
        v_ordinal;
    end if;

    update public.xrpl_phase_messages
    set status = 'completed',
        attempt_count = 1,
        lease_owner = null,
        lease_expires_at = null,
        result = jsonb_build_object(
          'status', 'staged', 'workId', v_work_id,
          'startLedgerIndex', v_start_index,
          'endLedgerIndex', v_end_index,
          'payloadDigest', concat(
            'sha256:', v_item.value->>'payloadDigest'
          ),
          'payloadChunks', v_chunk_count,
          'semanticCounts', v_counts
        ),
        completed_at = p_completed_at,
        updated_at = p_completed_at
    where message_id = v_scan_id
      and profile_id = 'supabase-devnet'
      and phase = 'scan'
      and status = 'pending'
      and attempt_count = 0;
    if not found then
      raise exception 'r5_recovery_batch_scan_completion_conflict_at_%',
        v_ordinal;
    end if;

    v_finalize_id := public.xrpl_phase_finalize_message_id(v_work_id);
    insert into public.xrpl_phase_messages (
      message_id, profile_id, phase, payload, status, available_at,
      attempt_count, result, created_at, updated_at, completed_at
    ) values (
      v_finalize_id, 'supabase-devnet', 'finalize',
      jsonb_build_object(
        'schemaVersion', 1, 'phase', 'finalize',
        'messageId', v_finalize_id, 'workId', v_work_id
      ),
      'completed', p_completed_at, 1,
      jsonb_build_object(
        'status', 'committed', 'workId', v_work_id,
        'ledgerIndex', v_end_index, 'ledgerHash', v_final_hash,
        'semanticCounts', v_counts
      ),
      p_completed_at, p_completed_at, p_completed_at
    );

    insert into public.xrpl_phase_successors (
      current_message_id, successor_message_id, reserved_at
    ) values (
      v_previous_message_id, v_finalize_id, p_completed_at
    );
    update public.xrpl_phase_messages
    set successor_message_id = v_finalize_id,
        updated_at = p_completed_at
    where message_id = v_previous_message_id;

    v_next_scan_id := public.xrpl_phase_scan_message_id(
      v_run.network, v_run.epoch_id, v_run.base_identity,
      v_end_index, v_final_hash, 0
    );
    insert into public.xrpl_phase_messages (
      message_id, profile_id, phase, payload, status, available_at,
      attempt_count, created_at, updated_at
    ) values (
      v_next_scan_id, 'supabase-devnet', 'scan',
      jsonb_build_object(
        'schemaVersion', 1, 'phase', 'scan',
        'messageId', v_next_scan_id,
        'network', v_run.network, 'epochId', v_run.epoch_id,
        'baseIdentity', v_run.base_identity,
        'expectedPreviousLedgerIndex', v_end_index,
        'expectedPreviousLedgerHash', v_final_hash,
        'scanSequence', 0
      ),
      'pending', p_completed_at, 0, p_completed_at, p_completed_at
    );
    insert into public.xrpl_phase_successors (
      current_message_id, successor_message_id, reserved_at
    ) values (
      v_finalize_id, v_next_scan_id, p_completed_at
    );
    update public.xrpl_phase_messages
    set successor_message_id = v_next_scan_id,
        updated_at = p_completed_at
    where message_id = v_finalize_id;

    v_scan_id := v_next_scan_id;
    v_last_index := v_end_index;
    v_last_hash := v_final_hash;
    v_final_work_id := v_work_id;
  end loop;

  if v_last_index <> v_batch.end_ledger_index
    or v_last_hash is null or v_final_work_id is null then
    raise exception 'r5_recovery_batch_reserved_end_not_reached';
  end if;
  if v_total_rows <> (v_accounting_input->>'normalizedRecordCount')::integer
    or v_total_chunks <> (v_accounting_input->>'payloadChunkCount')::integer
    or v_total_relationships <> (v_accounting_input->>'relationshipCount')::integer then
    raise exception 'r5_recovery_batch_accounting_count_mismatch';
  end if;

  insert into public.xrpl_phase_watermarks (
    profile_id, network, epoch_id, base_identity,
    ledger_index, ledger_hash, work_id, updated_at
  ) values (
    'supabase-devnet', v_run.network, v_run.epoch_id, v_run.base_identity,
    v_last_index, v_last_hash, v_final_work_id, p_completed_at
  )
  on conflict (profile_id) do update set
    network = excluded.network,
    epoch_id = excluded.epoch_id,
    base_identity = excluded.base_identity,
    ledger_index = excluded.ledger_index,
    ledger_hash = excluded.ledger_hash,
    work_id = excluded.work_id,
    updated_at = excluded.updated_at;

  select encode(digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
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
  ) order by work.start_ledger_index, rows.semantic_class, rows.canonical_key),
    '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  into v_rows_digest
  from public.xrpl_phase_reference_rows rows
  join public.xrpl_phase_work work on work.work_id = rows.work_id
  where work.profile_id = 'supabase-devnet'
    and work.start_ledger_index between v_batch.start_ledger_index
      and v_batch.end_ledger_index;

  v_database_milliseconds := extract(
    epoch from (clock_timestamp() - v_database_started)
  ) * 1000;

  update xrpl_r5_v1.recovery_batches
  set status = 'completed',
      lease_owner = null,
      lease_expires_at = null,
      finalized_egress_upper_bound_bytes = p_finalized_egress_upper_bound_bytes,
      accounting_digest = p_accounting_digest,
      final_ledger_hash = v_last_hash,
      final_work_id = v_final_work_id,
      works_digest = p_works_digest,
      rows_digest = v_rows_digest,
      error_message = null,
      completed_at = p_completed_at,
      updated_at = p_completed_at
  where run_id = p_run_id and batch_id = p_batch_id
  returning * into v_batch;

  v_new_completed_batches := v_run.completed_batches + 1;
  v_new_committed_ledgers := v_run.committed_ledgers + v_batch.ledger_count;
  update xrpl_r5_v1.recovery_runs
  set status = 'running',
      current_watermark_ledger_index = v_last_index,
      current_watermark_ledger_hash = v_last_hash,
      current_watermark_work_id = v_final_work_id,
      completed_batches = v_new_completed_batches,
      committed_ledgers = v_new_committed_ledgers,
      last_accounting_digest = p_accounting_digest,
      last_error = null,
      updated_at = p_completed_at
  where run_id = p_run_id;

  return jsonb_build_object(
    'completed', true,
    'replayed', false,
    'runId', p_run_id,
    'batchId', p_batch_id,
    'batchSequence', v_batch.batch_sequence,
    'startLedgerIndex', v_batch.start_ledger_index,
    'endLedgerIndex', v_batch.end_ledger_index,
    'ledgerCount', v_batch.ledger_count,
    'finalLedgerHash', v_last_hash,
    'finalWorkId', v_final_work_id,
    'worksDigest', p_works_digest,
    'rowsDigest', v_rows_digest,
    'accountingDigest', p_accounting_digest,
    'reservedEgressUpperBoundBytes',
      v_batch.reserved_egress_upper_bound_bytes,
    'finalizedEgressUpperBoundBytes',
      v_batch.finalized_egress_upper_bound_bytes,
    'effectiveEgressUpperBoundBytes',
      v_batch.finalized_egress_upper_bound_bytes,
    'recordCount', v_total_rows,
    'payloadChunkCount', v_total_chunks,
    'relationshipCount', v_total_relationships,
    'fetchMilliseconds', p_fetch_milliseconds,
    'normalizeMilliseconds', p_normalize_milliseconds,
    'edgeWallMilliseconds', p_edge_wall_milliseconds,
    'databaseMilliseconds', v_database_milliseconds,
    'completedBatches', v_new_completed_batches,
    'committedLedgers', v_new_committed_ledgers,
    'nextPendingScanId', v_scan_id,
    'checks', jsonb_build_object(
      'activeWatermarkAdvancedExactly',
        v_last_index = v_batch.end_ledger_index,
      'singlePendingScanAfterCommit', (
        select count(*) = 1
        from public.xrpl_phase_messages
        where profile_id = 'supabase-devnet' and status = 'pending'
      ),
      'noLeasedOrRetryMessagesAfterCommit', not exists (
        select 1 from public.xrpl_phase_messages
        where profile_id = 'supabase-devnet'
          and status in ('leased', 'retry')
      ),
      'batchReservationShrunkOnlyAfterSuccess',
        v_batch.finalized_egress_upper_bound_bytes
          < v_batch.reserved_egress_upper_bound_bytes,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationNotStarted', true,
      'soakNotStarted', true
    )
  );
end;
$$;

revoke all on function public.xrpl_complete_r5_active_recovery_batch(
  text, text, text, timestamptz, text, text, text, text,
  bigint, numeric, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.xrpl_complete_r5_active_recovery_batch(
  text, text, text, timestamptz, text, text, text, text,
  bigint, numeric, numeric, numeric
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_complete_r5_active_recovery_batch(text, text, text, timestamptz, text, text, text, text, bigint, numeric, numeric, numeric) to supabase_admin';
  end if;
end;
$$;
