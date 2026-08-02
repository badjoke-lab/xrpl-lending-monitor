create index if not exists xrpl_phase_work_committed_reader_idx
  on public.xrpl_phase_work(
    profile_id,
    network,
    epoch_id,
    base_identity,
    status,
    scanned_end_ledger_index,
    work_id
  );

create or replace function public.xrpl_read_committed_page(
  p_kind text,
  p_semantic_class text default null,
  p_canonical_key text default null,
  p_start_ledger_index bigint default null,
  p_end_ledger_index bigint default null,
  p_relationship_id text default null,
  p_order text default 'asc',
  p_offset integer default 0,
  p_limit integer default 50,
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
  where profile_id = 'supabase-devnet'
  for share;
  if not found
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1'
    or v_stream.status <> 'active' then
    raise exception 'unavailable: committed reader stream is unavailable';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_stream.profile_id
  for share;
  if not found then
    raise exception 'unavailable: committed watermark is unavailable';
  end if;

  select * into v_work
  from public.xrpl_phase_work
  where work_id = v_watermark.work_id
  for share;
  if not found
    or v_watermark.network <> v_stream.network
    or v_watermark.epoch_id <> v_stream.epoch_id
    or v_watermark.base_identity <> v_stream.base_identity
    or v_watermark.ledger_index <= 0
    or v_watermark.ledger_hash !~ '^[A-F0-9]{64}$'
    or v_work.profile_id <> v_stream.profile_id
    or v_work.network <> v_stream.network
    or v_work.epoch_id <> v_stream.epoch_id
    or v_work.base_identity <> v_stream.base_identity
    or v_work.status <> 'committed'
    or v_work.committed_at is null
    or v_work.scanned_end_ledger_index <> v_watermark.ledger_index
    or v_work.final_ledger_hash <> v_watermark.ledger_hash then
    raise exception 'integrity_failure: committed watermark does not match its work';
  end if;

  if v_expected_count = 5 and (
    p_expected_epoch_id <> v_watermark.epoch_id
    or p_expected_base_identity <> v_watermark.base_identity
    or p_expected_ledger_index <> v_watermark.ledger_index
    or upper(p_expected_ledger_hash) <> v_watermark.ledger_hash
    or p_expected_work_id <> v_watermark.work_id
  ) then
    raise exception 'stale_cursor: committed read fence advanced';
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
      inner join public.xrpl_phase_work as work on work.work_id = rows.work_id
      where work.profile_id = v_stream.profile_id
        and work.network = v_stream.network
        and work.epoch_id = v_stream.epoch_id
        and work.base_identity = v_stream.base_identity
        and work.status = 'committed'
        and work.committed_at is not null
        and work.scanned_end_ledger_index <= v_watermark.ledger_index
        and rows.source_ledger_index between work.start_ledger_index and work.scanned_end_ledger_index
        and rows.source_ledger_index <= v_watermark.ledger_index
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
      inner join public.xrpl_phase_work as work on work.work_id = rows.work_id
      where work.profile_id = v_stream.profile_id
        and work.network = v_stream.network
        and work.epoch_id = v_stream.epoch_id
        and work.base_identity = v_stream.base_identity
        and work.status = 'committed'
        and work.committed_at is not null
        and work.scanned_end_ledger_index <= v_watermark.ledger_index
        and rows.source_ledger_index between work.start_ledger_index and work.scanned_end_ledger_index
        and rows.source_ledger_index <= v_watermark.ledger_index
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

revoke all on function public.xrpl_read_committed_page(
  text, text, text, bigint, bigint, text, text, integer, integer,
  text, text, bigint, text, text
) from public, anon, authenticated;

grant execute on function public.xrpl_read_committed_page(
  text, text, text, bigint, bigint, text, text, integer, integer,
  text, text, bigint, text, text
) to service_role;
