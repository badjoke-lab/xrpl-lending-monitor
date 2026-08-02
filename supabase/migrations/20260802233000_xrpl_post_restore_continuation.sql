create schema if not exists xrpl_restore_continuation_v1;

create table if not exists xrpl_restore_continuation_v1.xrpl_phase_streams
  (like public.xrpl_phase_streams including all);
create table if not exists xrpl_restore_continuation_v1.xrpl_phase_messages
  (like public.xrpl_phase_messages including all);
create table if not exists xrpl_restore_continuation_v1.xrpl_phase_successors
  (like public.xrpl_phase_successors including all);
create table if not exists xrpl_restore_continuation_v1.xrpl_phase_work
  (like public.xrpl_phase_work including all);
create table if not exists xrpl_restore_continuation_v1.xrpl_phase_payload_chunks
  (like public.xrpl_phase_payload_chunks including all);
create table if not exists xrpl_restore_continuation_v1.xrpl_phase_reference_rows
  (like public.xrpl_phase_reference_rows including all);
create table if not exists xrpl_restore_continuation_v1.xrpl_phase_commit_chunks
  (like public.xrpl_phase_commit_chunks including all);
create table if not exists xrpl_restore_continuation_v1.xrpl_phase_watermarks
  (like public.xrpl_phase_watermarks including all);

create table if not exists xrpl_restore_continuation_v1.restore_metadata (
  fixture_id text primary key,
  schema_version integer not null check (schema_version = 1),
  source_profile_id text not null,
  active_profile_id text not null,
  target_id text not null unique,
  anchor_work_id text not null,
  continuation_work_id text not null,
  anchor_ledger_index bigint not null check (anchor_ledger_index > 0),
  anchor_ledger_hash text not null check (anchor_ledger_hash ~ '^[A-F0-9]{64}$'),
  continuation_ledger_index bigint not null check (continuation_ledger_index = anchor_ledger_index + 1),
  continuation_ledger_hash text not null check (continuation_ledger_hash ~ '^[A-F0-9]{64}$'),
  source_state_digest text not null check (source_state_digest ~ '^[a-f0-9]{64}$'),
  source_row_counts jsonb not null,
  restored_at timestamptz not null,
  continued_at timestamptz
);

create or replace function public.xrpl_build_restored_continuation_state()
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
declare
  v_metadata xrpl_restore_continuation_v1.restore_metadata%rowtype;
  v_state jsonb;
begin
  select * into v_metadata
  from xrpl_restore_continuation_v1.restore_metadata
  where fixture_id = 'r4c2c-post-restore-continuation-v1';

  if not found then
    raise exception 'restore_continuation_unavailable: metadata is unavailable';
  end if;

  v_state := jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'profileId', v_metadata.source_profile_id,
      'activeProfileId', v_metadata.active_profile_id,
      'targetId', v_metadata.target_id,
      'anchorWorkId', v_metadata.anchor_work_id,
      'anchorLedgerIndex', v_metadata.anchor_ledger_index,
      'anchorLedgerHash', v_metadata.anchor_ledger_hash,
      'continuationWorkId', v_metadata.continuation_work_id,
      'continuationLedgerIndex', v_metadata.continuation_ledger_index,
      'continuationLedgerHash', v_metadata.continuation_ledger_hash
    ),
    'collection', jsonb_build_object(
      'streams', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.profile_id)
        from xrpl_restore_continuation_v1.xrpl_phase_streams as rows
      ), '[]'::jsonb),
      'work', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.start_ledger_index, rows.work_id)
        from xrpl_restore_continuation_v1.xrpl_phase_work as rows
      ), '[]'::jsonb),
      'payloadChunks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.work_id, rows.chunk_index)
        from xrpl_restore_continuation_v1.xrpl_phase_payload_chunks as rows
      ), '[]'::jsonb),
      'referenceRows', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.work_id, rows.source_ledger_index, rows.semantic_class, rows.canonical_key
        )
        from xrpl_restore_continuation_v1.xrpl_phase_reference_rows as rows
      ), '[]'::jsonb),
      'commitChunks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.work_id, rows.chunk_index)
        from xrpl_restore_continuation_v1.xrpl_phase_commit_chunks as rows
      ), '[]'::jsonb),
      'watermarks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.profile_id)
        from xrpl_restore_continuation_v1.xrpl_phase_watermarks as rows
      ), '[]'::jsonb)
    ),
    'scheduler', jsonb_build_object(
      'messages', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.created_at, rows.available_at, rows.message_id
        )
        from xrpl_restore_continuation_v1.xrpl_phase_messages as rows
      ), '[]'::jsonb),
      'successors', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.current_message_id, rows.successor_message_id
        )
        from xrpl_restore_continuation_v1.xrpl_phase_successors as rows
      ), '[]'::jsonb)
    )
  );

  return v_state;
end;
$$;

create or replace function public.xrpl_restore_continuation_row_counts()
returns jsonb
language sql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
  select jsonb_build_object(
    'streams', (select count(*) from xrpl_restore_continuation_v1.xrpl_phase_streams),
    'work', (select count(*) from xrpl_restore_continuation_v1.xrpl_phase_work),
    'payloadChunks', (select count(*) from xrpl_restore_continuation_v1.xrpl_phase_payload_chunks),
    'referenceRows', (select count(*) from xrpl_restore_continuation_v1.xrpl_phase_reference_rows),
    'commitChunks', (select count(*) from xrpl_restore_continuation_v1.xrpl_phase_commit_chunks),
    'watermarks', (select count(*) from xrpl_restore_continuation_v1.xrpl_phase_watermarks),
    'messages', (select count(*) from xrpl_restore_continuation_v1.xrpl_phase_messages),
    'successors', (select count(*) from xrpl_restore_continuation_v1.xrpl_phase_successors)
  )
$$;

create or replace function public.xrpl_prepare_restored_continuation(
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, extensions, pg_temp
as $$
declare
  v_fixture_id constant text := 'r4c2c-post-restore-continuation-v1';
  v_source_profile_id constant text := 'supabase-devnet-restore-continuation-source';
  v_target_id constant text := 'supabase-devnet-restore-continuation-v1';
  v_active_profile_id constant text := 'supabase-devnet';
  v_existing xrpl_restore_continuation_v1.restore_metadata%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_active_watermark public.xrpl_phase_watermarks%rowtype;
  v_anchor public.xrpl_phase_work%rowtype;
  v_continuation public.xrpl_phase_work%rowtype;
  v_scan_id text;
  v_scan_payload jsonb;
  v_scan_message jsonb;
  v_stream_json jsonb;
  v_anchor_json jsonb;
  v_watermark_json jsonb;
  v_source_state jsonb;
  v_restored_state jsonb;
  v_state_digest text;
  v_restored_digest text;
  v_counts jsonb;
begin
  select * into v_existing
  from xrpl_restore_continuation_v1.restore_metadata
  where fixture_id = v_fixture_id;

  if found then
    return jsonb_build_object(
      'prepared', true,
      'duplicate', true,
      'continued', v_existing.continued_at is not null,
      'sourceProfileId', v_existing.source_profile_id,
      'targetId', v_existing.target_id,
      'anchorWorkId', v_existing.anchor_work_id,
      'continuationWorkId', v_existing.continuation_work_id,
      'anchorLedgerIndex', v_existing.anchor_ledger_index,
      'anchorLedgerHash', v_existing.anchor_ledger_hash,
      'continuationLedgerIndex', v_existing.continuation_ledger_index,
      'continuationLedgerHash', v_existing.continuation_ledger_hash,
      'sourceStateDigest', v_existing.source_state_digest,
      'sourceRowCounts', v_existing.source_row_counts
    );
  end if;

  if exists (select 1 from xrpl_restore_continuation_v1.xrpl_phase_streams)
    or exists (select 1 from xrpl_restore_continuation_v1.xrpl_phase_messages)
    or exists (select 1 from xrpl_restore_continuation_v1.xrpl_phase_successors)
    or exists (select 1 from xrpl_restore_continuation_v1.xrpl_phase_work)
    or exists (select 1 from xrpl_restore_continuation_v1.xrpl_phase_payload_chunks)
    or exists (select 1 from xrpl_restore_continuation_v1.xrpl_phase_reference_rows)
    or exists (select 1 from xrpl_restore_continuation_v1.xrpl_phase_commit_chunks)
    or exists (select 1 from xrpl_restore_continuation_v1.xrpl_phase_watermarks) then
    raise exception 'restore_continuation_target_not_empty';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = v_active_profile_id
  for share;

  select * into v_active_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_active_profile_id
  for share;

  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1'
    or v_active_watermark.network <> v_stream.network
    or v_active_watermark.epoch_id <> v_stream.epoch_id
    or v_active_watermark.base_identity <> v_stream.base_identity then
    raise exception 'restore_continuation_active_source_unavailable';
  end if;

  select * into v_continuation
  from public.xrpl_phase_work
  where work_id = v_active_watermark.work_id
  for share;

  if not found
    or v_continuation.profile_id <> v_active_profile_id
    or v_continuation.status <> 'committed'
    or v_continuation.committed_at is null
    or v_continuation.scanned_end_ledger_index <> v_active_watermark.ledger_index
    or v_continuation.final_ledger_hash <> v_active_watermark.ledger_hash
    or v_continuation.start_ledger_index <> v_continuation.scanned_end_ledger_index then
    raise exception 'restore_continuation_latest_work_unavailable';
  end if;

  select * into v_anchor
  from public.xrpl_phase_work
  where profile_id = v_active_profile_id
    and status = 'committed'
    and committed_at is not null
    and scanned_end_ledger_index = v_continuation.previous_ledger_index
    and final_ledger_hash = v_continuation.expected_parent_hash
  order by committed_at desc, work_id desc
  for share
  limit 1;

  if not found
    or v_continuation.start_ledger_index <> v_anchor.scanned_end_ledger_index + 1
    or v_continuation.expected_parent_hash <> v_anchor.final_ledger_hash
    or v_continuation.network <> v_anchor.network
    or v_continuation.epoch_id <> v_anchor.epoch_id
    or v_continuation.base_identity <> v_anchor.base_identity
    or v_anchor.expected_payload_chunks < 1
    or v_anchor.expected_commit_chunks < 1
    or v_continuation.expected_payload_chunks < 1
    or v_continuation.expected_commit_chunks < 1 then
    raise exception 'restore_continuation_pair_is_not_consecutive';
  end if;

  if (
    select count(*)
    from public.xrpl_phase_payload_chunks
    where work_id = v_anchor.work_id
  ) <> v_anchor.expected_payload_chunks
    or (
      select count(*)
      from public.xrpl_phase_commit_chunks
      where work_id = v_anchor.work_id and status = 'completed'
    ) <> v_anchor.expected_commit_chunks
    or (
      select count(*)
      from public.xrpl_phase_reference_rows
      where work_id = v_anchor.work_id
    ) <> (v_anchor.semantic_counts_json::jsonb->>'totalRecords')::integer
    or (
      select count(*)
      from public.xrpl_phase_payload_chunks
      where work_id = v_continuation.work_id
    ) <> v_continuation.expected_payload_chunks
    or (
      select count(*)
      from public.xrpl_phase_commit_chunks
      where work_id = v_continuation.work_id and status = 'completed'
    ) <> v_continuation.expected_commit_chunks
    or (
      select count(*)
      from public.xrpl_phase_reference_rows
      where work_id = v_continuation.work_id
    ) <> (v_continuation.semantic_counts_json::jsonb->>'totalRecords')::integer then
    raise exception 'restore_continuation_source_evidence_is_incomplete';
  end if;

  v_scan_id := public.xrpl_phase_scan_message_id(
    v_stream.network,
    v_stream.epoch_id,
    v_stream.base_identity,
    v_anchor.scanned_end_ledger_index,
    v_anchor.final_ledger_hash,
    0
  );
  v_scan_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'scan',
    'messageId', v_scan_id,
    'network', v_stream.network,
    'epochId', v_stream.epoch_id,
    'baseIdentity', v_stream.base_identity,
    'expectedPreviousLedgerIndex', v_anchor.scanned_end_ledger_index,
    'expectedPreviousLedgerHash', v_anchor.final_ledger_hash,
    'scanSequence', 0
  );
  v_scan_message := jsonb_build_object(
    'message_id', v_scan_id,
    'schema_version', 1,
    'profile_id', v_source_profile_id,
    'phase', 'scan',
    'payload', v_scan_payload,
    'status', 'pending',
    'available_at', p_now,
    'attempt_count', 0,
    'lease_owner', null,
    'lease_expires_at', null,
    'result', null,
    'successor_message_id', null,
    'error_classification', null,
    'error_message', null,
    'created_at', p_now,
    'updated_at', p_now,
    'completed_at', null
  );
  v_stream_json := to_jsonb(v_stream) || jsonb_build_object('profile_id', v_source_profile_id);
  v_anchor_json := to_jsonb(v_anchor) || jsonb_build_object('profile_id', v_source_profile_id);
  v_watermark_json := jsonb_build_object(
    'profile_id', v_source_profile_id,
    'network', v_anchor.network,
    'epoch_id', v_anchor.epoch_id,
    'base_identity', v_anchor.base_identity,
    'ledger_index', v_anchor.scanned_end_ledger_index,
    'ledger_hash', v_anchor.final_ledger_hash,
    'work_id', v_anchor.work_id,
    'updated_at', p_now
  );

  v_source_state := jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'profileId', v_source_profile_id,
      'activeProfileId', v_active_profile_id,
      'targetId', v_target_id,
      'anchorWorkId', v_anchor.work_id,
      'anchorLedgerIndex', v_anchor.scanned_end_ledger_index,
      'anchorLedgerHash', v_anchor.final_ledger_hash,
      'continuationWorkId', v_continuation.work_id,
      'continuationLedgerIndex', v_continuation.scanned_end_ledger_index,
      'continuationLedgerHash', v_continuation.final_ledger_hash
    ),
    'collection', jsonb_build_object(
      'streams', jsonb_build_array(v_stream_json),
      'work', jsonb_build_array(v_anchor_json),
      'payloadChunks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.chunk_index)
        from public.xrpl_phase_payload_chunks as rows
        where rows.work_id = v_anchor.work_id
      ), '[]'::jsonb),
      'referenceRows', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.source_ledger_index, rows.semantic_class, rows.canonical_key
        )
        from public.xrpl_phase_reference_rows as rows
        where rows.work_id = v_anchor.work_id
      ), '[]'::jsonb),
      'commitChunks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.chunk_index)
        from public.xrpl_phase_commit_chunks as rows
        where rows.work_id = v_anchor.work_id
      ), '[]'::jsonb),
      'watermarks', jsonb_build_array(v_watermark_json)
    ),
    'scheduler', jsonb_build_object(
      'messages', jsonb_build_array(v_scan_message),
      'successors', '[]'::jsonb
    )
  );
  v_state_digest := public.xrpl_transfer_json_digest(v_source_state);
  v_counts := jsonb_build_object(
    'streams', 1,
    'work', 1,
    'payloadChunks', v_anchor.expected_payload_chunks,
    'referenceRows', (v_anchor.semantic_counts_json::jsonb->>'totalRecords')::integer,
    'commitChunks', v_anchor.expected_commit_chunks,
    'watermarks', 1,
    'messages', 1,
    'successors', 0
  );

  insert into xrpl_restore_continuation_v1.restore_metadata (
    fixture_id, schema_version, source_profile_id, active_profile_id,
    target_id, anchor_work_id, continuation_work_id,
    anchor_ledger_index, anchor_ledger_hash,
    continuation_ledger_index, continuation_ledger_hash,
    source_state_digest, source_row_counts, restored_at
  ) values (
    v_fixture_id, 1, v_source_profile_id, v_active_profile_id,
    v_target_id, v_anchor.work_id, v_continuation.work_id,
    v_anchor.scanned_end_ledger_index, v_anchor.final_ledger_hash,
    v_continuation.scanned_end_ledger_index, v_continuation.final_ledger_hash,
    v_state_digest, v_counts, p_now
  );

  insert into xrpl_restore_continuation_v1.xrpl_phase_streams
    select * from jsonb_populate_recordset(
      null::xrpl_restore_continuation_v1.xrpl_phase_streams,
      v_source_state#>'{collection,streams}'
    );
  insert into xrpl_restore_continuation_v1.xrpl_phase_work
    select * from jsonb_populate_recordset(
      null::xrpl_restore_continuation_v1.xrpl_phase_work,
      v_source_state#>'{collection,work}'
    );
  insert into xrpl_restore_continuation_v1.xrpl_phase_payload_chunks
    select * from jsonb_populate_recordset(
      null::xrpl_restore_continuation_v1.xrpl_phase_payload_chunks,
      v_source_state#>'{collection,payloadChunks}'
    );
  insert into xrpl_restore_continuation_v1.xrpl_phase_reference_rows
    select * from jsonb_populate_recordset(
      null::xrpl_restore_continuation_v1.xrpl_phase_reference_rows,
      v_source_state#>'{collection,referenceRows}'
    );
  insert into xrpl_restore_continuation_v1.xrpl_phase_commit_chunks
    select * from jsonb_populate_recordset(
      null::xrpl_restore_continuation_v1.xrpl_phase_commit_chunks,
      v_source_state#>'{collection,commitChunks}'
    );
  insert into xrpl_restore_continuation_v1.xrpl_phase_watermarks
    select * from jsonb_populate_recordset(
      null::xrpl_restore_continuation_v1.xrpl_phase_watermarks,
      v_source_state#>'{collection,watermarks}'
    );
  insert into xrpl_restore_continuation_v1.xrpl_phase_messages
    select * from jsonb_populate_recordset(
      null::xrpl_restore_continuation_v1.xrpl_phase_messages,
      v_source_state#>'{scheduler,messages}'
    );

  v_restored_state := public.xrpl_build_restored_continuation_state();
  v_restored_digest := public.xrpl_transfer_json_digest(v_restored_state);
  if v_restored_state <> v_source_state or v_restored_digest <> v_state_digest then
    raise exception 'restore_continuation_parity_failed';
  end if;
  if public.xrpl_restore_continuation_row_counts() <> v_counts then
    raise exception 'restore_continuation_row_counts_changed';
  end if;

  return jsonb_build_object(
    'prepared', true,
    'duplicate', false,
    'continued', false,
    'sourceProfileId', v_source_profile_id,
    'targetId', v_target_id,
    'anchorWorkId', v_anchor.work_id,
    'continuationWorkId', v_continuation.work_id,
    'anchorLedgerIndex', v_anchor.scanned_end_ledger_index,
    'anchorLedgerHash', v_anchor.final_ledger_hash,
    'continuationLedgerIndex', v_continuation.scanned_end_ledger_index,
    'continuationLedgerHash', v_continuation.final_ledger_hash,
    'sourceStateDigest', v_state_digest,
    'sourceRowCounts', v_counts,
    'pendingMessageId', v_scan_id
  );
end;
$$;

create or replace function public.xrpl_restore_continuation_insert_message(
  p_phase text,
  p_message_id text,
  p_payload jsonb,
  p_available_at timestamptz,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet-restore-continuation-source';
  v_existing xrpl_restore_continuation_v1.xrpl_phase_messages%rowtype;
begin
  insert into xrpl_restore_continuation_v1.xrpl_phase_messages (
    message_id, profile_id, phase, payload, status, available_at,
    created_at, updated_at
  ) values (
    p_message_id, v_profile_id, p_phase, p_payload, 'pending', p_available_at,
    p_created_at, p_created_at
  )
  on conflict (message_id) do nothing;

  select * into v_existing
  from xrpl_restore_continuation_v1.xrpl_phase_messages
  where message_id = p_message_id;

  if not found
    or v_existing.profile_id <> v_profile_id
    or v_existing.phase <> p_phase
    or v_existing.payload <> p_payload then
    raise exception 'restore_continuation_message_identity_conflict: %', p_message_id;
  end if;
end;
$$;

create or replace function public.xrpl_restore_continuation_reserve_successor(
  p_current_message_id text,
  p_successor_message_id text,
  p_reserved_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
begin
  insert into xrpl_restore_continuation_v1.xrpl_phase_successors (
    current_message_id, successor_message_id, reserved_at
  ) values (
    p_current_message_id, p_successor_message_id, p_reserved_at
  )
  on conflict (current_message_id) do nothing;

  if not exists (
    select 1
    from xrpl_restore_continuation_v1.xrpl_phase_successors
    where current_message_id = p_current_message_id
      and successor_message_id = p_successor_message_id
  ) then
    raise exception 'restore_continuation_successor_identity_conflict: %', p_current_message_id;
  end if;
end;
$$;

create or replace function public.xrpl_claim_restored_continuation_phase(
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
declare
  v_message xrpl_restore_continuation_v1.xrpl_phase_messages%rowtype;
  v_previous_owner text;
  v_previous_expiry timestamptz;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200 then
    raise exception 'invalid restore continuation owner';
  end if;
  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid restore continuation lease duration';
  end if;

  select * into v_message
  from xrpl_restore_continuation_v1.xrpl_phase_messages
  where profile_id = 'supabase-devnet-restore-continuation-source'
    and (
      (status in ('pending', 'retry') and available_at <= p_now)
      or (status = 'leased' and lease_expires_at <= p_now)
    )
  order by available_at, created_at, message_id
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'no_ready_message');
  end if;

  v_previous_owner := v_message.lease_owner;
  v_previous_expiry := v_message.lease_expires_at;

  update xrpl_restore_continuation_v1.xrpl_phase_messages
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
    'previousLeaseOwner', v_previous_owner,
    'previousLeaseExpiresAt', v_previous_expiry,
    'messageId', v_message.message_id,
    'phase', v_message.phase,
    'payload', v_message.payload,
    'attemptCount', v_message.attempt_count,
    'leaseExpiresAt', v_message.lease_expires_at
  );
end;
$$;

create or replace function public.xrpl_complete_restored_continuation_scan(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
declare
  v_metadata xrpl_restore_continuation_v1.restore_metadata%rowtype;
  v_message xrpl_restore_continuation_v1.xrpl_phase_messages%rowtype;
  v_watermark xrpl_restore_continuation_v1.xrpl_phase_watermarks%rowtype;
  v_source_work public.xrpl_phase_work%rowtype;
  v_commit_id text;
  v_commit_payload jsonb;
begin
  select * into v_metadata
  from xrpl_restore_continuation_v1.restore_metadata
  where fixture_id = 'r4c2c-post-restore-continuation-v1'
  for update;

  select * into v_message
  from xrpl_restore_continuation_v1.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.phase <> 'scan' then
    raise exception 'restore continuation scan message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'workId', v_metadata.continuation_work_id,
      'successorMessageId', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;
  if v_metadata.continued_at is not null then
    raise exception 'restore continuation already finalized';
  end if;

  select * into v_watermark
  from xrpl_restore_continuation_v1.xrpl_phase_watermarks
  where profile_id = v_metadata.source_profile_id
  for update;

  if not found
    or v_watermark.work_id <> v_metadata.anchor_work_id
    or v_watermark.ledger_index <> v_metadata.anchor_ledger_index
    or v_watermark.ledger_hash <> v_metadata.anchor_ledger_hash
    or (v_message.payload->>'expectedPreviousLedgerIndex')::bigint <> v_metadata.anchor_ledger_index
    or upper(v_message.payload->>'expectedPreviousLedgerHash') <> v_metadata.anchor_ledger_hash then
    raise exception 'restore continuation scan boundary changed';
  end if;

  select * into v_source_work
  from public.xrpl_phase_work
  where work_id = v_metadata.continuation_work_id
  for share;

  if not found
    or v_source_work.profile_id <> v_metadata.active_profile_id
    or v_source_work.status <> 'committed'
    or v_source_work.previous_ledger_index <> v_metadata.anchor_ledger_index
    or v_source_work.expected_parent_hash <> v_metadata.anchor_ledger_hash
    or v_source_work.scanned_end_ledger_index <> v_metadata.continuation_ledger_index
    or v_source_work.final_ledger_hash <> v_metadata.continuation_ledger_hash then
    raise exception 'restore continuation source work changed';
  end if;

  insert into xrpl_restore_continuation_v1.xrpl_phase_work (
    work_id, schema_version, profile_id, network, epoch_id, base_identity,
    previous_ledger_index, start_ledger_index, expected_parent_hash,
    planned_end_ledger_index, scanned_end_ledger_index, final_ledger_hash,
    status, plan_json, semantic_counts_json, payload_digest,
    expected_payload_chunks, expected_commit_chunks,
    error_code, error_message, created_at, updated_at, committed_at
  ) values (
    v_source_work.work_id, v_source_work.schema_version,
    v_metadata.source_profile_id, v_source_work.network,
    v_source_work.epoch_id, v_source_work.base_identity,
    v_source_work.previous_ledger_index, v_source_work.start_ledger_index,
    v_source_work.expected_parent_hash, v_source_work.planned_end_ledger_index,
    v_source_work.scanned_end_ledger_index, v_source_work.final_ledger_hash,
    'staged', v_source_work.plan_json, v_source_work.semantic_counts_json,
    v_source_work.payload_digest, v_source_work.expected_payload_chunks,
    v_source_work.expected_commit_chunks, null, null,
    p_completed_at, p_completed_at, null
  )
  on conflict (work_id) do nothing;

  if not exists (
    select 1
    from xrpl_restore_continuation_v1.xrpl_phase_work
    where work_id = v_source_work.work_id
      and profile_id = v_metadata.source_profile_id
      and previous_ledger_index = v_metadata.anchor_ledger_index
      and expected_parent_hash = v_metadata.anchor_ledger_hash
      and scanned_end_ledger_index = v_metadata.continuation_ledger_index
      and final_ledger_hash = v_metadata.continuation_ledger_hash
      and payload_digest = v_source_work.payload_digest
      and semantic_counts_json = v_source_work.semantic_counts_json
      and expected_payload_chunks = v_source_work.expected_payload_chunks
      and expected_commit_chunks = v_source_work.expected_commit_chunks
      and status in ('staged', 'committing', 'finalizing', 'committed')
  ) then
    raise exception 'restore continuation work identity conflict';
  end if;

  insert into xrpl_restore_continuation_v1.xrpl_phase_payload_chunks
  select *
  from public.xrpl_phase_payload_chunks
  where work_id = v_source_work.work_id
  on conflict (work_id, chunk_index) do nothing;

  if (
    select count(*)
    from xrpl_restore_continuation_v1.xrpl_phase_payload_chunks
    where work_id = v_source_work.work_id
  ) <> v_source_work.expected_payload_chunks then
    raise exception 'restore continuation payload staging is incomplete';
  end if;

  v_commit_id := public.xrpl_phase_commit_message_id(v_source_work.work_id, 0);
  v_commit_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'commit',
    'messageId', v_commit_id,
    'workId', v_source_work.work_id,
    'chunkIndex', 0
  );
  perform public.xrpl_restore_continuation_insert_message(
    'commit', v_commit_id, v_commit_payload, p_completed_at, p_completed_at
  );
  perform public.xrpl_restore_continuation_reserve_successor(
    p_message_id, v_commit_id, p_completed_at
  );

  update xrpl_restore_continuation_v1.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'staged',
      'workId', v_source_work.work_id,
      'startLedgerIndex', v_source_work.start_ledger_index,
      'endLedgerIndex', v_source_work.scanned_end_ledger_index,
      'payloadDigest', concat('sha256:', v_source_work.payload_digest),
      'payloadChunks', v_source_work.expected_payload_chunks,
      'semanticCounts', v_source_work.semantic_counts_json::jsonb,
      'sourceReboundFrom', v_metadata.active_profile_id,
      'sourceReboundTo', v_metadata.source_profile_id
    ),
    successor_message_id = v_commit_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'workId', v_source_work.work_id,
    'payloadChunks', v_source_work.expected_payload_chunks,
    'totalRecords', (v_source_work.semantic_counts_json::jsonb->>'totalRecords')::integer,
    'successorMessageId', v_commit_id
  );
end;
$$;

create or replace function public.xrpl_complete_restored_continuation_commit(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
declare
  v_metadata xrpl_restore_continuation_v1.restore_metadata%rowtype;
  v_message xrpl_restore_continuation_v1.xrpl_phase_messages%rowtype;
  v_work xrpl_restore_continuation_v1.xrpl_phase_work%rowtype;
  v_chunk xrpl_restore_continuation_v1.xrpl_phase_payload_chunks%rowtype;
  v_source_commit public.xrpl_phase_commit_chunks%rowtype;
  v_chunk_index integer;
  v_inserted integer;
  v_next_id text;
  v_next_phase text;
  v_next_payload jsonb;
begin
  select * into v_metadata
  from xrpl_restore_continuation_v1.restore_metadata
  where fixture_id = 'r4c2c-post-restore-continuation-v1'
  for update;

  select * into v_message
  from xrpl_restore_continuation_v1.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.phase <> 'commit' then
    raise exception 'restore continuation commit message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'successorMessageId', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  select * into v_work
  from xrpl_restore_continuation_v1.xrpl_phase_work
  where work_id = v_metadata.continuation_work_id
  for update;

  if not found or v_work.status not in ('staged', 'committing') then
    raise exception 'restore continuation work is not commit-ready';
  end if;

  v_chunk_index := (v_message.payload->>'chunkIndex')::integer;
  if v_chunk_index < 0 or v_chunk_index >= v_work.expected_commit_chunks then
    raise exception 'restore continuation chunk index is invalid';
  end if;
  if v_chunk_index > 0 and not exists (
    select 1
    from xrpl_restore_continuation_v1.xrpl_phase_commit_chunks
    where work_id = v_work.work_id
      and chunk_index = v_chunk_index - 1
      and status = 'completed'
  ) then
    raise exception 'restore continuation commit chunks are out of order';
  end if;

  select * into v_chunk
  from xrpl_restore_continuation_v1.xrpl_phase_payload_chunks
  where work_id = v_work.work_id and chunk_index = v_chunk_index
  for update;

  select * into v_source_commit
  from public.xrpl_phase_commit_chunks
  where work_id = v_work.work_id
    and chunk_index = v_chunk_index
    and status = 'completed'
  for share;

  if not found
    or v_source_commit.row_mutation_count <> v_chunk.record_count
    or v_source_commit.operation_count <> v_chunk.record_count
    or v_source_commit.chunk_digest <> v_chunk.payload_digest then
    raise exception 'restore continuation source commit evidence changed';
  end if;

  insert into xrpl_restore_continuation_v1.xrpl_phase_reference_rows (
    work_id, semantic_class, canonical_key, source_ledger_index,
    source_ledger_hash, source_transaction_hash, object_id,
    relationship_ids, value_json, is_tombstone, created_at
  )
  select
    rows.work_id, rows.semantic_class, rows.canonical_key,
    rows.source_ledger_index, rows.source_ledger_hash,
    rows.source_transaction_hash, rows.object_id,
    rows.relationship_ids, rows.value_json, rows.is_tombstone,
    p_completed_at
  from public.xrpl_phase_reference_rows as rows
  where rows.work_id = v_work.work_id
    and exists (
      select 1
      from jsonb_array_elements((v_chunk.payload_json::jsonb)->'records') as record
      where record->>'semanticClass' = rows.semantic_class
        and record->>'canonicalKey' = rows.canonical_key
    )
  on conflict (work_id, semantic_class, canonical_key) do nothing;

  select count(*) into v_inserted
  from xrpl_restore_continuation_v1.xrpl_phase_reference_rows as rows
  where rows.work_id = v_work.work_id
    and exists (
      select 1
      from jsonb_array_elements((v_chunk.payload_json::jsonb)->'records') as record
      where record->>'semanticClass' = rows.semantic_class
        and record->>'canonicalKey' = rows.canonical_key
    );

  if v_inserted <> v_chunk.record_count then
    raise exception 'restore continuation reference rows are incomplete for chunk %', v_chunk_index;
  end if;

  insert into xrpl_restore_continuation_v1.xrpl_phase_commit_chunks (
    work_id, chunk_index, status, operation_count, row_mutation_count,
    chunk_digest, error_message, created_at, updated_at, completed_at
  ) values (
    v_work.work_id, v_chunk_index, 'completed',
    v_source_commit.operation_count, v_source_commit.row_mutation_count,
    v_source_commit.chunk_digest, null,
    p_completed_at, p_completed_at, p_completed_at
  )
  on conflict (work_id, chunk_index) do nothing;

  if not exists (
    select 1
    from xrpl_restore_continuation_v1.xrpl_phase_commit_chunks
    where work_id = v_work.work_id
      and chunk_index = v_chunk_index
      and status = 'completed'
      and operation_count = v_chunk.record_count
      and row_mutation_count = v_chunk.record_count
      and chunk_digest = v_chunk.payload_digest
  ) then
    raise exception 'restore continuation commit evidence conflict';
  end if;

  update xrpl_restore_continuation_v1.xrpl_phase_work
  set status = 'committing', updated_at = p_completed_at
  where work_id = v_work.work_id and status <> 'committed';

  if v_chunk_index + 1 < v_work.expected_commit_chunks then
    v_next_phase := 'commit';
    v_next_id := public.xrpl_phase_commit_message_id(v_work.work_id, v_chunk_index + 1);
    v_next_payload := jsonb_build_object(
      'schemaVersion', 1,
      'phase', 'commit',
      'messageId', v_next_id,
      'workId', v_work.work_id,
      'chunkIndex', v_chunk_index + 1
    );
  else
    v_next_phase := 'finalize';
    v_next_id := public.xrpl_phase_finalize_message_id(v_work.work_id);
    v_next_payload := jsonb_build_object(
      'schemaVersion', 1,
      'phase', 'finalize',
      'messageId', v_next_id,
      'workId', v_work.work_id
    );
  end if;

  perform public.xrpl_restore_continuation_insert_message(
    v_next_phase, v_next_id, v_next_payload, p_completed_at, p_completed_at
  );
  perform public.xrpl_restore_continuation_reserve_successor(
    p_message_id, v_next_id, p_completed_at
  );

  update xrpl_restore_continuation_v1.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'committing',
      'workId', v_work.work_id,
      'chunkIndex', v_chunk_index,
      'operationCount', v_chunk.record_count,
      'rowMutationCount', v_chunk.record_count,
      'chunkDigest', concat('sha256:', v_chunk.payload_digest)
    ),
    successor_message_id = v_next_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'workId', v_work.work_id,
    'chunkIndex', v_chunk_index,
    'rowCount', v_chunk.record_count,
    'successorMessageId', v_next_id,
    'successorPhase', v_next_phase
  );
end;
$$;

create or replace function public.xrpl_complete_restored_continuation_finalize(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
declare
  v_metadata xrpl_restore_continuation_v1.restore_metadata%rowtype;
  v_message xrpl_restore_continuation_v1.xrpl_phase_messages%rowtype;
  v_work xrpl_restore_continuation_v1.xrpl_phase_work%rowtype;
  v_watermark xrpl_restore_continuation_v1.xrpl_phase_watermarks%rowtype;
  v_next_scan_id text;
  v_next_scan_payload jsonb;
  v_expected_rows integer;
begin
  select * into v_metadata
  from xrpl_restore_continuation_v1.restore_metadata
  where fixture_id = 'r4c2c-post-restore-continuation-v1'
  for update;

  select * into v_message
  from xrpl_restore_continuation_v1.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.phase <> 'finalize' then
    raise exception 'restore continuation finalize message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'ledgerIndex', v_metadata.continuation_ledger_index,
      'ledgerHash', v_metadata.continuation_ledger_hash,
      'successorMessageId', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  select * into v_work
  from xrpl_restore_continuation_v1.xrpl_phase_work
  where work_id = v_metadata.continuation_work_id
  for update;

  if not found or v_work.status not in ('committing', 'finalizing') then
    raise exception 'restore continuation work is not finalize-ready';
  end if;
  if (
    select count(*)
    from xrpl_restore_continuation_v1.xrpl_phase_commit_chunks
    where work_id = v_work.work_id and status = 'completed'
  ) <> v_work.expected_commit_chunks
    or (
      select count(*)
      from xrpl_restore_continuation_v1.xrpl_phase_payload_chunks
      where work_id = v_work.work_id and encoded_digest is not null
    ) <> v_work.expected_payload_chunks then
    raise exception 'restore continuation chunk evidence is incomplete';
  end if;

  v_expected_rows := (v_work.semantic_counts_json::jsonb->>'totalRecords')::integer;
  if (
    select count(*)
    from xrpl_restore_continuation_v1.xrpl_phase_reference_rows
    where work_id = v_work.work_id
  ) <> v_expected_rows then
    raise exception 'restore continuation reference rows are incomplete';
  end if;

  select * into v_watermark
  from xrpl_restore_continuation_v1.xrpl_phase_watermarks
  where profile_id = v_metadata.source_profile_id
  for update;

  if not found
    or v_watermark.work_id <> v_metadata.anchor_work_id
    or v_watermark.ledger_index <> v_metadata.anchor_ledger_index
    or v_watermark.ledger_hash <> v_metadata.anchor_ledger_hash
    or v_work.previous_ledger_index <> v_watermark.ledger_index
    or v_work.expected_parent_hash <> v_watermark.ledger_hash then
    raise exception 'restore continuation finalize boundary changed';
  end if;

  update xrpl_restore_continuation_v1.xrpl_phase_work
  set status = 'finalizing', updated_at = p_completed_at
  where work_id = v_work.work_id;

  update xrpl_restore_continuation_v1.xrpl_phase_watermarks
  set
    network = v_work.network,
    epoch_id = v_work.epoch_id,
    base_identity = v_work.base_identity,
    ledger_index = v_work.scanned_end_ledger_index,
    ledger_hash = v_work.final_ledger_hash,
    work_id = v_work.work_id,
    updated_at = p_completed_at
  where profile_id = v_metadata.source_profile_id;

  update xrpl_restore_continuation_v1.xrpl_phase_work
  set
    status = 'committed',
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
  perform public.xrpl_restore_continuation_insert_message(
    'scan', v_next_scan_id, v_next_scan_payload, p_completed_at, p_completed_at
  );
  perform public.xrpl_restore_continuation_reserve_successor(
    p_message_id, v_next_scan_id, p_completed_at
  );

  update xrpl_restore_continuation_v1.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'committed',
      'workId', v_work.work_id,
      'ledgerIndex', v_work.scanned_end_ledger_index,
      'ledgerHash', v_work.final_ledger_hash,
      'semanticCounts', v_work.semantic_counts_json::jsonb,
      'restoredSourceProfileId', v_metadata.source_profile_id
    ),
    successor_message_id = v_next_scan_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  update xrpl_restore_continuation_v1.restore_metadata
  set continued_at = p_completed_at
  where fixture_id = v_metadata.fixture_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'workId', v_work.work_id,
    'ledgerIndex', v_work.scanned_end_ledger_index,
    'ledgerHash', v_work.final_ledger_hash,
    'semanticCounts', v_work.semantic_counts_json::jsonb,
    'successorMessageId', v_next_scan_id
  );
end;
$$;

create or replace function public.xrpl_read_restored_continuation_evidence()
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, extensions, pg_temp
as $$
declare
  v_metadata xrpl_restore_continuation_v1.restore_metadata%rowtype;
  v_state jsonb;
  v_counts jsonb;
  v_watermark xrpl_restore_continuation_v1.xrpl_phase_watermarks%rowtype;
  v_work xrpl_restore_continuation_v1.xrpl_phase_work%rowtype;
  v_active_work public.xrpl_phase_work%rowtype;
  v_messages jsonb;
  v_status_counts jsonb;
  v_phase_sequence jsonb;
  v_target_rows integer;
  v_active_rows integer;
  v_target_digest text;
  v_active_digest text;
begin
  select * into v_metadata
  from xrpl_restore_continuation_v1.restore_metadata
  where fixture_id = 'r4c2c-post-restore-continuation-v1';

  if not found then
    raise exception 'restore continuation evidence is unavailable';
  end if;

  v_state := public.xrpl_build_restored_continuation_state();
  v_counts := public.xrpl_restore_continuation_row_counts();

  select * into v_watermark
  from xrpl_restore_continuation_v1.xrpl_phase_watermarks
  where profile_id = v_metadata.source_profile_id;

  select * into v_work
  from xrpl_restore_continuation_v1.xrpl_phase_work
  where work_id = v_metadata.continuation_work_id;

  select * into v_active_work
  from public.xrpl_phase_work
  where work_id = v_metadata.continuation_work_id;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at, rows.message_id), '[]'::jsonb)
  into v_messages
  from xrpl_restore_continuation_v1.xrpl_phase_messages as rows;

  select coalesce(jsonb_object_agg(status, count), '{}'::jsonb)
  into v_status_counts
  from (
    select status, count(*)::integer as count
    from xrpl_restore_continuation_v1.xrpl_phase_messages
    group by status
  ) statuses;

  select coalesce(jsonb_agg(jsonb_build_object(
    'phase', rows.phase,
    'status', rows.status,
    'messageId', rows.message_id,
    'attemptCount', rows.attempt_count,
    'successorMessageId', rows.successor_message_id
  ) order by rows.created_at, rows.message_id), '[]'::jsonb)
  into v_phase_sequence
  from xrpl_restore_continuation_v1.xrpl_phase_messages as rows;

  select count(*) into v_target_rows
  from xrpl_restore_continuation_v1.xrpl_phase_reference_rows
  where work_id = v_metadata.continuation_work_id;
  select count(*) into v_active_rows
  from public.xrpl_phase_reference_rows
  where work_id = v_metadata.continuation_work_id;

  select encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(rows) order by rows.semantic_class, rows.canonical_key), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  into v_target_digest
  from xrpl_restore_continuation_v1.xrpl_phase_reference_rows as rows
  where rows.work_id = v_metadata.continuation_work_id;
  select encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(rows) order by rows.semantic_class, rows.canonical_key), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  into v_active_digest
  from public.xrpl_phase_reference_rows as rows
  where rows.work_id = v_metadata.continuation_work_id;

  return jsonb_build_object(
    'schemaVersion', 1,
    'fixtureId', v_metadata.fixture_id,
    'sourceProfileId', v_metadata.source_profile_id,
    'activeProfileId', v_metadata.active_profile_id,
    'targetId', v_metadata.target_id,
    'sourceStateDigest', v_metadata.source_state_digest,
    'sourceRowCounts', v_metadata.source_row_counts,
    'restoredAt', v_metadata.restored_at,
    'continuedAt', v_metadata.continued_at,
    'anchor', jsonb_build_object(
      'workId', v_metadata.anchor_work_id,
      'ledgerIndex', v_metadata.anchor_ledger_index,
      'ledgerHash', v_metadata.anchor_ledger_hash
    ),
    'continuation', jsonb_build_object(
      'workId', v_metadata.continuation_work_id,
      'ledgerIndex', v_metadata.continuation_ledger_index,
      'ledgerHash', v_metadata.continuation_ledger_hash
    ),
    'targetWatermark', to_jsonb(v_watermark),
    'targetWork', to_jsonb(v_work),
    'activeSourceWork', to_jsonb(v_active_work),
    'rowCounts', v_counts,
    'messageStatusCounts', v_status_counts,
    'phaseSequence', v_phase_sequence,
    'messages', v_messages,
    'targetStateDigest', public.xrpl_transfer_json_digest(v_state),
    'continuationRowCount', v_target_rows,
    'activeContinuationRowCount', v_active_rows,
    'continuationRowsDigest', v_target_digest,
    'activeContinuationRowsDigest', v_active_digest,
    'checks', jsonb_build_object(
      'continued', v_metadata.continued_at is not null,
      'watermarkAdvancedExactlyOne', v_watermark.ledger_index = v_metadata.anchor_ledger_index + 1,
      'watermarkMatchesDurableSource',
        v_watermark.ledger_index = v_metadata.continuation_ledger_index
        and v_watermark.ledger_hash = v_metadata.continuation_ledger_hash
        and v_watermark.work_id = v_metadata.continuation_work_id,
      'workCommitted', v_work.status = 'committed' and v_work.committed_at is not null,
      'committedRowsOnly', v_work.status = 'committed',
      'rowCountParity', v_target_rows = v_active_rows,
      'rowDigestParity', v_target_digest = v_active_digest,
      'sourceReboundExplicitly', v_metadata.source_profile_id <> v_metadata.active_profile_id
    )
  );
end;
$$;

revoke all on schema xrpl_restore_continuation_v1 from public, anon, authenticated;
revoke all on all tables in schema xrpl_restore_continuation_v1 from public, anon, authenticated;

revoke all on function public.xrpl_build_restored_continuation_state() from public, anon, authenticated;
revoke all on function public.xrpl_restore_continuation_row_counts() from public, anon, authenticated;
revoke all on function public.xrpl_prepare_restored_continuation(timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_restore_continuation_insert_message(text, text, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_restore_continuation_reserve_successor(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_claim_restored_continuation_phase(text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.xrpl_complete_restored_continuation_scan(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_complete_restored_continuation_commit(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_complete_restored_continuation_finalize(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_read_restored_continuation_evidence() from public, anon, authenticated;

grant usage on schema xrpl_restore_continuation_v1 to service_role;
grant select, insert, update on all tables in schema xrpl_restore_continuation_v1 to service_role;
grant execute on function public.xrpl_build_restored_continuation_state() to service_role;
grant execute on function public.xrpl_restore_continuation_row_counts() to service_role;
grant execute on function public.xrpl_prepare_restored_continuation(timestamptz) to service_role;
grant execute on function public.xrpl_restore_continuation_insert_message(text, text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.xrpl_restore_continuation_reserve_successor(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_claim_restored_continuation_phase(text, timestamptz, integer) to service_role;
grant execute on function public.xrpl_complete_restored_continuation_scan(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_complete_restored_continuation_commit(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_complete_restored_continuation_finalize(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_read_restored_continuation_evidence() to service_role;
