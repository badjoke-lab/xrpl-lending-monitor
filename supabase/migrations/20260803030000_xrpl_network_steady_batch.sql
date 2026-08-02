create schema if not exists xrpl_steady_v1;

create table if not exists xrpl_steady_v1.sessions (
  session_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  source_profile_id text not null check (source_profile_id = 'supabase-devnet'),
  target_profile_id text not null check (target_profile_id = 'supabase-devnet-steady-qualification'),
  network text not null check (network = 'devnet'),
  epoch_id text not null check (epoch_id = 'supabase-r4c2c-v1'),
  base_identity text not null,
  status text not null check (status in ('running', 'completed', 'halted')),
  target_ticks integer not null check (target_ticks = 6),
  batch_size integer not null check (batch_size = 24),
  completed_ticks integer not null default 0 check (completed_ticks between 0 and 6),
  committed_ledgers integer not null default 0 check (committed_ledgers between 0 and 144),
  anchor_ledger_index bigint not null,
  anchor_ledger_hash text not null check (anchor_ledger_hash ~ '^[A-F0-9]{64}$'),
  anchor_work_id text not null,
  anchor_epoch_id text not null,
  anchor_base_identity text not null,
  watermark_ledger_index bigint not null,
  watermark_ledger_hash text not null check (watermark_ledger_hash ~ '^[A-F0-9]{64}$'),
  watermark_work_id text not null,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  prepared_at timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null,
  constraint xrpl_steady_session_lease_pair check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  )
);

create unique index if not exists xrpl_steady_one_running_session_idx
  on xrpl_steady_v1.sessions ((status))
  where status = 'running';

create table if not exists xrpl_steady_v1.ticks (
  session_id text not null references xrpl_steady_v1.sessions(session_id) on delete cascade,
  tick_id text not null,
  tick_sequence integer not null check (tick_sequence between 1 and 6),
  scheduled_minute timestamptz not null,
  status text not null check (status in ('leased', 'deferred', 'completed', 'error')),
  lease_owner text,
  lease_expires_at timestamptz,
  start_ledger_index bigint not null,
  end_ledger_index bigint not null,
  expected_parent_hash text not null check (expected_parent_hash ~ '^[A-F0-9]{64}$'),
  final_ledger_hash text,
  work_count integer,
  record_count integer,
  message_count integer,
  successor_count integer,
  works_digest text,
  rows_digest text,
  fetch_milliseconds numeric,
  normalize_milliseconds numeric,
  edge_wall_milliseconds numeric,
  database_milliseconds numeric,
  error_message text,
  claimed_at timestamptz not null,
  completed_at timestamptz,
  primary key (session_id, tick_id),
  unique (session_id, tick_sequence),
  unique (session_id, scheduled_minute),
  constraint xrpl_steady_tick_range check (end_ledger_index = start_ledger_index + 23),
  constraint xrpl_steady_tick_lease_pair check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  )
);

create table if not exists xrpl_steady_v1.works (
  session_id text not null references xrpl_steady_v1.sessions(session_id) on delete cascade,
  tick_sequence integer not null,
  ordinal integer not null check (ordinal between 1 and 24),
  work_id text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  expected_parent_hash text not null check (expected_parent_hash ~ '^[A-F0-9]{64}$'),
  scanned_end_ledger_index bigint not null,
  final_ledger_hash text not null check (final_ledger_hash ~ '^[A-F0-9]{64}$'),
  plan_json text not null,
  semantic_counts_json text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  expected_payload_chunks integer not null check (expected_payload_chunks > 0),
  expected_commit_chunks integer not null check (expected_commit_chunks > 0),
  status text not null check (status = 'committed'),
  committed_at timestamptz not null,
  primary key (session_id, work_id),
  unique (session_id, tick_sequence, ordinal)
);

create table if not exists xrpl_steady_v1.messages (
  session_id text not null references xrpl_steady_v1.sessions(session_id) on delete cascade,
  tick_sequence integer not null,
  message_id text not null,
  phase text not null check (phase in ('scan', 'commit', 'finalize')),
  work_id text,
  chunk_index integer,
  status text not null check (status in ('pending', 'completed', 'error')),
  attempt_count integer not null check (attempt_count in (0, 1)),
  payload jsonb not null,
  result jsonb,
  successor_message_id text,
  created_at timestamptz not null,
  completed_at timestamptz,
  primary key (session_id, message_id)
);

create table if not exists xrpl_steady_v1.successors (
  session_id text not null references xrpl_steady_v1.sessions(session_id) on delete cascade,
  current_message_id text not null,
  successor_message_id text not null,
  reserved_at timestamptz not null,
  primary key (session_id, current_message_id),
  unique (session_id, successor_message_id)
);

create table if not exists xrpl_steady_v1.payload_chunks (
  session_id text not null,
  work_id text not null,
  chunk_index integer not null,
  total_chunks integer not null,
  payload_json text not null,
  chunk_digest text not null check (chunk_digest ~ '^[a-f0-9]{64}$'),
  encoded_digest text not null check (encoded_digest ~ '^[a-f0-9]{64}$'),
  byte_count integer not null check (byte_count > 0),
  record_count integer not null check (record_count > 0),
  created_at timestamptz not null,
  primary key (session_id, work_id, chunk_index),
  foreign key (session_id, work_id) references xrpl_steady_v1.works(session_id, work_id) on delete cascade
);

create table if not exists xrpl_steady_v1.reference_rows (
  session_id text not null,
  work_id text not null,
  semantic_class text not null,
  canonical_key text not null,
  source_ledger_index bigint not null,
  source_ledger_hash text not null check (source_ledger_hash ~ '^[A-F0-9]{64}$'),
  source_transaction_hash text,
  object_id text,
  relationship_ids jsonb not null,
  value_json text,
  is_tombstone boolean not null,
  created_at timestamptz not null,
  primary key (session_id, work_id, semantic_class, canonical_key),
  foreign key (session_id, work_id) references xrpl_steady_v1.works(session_id, work_id) on delete cascade
);

create table if not exists xrpl_steady_v1.commit_chunks (
  session_id text not null,
  work_id text not null,
  chunk_index integer not null,
  operation_count integer not null check (operation_count >= 0),
  row_mutation_count integer not null check (row_mutation_count >= 0),
  chunk_digest text not null check (chunk_digest ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz not null,
  primary key (session_id, work_id, chunk_index),
  foreign key (session_id, work_id) references xrpl_steady_v1.works(session_id, work_id) on delete cascade
);

revoke all on schema xrpl_steady_v1 from public, anon, authenticated;
revoke all on all tables in schema xrpl_steady_v1 from public, anon, authenticated;

create or replace function public.xrpl_prepare_network_steady_session(
  p_session_id text,
  p_prepared_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
begin
  if p_session_id !~ '^[a-z0-9][a-z0-9-]{7,79}$' then
    raise exception 'invalid steady session id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-network-steady', 0));

  if exists (select 1 from xrpl_steady_v1.sessions where status = 'running') then
    raise exception 'another steady qualification session is already running';
  end if;
  if exists (select 1 from xrpl_steady_v1.sessions where session_id = p_session_id) then
    raise exception 'steady qualification session already exists';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'active Supabase Devnet stream is unavailable';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found then
    raise exception 'active Supabase Devnet watermark is unavailable';
  end if;

  insert into xrpl_steady_v1.sessions (
    session_id, source_profile_id, target_profile_id, network, epoch_id,
    base_identity, status, target_ticks, batch_size,
    anchor_ledger_index, anchor_ledger_hash, anchor_work_id,
    anchor_epoch_id, anchor_base_identity,
    watermark_ledger_index, watermark_ledger_hash, watermark_work_id,
    prepared_at, updated_at
  ) values (
    p_session_id, 'supabase-devnet', 'supabase-devnet-steady-qualification',
    'devnet', 'supabase-r4c2c-v1', concat('steady-', p_session_id),
    'running', 6, 24,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    v_watermark.epoch_id, v_watermark.base_identity,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    p_prepared_at, p_prepared_at
  );

  return jsonb_build_object(
    'prepared', true,
    'sessionId', p_session_id,
    'targetTicks', 6,
    'batchSize', 24,
    'anchor', jsonb_build_object(
      'ledgerIndex', v_watermark.ledger_index,
      'ledgerHash', v_watermark.ledger_hash,
      'workId', v_watermark.work_id,
      'epochId', v_watermark.epoch_id,
      'baseIdentity', v_watermark.base_identity
    )
  );
end;
$$;

create or replace function public.xrpl_claim_network_steady_tick(
  p_owner text,
  p_scheduled_at timestamptz,
  p_now timestamptz,
  p_lease_seconds integer default 55
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_session xrpl_steady_v1.sessions%rowtype;
  v_sequence integer;
  v_minute timestamptz;
  v_tick_id text;
  v_start bigint;
  v_end bigint;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200 then
    raise exception 'invalid steady tick owner';
  end if;
  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid steady tick lease duration';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-network-steady', 0));

  select * into v_session
  from xrpl_steady_v1.sessions
  where status = 'running'
  order by prepared_at
  limit 1
  for update;
  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'no_running_session');
  end if;

  if v_session.lease_owner is not null and v_session.lease_expires_at > p_now then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'lease_active',
      'sessionId', v_session.session_id,
      'leaseExpiresAt', v_session.lease_expires_at
    );
  end if;

  v_minute := date_trunc('minute', p_scheduled_at);
  if exists (
    select 1 from xrpl_steady_v1.ticks
    where session_id = v_session.session_id and scheduled_minute = v_minute
  ) then
    return jsonb_build_object('claimed', false, 'reason', 'minute_already_reserved');
  end if;

  v_sequence := v_session.completed_ticks + 1;
  if v_sequence > v_session.target_ticks then
    update xrpl_steady_v1.sessions
    set status = 'completed', completed_at = p_now, updated_at = p_now
    where session_id = v_session.session_id;
    return jsonb_build_object('claimed', false, 'reason', 'session_complete');
  end if;

  v_start := v_session.watermark_ledger_index + 1;
  v_end := v_start + v_session.batch_size - 1;
  v_tick_id := concat('steady:v1:', v_session.session_id, ':tick:', v_sequence);

  update xrpl_steady_v1.sessions
  set
    lease_owner = p_owner,
    lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
    updated_at = p_now
  where session_id = v_session.session_id;

  insert into xrpl_steady_v1.ticks (
    session_id, tick_id, tick_sequence, scheduled_minute, status,
    lease_owner, lease_expires_at, start_ledger_index, end_ledger_index,
    expected_parent_hash, claimed_at
  ) values (
    v_session.session_id, v_tick_id, v_sequence, v_minute, 'leased',
    p_owner, p_now + make_interval(secs => p_lease_seconds),
    v_start, v_end, v_session.watermark_ledger_hash, p_now
  );

  return jsonb_build_object(
    'claimed', true,
    'sessionId', v_session.session_id,
    'tickId', v_tick_id,
    'tickSequence', v_sequence,
    'scheduledMinute', v_minute,
    'startLedgerIndex', v_start,
    'endLedgerIndex', v_end,
    'expectedParentHash', v_session.watermark_ledger_hash,
    'baseIdentity', v_session.base_identity,
    'network', v_session.network,
    'epochId', v_session.epoch_id,
    'batchSize', v_session.batch_size,
    'leaseExpiresAt', p_now + make_interval(secs => p_lease_seconds)
  );
end;
$$;

create or replace function public.xrpl_defer_network_steady_tick(
  p_owner text,
  p_tick_id text,
  p_deferred_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_tick xrpl_steady_v1.ticks%rowtype;
begin
  select * into v_tick
  from xrpl_steady_v1.ticks
  where tick_id = p_tick_id
  for update;
  if not found or v_tick.status <> 'leased' or v_tick.lease_owner <> p_owner then
    return jsonb_build_object('deferred', false, 'reason', 'lease_lost');
  end if;

  update xrpl_steady_v1.ticks
  set
    status = 'deferred', lease_owner = null, lease_expires_at = null,
    error_message = left(coalesce(p_reason, 'head_not_ready'), 1000),
    completed_at = p_deferred_at
  where session_id = v_tick.session_id and tick_id = p_tick_id;

  update xrpl_steady_v1.sessions
  set lease_owner = null, lease_expires_at = null, updated_at = p_deferred_at
  where session_id = v_tick.session_id and lease_owner = p_owner;

  return jsonb_build_object('deferred', true, 'sessionId', v_tick.session_id);
end;
$$;

create or replace function public.xrpl_fail_network_steady_tick(
  p_owner text,
  p_tick_id text,
  p_failed_at timestamptz,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_tick xrpl_steady_v1.ticks%rowtype;
begin
  select * into v_tick
  from xrpl_steady_v1.ticks
  where tick_id = p_tick_id
  for update;
  if not found or v_tick.status <> 'leased' or v_tick.lease_owner <> p_owner then
    return jsonb_build_object('recorded', false, 'reason', 'lease_lost');
  end if;

  update xrpl_steady_v1.ticks
  set
    status = 'error', lease_owner = null, lease_expires_at = null,
    error_message = left(coalesce(p_error, 'steady tick failure'), 2000),
    completed_at = p_failed_at
  where session_id = v_tick.session_id and tick_id = p_tick_id;

  update xrpl_steady_v1.sessions
  set
    status = 'halted', lease_owner = null, lease_expires_at = null,
    last_error = left(coalesce(p_error, 'steady tick failure'), 2000),
    completed_at = p_failed_at, updated_at = p_failed_at
  where session_id = v_tick.session_id and lease_owner = p_owner;

  return jsonb_build_object('recorded', true, 'sessionId', v_tick.session_id);
end;
$$;

create or replace function public.xrpl_complete_network_steady_tick(
  p_owner text,
  p_tick_id text,
  p_completed_at timestamptz,
  p_works_json text,
  p_works_digest text,
  p_fetch_milliseconds numeric,
  p_normalize_milliseconds numeric,
  p_edge_wall_milliseconds numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, extensions, pg_temp
as $$
declare
  v_tick xrpl_steady_v1.ticks%rowtype;
  v_session xrpl_steady_v1.sessions%rowtype;
  v_works jsonb;
  v_item record;
  v_chunk record;
  v_row record;
  v_ordinal integer;
  v_chunk_count integer;
  v_row_count integer := 0;
  v_message_count integer := 0;
  v_successor_count integer := 0;
  v_scan_id text;
  v_commit_id text;
  v_previous_message_id text;
  v_finalize_id text;
  v_next_scan_id text;
  v_work_id text;
  v_previous_index bigint;
  v_start_index bigint;
  v_end_index bigint;
  v_expected_parent text;
  v_final_hash text;
  v_last_hash text;
  v_last_index bigint;
  v_rows_text text;
  v_database_started timestamptz := clock_timestamp();
  v_database_elapsed numeric;
  v_final_work_id text;
  v_session_completed_ticks integer;
  v_session_committed_ledgers integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-network-steady', 0));

  select * into v_tick
  from xrpl_steady_v1.ticks
  where tick_id = p_tick_id
  for update;
  if not found or v_tick.status <> 'leased' or v_tick.lease_owner <> p_owner then
    raise exception 'steady tick lease lost';
  end if;

  select * into v_session
  from xrpl_steady_v1.sessions
  where session_id = v_tick.session_id
  for update;
  if not found
    or v_session.status <> 'running'
    or v_session.lease_owner <> p_owner
    or v_session.lease_expires_at <= p_completed_at then
    raise exception 'steady session lease lost';
  end if;

  if p_works_digest !~ '^[a-f0-9]{64}$'
    or encode(digest(convert_to(p_works_json, 'UTF8'), 'sha256'), 'hex') <> p_works_digest then
    raise exception 'steady works digest mismatch';
  end if;

  begin
    v_works := p_works_json::jsonb;
  exception when others then
    raise exception 'steady works JSON is invalid';
  end;
  if jsonb_typeof(v_works) <> 'array' or jsonb_array_length(v_works) <> 24 then
    raise exception 'steady tick must contain exactly 24 works';
  end if;

  v_last_hash := v_tick.expected_parent_hash;
  v_last_index := v_tick.start_ledger_index - 1;

  for v_item in
    select value, ordinality::integer as ordinal
    from jsonb_array_elements(v_works) with ordinality
    order by ordinality
  loop
    v_ordinal := v_item.ordinal;
    v_work_id := v_item.value->>'workId';
    v_previous_index := (v_item.value->>'previousLedgerIndex')::bigint;
    v_start_index := (v_item.value->>'startLedgerIndex')::bigint;
    v_end_index := (v_item.value->>'scannedEndLedgerIndex')::bigint;
    v_expected_parent := upper(v_item.value->>'expectedParentHash');
    v_final_hash := upper(v_item.value->>'finalLedgerHash');
    v_chunk_count := jsonb_array_length(v_item.value->'chunks');

    if v_work_id is null or length(v_work_id) < 20
      or v_previous_index <> v_last_index
      or v_start_index <> v_previous_index + 1
      or v_end_index <> v_start_index
      or v_start_index <> v_tick.start_ledger_index + v_ordinal - 1
      or v_expected_parent <> v_last_hash
      or v_final_hash !~ '^[A-F0-9]{64}$'
      or v_chunk_count < 1 then
      raise exception 'steady work identity or continuity mismatch at ordinal %', v_ordinal;
    end if;

    insert into xrpl_steady_v1.works (
      session_id, tick_sequence, ordinal, work_id,
      previous_ledger_index, start_ledger_index, expected_parent_hash,
      scanned_end_ledger_index, final_ledger_hash, plan_json,
      semantic_counts_json, payload_digest,
      expected_payload_chunks, expected_commit_chunks,
      status, committed_at
    ) values (
      v_tick.session_id, v_tick.tick_sequence, v_ordinal, v_work_id,
      v_previous_index, v_start_index, v_expected_parent,
      v_end_index, v_final_hash, v_item.value->>'planJson',
      v_item.value->>'semanticCountsJson', v_item.value->>'payloadDigest',
      v_chunk_count, v_chunk_count, 'committed', p_completed_at
    );

    v_scan_id := concat('steady:v1:', v_tick.session_id, ':tick:', v_tick.tick_sequence,
      ':work:', v_ordinal, ':scan');
    insert into xrpl_steady_v1.messages (
      session_id, tick_sequence, message_id, phase, work_id,
      status, attempt_count, payload, result, created_at, completed_at
    ) values (
      v_tick.session_id, v_tick.tick_sequence, v_scan_id, 'scan', v_work_id,
      'completed', 1,
      jsonb_build_object('schemaVersion', 1, 'phase', 'scan', 'ordinal', v_ordinal,
        'previousLedgerIndex', v_previous_index, 'expectedParentHash', v_expected_parent),
      jsonb_build_object('status', 'staged', 'ledgerIndex', v_start_index),
      p_completed_at, p_completed_at
    );
    v_message_count := v_message_count + 1;
    v_previous_message_id := v_scan_id;

    for v_chunk in
      select value, ordinality::integer as ordinal
      from jsonb_array_elements(v_item.value->'chunks') with ordinality
      order by ordinality
    loop
      if (v_chunk.value->>'chunkIndex')::integer <> v_chunk.ordinal - 1
        or (v_chunk.value->>'totalChunks')::integer <> v_chunk_count
        or (v_chunk.value->>'chunkDigest') !~ '^[a-f0-9]{64}$'
        or (v_chunk.value->>'encodedDigest') !~ '^[a-f0-9]{64}$'
        or encode(digest(convert_to(v_chunk.value->>'payloadJson', 'UTF8'), 'sha256'), 'hex')
          <> v_chunk.value->>'encodedDigest'
        or octet_length(convert_to(v_chunk.value->>'payloadJson', 'UTF8'))
          <> (v_chunk.value->>'byteCount')::integer then
        raise exception 'steady payload chunk mismatch at work % chunk %', v_ordinal, v_chunk.ordinal - 1;
      end if;

      insert into xrpl_steady_v1.payload_chunks (
        session_id, work_id, chunk_index, total_chunks, payload_json,
        chunk_digest, encoded_digest, byte_count, record_count, created_at
      ) values (
        v_tick.session_id, v_work_id,
        (v_chunk.value->>'chunkIndex')::integer,
        (v_chunk.value->>'totalChunks')::integer,
        v_chunk.value->>'payloadJson', v_chunk.value->>'chunkDigest',
        v_chunk.value->>'encodedDigest', (v_chunk.value->>'byteCount')::integer,
        (v_chunk.value->>'recordCount')::integer, p_completed_at
      );

      v_rows_text := v_chunk.value->>'referenceRowsJson';
      if (v_chunk.value->>'referenceRowsDigest') !~ '^[a-f0-9]{64}$'
        or encode(digest(convert_to(v_rows_text, 'UTF8'), 'sha256'), 'hex')
          <> v_chunk.value->>'referenceRowsDigest' then
        raise exception 'steady reference-row digest mismatch at work % chunk %', v_ordinal, v_chunk.ordinal - 1;
      end if;

      for v_row in
        select value
        from jsonb_array_elements(v_rows_text::jsonb)
      loop
        insert into xrpl_steady_v1.reference_rows (
          session_id, work_id, semantic_class, canonical_key,
          source_ledger_index, source_ledger_hash, source_transaction_hash,
          object_id, relationship_ids, value_json, is_tombstone, created_at
        ) values (
          v_tick.session_id, v_work_id,
          v_row.value->>'semanticClass', v_row.value->>'canonicalKey',
          (v_row.value->>'sourceLedgerIndex')::bigint,
          upper(v_row.value->>'sourceLedgerHash'),
          nullif(v_row.value->>'sourceTransactionHash', ''),
          nullif(v_row.value->>'objectId', ''),
          coalesce(v_row.value->'relationshipIds', '[]'::jsonb),
          v_row.value->>'valueJson',
          (v_row.value->>'isTombstone')::boolean,
          (v_row.value->>'createdAt')::timestamptz
        );
        v_row_count := v_row_count + 1;
      end loop;

      v_commit_id := concat('steady:v1:', v_tick.session_id, ':tick:', v_tick.tick_sequence,
        ':work:', v_ordinal, ':commit:', v_chunk.ordinal - 1);
      insert into xrpl_steady_v1.messages (
        session_id, tick_sequence, message_id, phase, work_id, chunk_index,
        status, attempt_count, payload, result, created_at, completed_at
      ) values (
        v_tick.session_id, v_tick.tick_sequence, v_commit_id, 'commit', v_work_id,
        v_chunk.ordinal - 1, 'completed', 1,
        jsonb_build_object('schemaVersion', 1, 'phase', 'commit', 'ordinal', v_ordinal,
          'chunkIndex', v_chunk.ordinal - 1),
        jsonb_build_object('status', 'completed', 'rowCount', (v_chunk.value->>'recordCount')::integer),
        p_completed_at, p_completed_at
      );
      v_message_count := v_message_count + 1;

      insert into xrpl_steady_v1.successors (
        session_id, current_message_id, successor_message_id, reserved_at
      ) values (
        v_tick.session_id, v_previous_message_id, v_commit_id, p_completed_at
      );
      update xrpl_steady_v1.messages
      set successor_message_id = v_commit_id
      where session_id = v_tick.session_id and message_id = v_previous_message_id;
      v_successor_count := v_successor_count + 1;
      v_previous_message_id := v_commit_id;

      insert into xrpl_steady_v1.commit_chunks (
        session_id, work_id, chunk_index, operation_count,
        row_mutation_count, chunk_digest, completed_at
      ) values (
        v_tick.session_id, v_work_id, v_chunk.ordinal - 1,
        (v_chunk.value->>'recordCount')::integer,
        (v_chunk.value->>'recordCount')::integer,
        v_chunk.value->>'chunkDigest', p_completed_at
      );
    end loop;

    v_finalize_id := concat('steady:v1:', v_tick.session_id, ':tick:', v_tick.tick_sequence,
      ':work:', v_ordinal, ':finalize');
    insert into xrpl_steady_v1.messages (
      session_id, tick_sequence, message_id, phase, work_id,
      status, attempt_count, payload, result, created_at, completed_at
    ) values (
      v_tick.session_id, v_tick.tick_sequence, v_finalize_id, 'finalize', v_work_id,
      'completed', 1,
      jsonb_build_object('schemaVersion', 1, 'phase', 'finalize', 'ordinal', v_ordinal),
      jsonb_build_object('status', 'committed', 'ledgerIndex', v_end_index),
      p_completed_at, p_completed_at
    );
    v_message_count := v_message_count + 1;
    insert into xrpl_steady_v1.successors (
      session_id, current_message_id, successor_message_id, reserved_at
    ) values (
      v_tick.session_id, v_previous_message_id, v_finalize_id, p_completed_at
    );
    update xrpl_steady_v1.messages
    set successor_message_id = v_finalize_id
    where session_id = v_tick.session_id and message_id = v_previous_message_id;
    v_successor_count := v_successor_count + 1;

    if v_ordinal < 24 then
      v_next_scan_id := concat('steady:v1:', v_tick.session_id, ':tick:', v_tick.tick_sequence,
        ':work:', v_ordinal + 1, ':scan');
      insert into xrpl_steady_v1.successors (
        session_id, current_message_id, successor_message_id, reserved_at
      ) values (
        v_tick.session_id, v_finalize_id, v_next_scan_id, p_completed_at
      );
      update xrpl_steady_v1.messages
      set successor_message_id = v_next_scan_id
      where session_id = v_tick.session_id and message_id = v_finalize_id;
      v_successor_count := v_successor_count + 1;
    end if;

    v_last_hash := v_final_hash;
    v_last_index := v_end_index;
    v_final_work_id := v_work_id;
  end loop;

  if v_last_index <> v_tick.end_ledger_index then
    raise exception 'steady tick did not reach the reserved end ledger';
  end if;

  v_next_scan_id := concat('steady:v1:', v_tick.session_id, ':tick:', v_tick.tick_sequence + 1, ':work:1:scan');
  insert into xrpl_steady_v1.messages (
    session_id, tick_sequence, message_id, phase, status, attempt_count,
    payload, created_at
  ) values (
    v_tick.session_id, v_tick.tick_sequence + 1, v_next_scan_id, 'scan',
    'pending', 0,
    jsonb_build_object('schemaVersion', 1, 'phase', 'scan',
      'previousLedgerIndex', v_last_index, 'expectedParentHash', v_last_hash),
    p_completed_at
  );
  v_message_count := v_message_count + 1;
  insert into xrpl_steady_v1.successors (
    session_id, current_message_id, successor_message_id, reserved_at
  ) values (
    v_tick.session_id, v_finalize_id, v_next_scan_id, p_completed_at
  );
  update xrpl_steady_v1.messages
  set successor_message_id = v_next_scan_id
  where session_id = v_tick.session_id and message_id = v_finalize_id;
  v_successor_count := v_successor_count + 1;

  v_database_elapsed := extract(epoch from (clock_timestamp() - v_database_started)) * 1000;

  update xrpl_steady_v1.ticks
  set
    status = 'completed', lease_owner = null, lease_expires_at = null,
    final_ledger_hash = v_last_hash, work_count = 24,
    record_count = v_row_count, message_count = v_message_count,
    successor_count = v_successor_count, works_digest = p_works_digest,
    rows_digest = encode(digest(convert_to(coalesce((
      select jsonb_agg(jsonb_build_object(
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
      ) order by works.ordinal, rows.semantic_class, rows.canonical_key)
      from xrpl_steady_v1.reference_rows as rows
      join xrpl_steady_v1.works as works
        on works.session_id = rows.session_id and works.work_id = rows.work_id
      where rows.session_id = v_tick.session_id and works.tick_sequence = v_tick.tick_sequence
    ), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex'),
    fetch_milliseconds = p_fetch_milliseconds,
    normalize_milliseconds = p_normalize_milliseconds,
    edge_wall_milliseconds = p_edge_wall_milliseconds,
    database_milliseconds = v_database_elapsed,
    completed_at = p_completed_at
  where session_id = v_tick.session_id and tick_id = p_tick_id;

  v_session_completed_ticks := v_session.completed_ticks + 1;
  v_session_committed_ledgers := v_session.committed_ledgers + 24;
  update xrpl_steady_v1.sessions
  set
    completed_ticks = v_session_completed_ticks,
    committed_ledgers = v_session_committed_ledgers,
    watermark_ledger_index = v_last_index,
    watermark_ledger_hash = v_last_hash,
    watermark_work_id = v_final_work_id,
    lease_owner = null,
    lease_expires_at = null,
    status = case when v_session_completed_ticks = target_ticks then 'completed' else 'running' end,
    completed_at = case when v_session_completed_ticks = target_ticks then p_completed_at else null end,
    updated_at = p_completed_at
  where session_id = v_tick.session_id;

  return jsonb_build_object(
    'completed', true,
    'sessionId', v_tick.session_id,
    'tickId', p_tick_id,
    'tickSequence', v_tick.tick_sequence,
    'scheduledMinute', v_tick.scheduled_minute,
    'startLedgerIndex', v_tick.start_ledger_index,
    'endLedgerIndex', v_tick.end_ledger_index,
    'committedLedgers', 24,
    'recordCount', v_row_count,
    'messageCount', v_message_count,
    'successorCount', v_successor_count,
    'databaseMilliseconds', v_database_elapsed,
    'sessionCompletedTicks', v_session_completed_ticks,
    'sessionStatus', case when v_session_completed_ticks = v_session.target_ticks then 'completed' else 'running' end
  );
end;
$$;

create or replace function public.xrpl_read_network_steady_session(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_session xrpl_steady_v1.sessions%rowtype;
  v_active public.xrpl_phase_watermarks%rowtype;
  v_ticks jsonb;
begin
  select * into v_session
  from xrpl_steady_v1.sessions
  where session_id = p_session_id;
  if not found then raise exception 'steady session not found'; end if;

  select * into v_active
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found then raise exception 'active watermark missing'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tickId', tick_id,
    'tickSequence', tick_sequence,
    'scheduledMinute', scheduled_minute,
    'status', status,
    'startLedgerIndex', start_ledger_index,
    'endLedgerIndex', end_ledger_index,
    'finalLedgerHash', final_ledger_hash,
    'workCount', work_count,
    'recordCount', record_count,
    'messageCount', message_count,
    'successorCount', successor_count,
    'worksDigest', works_digest,
    'rowsDigest', rows_digest,
    'fetchMilliseconds', fetch_milliseconds,
    'normalizeMilliseconds', normalize_milliseconds,
    'edgeWallMilliseconds', edge_wall_milliseconds,
    'databaseMilliseconds', database_milliseconds,
    'errorMessage', error_message,
    'claimedAt', claimed_at,
    'completedAt', completed_at
  ) order by scheduled_minute, tick_sequence), '[]'::jsonb)
  into v_ticks
  from xrpl_steady_v1.ticks
  where session_id = p_session_id;

  return jsonb_build_object(
    'sessionId', v_session.session_id,
    'status', v_session.status,
    'targetTicks', v_session.target_ticks,
    'batchSize', v_session.batch_size,
    'completedTicks', v_session.completed_ticks,
    'committedLedgers', v_session.committed_ledgers,
    'anchor', jsonb_build_object(
      'ledgerIndex', v_session.anchor_ledger_index,
      'ledgerHash', v_session.anchor_ledger_hash,
      'workId', v_session.anchor_work_id,
      'epochId', v_session.anchor_epoch_id,
      'baseIdentity', v_session.anchor_base_identity
    ),
    'targetWatermark', jsonb_build_object(
      'ledgerIndex', v_session.watermark_ledger_index,
      'ledgerHash', v_session.watermark_ledger_hash,
      'workId', v_session.watermark_work_id
    ),
    'activeAfter', jsonb_build_object(
      'ledgerIndex', v_active.ledger_index,
      'ledgerHash', v_active.ledger_hash,
      'workId', v_active.work_id,
      'epochId', v_active.epoch_id,
      'baseIdentity', v_active.base_identity
    ),
    'lastError', v_session.last_error,
    'preparedAt', v_session.prepared_at,
    'completedAt', v_session.completed_at,
    'ticks', v_ticks,
    'checks', jsonb_build_object(
      'activeProfileNonRegressing', v_active.ledger_index >= v_session.anchor_ledger_index,
      'activeSourceIdentityPreserved', v_active.epoch_id = v_session.anchor_epoch_id
        and v_active.base_identity = v_session.anchor_base_identity,
      'targetAdvanceExact', v_session.watermark_ledger_index = v_session.anchor_ledger_index + v_session.committed_ledgers,
      'completedTickParity', v_session.completed_ticks = (
        select count(*) from xrpl_steady_v1.ticks
        where session_id = p_session_id and status = 'completed'
      ),
      'completedWorkParity', v_session.committed_ledgers = (
        select count(*) from xrpl_steady_v1.works where session_id = p_session_id
      ),
      'allCompletedAttemptsOne', not exists (
        select 1 from xrpl_steady_v1.messages
        where session_id = p_session_id and status = 'completed' and attempt_count <> 1
      )
    )
  );
end;
$$;

revoke all on function public.xrpl_prepare_network_steady_session(text, timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_claim_network_steady_tick(text, timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.xrpl_defer_network_steady_tick(text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.xrpl_fail_network_steady_tick(text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.xrpl_complete_network_steady_tick(text, text, timestamptz, text, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.xrpl_read_network_steady_session(text) from public, anon, authenticated;
grant execute on function public.xrpl_prepare_network_steady_session(text, timestamptz) to service_role;
grant execute on function public.xrpl_claim_network_steady_tick(text, timestamptz, timestamptz, integer) to service_role;
grant execute on function public.xrpl_defer_network_steady_tick(text, text, timestamptz, text) to service_role;
grant execute on function public.xrpl_fail_network_steady_tick(text, text, timestamptz, text) to service_role;
grant execute on function public.xrpl_complete_network_steady_tick(text, text, timestamptz, text, text, numeric, numeric, numeric) to service_role;
grant execute on function public.xrpl_read_network_steady_session(text) to service_role;

do $$
declare
  v_existing record;
begin
  for v_existing in
    select jobid from cron.job where jobname = 'xrpl-lending-monitor-steady-qualification-minute'
  loop
    perform cron.unschedule(v_existing.jobid);
  end loop;

  if not exists (select 1 from vault.decrypted_secrets where name = 'xrpl_project_url') then
    raise exception 'Vault secret xrpl_project_url must exist before steady qualification migration';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'xrpl_secret_key') then
    raise exception 'Vault secret xrpl_secret_key must exist before steady qualification migration';
  end if;

  perform cron.schedule(
    'xrpl-lending-monitor-steady-qualification-minute',
    '* * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets where name = 'xrpl_project_url'
        ) || '/functions/v1/xrpl-steady-batch-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret from vault.decrypted_secrets where name = 'xrpl_secret_key'
          )
        ),
        body := jsonb_build_object(
          'source', 'pg_cron',
          'scheduled_at', now()
        ),
        timeout_milliseconds := 50000
      );
    $cron$
  );
end;
$$;
