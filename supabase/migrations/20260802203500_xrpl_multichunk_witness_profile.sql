create or replace function public.xrpl_ensure_multichunk_witness_profile(
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet-multichunk-witness';
  v_epoch_id constant text := 'supabase-r4c2c-v1';
  v_base_identity constant text := 'multichunk-witness-2776760';
  v_base_ledger_index constant bigint := 2776759;
  v_base_ledger_hash constant text := 'E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628';
  v_target_ledger_index constant bigint := 2776760;
  v_target_ledger_hash constant text := '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D';
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_message_id text;
  v_payload jsonb;
begin
  insert into public.xrpl_phase_streams (
    profile_id,
    schema_version,
    network,
    epoch_id,
    base_identity,
    immutable_base_ledger_index,
    immutable_base_ledger_hash,
    status,
    created_at,
    updated_at
  ) values (
    v_profile_id,
    1,
    'devnet',
    v_epoch_id,
    v_base_identity,
    v_base_ledger_index,
    v_base_ledger_hash,
    'active',
    p_now,
    p_now
  )
  on conflict (profile_id) do nothing;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = v_profile_id
  for update;

  if not found
    or v_stream.schema_version <> 1
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> v_epoch_id
    or v_stream.base_identity <> v_base_identity
    or v_stream.immutable_base_ledger_index <> v_base_ledger_index
    or v_stream.immutable_base_ledger_hash <> v_base_ledger_hash
    or v_stream.status <> 'active' then
    raise exception 'multi-chunk witness stream identity conflict';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_profile_id
  for update;

  if found then
    if v_watermark.network <> 'devnet'
      or v_watermark.epoch_id <> v_epoch_id
      or v_watermark.base_identity <> v_base_identity
      or v_watermark.ledger_index <> v_target_ledger_index
      or v_watermark.ledger_hash <> v_target_ledger_hash then
      raise exception 'multi-chunk witness watermark identity conflict';
    end if;
    return jsonb_build_object(
      'ready', true,
      'committed', true,
      'profile_id', v_profile_id,
      'watermark_work_id', v_watermark.work_id,
      'watermark_ledger_index', v_watermark.ledger_index,
      'watermark_ledger_hash', v_watermark.ledger_hash
    );
  end if;

  v_message_id := public.xrpl_phase_scan_message_id(
    'devnet',
    v_epoch_id,
    v_base_identity,
    v_base_ledger_index,
    v_base_ledger_hash,
    0
  );
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'scan',
    'messageId', v_message_id,
    'network', 'devnet',
    'epochId', v_epoch_id,
    'baseIdentity', v_base_identity,
    'expectedPreviousLedgerIndex', v_base_ledger_index,
    'expectedPreviousLedgerHash', v_base_ledger_hash,
    'scanSequence', 0
  );

  perform public.xrpl_phase_insert_message(
    v_profile_id,
    'scan',
    v_message_id,
    v_payload,
    p_now,
    p_now
  );

  return jsonb_build_object(
    'ready', true,
    'committed', false,
    'profile_id', v_profile_id,
    'message_id', v_message_id
  );
end;
$$;

create or replace function public.xrpl_claim_multichunk_witness_phase(
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer default 55
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activation jsonb;
  v_message public.xrpl_phase_messages%rowtype;
  v_previous_owner text;
  v_previous_expiry timestamptz;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200 then
    raise exception 'invalid multi-chunk witness owner';
  end if;
  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid multi-chunk witness lease duration';
  end if;

  v_activation := public.xrpl_ensure_multichunk_witness_profile(p_now);
  if coalesce((v_activation->>'committed')::boolean, false) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'already_committed',
      'activation', v_activation
    );
  end if;

  select * into v_message
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet-multichunk-witness'
    and (
      (status in ('pending', 'retry') and available_at <= p_now)
      or (status = 'leased' and lease_expires_at <= p_now)
    )
  order by available_at, created_at, message_id
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'no_ready_message',
      'activation', v_activation
    );
  end if;

  v_previous_owner := v_message.lease_owner;
  v_previous_expiry := v_message.lease_expires_at;

  update public.xrpl_phase_messages
  set
    status = 'leased',
    lease_owner = p_owner,
    lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1,
    updated_at = p_now
  where message_id = v_message.message_id
  returning * into v_message;

  return jsonb_build_object(
    'claimed', true,
    'reclaimed', v_previous_owner is not null,
    'previous_lease_owner', v_previous_owner,
    'previous_lease_expires_at', v_previous_expiry,
    'message_id', v_message.message_id,
    'phase', v_message.phase,
    'payload', v_message.payload,
    'attempt_count', v_message.attempt_count,
    'lease_expires_at', v_message.lease_expires_at,
    'activation', v_activation
  );
end;
$$;

create or replace function public.xrpl_read_multichunk_witness_page(
  p_kind text,
  p_semantic_class text default null,
  p_canonical_key text default null,
  p_start_ledger_index bigint default null,
  p_end_ledger_index bigint default null,
  p_relationship_id text default null,
  p_order text default 'asc',
  p_offset integer default 0,
  p_limit integer default 40,
  p_expected_epoch_id text default null,
  p_expected_base_identity text default null,
  p_expected_ledger_index bigint default null,
  p_expected_ledger_hash text default null,
  p_expected_work_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_work public.xrpl_phase_work%rowtype;
  v_fence jsonb;
  v_rows jsonb;
  v_has_more boolean;
  v_expected_count integer;
begin
  if p_kind not in ('fence', 'exact', 'semantic', 'ledger_range', 'relationship') then
    raise exception 'invalid_query: unknown read kind';
  end if;
  if p_order not in ('asc', 'desc') then
    raise exception 'invalid_query: unknown order';
  end if;
  if p_offset < 0 or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_query: offset or limit is outside the bounded reader envelope';
  end if;
  if p_semantic_class is not null and p_semantic_class not in (
    'validated-ledger',
    'protocol-event',
    'object-change',
    'loan-lifecycle',
    'archived-object',
    'balance-history',
    'current-projection'
  ) then
    raise exception 'invalid_query: unknown semantic class';
  end if;
  if p_kind = 'exact' and (
    p_semantic_class is null
    or p_canonical_key is null
    or btrim(p_canonical_key) = ''
    or p_offset <> 0
    or p_limit <> 1
  ) then
    raise exception 'invalid_query: exact lookup identity is incomplete';
  end if;
  if p_kind = 'semantic' and p_semantic_class is null then
    raise exception 'invalid_query: semantic lookup requires a class';
  end if;
  if p_kind = 'ledger_range' and (
    p_start_ledger_index is null
    or p_end_ledger_index is null
    or p_start_ledger_index < 0
    or p_end_ledger_index < p_start_ledger_index
  ) then
    raise exception 'invalid_query: ledger range is invalid';
  end if;
  if p_kind = 'relationship' and (
    p_relationship_id is null or btrim(p_relationship_id) = ''
  ) then
    raise exception 'invalid_query: relationship lookup requires an identity';
  end if;
  if p_kind = 'fence' and (
    p_semantic_class is not null
    or p_canonical_key is not null
    or p_start_ledger_index is not null
    or p_end_ledger_index is not null
    or p_relationship_id is not null
    or p_offset <> 0
  ) then
    raise exception 'invalid_query: fence lookup contains row filters';
  end if;

  v_expected_count :=
    (p_expected_epoch_id is not null)::integer
    + (p_expected_base_identity is not null)::integer
    + (p_expected_ledger_index is not null)::integer
    + (p_expected_ledger_hash is not null)::integer
    + (p_expected_work_id is not null)::integer;
  if v_expected_count not in (0, 5) then
    raise exception 'invalid_query: expected fence must be complete';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet-multichunk-witness'
  for share;
  if not found
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1'
    or v_stream.base_identity <> 'multichunk-witness-2776760'
    or v_stream.status <> 'active' then
    raise exception 'unavailable: multi-chunk witness stream is unavailable';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_stream.profile_id
  for share;
  if not found then
    raise exception 'unavailable: multi-chunk witness watermark is unavailable';
  end if;

  select * into v_work
  from public.xrpl_phase_work
  where work_id = v_watermark.work_id
  for share;
  if not found
    or v_watermark.network <> v_stream.network
    or v_watermark.epoch_id <> v_stream.epoch_id
    or v_watermark.base_identity <> v_stream.base_identity
    or v_watermark.ledger_index <> 2776760
    or v_watermark.ledger_hash <> '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D'
    or v_work.profile_id <> v_stream.profile_id
    or v_work.network <> v_stream.network
    or v_work.epoch_id <> v_stream.epoch_id
    or v_work.base_identity <> v_stream.base_identity
    or v_work.status <> 'committed'
    or v_work.committed_at is null
    or v_work.scanned_end_ledger_index <> v_watermark.ledger_index
    or v_work.final_ledger_hash <> v_watermark.ledger_hash
    or v_work.expected_payload_chunks <> 3
    or v_work.expected_commit_chunks <> 3 then
    raise exception 'integrity_failure: multi-chunk witness watermark does not match its work';
  end if;

  if v_expected_count = 5 and (
    p_expected_epoch_id <> v_watermark.epoch_id
    or p_expected_base_identity <> v_watermark.base_identity
    or p_expected_ledger_index <> v_watermark.ledger_index
    or upper(p_expected_ledger_hash) <> v_watermark.ledger_hash
    or p_expected_work_id <> v_watermark.work_id
  ) then
    raise exception 'stale_cursor: multi-chunk witness read fence changed';
  end if;

  v_fence := jsonb_build_object(
    'schemaVersion', 1,
    'network', v_watermark.network,
    'epochId', v_watermark.epoch_id,
    'baseIdentity', v_watermark.base_identity,
    'ledgerIndex', v_watermark.ledger_index,
    'ledgerHash', v_watermark.ledger_hash,
    'workId', v_watermark.work_id
  );

  if p_kind = 'fence' then
    return jsonb_build_object(
      'schemaVersion', 1,
      'fence', v_fence,
      'rows', '[]'::jsonb,
      'hasMore', false
    );
  end if;

  if p_order = 'asc' then
    with selected as (
      select
        rows.work_id,
        rows.semantic_class,
        rows.canonical_key,
        rows.source_ledger_index,
        rows.source_ledger_hash,
        rows.source_transaction_hash,
        rows.object_id,
        rows.relationship_ids,
        rows.value_json,
        rows.is_tombstone,
        rows.created_at
      from public.xrpl_phase_reference_rows as rows
      where rows.work_id = v_work.work_id
        and (p_semantic_class is null or rows.semantic_class = p_semantic_class)
        and (p_kind <> 'exact' or rows.canonical_key = p_canonical_key)
        and (
          p_kind <> 'ledger_range'
          or rows.source_ledger_index between p_start_ledger_index and p_end_ledger_index
        )
        and (
          p_kind <> 'relationship'
          or rows.relationship_ids ? p_relationship_id
        )
      order by
        rows.source_ledger_index asc,
        rows.semantic_class asc,
        rows.canonical_key asc,
        rows.work_id asc
      offset p_offset
      limit p_limit + 1
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'workId', work_id,
          'semanticClass', semantic_class,
          'canonicalKey', canonical_key,
          'sourceLedgerIndex', source_ledger_index,
          'sourceLedgerHash', source_ledger_hash,
          'sourceTransactionHash', source_transaction_hash,
          'objectId', object_id,
          'relationshipIds', relationship_ids,
          'valueJson', value_json,
          'isTombstone', is_tombstone,
          'createdAt', created_at
        ) order by source_ledger_index, semantic_class, canonical_key, work_id
      ),
      '[]'::jsonb
    ) into v_rows
    from selected;
  else
    with selected as (
      select
        rows.work_id,
        rows.semantic_class,
        rows.canonical_key,
        rows.source_ledger_index,
        rows.source_ledger_hash,
        rows.source_transaction_hash,
        rows.object_id,
        rows.relationship_ids,
        rows.value_json,
        rows.is_tombstone,
        rows.created_at
      from public.xrpl_phase_reference_rows as rows
      where rows.work_id = v_work.work_id
        and (p_semantic_class is null or rows.semantic_class = p_semantic_class)
        and (p_kind <> 'exact' or rows.canonical_key = p_canonical_key)
        and (
          p_kind <> 'ledger_range'
          or rows.source_ledger_index between p_start_ledger_index and p_end_ledger_index
        )
        and (
          p_kind <> 'relationship'
          or rows.relationship_ids ? p_relationship_id
        )
      order by
        rows.source_ledger_index desc,
        rows.semantic_class desc,
        rows.canonical_key desc,
        rows.work_id desc
      offset p_offset
      limit p_limit + 1
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'workId', work_id,
          'semanticClass', semantic_class,
          'canonicalKey', canonical_key,
          'sourceLedgerIndex', source_ledger_index,
          'sourceLedgerHash', source_ledger_hash,
          'sourceTransactionHash', source_transaction_hash,
          'objectId', object_id,
          'relationshipIds', relationship_ids,
          'valueJson', value_json,
          'isTombstone', is_tombstone,
          'createdAt', created_at
        ) order by source_ledger_index desc, semantic_class desc, canonical_key desc, work_id desc
      ),
      '[]'::jsonb
    ) into v_rows
    from selected;
  end if;

  v_has_more := jsonb_array_length(v_rows) > p_limit;
  if v_has_more then
    v_rows := v_rows - p_limit;
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'fence', v_fence,
    'rows', v_rows,
    'hasMore', v_has_more
  );
end;
$$;

revoke all on function public.xrpl_ensure_multichunk_witness_profile(timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_claim_multichunk_witness_phase(text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.xrpl_read_multichunk_witness_page(
  text, text, text, bigint, bigint, text, text, integer, integer,
  text, text, bigint, text, text
) from public, anon, authenticated;

grant execute on function public.xrpl_ensure_multichunk_witness_profile(timestamptz)
  to service_role;
grant execute on function public.xrpl_claim_multichunk_witness_phase(text, timestamptz, integer)
  to service_role;
grant execute on function public.xrpl_read_multichunk_witness_page(
  text, text, text, bigint, bigint, text, text, integer, integer,
  text, text, bigint, text, text
) to service_role;
