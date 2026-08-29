-- Current-first Supabase lane.
--
-- This migration creates a storage/runtime boundary for keeping the public
-- current-state overlay fresh without advancing the full-history phase
-- watermark. It is intentionally empty after migration: production activation
-- still requires an explicit prepare call and a separately deployed executor.
--
-- The lane persists only:
--   * one current watermark / lease row;
--   * the newest current-projection row per canonical object identity; and
--   * aggregate history-deferral metadata.
--
-- It does NOT write xrpl_phase_messages, xrpl_phase_successors,
-- xrpl_phase_payload_chunks, xrpl_phase_reference_rows, or
-- xrpl_phase_watermarks.

create schema if not exists xrpl_current_v1;
revoke all on schema xrpl_current_v1 from public, anon, authenticated;

grant usage on schema xrpl_current_v1 to service_role;

create table if not exists xrpl_current_v1.state (
  profile_id text primary key check (profile_id = 'supabase-current-devnet'),
  schema_version integer not null default 1 check (schema_version = 1),
  network text not null check (network = 'devnet'),
  epoch_id text not null,
  base_identity text not null,
  ledger_index bigint not null check (ledger_index > 0),
  ledger_hash text not null check (ledger_hash ~ '^[A-F0-9]{64}$'),
  history_complete_through_ledger bigint not null check (history_complete_through_ledger > 0),
  history_deferred_from_ledger bigint,
  history_deferred_through_ledger bigint,
  history_deferred_ledgers bigint not null default 0 check (history_deferred_ledgers >= 0),
  history_deferred_records bigint not null default 0 check (history_deferred_records >= 0),
  status text not null default 'active' check (status in ('active', 'halted')),
  lease_owner text,
  lease_expires_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error text,
  last_chain_digest text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint xrpl_current_state_lease_pair_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint xrpl_current_state_history_boundary_check check (
    history_complete_through_ledger <= ledger_index
    and (
      (history_deferred_from_ledger is null and history_deferred_through_ledger is null
        and history_deferred_ledgers = 0)
      or (
        history_deferred_from_ledger = history_complete_through_ledger + 1
        and history_deferred_through_ledger = ledger_index
        and history_deferred_ledgers = ledger_index - history_complete_through_ledger
      )
    )
  ),
  constraint xrpl_current_state_chain_digest_check check (
    last_chain_digest is null or last_chain_digest ~ '^[a-f0-9]{64}$'
  )
);

create table if not exists xrpl_current_v1.objects (
  profile_id text not null references xrpl_current_v1.state(profile_id) on delete cascade,
  canonical_key text not null,
  object_id text not null,
  relationship_ids jsonb not null default '[]'::jsonb,
  value_json text,
  is_tombstone boolean not null,
  source_ledger_index bigint not null check (source_ledger_index > 0),
  source_ledger_hash text not null check (source_ledger_hash ~ '^[A-F0-9]{64}$'),
  source_transaction_hash text not null check (source_transaction_hash ~ '^[A-F0-9]{64}$'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (profile_id, canonical_key),
  constraint xrpl_current_objects_key_check check (
    canonical_key like 'projection:%'
  ),
  constraint xrpl_current_objects_relationships_check check (
    jsonb_typeof(relationship_ids) = 'array'
  ),
  constraint xrpl_current_objects_value_check check (
    (is_tombstone and value_json is null)
    or (not is_tombstone and value_json is not null)
  )
);

create index if not exists xrpl_current_objects_source_idx
  on xrpl_current_v1.objects(profile_id, source_ledger_index, canonical_key);

create index if not exists xrpl_current_objects_relationships_idx
  on xrpl_current_v1.objects using gin(relationship_ids);

alter table xrpl_current_v1.state enable row level security;
alter table xrpl_current_v1.objects enable row level security;

revoke all on xrpl_current_v1.state from public, anon, authenticated;
revoke all on xrpl_current_v1.objects from public, anon, authenticated;
grant select, insert, update on xrpl_current_v1.state to service_role;
grant select, insert, update on xrpl_current_v1.objects to service_role;

create or replace function public.xrpl_prepare_current_first_lane(
  p_expected_epoch_id text,
  p_expected_base_identity text,
  p_expected_ledger_index bigint,
  p_expected_ledger_hash text,
  p_expected_work_id text,
  p_prepared_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_current_v1, pg_temp
as $$
declare
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_work public.xrpl_phase_work%rowtype;
  v_state xrpl_current_v1.state%rowtype;
begin
  if p_expected_epoch_id is null or btrim(p_expected_epoch_id) = ''
    or p_expected_base_identity is null or btrim(p_expected_base_identity) = ''
    or p_expected_ledger_index <= 0
    or upper(p_expected_ledger_hash) !~ '^[A-F0-9]{64}$'
    or p_expected_work_id is null or btrim(p_expected_work_id) = ''
    or p_prepared_at is null then
    raise exception 'current_first_prepare_invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-current-first-lane', 0));

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet'
  for share;
  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet'
  for share;
  select * into v_work
  from public.xrpl_phase_work
  where work_id = p_expected_work_id
  for share;

  if v_stream.profile_id is null
    or v_stream.status <> 'active'
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> p_expected_epoch_id
    or v_stream.base_identity <> p_expected_base_identity
    or v_watermark.profile_id is null
    or v_watermark.epoch_id <> p_expected_epoch_id
    or v_watermark.base_identity <> p_expected_base_identity
    or v_watermark.ledger_index <> p_expected_ledger_index
    or v_watermark.ledger_hash <> upper(p_expected_ledger_hash)
    or v_watermark.work_id <> p_expected_work_id
    or v_work.work_id is null
    or v_work.profile_id <> 'supabase-devnet'
    or v_work.status <> 'committed'
    or v_work.scanned_end_ledger_index <> p_expected_ledger_index
    or v_work.final_ledger_hash <> upper(p_expected_ledger_hash) then
    raise exception 'current_first_prepare_source_boundary_mismatch';
  end if;

  insert into xrpl_current_v1.state (
    profile_id, network, epoch_id, base_identity,
    ledger_index, ledger_hash, history_complete_through_ledger,
    created_at, updated_at
  ) values (
    'supabase-current-devnet', 'devnet', p_expected_epoch_id, p_expected_base_identity,
    p_expected_ledger_index, upper(p_expected_ledger_hash), p_expected_ledger_index,
    p_prepared_at, p_prepared_at
  )
  on conflict (profile_id) do nothing;

  select * into v_state
  from xrpl_current_v1.state
  where profile_id = 'supabase-current-devnet'
  for update;

  if v_state.network <> 'devnet'
    or v_state.epoch_id <> p_expected_epoch_id
    or v_state.base_identity <> p_expected_base_identity
    or v_state.ledger_index <> p_expected_ledger_index
    or v_state.ledger_hash <> upper(p_expected_ledger_hash)
    or v_state.history_complete_through_ledger <> p_expected_ledger_index
    or v_state.history_deferred_from_ledger is not null
    or v_state.history_deferred_through_ledger is not null
    or v_state.history_deferred_ledgers <> 0
    or v_state.history_deferred_records <> 0
    or v_state.status <> 'active'
    or v_state.lease_owner is not null
    or v_state.lease_expires_at is not null then
    raise exception 'current_first_prepare_identity_conflict';
  end if;

  return jsonb_build_object(
    'prepared', true,
    'profileId', v_state.profile_id,
    'network', v_state.network,
    'epochId', v_state.epoch_id,
    'baseIdentity', v_state.base_identity,
    'ledgerIndex', v_state.ledger_index,
    'ledgerHash', v_state.ledger_hash,
    'historyCompleteThroughLedger', v_state.history_complete_through_ledger,
    'historyDeferred', false
  );
end;
$$;

create or replace function public.xrpl_claim_current_first_lane(
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_current_v1, pg_temp
as $$
declare
  v_state xrpl_current_v1.state%rowtype;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_now is null
    or p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'current_first_claim_invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-current-first-lane', 0));
  select * into v_state
  from xrpl_current_v1.state
  where profile_id = 'supabase-current-devnet'
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'not_prepared');
  end if;
  if v_state.status <> 'active' then
    return jsonb_build_object('claimed', false, 'reason', 'halted');
  end if;
  if v_state.lease_owner is not null
    and v_state.lease_expires_at is not null
    and v_state.lease_expires_at > p_now then
    return jsonb_build_object('claimed', false, 'reason', 'leased');
  end if;

  update xrpl_current_v1.state
  set lease_owner = p_owner,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      updated_at = p_now
  where profile_id = 'supabase-current-devnet'
  returning * into v_state;

  return jsonb_build_object(
    'claimed', true,
    'profileId', v_state.profile_id,
    'network', v_state.network,
    'epochId', v_state.epoch_id,
    'baseIdentity', v_state.base_identity,
    'ledgerIndex', v_state.ledger_index,
    'ledgerHash', v_state.ledger_hash,
    'historyCompleteThroughLedger', v_state.history_complete_through_ledger,
    'historyDeferredFromLedger', v_state.history_deferred_from_ledger,
    'historyDeferredThroughLedger', v_state.history_deferred_through_ledger,
    'leaseOwner', v_state.lease_owner,
    'leaseExpiresAt', v_state.lease_expires_at
  );
end;
$$;

create or replace function public.xrpl_complete_current_first_lane(
  p_owner text,
  p_expected_previous_ledger bigint,
  p_expected_previous_hash text,
  p_ledgers_json text,
  p_current_rows_json text,
  p_deferred_history_records bigint,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_current_v1, extensions, pg_temp
as $$
declare
  v_state xrpl_current_v1.state%rowtype;
  v_ledgers jsonb;
  v_rows jsonb;
  v_ledger record;
  v_row record;
  v_ordinal integer;
  v_ledger_index bigint;
  v_ledger_hash text;
  v_parent_hash text;
  v_previous_hash text;
  v_final_ledger bigint;
  v_final_hash text;
  v_chain_digest text;
  v_canonical_key text;
  v_object_id text;
  v_relationship_ids jsonb;
  v_value_json text;
  v_is_tombstone boolean;
  v_source_ledger_index bigint;
  v_source_ledger_hash text;
  v_source_transaction_hash text;
  v_row_count integer := 0;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_expected_previous_ledger <= 0
    or upper(p_expected_previous_hash) !~ '^[A-F0-9]{64}$'
    or p_deferred_history_records < 0
    or p_completed_at is null then
    raise exception 'current_first_complete_invalid_input';
  end if;

  begin
    v_ledgers := p_ledgers_json::jsonb;
    v_rows := p_current_rows_json::jsonb;
  exception when others then
    raise exception 'current_first_complete_json_invalid';
  end;
  if jsonb_typeof(v_ledgers) <> 'array'
    or jsonb_array_length(v_ledgers) < 1
    or jsonb_array_length(v_ledgers) > 12
    or jsonb_typeof(v_rows) <> 'array'
    or jsonb_array_length(v_rows) > 480 then
    raise exception 'current_first_complete_shape_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-current-first-lane', 0));
  select * into v_state
  from xrpl_current_v1.state
  where profile_id = 'supabase-current-devnet'
  for update;

  if not found
    or v_state.status <> 'active'
    or v_state.lease_owner is distinct from p_owner
    or v_state.lease_expires_at is null
    or v_state.lease_expires_at <= p_completed_at
    or v_state.ledger_index <> p_expected_previous_ledger
    or v_state.ledger_hash <> upper(p_expected_previous_hash) then
    raise exception 'current_first_complete_lease_or_boundary_invalid';
  end if;

  v_previous_hash := v_state.ledger_hash;
  for v_ledger in
    select value, ordinality::integer as ordinal
    from jsonb_array_elements(v_ledgers) with ordinality
    order by ordinality
  loop
    v_ordinal := v_ledger.ordinal;
    if jsonb_typeof(v_ledger.value) <> 'object' then
      raise exception 'current_first_ledger_invalid_at_%', v_ordinal;
    end if;
    v_ledger_index := (v_ledger.value->>'ledgerIndex')::bigint;
    v_ledger_hash := upper(v_ledger.value->>'ledgerHash');
    v_parent_hash := upper(v_ledger.value->>'parentHash');
    if v_ledger_index <> p_expected_previous_ledger + v_ordinal
      or v_ledger_hash !~ '^[A-F0-9]{64}$'
      or v_parent_hash !~ '^[A-F0-9]{64}$'
      or v_parent_hash <> v_previous_hash then
      raise exception 'current_first_ledger_chain_invalid_at_%', v_ordinal;
    end if;
    v_previous_hash := v_ledger_hash;
    v_final_ledger := v_ledger_index;
    v_final_hash := v_ledger_hash;
  end loop;

  v_chain_digest := encode(
    digest(convert_to(v_ledgers::text, 'UTF8'), 'sha256'),
    'hex'
  );

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    if jsonb_typeof(v_row.value) <> 'object'
      or v_row.value->>'semanticClass' <> 'current-projection' then
      raise exception 'current_first_row_class_invalid';
    end if;

    v_canonical_key := v_row.value->>'canonicalKey';
    v_object_id := nullif(v_row.value->>'objectId', '');
    v_relationship_ids := coalesce(v_row.value->'relationshipIds', '[]'::jsonb);
    v_value_json := case
      when v_row.value->'valueJson' = 'null'::jsonb then null
      else v_row.value->>'valueJson'
    end;
    v_is_tombstone := (v_row.value->>'isTombstone')::boolean;
    v_source_ledger_index := (v_row.value->>'sourceLedgerIndex')::bigint;
    v_source_ledger_hash := upper(v_row.value->>'sourceLedgerHash');
    v_source_transaction_hash := upper(v_row.value->>'sourceTransactionHash');

    if v_canonical_key is null or v_canonical_key not like 'projection:%'
      or v_object_id is null
      or jsonb_typeof(v_relationship_ids) <> 'array'
      or v_source_ledger_index <= p_expected_previous_ledger
      or v_source_ledger_index > v_final_ledger
      or v_source_ledger_hash !~ '^[A-F0-9]{64}$'
      or v_source_transaction_hash !~ '^[A-F0-9]{64}$'
      or (v_is_tombstone and v_value_json is not null)
      or (not v_is_tombstone and v_value_json is null) then
      raise exception 'current_first_row_identity_invalid';
    end if;
    if v_value_json is not null then
      perform v_value_json::jsonb;
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(v_ledgers) ledger
      where (ledger->>'ledgerIndex')::bigint = v_source_ledger_index
        and upper(ledger->>'ledgerHash') = v_source_ledger_hash
    ) then
      raise exception 'current_first_row_ledger_witness_missing';
    end if;

    insert into xrpl_current_v1.objects (
      profile_id, canonical_key, object_id, relationship_ids,
      value_json, is_tombstone,
      source_ledger_index, source_ledger_hash, source_transaction_hash,
      created_at, updated_at
    ) values (
      'supabase-current-devnet', v_canonical_key, v_object_id, v_relationship_ids,
      v_value_json, v_is_tombstone,
      v_source_ledger_index, v_source_ledger_hash, v_source_transaction_hash,
      p_completed_at, p_completed_at
    )
    on conflict (profile_id, canonical_key) do update set
      object_id = excluded.object_id,
      relationship_ids = excluded.relationship_ids,
      value_json = excluded.value_json,
      is_tombstone = excluded.is_tombstone,
      source_ledger_index = excluded.source_ledger_index,
      source_ledger_hash = excluded.source_ledger_hash,
      source_transaction_hash = excluded.source_transaction_hash,
      updated_at = excluded.updated_at
    where excluded.source_ledger_index > xrpl_current_v1.objects.source_ledger_index;

    v_row_count := v_row_count + 1;
  end loop;

  update xrpl_current_v1.state
  set ledger_index = v_final_ledger,
      ledger_hash = v_final_hash,
      history_deferred_from_ledger = coalesce(
        history_deferred_from_ledger,
        history_complete_through_ledger + 1
      ),
      history_deferred_through_ledger = v_final_ledger,
      history_deferred_ledgers = v_final_ledger - history_complete_through_ledger,
      history_deferred_records = history_deferred_records + p_deferred_history_records,
      lease_owner = null,
      lease_expires_at = null,
      consecutive_failures = 0,
      last_error = null,
      last_chain_digest = v_chain_digest,
      updated_at = p_completed_at
  where profile_id = 'supabase-current-devnet'
  returning * into v_state;

  return jsonb_build_object(
    'completed', true,
    'profileId', v_state.profile_id,
    'ledgerIndex', v_state.ledger_index,
    'ledgerHash', v_state.ledger_hash,
    'currentRowsApplied', v_row_count,
    'chainDigest', v_chain_digest,
    'historyCompleteThroughLedger', v_state.history_complete_through_ledger,
    'historyDeferredFromLedger', v_state.history_deferred_from_ledger,
    'historyDeferredThroughLedger', v_state.history_deferred_through_ledger,
    'historyDeferredLedgers', v_state.history_deferred_ledgers,
    'historyDeferredRecords', v_state.history_deferred_records
  );
end;
$$;

create or replace function public.xrpl_fail_current_first_lane(
  p_owner text,
  p_error text,
  p_failed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_current_v1, pg_temp
as $$
declare
  v_state xrpl_current_v1.state%rowtype;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_error is null or btrim(p_error) = ''
    or p_failed_at is null then
    raise exception 'current_first_fail_invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-current-first-lane', 0));
  select * into v_state
  from xrpl_current_v1.state
  where profile_id = 'supabase-current-devnet'
  for update;
  if not found or v_state.lease_owner is distinct from p_owner then
    raise exception 'current_first_fail_lease_invalid';
  end if;

  update xrpl_current_v1.state
  set lease_owner = null,
      lease_expires_at = null,
      consecutive_failures = consecutive_failures + 1,
      last_error = left(p_error, 2000),
      updated_at = p_failed_at
  where profile_id = 'supabase-current-devnet'
  returning * into v_state;

  return jsonb_build_object(
    'failed', true,
    'ledgerIndex', v_state.ledger_index,
    'ledgerHash', v_state.ledger_hash,
    'consecutiveFailures', v_state.consecutive_failures
  );
end;
$$;

create or replace function public.xrpl_read_current_first_page(
  p_relationship_id text default null,
  p_offset integer default 0,
  p_limit integer default 50,
  p_expected_ledger_index bigint default null,
  p_expected_ledger_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_current_v1, pg_temp
as $$
declare
  v_state xrpl_current_v1.state%rowtype;
  v_rows jsonb;
  v_has_more boolean;
begin
  if p_offset < 0 or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_query: current-first pagination outside bounded envelope';
  end if;
  if (p_expected_ledger_index is null) <> (p_expected_ledger_hash is null) then
    raise exception 'invalid_query: current-first expected fence must be complete';
  end if;

  select * into v_state
  from xrpl_current_v1.state
  where profile_id = 'supabase-current-devnet';
  if not found or v_state.status <> 'active' then
    raise exception 'unavailable: current-first state unavailable';
  end if;
  if p_expected_ledger_index is not null and (
    p_expected_ledger_index <> v_state.ledger_index
    or upper(p_expected_ledger_hash) <> v_state.ledger_hash
  ) then
    raise exception 'stale_cursor: current-first fence advanced';
  end if;

  with selected as (
    select
      canonical_key, object_id, relationship_ids, value_json, is_tombstone,
      source_ledger_index, source_ledger_hash, source_transaction_hash, updated_at
    from xrpl_current_v1.objects
    where profile_id = 'supabase-current-devnet'
      and (p_relationship_id is null or relationship_ids ? p_relationship_id)
    order by canonical_key
    offset p_offset
    limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'semanticClass', 'current-projection',
    'canonicalKey', canonical_key,
    'objectId', object_id,
    'relationshipIds', relationship_ids,
    'valueJson', value_json,
    'isTombstone', is_tombstone,
    'sourceLedgerIndex', source_ledger_index,
    'sourceLedgerHash', source_ledger_hash,
    'sourceTransactionHash', source_transaction_hash,
    'updatedAt', updated_at
  ) order by canonical_key), '[]'::jsonb)
  into v_rows
  from selected;

  v_has_more := jsonb_array_length(v_rows) > p_limit;
  if v_has_more then
    v_rows := v_rows - p_limit;
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'fence', jsonb_build_object(
      'network', v_state.network,
      'epochId', v_state.epoch_id,
      'baseIdentity', v_state.base_identity,
      'ledgerIndex', v_state.ledger_index,
      'ledgerHash', v_state.ledger_hash
    ),
    'history', jsonb_build_object(
      'completeThroughLedger', v_state.history_complete_through_ledger,
      'deferredFromLedger', v_state.history_deferred_from_ledger,
      'deferredThroughLedger', v_state.history_deferred_through_ledger,
      'deferredLedgers', v_state.history_deferred_ledgers,
      'deferredRecords', v_state.history_deferred_records,
      'complete', v_state.history_deferred_ledgers = 0
    ),
    'rows', v_rows,
    'hasMore', v_has_more
  );
end;
$$;

revoke all on function public.xrpl_prepare_current_first_lane(
  text, text, bigint, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_claim_current_first_lane(
  text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.xrpl_complete_current_first_lane(
  text, bigint, text, text, text, bigint, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_fail_current_first_lane(
  text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_read_current_first_page(
  text, integer, integer, bigint, text
) from public, anon, authenticated;

grant execute on function public.xrpl_prepare_current_first_lane(
  text, text, bigint, text, text, timestamptz
) to service_role;
grant execute on function public.xrpl_claim_current_first_lane(
  text, timestamptz, integer
) to service_role;
grant execute on function public.xrpl_complete_current_first_lane(
  text, bigint, text, text, text, bigint, timestamptz
) to service_role;
grant execute on function public.xrpl_fail_current_first_lane(
  text, text, timestamptz
) to service_role;
grant execute on function public.xrpl_read_current_first_page(
  text, integer, integer, bigint, text
) to service_role;
