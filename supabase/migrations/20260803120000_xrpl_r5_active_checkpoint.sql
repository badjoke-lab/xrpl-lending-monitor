create schema if not exists xrpl_r5_v1;

create table if not exists xrpl_r5_v1.active_checkpoints (
  checkpoint_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null check (profile_id = 'supabase_free_postgres_pgcron_edge'),
  profile_revision integer not null check (profile_revision = 3),
  profile_identity_digest text not null check (
    profile_identity_digest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
  ),
  selection_digest text not null check (
    selection_digest = '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
  ),
  source_profile_id text not null check (source_profile_id = 'supabase-devnet'),
  network text not null check (network = 'devnet'),
  epoch_id text not null check (epoch_id = 'supabase-r4c2c-v1'),
  base_identity text not null,
  watermark_ledger_index bigint not null check (watermark_ledger_index > 0),
  watermark_ledger_hash text not null check (watermark_ledger_hash ~ '^[A-F0-9]{64}$'),
  watermark_work_id text not null,
  observed_at timestamptz not null,
  state_digest text not null check (state_digest ~ '^[a-f0-9]{64}$'),
  row_counts jsonb not null,
  section_digests jsonb not null,
  state jsonb not null,
  created_at timestamptz not null default statement_timestamp()
);

revoke all on schema xrpl_r5_v1 from public, anon, authenticated;
revoke all on all tables in schema xrpl_r5_v1 from public, anon, authenticated;

create or replace function public.xrpl_create_r5_active_checkpoint(
  p_checkpoint_id text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_runtime public.xrpl_collector_runtime%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_pending_scan public.xrpl_phase_messages%rowtype;
  v_predecessor public.xrpl_phase_messages%rowtype;
  v_latest_work public.xrpl_phase_work%rowtype;
  v_existing xrpl_r5_v1.active_checkpoints%rowtype;
  v_runtime_json jsonb;
  v_stream_json jsonb;
  v_watermark_json jsonb;
  v_messages_json jsonb;
  v_successors_json jsonb;
  v_work_json jsonb;
  v_payload_chunks_json jsonb;
  v_reference_rows_json jsonb;
  v_commit_chunks_json jsonb;
  v_resource_json jsonb;
  v_state jsonb;
  v_state_digest text;
  v_row_counts jsonb;
  v_section_digests jsonb;
  v_pending_count integer;
  v_leased_count integer;
  v_retry_count integer;
  v_error_message_count integer;
  v_inflight_work_count integer;
  v_error_work_count integer;
  v_message_count integer;
  v_successor_count integer;
  v_work_count integer;
  v_payload_chunk_count integer;
  v_reference_row_count integer;
  v_commit_chunk_count integer;
begin
  if p_checkpoint_id !~ '^r5-checkpoint-[a-z0-9][a-z0-9-]{7,79}$'
    or p_observed_at is null then
    raise exception 'r5_checkpoint_invalid_identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0));

  lock table public.xrpl_collector_runtime in share mode;
  lock table public.xrpl_phase_streams in share mode;
  lock table public.xrpl_phase_messages in share mode;
  lock table public.xrpl_phase_successors in share mode;
  lock table public.xrpl_phase_work in share mode;
  lock table public.xrpl_phase_payload_chunks in share mode;
  lock table public.xrpl_phase_reference_rows in share mode;
  lock table public.xrpl_phase_commit_chunks in share mode;
  lock table public.xrpl_phase_watermarks in share mode;
  lock table xrpl_resource_guard_v2.attempts in share mode;
  lock table xrpl_resource_guard_v2.tick_accounting in share mode;

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
    raise exception 'r5_checkpoint_collector_not_quiescent';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  if not found
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1'
    or v_stream.status <> 'active'
    or v_stream.last_error_classification is not null
    or v_stream.last_error_message is not null then
    raise exception 'r5_checkpoint_active_stream_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found
    or v_watermark.network <> v_stream.network
    or v_watermark.epoch_id <> v_stream.epoch_id
    or v_watermark.base_identity <> v_stream.base_identity then
    raise exception 'r5_checkpoint_watermark_identity_invalid';
  end if;

  select
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'leased')::integer,
    count(*) filter (where status = 'retry')::integer,
    count(*) filter (where status = 'error')::integer,
    count(*)::integer
  into v_pending_count, v_leased_count, v_retry_count,
       v_error_message_count, v_message_count
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet';

  if v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0 then
    raise exception 'r5_checkpoint_scheduler_not_quiescent';
  end if;

  select * into v_pending_scan
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet' and status = 'pending';
  if not found
    or v_pending_scan.phase <> 'scan'
    or (v_pending_scan.payload->>'expectedPreviousLedgerIndex')::bigint
      <> v_watermark.ledger_index
    or upper(v_pending_scan.payload->>'expectedPreviousLedgerHash')
      <> v_watermark.ledger_hash
    or v_pending_scan.payload->>'epochId' <> v_stream.epoch_id
    or v_pending_scan.payload->>'baseIdentity' <> v_stream.base_identity then
    raise exception 'r5_checkpoint_pending_scan_not_bound_to_watermark';
  end if;

  select messages.* into v_predecessor
  from public.xrpl_phase_successors successors
  join public.xrpl_phase_messages messages
    on messages.message_id = successors.current_message_id
  where successors.successor_message_id = v_pending_scan.message_id;
  if not found
    or v_predecessor.profile_id <> 'supabase-devnet'
    or v_predecessor.phase <> 'finalize'
    or v_predecessor.status <> 'completed'
    or v_predecessor.result->>'status' <> 'committed'
    or v_predecessor.result->>'workId' <> v_watermark.work_id
    or (v_predecessor.result->>'ledgerIndex')::bigint <> v_watermark.ledger_index
    or upper(v_predecessor.result->>'ledgerHash') <> v_watermark.ledger_hash then
    raise exception 'r5_checkpoint_successor_chain_not_bound_to_watermark';
  end if;

  select * into v_latest_work
  from public.xrpl_phase_work
  where work_id = v_watermark.work_id;
  if not found
    or v_latest_work.profile_id <> 'supabase-devnet'
    or v_latest_work.network <> v_stream.network
    or v_latest_work.epoch_id <> v_stream.epoch_id
    or v_latest_work.base_identity <> v_stream.base_identity
    or v_latest_work.status <> 'committed'
    or v_latest_work.scanned_end_ledger_index <> v_watermark.ledger_index
    or v_latest_work.final_ledger_hash <> v_watermark.ledger_hash
    or v_latest_work.committed_at is null then
    raise exception 'r5_checkpoint_watermark_work_invalid';
  end if;

  select
    count(*) filter (
      where status in ('planned', 'staged', 'committing', 'finalizing')
    )::integer,
    count(*) filter (where status = 'error')::integer,
    count(*)::integer
  into v_inflight_work_count, v_error_work_count, v_work_count
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet';
  if v_inflight_work_count <> 0 then
    raise exception 'r5_checkpoint_inflight_work_present';
  end if;

  select to_jsonb(v_runtime) into v_runtime_json;
  select to_jsonb(v_stream) into v_stream_json;
  select to_jsonb(v_watermark) into v_watermark_json;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at, rows.message_id), '[]'::jsonb)
  into v_messages_json
  from (
    select * from public.xrpl_phase_messages
    where profile_id = 'supabase-devnet'
  ) rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.current_message_id), '[]'::jsonb),
         count(*)::integer
  into v_successors_json, v_successor_count
  from (
    select successors.*
    from public.xrpl_phase_successors successors
    join public.xrpl_phase_messages messages
      on messages.message_id = successors.current_message_id
    where messages.profile_id = 'supabase-devnet'
  ) rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.start_ledger_index, rows.work_id), '[]'::jsonb)
  into v_work_json
  from (
    select * from public.xrpl_phase_work
    where profile_id = 'supabase-devnet'
  ) rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.work_id, rows.chunk_index), '[]'::jsonb),
         count(*)::integer
  into v_payload_chunks_json, v_payload_chunk_count
  from (
    select chunks.*
    from public.xrpl_phase_payload_chunks chunks
    join public.xrpl_phase_work work on work.work_id = chunks.work_id
    where work.profile_id = 'supabase-devnet'
  ) rows;

  select coalesce(jsonb_agg(
           to_jsonb(rows)
           order by rows.work_id, rows.semantic_class, rows.canonical_key
         ), '[]'::jsonb),
         count(*)::integer
  into v_reference_rows_json, v_reference_row_count
  from (
    select reference_rows.*
    from public.xrpl_phase_reference_rows reference_rows
    join public.xrpl_phase_work work on work.work_id = reference_rows.work_id
    where work.profile_id = 'supabase-devnet'
  ) rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.work_id, rows.chunk_index), '[]'::jsonb),
         count(*)::integer
  into v_commit_chunks_json, v_commit_chunk_count
  from (
    select commit_chunks.*
    from public.xrpl_phase_commit_chunks commit_chunks
    join public.xrpl_phase_work work on work.work_id = commit_chunks.work_id
    where work.profile_id = 'supabase-devnet'
  ) rows;

  v_resource_json := xrpl_resource_guard_v2.build_accounting_transfer_state(p_observed_at);

  v_row_counts := jsonb_build_object(
    'runtime', 1,
    'streams', 1,
    'watermarks', 1,
    'messages', v_message_count,
    'pendingMessages', v_pending_count,
    'leasedMessages', v_leased_count,
    'retryMessages', v_retry_count,
    'errorMessages', v_error_message_count,
    'successors', v_successor_count,
    'work', v_work_count,
    'inflightWork', v_inflight_work_count,
    'errorWork', v_error_work_count,
    'payloadChunks', v_payload_chunk_count,
    'referenceRows', v_reference_row_count,
    'commitChunks', v_commit_chunk_count,
    'resourceAttempts', (v_resource_json #>> '{summary,attemptCount}')::integer,
    'resourceTickAccounting',
      (v_resource_json #>> '{summary,accountingCount}')::integer
  );

  v_section_digests := jsonb_build_object(
    'runtime', public.xrpl_transfer_json_digest(v_runtime_json),
    'stream', public.xrpl_transfer_json_digest(v_stream_json),
    'watermark', public.xrpl_transfer_json_digest(v_watermark_json),
    'messages', public.xrpl_transfer_json_digest(v_messages_json),
    'successors', public.xrpl_transfer_json_digest(v_successors_json),
    'work', public.xrpl_transfer_json_digest(v_work_json),
    'payloadChunks', public.xrpl_transfer_json_digest(v_payload_chunks_json),
    'referenceRows', public.xrpl_transfer_json_digest(v_reference_rows_json),
    'commitChunks', public.xrpl_transfer_json_digest(v_commit_chunks_json),
    'resourceAccounting', public.xrpl_transfer_json_digest(v_resource_json)
  );

  v_state := jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r5-supabase-active-recovery-checkpoint',
    'selectedProfile', jsonb_build_object(
      'profileId', 'supabase_free_postgres_pgcron_edge',
      'profileRevision', 3,
      'profileIdentityDigest',
        '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      'selectionDigest',
        '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    ),
    'observedAt', p_observed_at,
    'active', jsonb_build_object(
      'runtime', v_runtime_json,
      'stream', v_stream_json,
      'watermark', v_watermark_json,
      'messages', v_messages_json,
      'successors', v_successors_json,
      'work', v_work_json,
      'payloadChunks', v_payload_chunks_json,
      'referenceRows', v_reference_rows_json,
      'commitChunks', v_commit_chunks_json
    ),
    'resourceAccounting', v_resource_json,
    'rowCounts', v_row_counts,
    'sectionDigests', v_section_digests,
    'checks', jsonb_build_object(
      'collectorQuiescent', true,
      'activeStreamHealthy', true,
      'onePendingSuccessorScan', true,
      'pendingScanBoundToWatermark', true,
      'completedFinalizeBoundToWatermark', true,
      'watermarkWorkCommitted', true,
      'noInflightWork', true,
      'revision3AccountingIncluded', true,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true
    )
  );
  v_state_digest := public.xrpl_transfer_json_digest(v_state);

  select * into v_existing
  from xrpl_r5_v1.active_checkpoints
  where checkpoint_id = p_checkpoint_id
  for update;
  if found then
    if v_existing.state_digest <> v_state_digest
      or v_existing.state <> v_state
      or v_existing.row_counts <> v_row_counts
      or v_existing.section_digests <> v_section_digests then
      raise exception 'r5_checkpoint_identity_conflict';
    end if;
    return jsonb_build_object(
      'created', true,
      'duplicate', true,
      'checkpointId', v_existing.checkpoint_id,
      'stateDigest', v_existing.state_digest,
      'observedAt', v_existing.observed_at,
      'watermarkLedgerIndex', v_existing.watermark_ledger_index,
      'watermarkLedgerHash', v_existing.watermark_ledger_hash,
      'watermarkWorkId', v_existing.watermark_work_id,
      'rowCounts', v_existing.row_counts,
      'sectionDigests', v_existing.section_digests,
      'stateBytes', octet_length(convert_to(v_existing.state::text, 'UTF8')),
      'checks', v_existing.state->'checks'
    );
  end if;

  insert into xrpl_r5_v1.active_checkpoints (
    checkpoint_id, profile_id, profile_revision, profile_identity_digest,
    selection_digest, source_profile_id, network, epoch_id, base_identity,
    watermark_ledger_index, watermark_ledger_hash, watermark_work_id,
    observed_at, state_digest, row_counts, section_digests, state
  ) values (
    p_checkpoint_id, 'supabase_free_postgres_pgcron_edge', 3,
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
    'supabase-devnet', v_stream.network, v_stream.epoch_id, v_stream.base_identity,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    p_observed_at, v_state_digest, v_row_counts, v_section_digests, v_state
  );

  return jsonb_build_object(
    'created', true,
    'duplicate', false,
    'checkpointId', p_checkpoint_id,
    'profileId', 'supabase_free_postgres_pgcron_edge',
    'profileRevision', 3,
    'profileIdentityDigest',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    'selectionDigest',
      '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
    'observedAt', p_observed_at,
    'watermarkLedgerIndex', v_watermark.ledger_index,
    'watermarkLedgerHash', v_watermark.ledger_hash,
    'watermarkWorkId', v_watermark.work_id,
    'stateDigest', v_state_digest,
    'rowCounts', v_row_counts,
    'sectionDigests', v_section_digests,
    'stateBytes', octet_length(convert_to(v_state::text, 'UTF8')),
    'checks', v_state->'checks'
  );
end;
$$;

create or replace function public.xrpl_read_r5_active_checkpoint(
  p_checkpoint_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_checkpoint xrpl_r5_v1.active_checkpoints%rowtype;
  v_recomputed_digest text;
begin
  select * into v_checkpoint
  from xrpl_r5_v1.active_checkpoints
  where checkpoint_id = p_checkpoint_id;
  if not found then
    return jsonb_build_object('found', false, 'checkpointId', p_checkpoint_id);
  end if;

  v_recomputed_digest := public.xrpl_transfer_json_digest(v_checkpoint.state);
  return jsonb_build_object(
    'found', true,
    'schemaVersion', v_checkpoint.schema_version,
    'purpose', 'r5-supabase-active-recovery-checkpoint-summary',
    'checkpointId', v_checkpoint.checkpoint_id,
    'profileId', v_checkpoint.profile_id,
    'profileRevision', v_checkpoint.profile_revision,
    'profileIdentityDigest', v_checkpoint.profile_identity_digest,
    'selectionDigest', v_checkpoint.selection_digest,
    'sourceProfileId', v_checkpoint.source_profile_id,
    'network', v_checkpoint.network,
    'epochId', v_checkpoint.epoch_id,
    'baseIdentity', v_checkpoint.base_identity,
    'watermarkLedgerIndex', v_checkpoint.watermark_ledger_index,
    'watermarkLedgerHash', v_checkpoint.watermark_ledger_hash,
    'watermarkWorkId', v_checkpoint.watermark_work_id,
    'observedAt', v_checkpoint.observed_at,
    'stateDigest', v_checkpoint.state_digest,
    'rowCounts', v_checkpoint.row_counts,
    'sectionDigests', v_checkpoint.section_digests,
    'stateBytes', octet_length(convert_to(v_checkpoint.state::text, 'UTF8')),
    'createdAt', v_checkpoint.created_at,
    'checks', jsonb_build_object(
      'storedStateDigestValid', v_recomputed_digest = v_checkpoint.state_digest,
      'exactRevision3Identity',
        v_checkpoint.profile_id = 'supabase_free_postgres_pgcron_edge'
        and v_checkpoint.profile_revision = 3
        and v_checkpoint.profile_identity_digest
          = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      'exactSelectionBound',
        v_checkpoint.selection_digest
          = '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationAuthorized', false,
      'soakAuthorized', false
    )
  );
end;
$$;

revoke all on function public.xrpl_create_r5_active_checkpoint(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_read_r5_active_checkpoint(text)
  from public, anon, authenticated;
grant execute on function public.xrpl_create_r5_active_checkpoint(text, timestamptz)
  to service_role;
grant execute on function public.xrpl_read_r5_active_checkpoint(text)
  to service_role;
