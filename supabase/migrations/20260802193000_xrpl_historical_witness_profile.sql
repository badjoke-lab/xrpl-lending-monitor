create table if not exists public.xrpl_historical_witness_sets (
  set_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null check (profile_id = 'supabase-devnet-historical-witness'),
  network text not null check (network = 'devnet'),
  epoch_id text not null check (epoch_id = 'supabase-r4c2c-historical-witness-v1'),
  base_identity text not null check (
    base_identity = 'historical-witness-2776760-2980845-3127240'
  ),
  fence_ledger_index bigint not null check (fence_ledger_index = 3127240),
  fence_ledger_hash text not null check (
    fence_ledger_hash = '6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3'
  ),
  work_id text not null unique,
  source_run_id bigint not null check (source_run_id = 30741004656),
  records_digest text not null check (records_digest ~ '^[a-f0-9]{64}$'),
  semantic_counts jsonb not null check (jsonb_typeof(semantic_counts) = 'object'),
  record_count integer not null check (record_count = 237),
  status text not null check (status in ('staging', 'committed')),
  created_at timestamptz not null,
  committed_at timestamptz,
  constraint xrpl_historical_witness_sets_committed_check check (
    (status = 'committed' and committed_at is not null)
    or (status = 'staging' and committed_at is null)
  )
);

create table if not exists public.xrpl_historical_witness_rows (
  set_id text not null references public.xrpl_historical_witness_sets(set_id) on delete cascade,
  semantic_class text not null check (
    semantic_class in (
      'validated-ledger',
      'protocol-event',
      'object-change',
      'loan-lifecycle',
      'archived-object',
      'balance-history',
      'current-projection'
    )
  ),
  canonical_key text not null,
  source_ledger_index bigint not null check (
    source_ledger_index in (2776760, 2980845, 3127240)
  ),
  source_ledger_hash text not null check (source_ledger_hash ~ '^[A-F0-9]{64}$'),
  source_transaction_hash text,
  object_id text,
  relationship_ids jsonb not null default '[]'::jsonb,
  value_json text,
  is_tombstone boolean not null,
  created_at timestamptz not null,
  primary key (set_id, semantic_class, canonical_key),
  constraint xrpl_historical_witness_tx_hash_check check (
    source_transaction_hash is null or source_transaction_hash ~ '^[A-F0-9]{64}$'
  ),
  constraint xrpl_historical_witness_relationships_check check (
    jsonb_typeof(relationship_ids) = 'array'
  )
);

create index if not exists xrpl_historical_witness_rows_order_idx
  on public.xrpl_historical_witness_rows(
    set_id,
    source_ledger_index,
    semantic_class,
    canonical_key
  );

create index if not exists xrpl_historical_witness_rows_relationship_idx
  on public.xrpl_historical_witness_rows using gin (relationship_ids);

alter table public.xrpl_historical_witness_sets enable row level security;
alter table public.xrpl_historical_witness_rows enable row level security;

revoke all on public.xrpl_historical_witness_sets from public, anon, authenticated;
revoke all on public.xrpl_historical_witness_rows from public, anon, authenticated;

grant select, insert, update on public.xrpl_historical_witness_sets to service_role;
grant select, insert on public.xrpl_historical_witness_rows to service_role;

create or replace function public.xrpl_commit_historical_witness(
  p_set_id text,
  p_records_json text,
  p_records_digest text,
  p_committed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_expected_set_id constant text := 'r4c2c-devnet-historical-witness-v1';
  v_work_id constant text := 'historical-witness-work-v1:2776760:2980845:3127240';
  v_counts constant jsonb := jsonb_build_object(
    'validated-ledger', 3,
    'protocol-event', 13,
    'object-change', 197,
    'loan-lifecycle', 3,
    'archived-object', 1,
    'balance-history', 2,
    'current-projection', 18
  );
  v_records jsonb;
  v_record jsonb;
  v_relationships jsonb;
  v_canonical_relationships jsonb;
  v_existing public.xrpl_historical_witness_sets%rowtype;
  v_semantic_class text;
  v_canonical_key text;
  v_source_ledger_index bigint;
  v_source_ledger_hash text;
  v_source_transaction_hash text;
  v_object_id text;
  v_value_json text;
  v_is_tombstone boolean;
  v_previous_ledger_index bigint := -1;
  v_previous_semantic_class text := '';
  v_previous_canonical_key text := '';
  v_validated integer := 0;
  v_protocol integer := 0;
  v_change integer := 0;
  v_lifecycle integer := 0;
  v_archive integer := 0;
  v_balance integer := 0;
  v_projection integer := 0;
  v_actual_digest text;
  v_inserted integer;
begin
  if p_set_id <> v_expected_set_id then
    raise exception 'invalid_witness: unexpected set identity';
  end if;
  if p_records_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_witness: records digest is invalid';
  end if;
  if p_committed_at is null then
    raise exception 'invalid_witness: committed time is required';
  end if;

  v_actual_digest := encode(
    digest(convert_to(p_records_json, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_actual_digest <> p_records_digest then
    raise exception 'invalid_witness: records digest mismatch';
  end if;

  begin
    v_records := p_records_json::jsonb;
  exception when others then
    raise exception 'invalid_witness: records JSON is invalid';
  end;
  if jsonb_typeof(v_records) <> 'array' or jsonb_array_length(v_records) <> 237 then
    raise exception 'invalid_witness: records array must contain exactly 237 rows';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_records) as item
    group by item->>'semanticClass', item->>'canonicalKey'
    having count(*) > 1
  ) then
    raise exception 'invalid_witness: duplicate semantic class and canonical key';
  end if;

  for v_record in select value from jsonb_array_elements(v_records)
  loop
    if jsonb_typeof(v_record) <> 'object' then
      raise exception 'invalid_witness: record is not an object';
    end if;
    v_semantic_class := v_record->>'semanticClass';
    v_canonical_key := v_record->>'canonicalKey';
    v_source_ledger_index := (v_record->>'sourceLedgerIndex')::bigint;
    v_source_ledger_hash := upper(v_record->>'sourceLedgerHash');
    v_source_transaction_hash := nullif(upper(v_record->>'sourceTransactionHash'), '');
    v_object_id := nullif(v_record->>'objectId', '');
    v_relationships := v_record->'relationshipIds';
    v_value_json := case
      when v_record->'valueJson' = 'null'::jsonb then null
      else v_record->>'valueJson'
    end;
    v_is_tombstone := (v_record->>'isTombstone')::boolean;

    if v_semantic_class not in (
      'validated-ledger',
      'protocol-event',
      'object-change',
      'loan-lifecycle',
      'archived-object',
      'balance-history',
      'current-projection'
    ) or v_canonical_key is null or btrim(v_canonical_key) = '' then
      raise exception 'invalid_witness: semantic identity is invalid';
    end if;
    if v_source_ledger_index = 2776760 and
      v_source_ledger_hash <> '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D' then
      raise exception 'invalid_witness: ledger 2776760 hash mismatch';
    elsif v_source_ledger_index = 2980845 and
      v_source_ledger_hash <> '5BA95992F3E649752BBA5550EEEF79DEB535881E10FF7C1D4F9EF953340B0C40' then
      raise exception 'invalid_witness: ledger 2980845 hash mismatch';
    elsif v_source_ledger_index = 3127240 and
      v_source_ledger_hash <> '6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3' then
      raise exception 'invalid_witness: ledger 3127240 hash mismatch';
    elsif v_source_ledger_index not in (2776760, 2980845, 3127240) then
      raise exception 'invalid_witness: source ledger is outside the fixed witness set';
    end if;
    if v_source_transaction_hash is not null and
      v_source_transaction_hash !~ '^[A-F0-9]{64}$' then
      raise exception 'invalid_witness: transaction hash is invalid';
    end if;
    if jsonb_typeof(v_relationships) <> 'array' or exists (
      select 1
      from jsonb_array_elements(v_relationships) as relationship(value)
      where jsonb_typeof(relationship.value) <> 'string'
        or btrim(relationship.value #>> '{}') = ''
    ) then
      raise exception 'invalid_witness: relationship array is invalid';
    end if;
    select coalesce(jsonb_agg(to_jsonb(value) order by value), '[]'::jsonb)
    into v_canonical_relationships
    from (
      select distinct value
      from jsonb_array_elements_text(v_relationships) as relationship(value)
    ) as canonical;
    if v_relationships <> v_canonical_relationships then
      raise exception 'invalid_witness: relationships are not sorted and unique';
    end if;
    if v_value_json is not null then
      begin
        perform v_value_json::jsonb;
      exception when others then
        raise exception 'invalid_witness: value JSON is invalid';
      end;
    end if;
    if v_semantic_class = 'current-projection' and v_is_tombstone and
      v_value_json is not null then
      raise exception 'invalid_witness: projection tombstone exposes a value';
    end if;

    if v_previous_ledger_index > v_source_ledger_index
      or (
        v_previous_ledger_index = v_source_ledger_index
        and v_previous_semantic_class > v_semantic_class
      )
      or (
        v_previous_ledger_index = v_source_ledger_index
        and v_previous_semantic_class = v_semantic_class
        and v_previous_canonical_key >= v_canonical_key
      ) then
      raise exception 'invalid_witness: records are not in canonical order';
    end if;
    v_previous_ledger_index := v_source_ledger_index;
    v_previous_semantic_class := v_semantic_class;
    v_previous_canonical_key := v_canonical_key;

    case v_semantic_class
      when 'validated-ledger' then v_validated := v_validated + 1;
      when 'protocol-event' then v_protocol := v_protocol + 1;
      when 'object-change' then v_change := v_change + 1;
      when 'loan-lifecycle' then v_lifecycle := v_lifecycle + 1;
      when 'archived-object' then v_archive := v_archive + 1;
      when 'balance-history' then v_balance := v_balance + 1;
      when 'current-projection' then v_projection := v_projection + 1;
    end case;
  end loop;

  if jsonb_build_object(
    'validated-ledger', v_validated,
    'protocol-event', v_protocol,
    'object-change', v_change,
    'loan-lifecycle', v_lifecycle,
    'archived-object', v_archive,
    'balance-history', v_balance,
    'current-projection', v_projection
  ) <> v_counts then
    raise exception 'invalid_witness: semantic counts do not match the fixed evidence';
  end if;

  select * into v_existing
  from public.xrpl_historical_witness_sets
  where set_id = p_set_id
  for update;
  if found then
    if v_existing.status = 'committed'
      and v_existing.records_digest = p_records_digest
      and v_existing.record_count = 237
      and v_existing.semantic_counts = v_counts then
      return jsonb_build_object(
        'committed', true,
        'duplicate', true,
        'setId', p_set_id,
        'workId', v_existing.work_id,
        'recordCount', v_existing.record_count,
        'semanticCounts', v_existing.semantic_counts
      );
    end if;
    raise exception 'integrity_failure: historical witness set conflicts with retained state';
  end if;

  insert into public.xrpl_historical_witness_sets (
    set_id,
    profile_id,
    network,
    epoch_id,
    base_identity,
    fence_ledger_index,
    fence_ledger_hash,
    work_id,
    source_run_id,
    records_digest,
    semantic_counts,
    record_count,
    status,
    created_at,
    committed_at
  ) values (
    p_set_id,
    'supabase-devnet-historical-witness',
    'devnet',
    'supabase-r4c2c-historical-witness-v1',
    'historical-witness-2776760-2980845-3127240',
    3127240,
    '6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3',
    v_work_id,
    30741004656,
    p_records_digest,
    v_counts,
    237,
    'staging',
    p_committed_at,
    null
  );

  for v_record in select value from jsonb_array_elements(v_records)
  loop
    insert into public.xrpl_historical_witness_rows (
      set_id,
      semantic_class,
      canonical_key,
      source_ledger_index,
      source_ledger_hash,
      source_transaction_hash,
      object_id,
      relationship_ids,
      value_json,
      is_tombstone,
      created_at
    ) values (
      p_set_id,
      v_record->>'semanticClass',
      v_record->>'canonicalKey',
      (v_record->>'sourceLedgerIndex')::bigint,
      upper(v_record->>'sourceLedgerHash'),
      nullif(upper(v_record->>'sourceTransactionHash'), ''),
      nullif(v_record->>'objectId', ''),
      v_record->'relationshipIds',
      case when v_record->'valueJson' = 'null'::jsonb then null else v_record->>'valueJson' end,
      (v_record->>'isTombstone')::boolean,
      p_committed_at
    );
  end loop;

  select count(*) into v_inserted
  from public.xrpl_historical_witness_rows
  where set_id = p_set_id;
  if v_inserted <> 237 then
    raise exception 'integrity_failure: historical witness row count mismatch';
  end if;

  update public.xrpl_historical_witness_sets
  set status = 'committed', committed_at = p_committed_at
  where set_id = p_set_id and status = 'staging';
  if not found then
    raise exception 'integrity_failure: historical witness commit transition failed';
  end if;

  return jsonb_build_object(
    'committed', true,
    'duplicate', false,
    'setId', p_set_id,
    'workId', v_work_id,
    'recordCount', 237,
    'semanticCounts', v_counts,
    'fence', jsonb_build_object(
      'schemaVersion', 1,
      'network', 'devnet',
      'epochId', 'supabase-r4c2c-historical-witness-v1',
      'baseIdentity', 'historical-witness-2776760-2980845-3127240',
      'ledgerIndex', 3127240,
      'ledgerHash', '6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3',
      'workId', v_work_id
    )
  );
end;
$$;

create or replace function public.xrpl_read_historical_witness_page(
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
  v_set public.xrpl_historical_witness_sets%rowtype;
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
    case when p_expected_epoch_id is null then 0 else 1 end
    + case when p_expected_base_identity is null then 0 else 1 end
    + case when p_expected_ledger_index is null then 0 else 1 end
    + case when p_expected_ledger_hash is null then 0 else 1 end
    + case when p_expected_work_id is null then 0 else 1 end;
  if v_expected_count not in (0, 5) then
    raise exception 'invalid_query: expected fence must be complete';
  end if;

  select * into v_set
  from public.xrpl_historical_witness_sets
  where set_id = 'r4c2c-devnet-historical-witness-v1'
  for share;
  if not found
    or v_set.status <> 'committed'
    or v_set.committed_at is null
    or v_set.profile_id <> 'supabase-devnet-historical-witness'
    or v_set.network <> 'devnet'
    or v_set.epoch_id <> 'supabase-r4c2c-historical-witness-v1'
    or v_set.base_identity <> 'historical-witness-2776760-2980845-3127240'
    or v_set.fence_ledger_index <> 3127240
    or v_set.fence_ledger_hash <> '6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3'
    or v_set.record_count <> 237 then
    raise exception 'unavailable: historical witness set is unavailable';
  end if;

  if (select count(*) from public.xrpl_historical_witness_rows where set_id = v_set.set_id) <> 237 then
    raise exception 'integrity_failure: historical witness row count does not match its set';
  end if;

  if v_expected_count = 5 and (
    p_expected_epoch_id <> v_set.epoch_id
    or p_expected_base_identity <> v_set.base_identity
    or p_expected_ledger_index <> v_set.fence_ledger_index
    or upper(p_expected_ledger_hash) <> v_set.fence_ledger_hash
    or p_expected_work_id <> v_set.work_id
  ) then
    raise exception 'stale_cursor: historical witness fence changed';
  end if;

  v_fence := jsonb_build_object(
    'schemaVersion', 1,
    'network', v_set.network,
    'epochId', v_set.epoch_id,
    'baseIdentity', v_set.base_identity,
    'ledgerIndex', v_set.fence_ledger_index,
    'ledgerHash', v_set.fence_ledger_hash,
    'workId', v_set.work_id
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
        v_set.work_id as work_id,
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
      from public.xrpl_historical_witness_rows as rows
      where rows.set_id = v_set.set_id
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
      order by rows.source_ledger_index, rows.semantic_class, rows.canonical_key
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
        v_set.work_id as work_id,
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
      from public.xrpl_historical_witness_rows as rows
      where rows.set_id = v_set.set_id
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
      order by rows.source_ledger_index desc, rows.semantic_class desc, rows.canonical_key desc
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

revoke all on function public.xrpl_commit_historical_witness(
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_read_historical_witness_page(
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text,
  integer,
  integer,
  text,
  text,
  bigint,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.xrpl_commit_historical_witness(
  text,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function public.xrpl_read_historical_witness_page(
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text,
  integer,
  integer,
  text,
  text,
  bigint,
  text,
  text
) to service_role;
