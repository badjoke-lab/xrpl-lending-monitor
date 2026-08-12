-- Qualification-only compact checkpoint for the exact revision-4 12-ledger proof.
--
-- This statement deliberately does NOT materialize the historical messages/work/
-- chunk/reference-row sets. It preserves the strict active-boundary invariants
-- needed by the existing recovery prepare/rebind path, stores exact source row
-- counts, and commits only the bounded rows that prove the quiescent watermark
-- boundary. The resulting checkpoint is explicitly marked qualification-only and
-- must never be treated as a complete recovery snapshot.
--
-- Render-time placeholders (validated before substitution by the workflow):
--   __CHECKPOINT_ID__      ^r5-checkpoint-revision4-proof-[0-9]+$
--   __SELECTION_DIGEST__   ^[a-f0-9]{64}$
--   __OBSERVED_AT__        RFC3339 UTC second precision

with
active_checkpoint_lock as materialized (
  select pg_advisory_xact_lock(
    hashtextextended('xrpl-r5-active-checkpoint', 0)
  ) as locked
),
boundary_drain as materialized (
  select public.xrpl_drain_r5_checkpoint_boundary(
    'r5-rev4-qual-' || substr(
      encode(
        extensions.digest(
          convert_to('__CHECKPOINT_ID__', 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      1,
      24
    ),
    '__OBSERVED_AT__'::timestamptz
  ) as value
  from active_checkpoint_lock
),
runtime as materialized (
  select r.*
  from public.xrpl_collector_runtime r
  cross join boundary_drain d
  where r.profile_id = 'supabase-devnet'
    and r.network = 'devnet'
    and r.status = 'stopped'
    and r.lease_owner is null
    and r.lease_expires_at is null
    and r.last_error is null
    and r.consecutive_failures = 0
),
stream as materialized (
  select s.*
  from public.xrpl_phase_streams s
  cross join boundary_drain d
  where s.profile_id = 'supabase-devnet'
    and s.network = 'devnet'
    and s.epoch_id = 'supabase-r4c2c-v1'
    and s.status = 'active'
    and s.last_error_classification is null
    and s.last_error_message is null
),
watermark as materialized (
  select w.*
  from public.xrpl_phase_watermarks w
  join stream s
    on s.profile_id = w.profile_id
   and s.network = w.network
   and s.epoch_id = w.epoch_id
   and s.base_identity = w.base_identity
  where w.profile_id = 'supabase-devnet'
),
pending_scan as materialized (
  select m.*
  from public.xrpl_phase_messages m
  join stream s on s.profile_id = m.profile_id
  join watermark w on w.profile_id = m.profile_id
  where m.profile_id = 'supabase-devnet'
    and m.status = 'pending'
    and m.phase = 'scan'
    and (m.payload->>'expectedPreviousLedgerIndex')::bigint = w.ledger_index
    and upper(m.payload->>'expectedPreviousLedgerHash') = w.ledger_hash
    and m.payload->>'network' = s.network
    and m.payload->>'epochId' = s.epoch_id
    and m.payload->>'baseIdentity' = s.base_identity
),
predecessor_finalize as materialized (
  select predecessor.*
  from pending_scan pending
  join public.xrpl_phase_successors successor
    on successor.successor_message_id = pending.message_id
  join public.xrpl_phase_messages predecessor
    on predecessor.message_id = successor.current_message_id
  join watermark w on true
  where predecessor.profile_id = 'supabase-devnet'
    and predecessor.phase = 'finalize'
    and predecessor.status = 'completed'
    and predecessor.result->>'status' = 'committed'
    and predecessor.result->>'workId' = w.work_id
    and (predecessor.result->>'ledgerIndex')::bigint = w.ledger_index
    and upper(predecessor.result->>'ledgerHash') = w.ledger_hash
),
watermark_work as materialized (
  select work.*
  from public.xrpl_phase_work work
  join stream s
    on s.profile_id = work.profile_id
   and s.network = work.network
   and s.epoch_id = work.epoch_id
   and s.base_identity = work.base_identity
  join watermark w on w.work_id = work.work_id
  where work.profile_id = 'supabase-devnet'
    and work.status = 'committed'
    and work.scanned_end_ledger_index = w.ledger_index
    and work.final_ledger_hash = w.ledger_hash
    and work.committed_at is not null
),
message_counts as materialized (
  select
    count(*)::integer as messages,
    count(*) filter (where status = 'pending')::integer as pending_messages,
    count(*) filter (where status = 'leased')::integer as leased_messages,
    count(*) filter (where status = 'retry')::integer as retry_messages,
    count(*) filter (where status = 'error')::integer as error_messages
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet'
),
work_counts as materialized (
  select
    count(*)::integer as work,
    count(*) filter (
      where status in ('planned', 'staged', 'committing', 'finalizing')
    )::integer as inflight_work,
    count(*) filter (where status = 'error')::integer as error_work
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
),
successor_counts as materialized (
  select count(*)::integer as successors
  from public.xrpl_phase_successors successors
  join public.xrpl_phase_messages messages
    on messages.message_id = successors.current_message_id
  where messages.profile_id = 'supabase-devnet'
),
payload_chunk_counts as materialized (
  select count(*)::integer as payload_chunks
  from public.xrpl_phase_payload_chunks chunks
  join public.xrpl_phase_work work on work.work_id = chunks.work_id
  where work.profile_id = 'supabase-devnet'
),
reference_row_counts as materialized (
  select count(*)::integer as reference_rows
  from public.xrpl_phase_reference_rows reference_rows
  join public.xrpl_phase_work work on work.work_id = reference_rows.work_id
  where work.profile_id = 'supabase-devnet'
),
commit_chunk_counts as materialized (
  select count(*)::integer as commit_chunks
  from public.xrpl_phase_commit_chunks chunks
  join public.xrpl_phase_work work on work.work_id = chunks.work_id
  where work.profile_id = 'supabase-devnet'
),
resource_counts as materialized (
  select
    (select count(*)::integer from xrpl_resource_guard_v2.attempts)
      as resource_attempts,
    (select count(*)::integer from xrpl_resource_guard_v2.tick_accounting)
      as resource_tick_accounting
),
qualified_boundary as materialized (
  select
    to_jsonb(r) as runtime_json,
    to_jsonb(s) as stream_json,
    to_jsonb(w) as watermark_json,
    to_jsonb(pending) as pending_scan_json,
    to_jsonb(predecessor) as predecessor_finalize_json,
    to_jsonb(work) as watermark_work_json,
    d.value as boundary_drain_json,
    w.ledger_index as watermark_ledger_index,
    w.ledger_hash as watermark_ledger_hash,
    w.work_id as watermark_work_id,
    s.network,
    s.epoch_id,
    s.base_identity,
    mc.messages,
    mc.pending_messages,
    mc.leased_messages,
    mc.retry_messages,
    mc.error_messages,
    wc.work,
    wc.inflight_work,
    wc.error_work,
    sc.successors,
    pc.payload_chunks,
    rc.reference_rows,
    cc.commit_chunks,
    resource.resource_attempts,
    resource.resource_tick_accounting
  from boundary_drain d
  cross join runtime r
  cross join stream s
  cross join watermark w
  cross join pending_scan pending
  cross join predecessor_finalize predecessor
  cross join watermark_work work
  cross join message_counts mc
  cross join work_counts wc
  cross join successor_counts sc
  cross join payload_chunk_counts pc
  cross join reference_row_counts rc
  cross join commit_chunk_counts cc
  cross join resource_counts resource
  where coalesce((d.value->>'drained')::boolean, false) is true
    and d.value->>'purpose' = 'r5-checkpoint-boundary-drain'
    and coalesce((d.value #>> '{checks,collectorQuiescent}')::boolean, false) is true
    and coalesce((d.value #>> '{checks,activeStreamHealthy}')::boolean, false) is true
    and coalesce((d.value #>> '{checks,noScanExecuted}')::boolean, false) is true
    and coalesce((d.value #>> '{checks,onePendingScan}')::boolean, false) is true
    and coalesce((d.value #>> '{checks,pendingScanBoundToWatermark}')::boolean, false) is true
    and coalesce((d.value #>> '{checks,noInflightWork}')::boolean, false) is true
    and coalesce((d.value #>> '{checks,watermarkIdentityPreserved}')::boolean, false) is true
    and (d.value #>> '{watermarkAfter,ledgerIndex}')::bigint = w.ledger_index
    and upper(d.value #>> '{watermarkAfter,ledgerHash}') = w.ledger_hash
    and d.value #>> '{watermarkAfter,workId}' = w.work_id
    and d.value #>> '{pendingScan,messageId}' = pending.message_id
    and mc.pending_messages = 1
    and mc.leased_messages = 0
    and mc.retry_messages = 0
    and wc.inflight_work = 0
),
checkpoint_material as materialized (
  select
    q.*,
    jsonb_build_object(
      'runtime', 1,
      'streams', 1,
      'watermarks', 1,
      'messages', q.messages,
      'pendingMessages', q.pending_messages,
      'leasedMessages', q.leased_messages,
      'retryMessages', q.retry_messages,
      'errorMessages', q.error_messages,
      'successors', q.successors,
      'work', q.work,
      'inflightWork', q.inflight_work,
      'errorWork', q.error_work,
      'payloadChunks', q.payload_chunks,
      'referenceRows', q.reference_rows,
      'commitChunks', q.commit_chunks,
      'resourceAttempts', q.resource_attempts,
      'resourceTickAccounting', q.resource_tick_accounting
    ) as row_counts,
    jsonb_build_object(
      'runtime', public.xrpl_transfer_json_digest(q.runtime_json),
      'stream', public.xrpl_transfer_json_digest(q.stream_json),
      'watermark', public.xrpl_transfer_json_digest(q.watermark_json),
      'pendingScan', public.xrpl_transfer_json_digest(q.pending_scan_json),
      'predecessorFinalize',
        public.xrpl_transfer_json_digest(q.predecessor_finalize_json),
      'watermarkWork', public.xrpl_transfer_json_digest(q.watermark_work_json),
      'boundaryDrain', public.xrpl_transfer_json_digest(q.boundary_drain_json),
      'resourceCounts', public.xrpl_transfer_json_digest(
        jsonb_build_object(
          'attempts', q.resource_attempts,
          'tickAccounting', q.resource_tick_accounting
        )
      )
    ) as section_digests
  from qualified_boundary q
),
checkpoint_state as materialized (
  select
    m.*,
    jsonb_build_object(
      'schemaVersion', 1,
      'purpose', 'r5-revision4-qualification-boundary-checkpoint',
      'selectedProfile', jsonb_build_object(
        'profileId', 'supabase_free_postgres_pgcron_edge',
        'profileRevision', 4,
        'profileIdentityDigest',
          '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
        'selectionDigest', '__SELECTION_DIGEST__'
      ),
      'observedAt', '__OBSERVED_AT__'::timestamptz,
      'activeBoundary', jsonb_build_object(
        'runtime', m.runtime_json,
        'stream', m.stream_json,
        'watermark', m.watermark_json,
        'pendingScan', m.pending_scan_json,
        'predecessorFinalize', m.predecessor_finalize_json,
        'watermarkWork', m.watermark_work_json
      ),
      'boundaryDrain', m.boundary_drain_json,
      'rowCounts', m.row_counts,
      'sectionDigests', m.section_digests,
      'checks', jsonb_build_object(
        'collectorQuiescent', true,
        'activeStreamHealthy', true,
        'onePendingSuccessorScan', true,
        'pendingScanBoundToWatermark', true,
        'completedFinalizeBoundToWatermark', true,
        'watermarkWorkCommitted', true,
        'noInflightWork', true,
        'exactRevision4Identity', true,
        'qualificationBoundaryOnly', true,
        'fullRecoveryStateCaptured', false,
        'legacyRevision3AccountingStateRetained', false,
        'publicReaderUnchanged', true,
        'mainnetDisabled', true,
        'activeRecoveryStarted', false,
        'stabilizationAuthorized', false,
        'soakAuthorized', false
      )
    ) as state
  from checkpoint_material m
),
checkpoint_payload as materialized (
  select
    s.*,
    public.xrpl_transfer_json_digest(s.state) as state_digest
  from checkpoint_state s
),
inserted as (
  insert into xrpl_r5_v1.active_checkpoints (
    checkpoint_id,
    profile_id,
    profile_revision,
    profile_identity_digest,
    selection_digest,
    source_profile_id,
    network,
    epoch_id,
    base_identity,
    watermark_ledger_index,
    watermark_ledger_hash,
    watermark_work_id,
    observed_at,
    state_digest,
    row_counts,
    section_digests,
    state
  )
  select
    '__CHECKPOINT_ID__',
    'supabase_free_postgres_pgcron_edge',
    4,
    '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
    '__SELECTION_DIGEST__',
    'supabase-devnet',
    p.network,
    p.epoch_id,
    p.base_identity,
    p.watermark_ledger_index,
    p.watermark_ledger_hash,
    p.watermark_work_id,
    '__OBSERVED_AT__'::timestamptz,
    p.state_digest,
    p.row_counts,
    p.section_digests,
    p.state
  from checkpoint_payload p
  on conflict (checkpoint_id) do nothing
  returning *
),
selected_checkpoint as materialized (
  select i.*, false as duplicate
  from inserted i
  union all
  select existing.*, true as duplicate
  from xrpl_r5_v1.active_checkpoints existing
  where existing.checkpoint_id = '__CHECKPOINT_ID__'
    and not exists (select 1 from inserted)
),
validated_checkpoint as materialized (
  select selected.*, payload.state as expected_state,
         payload.state_digest as expected_state_digest
  from selected_checkpoint selected
  cross join checkpoint_payload payload
  where selected.profile_id = 'supabase_free_postgres_pgcron_edge'
    and selected.profile_revision = 4
    and selected.profile_identity_digest =
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    and selected.selection_digest = '__SELECTION_DIGEST__'
    and selected.source_profile_id = 'supabase-devnet'
    and selected.network = 'devnet'
    and selected.epoch_id = 'supabase-r4c2c-v1'
    and selected.state = payload.state
    and selected.state_digest = payload.state_digest
    and public.xrpl_transfer_json_digest(selected.state) = selected.state_digest
    and selected.state->>'purpose' =
      'r5-revision4-qualification-boundary-checkpoint'
    and selected.state #>> '{selectedProfile,profileRevision}' = '4'
    and selected.state #>> '{selectedProfile,profileIdentityDigest}' =
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    and selected.state #>> '{selectedProfile,selectionDigest}' =
      '__SELECTION_DIGEST__'
    and coalesce(
      (selected.state #>> '{checks,qualificationBoundaryOnly}')::boolean,
      false
    ) is true
    and coalesce(
      (selected.state #>> '{checks,fullRecoveryStateCaptured}')::boolean,
      true
    ) is false
)
select jsonb_build_object(
  'created', true,
  'duplicate', v.duplicate,
  'checkpointId', v.checkpoint_id,
  'checkpointKind', 'revision4-qualification-boundary',
  'profileRevision', v.profile_revision,
  'profileIdentityDigest', v.profile_identity_digest,
  'selectionDigest', v.selection_digest,
  'stateDigest', v.state_digest,
  'watermarkLedgerIndex', v.watermark_ledger_index,
  'watermarkLedgerHash', v.watermark_ledger_hash,
  'watermarkWorkId', v.watermark_work_id,
  'rowCounts', v.row_counts,
  'sectionDigests', v.section_digests,
  'stateBytes', octet_length(convert_to(v.state::text, 'UTF8')),
  'qualificationBoundaryOnly', true,
  'fullRecoveryStateCaptured', false,
  'publicReaderUnchanged', true,
  'mainnetDisabled', true
) as value
from validated_checkpoint v;
