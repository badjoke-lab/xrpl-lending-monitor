-- Qualification-only compact checkpoint for the exact revision-4 12-ledger proof.
--
-- The trusted checkpoint-boundary drain is the authoritative proof of the
-- post-drain scan boundary. Do not re-read phase tables in the same SQL statement
-- after invoking the drain: the canonical active-checkpoint wrapper sequences the
-- drain and the strict snapshot as separate PL/pgSQL commands, while one SQL
-- statement has statement-snapshot semantics that are not equivalent to that
-- procedural boundary. This compact qualification checkpoint therefore binds
-- directly to the validated drain result and never claims a complete recovery
-- snapshot.
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
existing_checkpoint as materialized (
  select existing.*
  from xrpl_r5_v1.active_checkpoints existing
  cross join active_checkpoint_lock checkpoint_lock
  where existing.checkpoint_id = '__CHECKPOINT_ID__'
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
  where not exists (select 1 from existing_checkpoint)
),
qualified_boundary as materialized (
  select
    d.value as boundary_drain_json,
    (d.value->>'drainedStepCount')::integer as drained_step_count,
    (d.value #>> '{watermarkBefore,ledgerIndex}')::bigint
      as watermark_before_ledger_index,
    upper(d.value #>> '{watermarkBefore,ledgerHash}')
      as watermark_before_ledger_hash,
    d.value #>> '{watermarkBefore,workId}' as watermark_before_work_id,
    (d.value #>> '{watermarkAfter,ledgerIndex}')::bigint
      as watermark_ledger_index,
    upper(d.value #>> '{watermarkAfter,ledgerHash}') as watermark_ledger_hash,
    d.value #>> '{watermarkAfter,workId}' as watermark_work_id,
    d.value->>'network' as network,
    d.value->>'epochId' as epoch_id,
    d.value->>'baseIdentity' as base_identity
  from boundary_drain d
  where coalesce((d.value->>'drained')::boolean, false) is true
    and d.value->>'purpose' = 'r5-checkpoint-boundary-drain'
    and d.value->>'profileId' = 'supabase_free_postgres_pgcron_edge'
    and (d.value->>'profileRevision')::integer = 3
    and d.value->>'profileIdentityDigest' =
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    and d.value->>'sourceProfileId' = 'supabase-devnet'
    and d.value->>'network' = 'devnet'
    and d.value->>'epochId' = 'supabase-r4c2c-v1'
    and coalesce(d.value->>'baseIdentity', '') <> ''
    and (d.value->>'drainedStepCount')::integer between 0 and 256
    and jsonb_typeof(d.value->'drainedPhases') = 'array'
    and (d.value->>'drainedStepCount')::integer =
      jsonb_array_length(d.value->'drainedPhases')
    and not exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(d.value->'drainedPhases') = 'array'
            then d.value->'drainedPhases'
          else '[]'::jsonb
        end
      ) drained_phase
      where drained_phase->>'phase' not in ('commit', 'finalize')
    )
    and coalesce(
      (d.value #>> '{checks,collectorQuiescent}')::boolean,
      false
    ) is true
    and coalesce(
      (d.value #>> '{checks,activeStreamHealthy}')::boolean,
      false
    ) is true
    and coalesce(
      (d.value #>> '{checks,onlyExistingCommitOrFinalizeDrained}')::boolean,
      false
    ) is true
    and coalesce((d.value #>> '{checks,noScanExecuted}')::boolean, false)
      is true
    and coalesce((d.value #>> '{checks,onePendingScan}')::boolean, false)
      is true
    and coalesce(
      (d.value #>> '{checks,pendingScanBoundToWatermark}')::boolean,
      false
    ) is true
    and coalesce((d.value #>> '{checks,noInflightWork}')::boolean, false)
      is true
    and coalesce(
      (d.value #>> '{checks,watermarkIdentityPreserved}')::boolean,
      false
    ) is true
    and coalesce((d.value #>> '{checks,publicReaderUnchanged}')::boolean, false)
      is true
    and coalesce((d.value #>> '{checks,mainnetDisabled}')::boolean, false)
      is true
    and coalesce((d.value #>> '{checks,activeRecoveryStarted}')::boolean, true)
      is false
    and coalesce((d.value #>> '{checks,stabilizationAuthorized}')::boolean, true)
      is false
    and coalesce((d.value #>> '{checks,soakAuthorized}')::boolean, true)
      is false
    and (d.value #>> '{watermarkBefore,ledgerIndex}')::bigint > 0
    and upper(d.value #>> '{watermarkBefore,ledgerHash}') ~ '^[A-F0-9]{64}$'
    and coalesce(d.value #>> '{watermarkBefore,workId}', '') <> ''
    and (d.value #>> '{watermarkAfter,ledgerIndex}')::bigint >=
      (d.value #>> '{watermarkBefore,ledgerIndex}')::bigint
    and upper(d.value #>> '{watermarkAfter,ledgerHash}') ~ '^[A-F0-9]{64}$'
    and coalesce(d.value #>> '{watermarkAfter,workId}', '') <> ''
    and coalesce(d.value #>> '{pendingScan,messageId}', '') <> ''
    and (d.value #>> '{pendingScan,expectedPreviousLedgerIndex}')::bigint =
      (d.value #>> '{watermarkAfter,ledgerIndex}')::bigint
    and upper(d.value #>> '{pendingScan,expectedPreviousLedgerHash}') =
      upper(d.value #>> '{watermarkAfter,ledgerHash}')
),
checkpoint_material as materialized (
  select
    q.*,
    jsonb_build_object(
      'runtime', 1,
      'streams', 1,
      'watermarks', 1,
      'pendingMessages', 1,
      'leasedMessages', 0,
      'retryMessages', 0,
      'inflightWork', 0,
      'drainedStepCount', q.drained_step_count,
      'qualificationBoundaryOnly', true
    ) as row_counts,
    jsonb_build_object(
      'boundaryDrain', public.xrpl_transfer_json_digest(q.boundary_drain_json),
      'watermarkAfter', public.xrpl_transfer_json_digest(
        q.boundary_drain_json->'watermarkAfter'
      ),
      'pendingScan', public.xrpl_transfer_json_digest(
        q.boundary_drain_json->'pendingScan'
      ),
      'drainedPhases', public.xrpl_transfer_json_digest(
        q.boundary_drain_json->'drainedPhases'
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
        'network', m.network,
        'epochId', m.epoch_id,
        'baseIdentity', m.base_identity,
        'watermark', m.boundary_drain_json->'watermarkAfter',
        'pendingScan', m.boundary_drain_json->'pendingScan'
      ),
      'boundaryDrain', m.boundary_drain_json,
      'rowCounts', m.row_counts,
      'sectionDigests', m.section_digests,
      'checks', jsonb_build_object(
        'collectorQuiescent', true,
        'activeStreamHealthy', true,
        'onePendingSuccessorScan', true,
        'pendingScanBoundToWatermark', true,
        'noInflightWork', true,
        'noScanExecutedDuringDrain', true,
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
  from existing_checkpoint existing
  where not exists (select 1 from inserted)
),
validated_checkpoint as materialized (
  select selected.*
  from selected_checkpoint selected
  left join checkpoint_payload payload on selected.duplicate is false
  where selected.profile_id = 'supabase_free_postgres_pgcron_edge'
    and selected.profile_revision = 4
    and selected.profile_identity_digest =
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    and selected.selection_digest = '__SELECTION_DIGEST__'
    and selected.source_profile_id = 'supabase-devnet'
    and selected.network = 'devnet'
    and selected.epoch_id = 'supabase-r4c2c-v1'
    and selected.observed_at = '__OBSERVED_AT__'::timestamptz
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
    and coalesce(
      (selected.state #>> '{checks,pendingScanBoundToWatermark}')::boolean,
      false
    ) is true
    and coalesce(
      (selected.state #>> '{checks,noInflightWork}')::boolean,
      false
    ) is true
    and coalesce(
      (selected.state #>> '{checks,publicReaderUnchanged}')::boolean,
      false
    ) is true
    and coalesce(
      (selected.state #>> '{checks,mainnetDisabled}')::boolean,
      false
    ) is true
    and (
      selected.duplicate is true
      or (
        payload.state is not null
        and selected.state = payload.state
        and selected.state_digest = payload.state_digest
        and selected.row_counts = payload.row_counts
        and selected.section_digests = payload.section_digests
      )
    )
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
