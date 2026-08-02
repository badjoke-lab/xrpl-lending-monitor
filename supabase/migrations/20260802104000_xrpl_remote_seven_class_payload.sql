alter table public.xrpl_phase_reference_rows
  drop constraint if exists xrpl_phase_reference_rows_semantic_class_check;

alter table public.xrpl_phase_reference_rows
  add constraint xrpl_phase_reference_rows_semantic_class_check check (
    semantic_class in (
      'validated-ledger',
      'protocol-event',
      'object-change',
      'loan-lifecycle',
      'archived-object',
      'balance-history',
      'current-projection'
    )
  );

alter table public.xrpl_phase_payload_chunks
  add column if not exists encoded_digest text;

alter table public.xrpl_phase_payload_chunks
  drop constraint if exists xrpl_phase_payload_chunks_encoded_digest_check;

alter table public.xrpl_phase_payload_chunks
  add constraint xrpl_phase_payload_chunks_encoded_digest_check check (
    encoded_digest is null or encoded_digest ~ '^[a-f0-9]{64}$'
  );

create or replace function public.xrpl_complete_portable_scan_phase(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz,
  p_ledger_index bigint,
  p_ledger_hash text,
  p_parent_hash text,
  p_payload_digest text,
  p_semantic_counts_json text,
  p_chunks_json text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_previous_index bigint;
  v_previous_hash text;
  v_work_id text;
  v_commit_id text;
  v_commit_payload jsonb;
  v_plan_json text;
  v_counts jsonb;
  v_chunks jsonb;
  v_chunk jsonb;
  v_chunk_payload jsonb;
  v_chunk_payload_json text;
  v_chunk_index integer;
  v_total_chunks integer;
  v_record_count integer;
  v_total_records integer := 0;
  v_chunk_digest text;
  v_encoded_digest text;
  v_actual_encoded_digest text;
begin
  if p_ledger_index <= 0
    or upper(p_ledger_hash) !~ '^[A-F0-9]{64}$'
    or upper(p_parent_hash) !~ '^[A-F0-9]{64}$' then
    raise exception 'invalid ledger identity';
  end if;
  if p_payload_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid full payload digest';
  end if;

  begin
    v_counts := p_semantic_counts_json::jsonb;
    v_chunks := p_chunks_json::jsonb;
  exception when others then
    raise exception 'portable scan JSON is invalid';
  end;
  if jsonb_typeof(v_counts) <> 'object' or jsonb_typeof(v_chunks) <> 'array' then
    raise exception 'portable scan JSON shape is invalid';
  end if;
  v_total_chunks := jsonb_array_length(v_chunks);
  if v_total_chunks < 1 or v_total_chunks > 256 then
    raise exception 'portable payload chunk count is invalid';
  end if;
  if coalesce((v_counts->>'validatedLedgers')::integer, -1) <> 1 then
    raise exception 'portable scan must contain one validated ledger';
  end if;

  select * into v_message
  from public.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.phase <> 'scan' then
    raise exception 'scan message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'successor_message_id', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = v_message.profile_id
  for update;
  if not found or v_stream.status <> 'active'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'portable phase stream is unavailable';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_message.profile_id
  for update;

  if found then
    v_previous_index := v_watermark.ledger_index;
    v_previous_hash := v_watermark.ledger_hash;
  else
    v_previous_index := v_stream.immutable_base_ledger_index;
    v_previous_hash := v_stream.immutable_base_ledger_hash;
  end if;

  if (v_message.payload->>'expectedPreviousLedgerIndex')::bigint <> v_previous_index
    or upper(v_message.payload->>'expectedPreviousLedgerHash') <> v_previous_hash then
    raise exception 'stale scan boundary';
  end if;
  if p_ledger_index <> v_previous_index + 1
    or upper(p_parent_hash) <> v_previous_hash then
    raise exception 'parent hash mismatch';
  end if;

  v_work_id := public.xrpl_phase_work_id(
    v_stream.network,
    v_stream.epoch_id,
    v_stream.base_identity,
    v_previous_index,
    v_previous_hash
  );
  v_plan_json := jsonb_build_object(
    'schemaVersion', 1,
    'workId', v_work_id,
    'network', v_stream.network,
    'epochId', v_stream.epoch_id,
    'baseIdentity', v_stream.base_identity,
    'previousLedgerIndex', v_previous_index,
    'expectedParentHash', v_previous_hash,
    'startLedgerIndex', p_ledger_index,
    'endLedgerIndex', p_ledger_index,
    'selectedLedgerCount', 1
  )::text;

  for v_chunk in select value from jsonb_array_elements(v_chunks)
  loop
    if jsonb_typeof(v_chunk) <> 'object' then
      raise exception 'portable payload chunk envelope is invalid';
    end if;
    v_chunk_index := (v_chunk->>'chunkIndex')::integer;
    v_record_count := (v_chunk->>'recordCount')::integer;
    v_chunk_digest := v_chunk->>'chunkDigest';
    v_encoded_digest := v_chunk->>'encodedDigest';
    v_chunk_payload_json := v_chunk->>'payloadJson';

    if v_chunk_index < 0 or v_chunk_index >= v_total_chunks
      or (v_chunk->>'totalChunks')::integer <> v_total_chunks
      or v_record_count < 1 or v_record_count > 40
      or v_chunk_digest !~ '^[a-f0-9]{64}$'
      or v_encoded_digest !~ '^[a-f0-9]{64}$'
      or v_chunk_payload_json is null then
      raise exception 'portable payload chunk identity is invalid';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_chunks) as duplicate
      where (duplicate->>'chunkIndex')::integer = v_chunk_index
      group by duplicate->>'chunkIndex'
      having count(*) > 1
    ) then
      raise exception 'portable payload chunk index is duplicated';
    end if;

    v_actual_encoded_digest := encode(
      digest(convert_to(v_chunk_payload_json, 'UTF8'), 'sha256'),
      'hex'
    );
    if v_actual_encoded_digest <> v_encoded_digest
      or octet_length(v_chunk_payload_json) > 512000 then
      raise exception 'portable payload encoded digest or size mismatch';
    end if;

    begin
      v_chunk_payload := v_chunk_payload_json::jsonb;
    exception when others then
      raise exception 'portable payload chunk JSON is invalid';
    end;
    if v_chunk_payload->>'schemaVersion' <> '1'
      or v_chunk_payload->>'workId' <> v_work_id
      or (v_chunk_payload->>'chunkIndex')::integer <> v_chunk_index
      or (v_chunk_payload->>'totalChunks')::integer <> v_total_chunks
      or v_chunk_payload->>'payloadDigest' <> concat('sha256:', p_payload_digest)
      or v_chunk_payload->>'chunkDigest' <> concat('sha256:', v_chunk_digest)
      or jsonb_typeof(v_chunk_payload->'records') <> 'array'
      or jsonb_array_length(v_chunk_payload->'records') <> v_record_count then
      raise exception 'portable payload chunk content identity mismatch';
    end if;
    v_total_records := v_total_records + v_record_count;
  end loop;

  if not exists (
    select 1
    from generate_series(0, v_total_chunks - 1) expected(index)
    where not exists (
      select 1
      from jsonb_array_elements(v_chunks) chunk
      where (chunk->>'chunkIndex')::integer = expected.index
    )
  ) then
    null;
  else
    raise exception 'portable payload chunks are not contiguous';
  end if;

  if coalesce((v_counts->>'totalRecords')::integer, -1) <> v_total_records then
    raise exception 'portable semantic count total mismatch';
  end if;

  insert into public.xrpl_phase_work (
    work_id, profile_id, network, epoch_id, base_identity,
    previous_ledger_index, start_ledger_index, expected_parent_hash,
    planned_end_ledger_index, scanned_end_ledger_index, final_ledger_hash,
    status, plan_json, semantic_counts_json, payload_digest,
    expected_payload_chunks, expected_commit_chunks, created_at, updated_at
  ) values (
    v_work_id, v_stream.profile_id, v_stream.network, v_stream.epoch_id,
    v_stream.base_identity, v_previous_index, p_ledger_index, v_previous_hash,
    p_ledger_index, p_ledger_index, upper(p_ledger_hash), 'staged', v_plan_json,
    p_semantic_counts_json, p_payload_digest, v_total_chunks, v_total_chunks,
    p_completed_at, p_completed_at
  )
  on conflict (work_id) do nothing;

  if not exists (
    select 1
    from public.xrpl_phase_work
    where work_id = v_work_id
      and profile_id = v_stream.profile_id
      and previous_ledger_index = v_previous_index
      and expected_parent_hash = v_previous_hash
      and scanned_end_ledger_index = p_ledger_index
      and final_ledger_hash = upper(p_ledger_hash)
      and payload_digest = p_payload_digest
      and semantic_counts_json = p_semantic_counts_json
      and expected_payload_chunks = v_total_chunks
      and expected_commit_chunks = v_total_chunks
      and status in ('staged', 'committing', 'finalizing', 'committed')
  ) then
    raise exception 'portable work identity conflict';
  end if;

  for v_chunk in select value from jsonb_array_elements(v_chunks)
  loop
    v_chunk_index := (v_chunk->>'chunkIndex')::integer;
    v_record_count := (v_chunk->>'recordCount')::integer;
    v_chunk_digest := v_chunk->>'chunkDigest';
    v_encoded_digest := v_chunk->>'encodedDigest';
    v_chunk_payload_json := v_chunk->>'payloadJson';

    insert into public.xrpl_phase_payload_chunks (
      work_id, chunk_index, encoding, payload_json, payload_digest,
      encoded_digest, byte_count, record_count, created_at
    ) values (
      v_work_id, v_chunk_index, 'normalized-payload-chunk-json-v1',
      v_chunk_payload_json, v_chunk_digest, v_encoded_digest,
      octet_length(v_chunk_payload_json), v_record_count, p_completed_at
    )
    on conflict (work_id, chunk_index) do nothing;

    if not exists (
      select 1
      from public.xrpl_phase_payload_chunks
      where work_id = v_work_id
        and chunk_index = v_chunk_index
        and encoding = 'normalized-payload-chunk-json-v1'
        and payload_json = v_chunk_payload_json
        and payload_digest = v_chunk_digest
        and encoded_digest = v_encoded_digest
        and byte_count = octet_length(v_chunk_payload_json)
        and record_count = v_record_count
    ) then
      raise exception 'portable payload chunk persistence conflict';
    end if;
  end loop;

  v_commit_id := public.xrpl_phase_commit_message_id(v_work_id, 0);
  v_commit_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'commit',
    'messageId', v_commit_id,
    'workId', v_work_id,
    'chunkIndex', 0
  );
  perform public.xrpl_phase_insert_message(
    v_stream.profile_id,
    'commit',
    v_commit_id,
    v_commit_payload,
    p_completed_at,
    p_completed_at
  );
  perform public.xrpl_phase_reserve_successor(
    p_message_id,
    v_commit_id,
    p_completed_at
  );

  update public.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'staged',
      'workId', v_work_id,
      'startLedgerIndex', p_ledger_index,
      'endLedgerIndex', p_ledger_index,
      'payloadDigest', concat('sha256:', p_payload_digest),
      'payloadChunks', v_total_chunks,
      'semanticCounts', v_counts
    ),
    successor_message_id = v_commit_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'work_id', v_work_id,
    'payload_chunks', v_total_chunks,
    'total_records', v_total_records,
    'successor_message_id', v_commit_id
  );
end;
$$;

create or replace function public.xrpl_complete_portable_commit_phase(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz,
  p_reference_rows_json text,
  p_reference_rows_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
  v_work public.xrpl_phase_work%rowtype;
  v_chunk public.xrpl_phase_payload_chunks%rowtype;
  v_chunk_payload jsonb;
  v_rows jsonb;
  v_row jsonb;
  v_payload_record jsonb;
  v_chunk_index integer;
  v_row_count integer;
  v_next_id text;
  v_next_payload jsonb;
  v_semantic_class text;
  v_canonical_key text;
  v_source_ledger_index bigint;
  v_source_ledger_hash text;
  v_source_transaction_hash text;
  v_object_id text;
  v_relationship_ids jsonb;
  v_value_json text;
  v_is_tombstone boolean;
  v_actual_rows_digest text;
begin
  if p_reference_rows_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid reference-row digest';
  end if;
  v_actual_rows_digest := encode(
    digest(convert_to(p_reference_rows_json, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_actual_rows_digest <> p_reference_rows_digest then
    raise exception 'reference-row digest mismatch';
  end if;
  begin
    v_rows := p_reference_rows_json::jsonb;
  exception when others then
    raise exception 'reference-row JSON is invalid';
  end;
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'reference-row JSON must be an array';
  end if;

  select * into v_message
  from public.xrpl_phase_messages
  where message_id = p_message_id
  for update;
  if not found or v_message.phase <> 'commit' then
    raise exception 'commit message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'successor_message_id', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  select * into v_work
  from public.xrpl_phase_work
  where work_id = v_message.payload->>'workId'
  for update;
  if not found
    or v_work.epoch_id <> 'supabase-r4c2c-v1'
    or v_work.status not in ('staged', 'committing') then
    raise exception 'portable work is not commit-ready';
  end if;

  v_chunk_index := (v_message.payload->>'chunkIndex')::integer;
  if v_chunk_index < 0 or v_chunk_index >= v_work.expected_payload_chunks then
    raise exception 'portable commit chunk index is invalid';
  end if;
  if exists (
    select 1
    from public.xrpl_phase_commit_chunks
    where work_id = v_work.work_id
      and chunk_index < v_chunk_index
      and status <> 'completed'
  ) or (
    v_chunk_index > 0 and not exists (
      select 1
      from public.xrpl_phase_commit_chunks
      where work_id = v_work.work_id
        and chunk_index = v_chunk_index - 1
        and status = 'completed'
    )
  ) then
    raise exception 'portable commit chunks are out of order';
  end if;

  select * into v_chunk
  from public.xrpl_phase_payload_chunks
  where work_id = v_work.work_id
    and chunk_index = v_chunk_index
  for update;
  if not found or v_chunk.encoded_digest is null then
    raise exception 'portable payload chunk is unavailable';
  end if;
  if encode(digest(convert_to(v_chunk.payload_json, 'UTF8'), 'sha256'), 'hex')
      <> v_chunk.encoded_digest then
    raise exception 'portable payload encoded digest mismatch';
  end if;
  begin
    v_chunk_payload := v_chunk.payload_json::jsonb;
  exception when others then
    raise exception 'portable payload chunk JSON is invalid';
  end;
  if v_chunk_payload->>'workId' <> v_work.work_id
    or (v_chunk_payload->>'chunkIndex')::integer <> v_chunk_index
    or (v_chunk_payload->>'totalChunks')::integer <> v_work.expected_payload_chunks
    or v_chunk_payload->>'payloadDigest' <> concat('sha256:', v_work.payload_digest)
    or v_chunk_payload->>'chunkDigest' <> concat('sha256:', v_chunk.payload_digest)
    or jsonb_typeof(v_chunk_payload->'records') <> 'array'
    or jsonb_array_length(v_chunk_payload->'records') <> v_chunk.record_count then
    raise exception 'portable payload chunk identity mismatch';
  end if;

  v_row_count := jsonb_array_length(v_rows);
  if v_row_count <> v_chunk.record_count then
    raise exception 'portable reference-row count mismatch';
  end if;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_semantic_class := v_row->>'semanticClass';
    v_canonical_key := v_row->>'canonicalKey';
    v_source_ledger_index := (v_row->>'sourceLedgerIndex')::bigint;
    v_source_ledger_hash := upper(v_row->>'sourceLedgerHash');
    v_source_transaction_hash := nullif(upper(v_row->>'sourceTransactionHash'), '');
    v_object_id := nullif(v_row->>'objectId', '');
    v_relationship_ids := v_row->'relationshipIds';
    v_value_json := case
      when v_row->'valueJson' = 'null'::jsonb then null
      else v_row->>'valueJson'
    end;
    v_is_tombstone := (v_row->>'isTombstone')::boolean;

    if v_semantic_class not in (
      'validated-ledger', 'protocol-event', 'object-change',
      'loan-lifecycle', 'archived-object', 'balance-history',
      'current-projection'
    ) or v_canonical_key is null or length(v_canonical_key) = 0
      or v_source_ledger_index <> v_work.scanned_end_ledger_index
      or v_source_ledger_hash <> v_work.final_ledger_hash
      or jsonb_typeof(v_relationship_ids) <> 'array' then
      raise exception 'portable reference-row identity is invalid';
    end if;
    if v_semantic_class = 'validated-ledger' then
      if v_source_transaction_hash is not null or v_object_id is not null
        or v_is_tombstone then
        raise exception 'validated-ledger identity is invalid';
      end if;
    else
      if v_source_transaction_hash is null
        or v_source_transaction_hash !~ '^[A-F0-9]{64}$' then
        raise exception 'portable transaction identity is invalid';
      end if;
    end if;
    if v_semantic_class in (
      'object-change', 'loan-lifecycle', 'archived-object', 'current-projection'
    ) and v_object_id is null then
      raise exception 'portable object identity is missing';
    end if;
    if v_semantic_class = 'current-projection' and v_is_tombstone
      and v_value_json is not null then
      raise exception 'current-projection tombstone must not contain a value';
    end if;
    if v_semantic_class <> 'current-projection' or not v_is_tombstone then
      if v_value_json is null then
        raise exception 'portable reference-row value is missing';
      end if;
      perform v_value_json::jsonb;
    end if;

    select payload_record into v_payload_record
    from jsonb_array_elements(v_chunk_payload->'records') payload_record
    where payload_record->>'semanticClass' = v_semantic_class
      and payload_record->>'canonicalKey' = v_canonical_key
    limit 1;
    if not found
      or (v_payload_record->>'sourceLedgerIndex')::bigint <> v_source_ledger_index
      or upper(v_payload_record->>'sourceLedgerHash') <> v_source_ledger_hash
      or coalesce(nullif(upper(v_payload_record->>'sourceTransactionHash'), ''), '')
          <> coalesce(v_source_transaction_hash, '')
      or coalesce(nullif(v_payload_record->>'objectId', ''), '')
          <> coalesce(v_object_id, '')
      or v_payload_record->'relationshipIds' <> v_relationship_ids
      or (v_payload_record->>'isTombstone')::boolean <> v_is_tombstone
      or (
        v_value_json is null and v_payload_record->'value' <> 'null'::jsonb
      )
      or (
        v_value_json is not null and v_payload_record->'value' <> v_value_json::jsonb
      ) then
      raise exception 'portable reference-row does not match payload chunk';
    end if;

    insert into public.xrpl_phase_reference_rows (
      work_id, semantic_class, canonical_key, source_ledger_index,
      source_ledger_hash, source_transaction_hash, object_id,
      relationship_ids, value_json, is_tombstone, created_at
    ) values (
      v_work.work_id, v_semantic_class, v_canonical_key,
      v_source_ledger_index, v_source_ledger_hash,
      v_source_transaction_hash, v_object_id, v_relationship_ids,
      v_value_json, v_is_tombstone, p_completed_at
    )
    on conflict (work_id, semantic_class, canonical_key) do nothing;

    if not exists (
      select 1
      from public.xrpl_phase_reference_rows
      where work_id = v_work.work_id
        and semantic_class = v_semantic_class
        and canonical_key = v_canonical_key
        and source_ledger_index = v_source_ledger_index
        and source_ledger_hash = v_source_ledger_hash
        and coalesce(source_transaction_hash, '') = coalesce(v_source_transaction_hash, '')
        and coalesce(object_id, '') = coalesce(v_object_id, '')
        and relationship_ids = v_relationship_ids
        and coalesce(value_json, '') = coalesce(v_value_json, '')
        and is_tombstone = v_is_tombstone
    ) then
      raise exception 'portable reference-row persistence conflict';
    end if;
  end loop;

  insert into public.xrpl_phase_commit_chunks (
    work_id, chunk_index, status, operation_count, row_mutation_count,
    chunk_digest, created_at, updated_at, completed_at
  ) values (
    v_work.work_id, v_chunk_index, 'completed', v_row_count, v_row_count,
    v_chunk.payload_digest, p_completed_at, p_completed_at, p_completed_at
  )
  on conflict (work_id, chunk_index) do nothing;

  if not exists (
    select 1
    from public.xrpl_phase_commit_chunks
    where work_id = v_work.work_id
      and chunk_index = v_chunk_index
      and status = 'completed'
      and operation_count = v_row_count
      and row_mutation_count = v_row_count
      and chunk_digest = v_chunk.payload_digest
  ) then
    raise exception 'portable commit evidence conflict';
  end if;

  update public.xrpl_phase_work
  set status = 'committing', updated_at = p_completed_at
  where work_id = v_work.work_id and status <> 'committed';

  if v_chunk_index + 1 < v_work.expected_commit_chunks then
    v_next_id := public.xrpl_phase_commit_message_id(v_work.work_id, v_chunk_index + 1);
    v_next_payload := jsonb_build_object(
      'schemaVersion', 1,
      'phase', 'commit',
      'messageId', v_next_id,
      'workId', v_work.work_id,
      'chunkIndex', v_chunk_index + 1
    );
    perform public.xrpl_phase_insert_message(
      v_work.profile_id, 'commit', v_next_id, v_next_payload,
      p_completed_at, p_completed_at
    );
  else
    v_next_id := public.xrpl_phase_finalize_message_id(v_work.work_id);
    v_next_payload := jsonb_build_object(
      'schemaVersion', 1,
      'phase', 'finalize',
      'messageId', v_next_id,
      'workId', v_work.work_id
    );
    perform public.xrpl_phase_insert_message(
      v_work.profile_id, 'finalize', v_next_id, v_next_payload,
      p_completed_at, p_completed_at
    );
  end if;
  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_next_id, p_completed_at
  );

  update public.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'committing',
      'workId', v_work.work_id,
      'chunkIndex', v_chunk_index,
      'operationCount', v_row_count,
      'rowMutationCount', v_row_count,
      'chunkDigest', concat('sha256:', v_chunk.payload_digest)
    ),
    successor_message_id = v_next_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'work_id', v_work.work_id,
    'chunk_index', v_chunk_index,
    'row_count', v_row_count,
    'successor_message_id', v_next_id
  );
end;
$$;

create or replace function public.xrpl_complete_portable_finalize_phase(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
  v_work public.xrpl_phase_work%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_current_watermark public.xrpl_phase_watermarks%rowtype;
  v_next_scan_id text;
  v_next_scan_payload jsonb;
  v_expected_rows integer;
begin
  select * into v_message
  from public.xrpl_phase_messages
  where message_id = p_message_id
  for update;
  if not found or v_message.phase <> 'finalize' then
    raise exception 'finalize message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'successor_message_id', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  select * into v_work
  from public.xrpl_phase_work
  where work_id = v_message.payload->>'workId'
  for update;
  if not found
    or v_work.epoch_id <> 'supabase-r4c2c-v1'
    or v_work.status not in ('committing', 'finalizing') then
    raise exception 'portable work is not finalize-ready';
  end if;

  if (
    select count(*)
    from public.xrpl_phase_commit_chunks
    where work_id = v_work.work_id and status = 'completed'
  ) <> v_work.expected_commit_chunks then
    raise exception 'portable commit evidence is incomplete';
  end if;
  if (
    select count(*)
    from public.xrpl_phase_payload_chunks
    where work_id = v_work.work_id
      and encoded_digest is not null
  ) <> v_work.expected_payload_chunks then
    raise exception 'portable payload evidence is incomplete';
  end if;
  v_expected_rows := (v_work.semantic_counts_json::jsonb->>'totalRecords')::integer;
  if (
    select count(*)
    from public.xrpl_phase_reference_rows
    where work_id = v_work.work_id
  ) <> v_expected_rows then
    raise exception 'portable reference-row evidence is incomplete';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = v_work.profile_id
  for update;
  if not found or v_stream.status <> 'active'
    or v_stream.epoch_id <> v_work.epoch_id
    or v_stream.base_identity <> v_work.base_identity then
    raise exception 'portable phase stream is unavailable';
  end if;

  select * into v_current_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_work.profile_id
  for update;
  if found then
    if v_current_watermark.ledger_index = v_work.scanned_end_ledger_index
      and v_current_watermark.ledger_hash = v_work.final_ledger_hash
      and v_current_watermark.work_id = v_work.work_id then
      null;
    elsif v_current_watermark.ledger_index <> v_work.previous_ledger_index
      or v_current_watermark.ledger_hash <> v_work.expected_parent_hash then
      raise exception 'portable finalize watermark conflict';
    end if;
  elsif v_stream.immutable_base_ledger_index <> v_work.previous_ledger_index
    or v_stream.immutable_base_ledger_hash <> v_work.expected_parent_hash then
    raise exception 'portable finalize base conflict';
  end if;

  update public.xrpl_phase_work
  set status = 'finalizing', updated_at = p_completed_at
  where work_id = v_work.work_id and status <> 'committed';

  insert into public.xrpl_phase_watermarks (
    profile_id, network, epoch_id, base_identity, ledger_index,
    ledger_hash, work_id, updated_at
  ) values (
    v_work.profile_id, v_work.network, v_work.epoch_id, v_work.base_identity,
    v_work.scanned_end_ledger_index, v_work.final_ledger_hash,
    v_work.work_id, p_completed_at
  )
  on conflict (profile_id) do update set
    network = excluded.network,
    epoch_id = excluded.epoch_id,
    base_identity = excluded.base_identity,
    ledger_index = excluded.ledger_index,
    ledger_hash = excluded.ledger_hash,
    work_id = excluded.work_id,
    updated_at = excluded.updated_at;

  update public.xrpl_phase_work
  set status = 'committed',
      committed_at = coalesce(committed_at, p_completed_at),
      updated_at = p_completed_at
  where work_id = v_work.work_id;

  v_next_scan_id := public.xrpl_phase_scan_message_id(
    v_work.network,
    v_work.epoch_id,
    v_work.base_identity,
    v_work.scanned_end_ledger_index,
    v_work.final_ledger_hash,
    0
  );
  v_next_scan_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'scan',
    'messageId', v_next_scan_id,
    'network', v_work.network,
    'epochId', v_work.epoch_id,
    'baseIdentity', v_work.base_identity,
    'expectedPreviousLedgerIndex', v_work.scanned_end_ledger_index,
    'expectedPreviousLedgerHash', v_work.final_ledger_hash,
    'scanSequence', 0
  );
  perform public.xrpl_phase_insert_message(
    v_work.profile_id,
    'scan',
    v_next_scan_id,
    v_next_scan_payload,
    p_completed_at,
    p_completed_at
  );
  perform public.xrpl_phase_reserve_successor(
    p_message_id,
    v_next_scan_id,
    p_completed_at
  );

  update public.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'committed',
      'workId', v_work.work_id,
      'ledgerIndex', v_work.scanned_end_ledger_index,
      'ledgerHash', v_work.final_ledger_hash,
      'semanticCounts', v_work.semantic_counts_json::jsonb
    ),
    successor_message_id = v_next_scan_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'work_id', v_work.work_id,
    'ledger_index', v_work.scanned_end_ledger_index,
    'ledger_hash', v_work.final_ledger_hash,
    'semantic_counts', v_work.semantic_counts_json::jsonb,
    'successor_message_id', v_next_scan_id
  );
end;
$$;

revoke all on function public.xrpl_complete_portable_scan_phase(
  text, text, timestamptz, bigint, text, text, text, text, text
) from public;
revoke all on function public.xrpl_complete_portable_commit_phase(
  text, text, timestamptz, text, text
) from public;
revoke all on function public.xrpl_complete_portable_finalize_phase(
  text, text, timestamptz
) from public;

grant execute on function public.xrpl_complete_portable_scan_phase(
  text, text, timestamptz, bigint, text, text, text, text, text
) to service_role;
grant execute on function public.xrpl_complete_portable_commit_phase(
  text, text, timestamptz, text, text
) to service_role;
grant execute on function public.xrpl_complete_portable_finalize_phase(
  text, text, timestamptz
) to service_role;

do $$
declare
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_base_index bigint;
  v_base_hash text;
  v_base_identity text;
  v_message_id text;
  v_payload jsonb;
begin
  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet'
  for update;
  if not found then
    raise exception 'R4C2b phase stream is unavailable';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet'
  for update;
  if found then
    v_base_index := v_watermark.ledger_index;
    v_base_hash := v_watermark.ledger_hash;
  else
    v_base_index := v_stream.immutable_base_ledger_index;
    v_base_hash := v_stream.immutable_base_ledger_hash;
  end if;

  update public.xrpl_phase_messages
  set
    status = 'error',
    lease_owner = null,
    lease_expires_at = null,
    error_classification = 'superseded_epoch',
    error_message = 'R4C2b message superseded by the R4C2c seven-class epoch',
    updated_at = now()
  where profile_id = 'supabase-devnet'
    and status in ('pending', 'leased', 'retry');

  delete from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
    and status <> 'committed';
  delete from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  v_base_identity := concat(
    'seven-class-base-', v_base_index::text, '-', v_base_hash
  );
  update public.xrpl_phase_streams
  set
    epoch_id = 'supabase-r4c2c-v1',
    base_identity = v_base_identity,
    immutable_base_ledger_index = v_base_index,
    immutable_base_ledger_hash = v_base_hash,
    status = 'active',
    last_error_classification = null,
    last_error_message = null,
    updated_at = now()
  where profile_id = 'supabase-devnet';

  v_message_id := public.xrpl_phase_scan_message_id(
    'devnet',
    'supabase-r4c2c-v1',
    v_base_identity,
    v_base_index,
    v_base_hash,
    0
  );
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'scan',
    'messageId', v_message_id,
    'network', 'devnet',
    'epochId', 'supabase-r4c2c-v1',
    'baseIdentity', v_base_identity,
    'expectedPreviousLedgerIndex', v_base_index,
    'expectedPreviousLedgerHash', v_base_hash,
    'scanSequence', 0
  );
  perform public.xrpl_phase_insert_message(
    'supabase-devnet',
    'scan',
    v_message_id,
    v_payload,
    now(),
    now()
  );
end;
$$;
