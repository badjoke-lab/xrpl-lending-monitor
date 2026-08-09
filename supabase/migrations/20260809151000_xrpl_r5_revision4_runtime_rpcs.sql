-- Revision-4 R5 runtime database boundary.
--
-- This migration is repository-only until an explicitly authorized deployment.
-- It preserves every revision-3 checkpoint/run/batch row and adds a separate
-- revision-4 entry path bound to the directional accounting profile.

-- Existing R5 tables were originally constrained to revision 3. Broaden only
-- the profile identity checks so historical revision-3 rows stay valid while
-- new revision-4 rows must carry the exact revision-4 profile digest and a
-- selection digest chosen by the later owner-authorized selection step.

alter table xrpl_r5_v1.active_checkpoints
  drop constraint if exists active_checkpoints_profile_revision_check;
alter table xrpl_r5_v1.active_checkpoints
  drop constraint if exists active_checkpoints_profile_identity_digest_check;
alter table xrpl_r5_v1.active_checkpoints
  drop constraint if exists active_checkpoints_selection_digest_check;

alter table xrpl_r5_v1.active_checkpoints
  add constraint xrpl_r5_active_checkpoint_selected_profile_check check (
    (
      profile_revision = 3
      and profile_identity_digest =
        '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
      and selection_digest =
        '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    )
    or (
      profile_revision = 4
      and profile_identity_digest =
        '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
      and selection_digest ~ '^[a-f0-9]{64}$'
    )
  );

alter table xrpl_r5_v1.recovery_runs
  drop constraint if exists recovery_runs_profile_revision_check;
alter table xrpl_r5_v1.recovery_runs
  drop constraint if exists recovery_runs_profile_identity_digest_check;
alter table xrpl_r5_v1.recovery_runs
  drop constraint if exists recovery_runs_selection_digest_check;

alter table xrpl_r5_v1.recovery_runs
  add constraint xrpl_r5_recovery_run_selected_profile_check check (
    (
      profile_revision = 3
      and profile_identity_digest =
        '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
      and selection_digest =
        '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    )
    or (
      profile_revision = 4
      and profile_identity_digest =
        '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
      and selection_digest ~ '^[a-f0-9]{64}$'
    )
  );

alter table xrpl_r5_v1.recovery_batches
  drop constraint if exists recovery_batches_profile_revision_check;
alter table xrpl_r5_v1.recovery_batches
  drop constraint if exists recovery_batches_profile_identity_digest_check;
alter table xrpl_r5_v1.recovery_batches
  drop constraint if exists recovery_batches_selection_digest_check;
alter table xrpl_r5_v1.recovery_batches
  drop constraint if exists recovery_batches_reserved_egress_upper_bound_bytes_check;

alter table xrpl_r5_v1.recovery_batches
  add constraint xrpl_r5_recovery_batch_selected_profile_check check (
    (
      profile_revision = 3
      and profile_identity_digest =
        '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
      and selection_digest =
        '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    )
    or (
      profile_revision = 4
      and profile_identity_digest =
        '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
      and selection_digest ~ '^[a-f0-9]{64}$'
    )
  );

alter table xrpl_r5_v1.recovery_batches
  add constraint xrpl_r5_recovery_batch_reservation_by_revision_check check (
    (profile_revision = 3 and reserved_egress_upper_bound_bytes = 134217728)
    or (
      profile_revision = 4
      and reserved_egress_upper_bound_bytes between 1 and 33554431
    )
  );

-- Build a revision-4 checkpoint from the existing proven checkpoint capture.
-- The capture itself is unchanged; only the selected recovery profile binding
-- is changed and the state digest is recomputed inside the same transaction.
create or replace function public.xrpl_create_r5_revision4_active_checkpoint(
  p_checkpoint_id text,
  p_selection_digest text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_existing xrpl_r5_v1.active_checkpoints%rowtype;
  v_state jsonb;
  v_state_digest text;
  v_legacy jsonb;
begin
  if p_selection_digest !~ '^[a-f0-9]{64}$' or p_observed_at is null then
    raise exception 'r5_revision4_checkpoint_invalid_selection';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0));

  select * into v_existing
  from xrpl_r5_v1.active_checkpoints
  where checkpoint_id = p_checkpoint_id
  for update;

  if found then
    if v_existing.profile_id <> 'supabase_free_postgres_pgcron_edge'
      or v_existing.profile_revision <> 4
      or v_existing.profile_identity_digest <>
        '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
      or v_existing.selection_digest <> p_selection_digest
      or public.xrpl_transfer_json_digest(v_existing.state) <> v_existing.state_digest
      or v_existing.state #>> '{selectedProfile,profileRevision}' <> '4'
      or v_existing.state #>> '{selectedProfile,profileIdentityDigest}' <>
        '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
      or v_existing.state #>> '{selectedProfile,selectionDigest}' <> p_selection_digest then
      raise exception 'r5_revision4_checkpoint_identity_conflict';
    end if;

    return jsonb_build_object(
      'created', true,
      'duplicate', true,
      'checkpointId', v_existing.checkpoint_id,
      'profileRevision', 4,
      'profileIdentityDigest', v_existing.profile_identity_digest,
      'selectionDigest', v_existing.selection_digest,
      'stateDigest', v_existing.state_digest,
      'watermarkLedgerIndex', v_existing.watermark_ledger_index,
      'watermarkLedgerHash', v_existing.watermark_ledger_hash,
      'watermarkWorkId', v_existing.watermark_work_id,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true
    );
  end if;

  v_legacy := public.xrpl_create_r5_active_checkpoint(
    p_checkpoint_id,
    p_observed_at
  );

  select * into v_existing
  from xrpl_r5_v1.active_checkpoints
  where checkpoint_id = p_checkpoint_id
  for update;

  if not found
    or v_existing.profile_revision <> 3
    or v_existing.profile_identity_digest <>
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_existing.selection_digest <>
      '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or public.xrpl_transfer_json_digest(v_existing.state) <> v_existing.state_digest then
    raise exception 'r5_revision4_checkpoint_legacy_capture_invalid';
  end if;

  v_state := jsonb_set(
    v_existing.state,
    '{selectedProfile}',
    jsonb_build_object(
      'profileId', 'supabase_free_postgres_pgcron_edge',
      'profileRevision', 4,
      'profileIdentityDigest',
        '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
      'selectionDigest', p_selection_digest
    ),
    true
  );
  v_state := jsonb_set(
    v_state,
    '{checks}',
    (coalesce(v_state->'checks', '{}'::jsonb) - 'revision3AccountingIncluded')
      || jsonb_build_object(
        'legacyRevision3AccountingStateRetained', true,
        'revision4DirectionalRecoveryBindingPrepared', true,
        'publicReaderUnchanged', true,
        'mainnetDisabled', true
      ),
    true
  );
  v_state_digest := public.xrpl_transfer_json_digest(v_state);

  update xrpl_r5_v1.active_checkpoints
  set profile_revision = 4,
      profile_identity_digest =
        '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
      selection_digest = p_selection_digest,
      state_digest = v_state_digest,
      state = v_state
  where checkpoint_id = p_checkpoint_id
  returning * into v_existing;

  return jsonb_build_object(
    'created', true,
    'duplicate', false,
    'checkpointId', v_existing.checkpoint_id,
    'profileRevision', 4,
    'profileIdentityDigest', v_existing.profile_identity_digest,
    'selectionDigest', v_existing.selection_digest,
    'stateDigest', v_existing.state_digest,
    'watermarkLedgerIndex', v_existing.watermark_ledger_index,
    'watermarkLedgerHash', v_existing.watermark_ledger_hash,
    'watermarkWorkId', v_existing.watermark_work_id,
    'legacyCaptureStateDigest', v_legacy->>'stateDigest',
    'publicReaderUnchanged', true,
    'mainnetDisabled', true
  );
end;
$$;

-- Clone the proven revision-3 prepare function, changing only the profile
-- identity and making the revision-4 selection digest derive from the bound
-- checkpoint instead of a hard-coded revision-3 selection.
do $clone_prepare$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_prepare_r5_active_recovery(text,text,text,bigint,text,timestamp with time zone)'
  );
  v_definition text;
  v_clone text;
  v_old_selection constant text :=
    '13a313d9d0679c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667';
  v_old_digest constant text :=
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67';
  v_new_digest constant text :=
    '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5';
begin
  if v_signature is null then
    raise exception 'r5_revision4_prepare_source_missing';
  end if;
  select pg_get_functiondef(v_signature) into v_definition;

  if position('public.xrpl_prepare_r5_active_recovery(' in v_definition) = 0
    or position('v_checkpoint.profile_revision <> 3' in v_definition) = 0
    or position(v_old_digest in v_definition) = 0
    or position(v_old_selection in v_definition) = 0 then
    raise exception 'r5_revision4_prepare_source_drift';
  end if;

  v_clone := replace(
    v_definition,
    'public.xrpl_prepare_r5_active_recovery(',
    'public.xrpl_prepare_r5_revision4_active_recovery('
  );
  v_clone := replace(v_clone, 'v_checkpoint.profile_revision <> 3', 'v_checkpoint.profile_revision <> 4');
  v_clone := replace(v_clone, v_old_digest, v_new_digest);
  v_clone := replace(
    v_clone,
    E'or v_checkpoint.selection_digest\n      <> ''' || v_old_selection || '''',
    E'or v_checkpoint.selection_digest !~ ''^[a-f0-9]{64}$'''
  );
  v_clone := replace(
    v_clone,
    E'''supabase_free_postgres_pgcron_edge'', 3,\n    ''' || v_new_digest || ''',\n    ''' || v_old_selection || ''',',
    E'''supabase_free_postgres_pgcron_edge'', 4,\n    ''' || v_new_digest || ''',\n    v_checkpoint.selection_digest,'
  );

  if position('public.xrpl_prepare_r5_revision4_active_recovery(' in v_clone) = 0
    or position('v_checkpoint.profile_revision <> 4' in v_clone) = 0
    or position(v_old_selection in v_clone) <> 0
    or position(E'''supabase_free_postgres_pgcron_edge'', 4,' in v_clone) = 0 then
    raise exception 'r5_revision4_prepare_clone_invalid';
  end if;

  execute v_clone;
end;
$clone_prepare$;

-- Revision-4 prepared-state rebind keeps the current proven descendant-chain
-- logic but binds it to revision 4 and the run's selected digest.
do $clone_rebind$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(text,timestamp with time zone)'
  );
  v_definition text;
  v_clone text;
  v_old_selection constant text :=
    '13a313d9d0679c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667';
  v_old_digest constant text :=
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67';
  v_new_digest constant text :=
    '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5';
begin
  if v_signature is null then
    raise exception 'r5_revision4_rebind_source_missing';
  end if;
  select pg_get_functiondef(v_signature) into v_definition;
  if position('public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(' in v_definition) = 0
    or position('v_run.profile_revision <> 3' in v_definition) = 0
    or position(v_old_selection in v_definition) = 0 then
    raise exception 'r5_revision4_rebind_source_drift';
  end if;

  v_clone := replace(
    v_definition,
    'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
    'public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary('
  );
  v_clone := replace(v_clone, 'v_run.profile_revision <> 3', 'v_run.profile_revision <> 4');
  v_clone := replace(v_clone, v_old_digest, v_new_digest);
  v_clone := replace(
    v_clone,
    E'or v_run.selection_digest\n      <> ''' || v_old_selection || '''',
    E'or v_run.selection_digest !~ ''^[a-f0-9]{64}$'''
  );

  if position('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(' in v_clone) = 0
    or position('v_run.profile_revision <> 4' in v_clone) = 0
    or position(v_old_selection in v_clone) <> 0 then
    raise exception 'r5_revision4_rebind_clone_invalid';
  end if;
  execute v_clone;
end;
$clone_rebind$;

-- Running revision-4 recovery does not adopt unexpected externally committed
-- descendants. With the normal collector stopped, equality is the only
-- accepted preclaim state; drift fails closed instead of importing revision-3
-- accounting assumptions into revision 4.
create or replace function public.xrpl_adopt_r5_revision4_committed_active_descendants(
  p_run_id text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
begin
  if p_now is null then
    raise exception 'r5_revision4_preclaim_boundary_invalid_time';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;
  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet'
  for update;

  if not found
    or v_run.profile_revision <> 4
    or v_run.profile_identity_digest <>
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    or v_run.selection_digest !~ '^[a-f0-9]{64}$'
    or v_run.status <> 'running'
    or v_run.completed_batches < 1
    or v_run.last_accounting_digest is null
    or v_run.completed_at is not null
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity then
    raise exception 'r5_revision4_preclaim_boundary_state_invalid';
  end if;

  if v_watermark.ledger_index <> v_run.current_watermark_ledger_index
    or v_watermark.ledger_hash <> v_run.current_watermark_ledger_hash
    or v_watermark.work_id <> v_run.current_watermark_work_id then
    raise exception 'r5_revision4_unexpected_active_descendant_drift';
  end if;

  return jsonb_build_object(
    'adopted', false,
    'reason', 'active_boundary_already_equal',
    'runId', v_run.run_id,
    'watermarkLedgerIndex', v_watermark.ledger_index,
    'watermarkLedgerHash', v_watermark.ledger_hash,
    'watermarkWorkId', v_watermark.work_id,
    'revision3DescendantAccountingNotImported', true
  );
end;
$$;

-- Clone the current base claim so all existing quiescence, lease, reclaim and
-- 12-ledger-cap fixes are retained. Revision 4 uses a 16 MiB precommit
-- reservation: it is a reservation only, not billable egress, and completion
-- must replace it with a strictly smaller measured directional upper bound.
do $clone_claim$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
  );
  v_definition text;
  v_clone text;
  v_old_selection constant text :=
    '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667';
  v_old_digest constant text :=
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67';
  v_new_digest constant text :=
    '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5';
begin
  if v_signature is null then
    raise exception 'r5_revision4_claim_source_missing';
  end if;
  select pg_get_functiondef(v_signature) into v_definition;
  if position('public.xrpl_claim_r5_active_recovery_batch(' in v_definition) = 0
    or position('v_run.profile_revision <> 3' in v_definition) = 0
    or position('v_reserved constant bigint := 134217728' in v_definition) = 0
    or position('v_count := least(12::bigint' in v_definition) = 0 then
    raise exception 'r5_revision4_claim_source_drift';
  end if;

  v_clone := replace(
    v_definition,
    'public.xrpl_claim_r5_active_recovery_batch(',
    'public.xrpl_claim_r5_revision4_recovery_batch('
  );
  v_clone := replace(v_clone, 'v_run.profile_revision <> 3', 'v_run.profile_revision <> 4');
  v_clone := replace(v_clone, 'v_reserved constant bigint := 134217728', 'v_reserved constant bigint := 16777216');
  v_clone := replace(v_clone, v_old_digest, v_new_digest);
  v_clone := replace(
    v_clone,
    E'or v_run.selection_digest\n      <> ''' || v_old_selection || '''',
    E'or v_run.selection_digest !~ ''^[a-f0-9]{64}$'''
  );
  v_clone := replace(
    v_clone,
    E'''supabase_free_postgres_pgcron_edge'', 3,\n    ''' || v_new_digest || ''',\n    ''' || v_old_selection || ''',',
    E'''supabase_free_postgres_pgcron_edge'', 4,\n    ''' || v_new_digest || ''',\n    v_run.selection_digest,'
  );

  if position('public.xrpl_claim_r5_revision4_recovery_batch(' in v_clone) = 0
    or position('v_run.profile_revision <> 4' in v_clone) = 0
    or position('v_reserved constant bigint := 16777216' in v_clone) = 0
    or position(v_old_selection in v_clone) <> 0
    or position(E'''supabase_free_postgres_pgcron_edge'', 4,' in v_clone) = 0 then
    raise exception 'r5_revision4_claim_clone_invalid';
  end if;

  execute v_clone;
end;
$clone_claim$;

-- Clone the latest prepared-head claim, including the later atomic-preclaim
-- fix, then route its revision-4 running boundary and base claim to the new
-- revision-4 helpers.
do $clone_progressive_claim$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'
  );
  v_definition text;
  v_clone text;
  v_old_selection constant text :=
    '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667';
  v_old_digest constant text :=
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67';
  v_new_digest constant text :=
    '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5';
begin
  if v_signature is null then
    raise exception 'r5_revision4_progressive_claim_source_missing';
  end if;
  select pg_get_functiondef(v_signature) into v_definition;
  if position('public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(' in v_definition) = 0
    or position('v_run.profile_revision <> 3' in v_definition) = 0
    or position('public.xrpl_claim_r5_active_recovery_batch(' in v_definition) = 0
    or position('atomicBoundaryHeldThroughClaim' in v_definition) = 0 then
    raise exception 'r5_revision4_progressive_claim_source_drift';
  end if;

  v_clone := replace(
    v_definition,
    'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
    'public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head('
  );
  v_clone := replace(v_clone, 'v_run.profile_revision <> 3', 'v_run.profile_revision <> 4');
  v_clone := replace(v_clone, v_old_digest, v_new_digest);
  v_clone := replace(
    v_clone,
    E'or v_run.selection_digest\n      <> ''' || v_old_selection || '''',
    E'or v_run.selection_digest !~ ''^[a-f0-9]{64}$'''
  );
  v_clone := replace(
    v_clone,
    'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
    'public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary('
  );
  v_clone := replace(
    v_clone,
    'public.xrpl_adopt_r5_committed_active_descendants(',
    'public.xrpl_adopt_r5_revision4_committed_active_descendants('
  );
  v_clone := replace(
    v_clone,
    'public.xrpl_claim_r5_active_recovery_batch(',
    'public.xrpl_claim_r5_revision4_recovery_batch('
  );

  if position('public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(' in v_clone) = 0
    or position('v_run.profile_revision <> 4' in v_clone) = 0
    or position('public.xrpl_claim_r5_revision4_recovery_batch(' in v_clone) = 0
    or position('public.xrpl_adopt_r5_revision4_committed_active_descendants(' in v_clone) = 0
    or position(v_old_selection in v_clone) <> 0 then
    raise exception 'r5_revision4_progressive_claim_clone_invalid';
  end if;

  execute v_clone;
end;
$clone_progressive_claim$;

-- Clone the current atomic completion implementation. Replace only the old
-- revision-3 accounting-validation section with revision-4 directional
-- validation; all work/message/watermark mutation and rollback behavior stays
-- exactly on the proven completion path.
do $clone_completion$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
  );
  v_definition text;
  v_clone text;
  v_start integer;
  v_finish integer;
  v_count_start integer;
  v_count_finish integer;
  v_validation_block text := $block$  v_accounting_input := v_accounting->'directionalSummary';
  v_accounting_result := v_accounting->'memorySupplemental';
  v_accounting_checks := v_accounting->'checks';
  v_accounting_thresholds := null;
  v_expected_rolling_egress := v_batch.prior_conservative_egress_31d_bytes
    + p_finalized_egress_upper_bound_bytes;

  if v_batch.profile_revision <> 4
    or v_batch.profile_identity_digest <>
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    or v_batch.selection_digest !~ '^[a-f0-9]{64}$'
    or v_accounting->>'profileId' <> 'supabase_free_postgres_pgcron_edge'
    or (v_accounting->>'profileRevision')::integer <> 4
    or v_accounting->>'profileIdentityDigest' <>
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    or v_accounting->>'disposition' <> 'runtime_precommit_completed'
    or v_accounting->>'observationId' <> concat('r5.rev4.', v_batch.batch_id)
    or v_accounting->>'attemptId' <>
      concat('r5.rev4.', v_batch.batch_id, '.attempt.', v_batch.batch_sequence)
    or jsonb_typeof(v_accounting->'observations') <> 'array'
    or jsonb_array_length(v_accounting->'observations') <> 6
    or jsonb_typeof(v_accounting_input) <> 'object'
    or jsonb_typeof(v_accounting_input->'byBoundary') <> 'array'
    or jsonb_array_length(v_accounting_input->'byBoundary') <> 6
    or jsonb_typeof(v_accounting_result) <> 'object'
    or jsonb_typeof(v_accounting_checks) <> 'object'
    or coalesce((v_accounting_checks->>'exactProfileIdentityBound')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'everyObservationDirectionBoundByContract')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'inboundBytesRemainInMemoryTransport')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'blanketAllDirectionMultiplierUsed')::boolean, true) is not false
    or coalesce((v_accounting_checks->>'accountingPreparedBeforeAtomicCompletion')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'accountingMustCommitAtomicallyWithWork')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'publicReaderUnchanged')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'mainnetDisabled')::boolean, false) is not true
    or coalesce((v_accounting_checks->>'stabilizationAuthorized')::boolean, true) is not false
    or coalesce((v_accounting_checks->>'soakAuthorized')::boolean, true) is not false
    or (v_accounting->>'unexplainedDirectionalDeltaReserveBytes')::bigint < 0
    or (v_accounting->>'rollingBillableEgressUpperBoundBytes')::bigint
      <> p_finalized_egress_upper_bound_bytes
    or (v_accounting_input->>'rollingBillableEgressUpperBoundBytes')::bigint
      + (v_accounting->>'unexplainedDirectionalDeltaReserveBytes')::bigint
      <> p_finalized_egress_upper_bound_bytes
    or (v_accounting->>'memoryTransportUpperBoundBytes')::bigint >= 234881024
    or v_expected_rolling_egress >= 4294967296
    or v_batch.projected_invocations_31d >= 400000
    or p_finalized_egress_upper_bound_bytes >= v_batch.reserved_egress_upper_bound_bytes
    or (
      select count(distinct observation->>'boundaryId')
      from jsonb_array_elements(v_accounting->'observations') observation
    ) <> 6
    or coalesce((
      select bool_and(observation->>'boundaryId' in (
        'invoker_to_edge_request',
        'edge_to_xrpl_request',
        'xrpl_to_edge_response',
        'edge_to_database_request',
        'database_to_edge_response',
        'edge_to_invoker_response'
      ))
      from jsonb_array_elements(v_accounting->'observations') observation
    ), false) is not true then
    raise exception 'r5_revision4_recovery_batch_accounting_invalid';
  end if;

$block$;
  v_count_block text := $block$  if v_total_rows < v_batch.ledger_count
    or v_total_chunks < v_batch.ledger_count
    or v_total_relationships < 0 then
    raise exception 'r5_revision4_recovery_batch_derived_count_invalid';
  end if;

$block$;
begin
  if v_signature is null then
    raise exception 'r5_revision4_completion_source_missing';
  end if;
  select pg_get_functiondef(v_signature) into v_definition;
  if position('public.xrpl_complete_r5_active_recovery_batch(' in v_definition) = 0 then
    raise exception 'r5_revision4_completion_source_drift';
  end if;

  v_clone := replace(
    v_definition,
    'public.xrpl_complete_r5_active_recovery_batch(',
    'public.xrpl_complete_r5_revision4_recovery_batch('
  );

  v_start := position(E'  v_accounting_input := v_accounting->''input'';\n' in v_clone);
  v_finish := position(E'  v_last_index := v_watermark.ledger_index;\n' in v_clone);
  if v_start = 0 or v_finish = 0 or v_finish <= v_start then
    raise exception 'r5_revision4_completion_accounting_anchor_drift';
  end if;
  v_clone := substring(v_clone from 1 for v_start - 1)
    || v_validation_block
    || substring(v_clone from v_finish);

  v_count_start := position(
    E'  if v_total_rows <> (v_accounting_input->>''normalizedRecordCount'')::integer\n'
    in v_clone
  );
  v_count_finish := position(
    E'  insert into public.xrpl_phase_watermarks (\n'
    in v_clone
  );
  if v_count_start = 0 or v_count_finish = 0 or v_count_finish <= v_count_start then
    raise exception 'r5_revision4_completion_count_anchor_drift';
  end if;
  v_clone := substring(v_clone from 1 for v_count_start - 1)
    || v_count_block
    || substring(v_clone from v_count_finish);

  if position('public.xrpl_complete_r5_revision4_recovery_batch(' in v_clone) = 0
    or position('r5_revision4_recovery_batch_accounting_invalid' in v_clone) = 0
    or position('runtime_precommit_completed' in v_clone) = 0
    or position('r5_recovery_batch_accounting_checks_invalid' in v_clone) <> 0
    or position('normalizedRecordCount' in v_clone) <> 0 then
    raise exception 'r5_revision4_completion_clone_invalid';
  end if;

  execute v_clone;
end;
$clone_completion$;

-- Failure finalization is profile-neutral in the proven implementation. This
-- wrapper prevents a revision-4 executor from finalizing any revision-3 batch.
create or replace function public.xrpl_fail_r5_revision4_recovery_batch(
  p_run_id text,
  p_batch_id text,
  p_owner text,
  p_error_message text,
  p_failed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));
  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id and batch_id = p_batch_id
  for update;

  if not found
    or v_batch.profile_revision <> 4
    or v_batch.profile_identity_digest <>
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    or v_batch.selection_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'r5_revision4_failure_batch_identity_invalid';
  end if;

  return public.xrpl_fail_r5_active_recovery_batch(
    p_run_id,
    p_batch_id,
    p_owner,
    p_error_message,
    p_failed_at
  );
end;
$$;

revoke all on function public.xrpl_create_r5_revision4_active_checkpoint(
  text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_prepare_r5_revision4_active_recovery(
  text, text, text, bigint, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(
  text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_adopt_r5_revision4_committed_active_descendants(
  text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_claim_r5_revision4_recovery_batch(
  text, text, bigint, text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.xrpl_complete_r5_revision4_recovery_batch(
  text, text, text, timestamptz, text, text, text, text,
  bigint, numeric, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.xrpl_fail_r5_revision4_recovery_batch(
  text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.xrpl_create_r5_revision4_active_checkpoint(
  text, text, timestamptz
) to service_role;
grant execute on function public.xrpl_prepare_r5_revision4_active_recovery(
  text, text, text, bigint, text, timestamptz
) to service_role;
grant execute on function public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(
  text, timestamptz
) to service_role;
grant execute on function public.xrpl_adopt_r5_revision4_committed_active_descendants(
  text, timestamptz
) to service_role;
grant execute on function public.xrpl_claim_r5_revision4_recovery_batch(
  text, text, bigint, text, timestamptz, integer
) to service_role;
grant execute on function public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) to service_role;
grant execute on function public.xrpl_complete_r5_revision4_recovery_batch(
  text, text, text, timestamptz, text, text, text, text,
  bigint, numeric, numeric, numeric
) to service_role;
grant execute on function public.xrpl_fail_r5_revision4_recovery_batch(
  text, text, text, text, timestamptz
) to service_role;

do $admin_grants$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_create_r5_revision4_active_checkpoint(text,text,timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(text,timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_adopt_r5_revision4_committed_active_descendants(text,timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamptz,integer) to supabase_admin';
    execute 'grant execute on function public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamptz,integer) to supabase_admin';
    execute 'grant execute on function public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamptz,text,text,text,text,bigint,numeric,numeric,numeric) to supabase_admin';
    execute 'grant execute on function public.xrpl_fail_r5_revision4_recovery_batch(text,text,text,text,timestamptz) to supabase_admin';
  end if;
end;
$admin_grants$;

-- Migration-time assertions: code may be installed locally by CI, but no
-- revision-4 checkpoint/run/batch is created by the migration itself.
do $assertions$
declare
  v_completion text;
  v_claim text;
  v_revision4_rows bigint;
begin
  if to_regprocedure(
      'public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'
    ) is null
    or to_regprocedure(
      'public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
    ) is null
    or to_regprocedure(
      'public.xrpl_fail_r5_revision4_recovery_batch(text,text,text,text,timestamp with time zone)'
    ) is null then
    raise exception 'r5_revision4_runtime_rpc_missing';
  end if;

  select pg_get_functiondef(to_regprocedure(
    'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
  )) into v_claim;
  select pg_get_functiondef(to_regprocedure(
    'public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
  )) into v_completion;

  if position('v_reserved constant bigint := 16777216' in v_claim) = 0
    or position('v_count := least(12::bigint' in v_claim) = 0
    or position('runtime_precommit_completed' in v_completion) = 0
    or position('r5_revision4_recovery_batch_accounting_invalid' in v_completion) = 0 then
    raise exception 'r5_revision4_runtime_definition_invalid';
  end if;

  select
    (select count(*) from xrpl_r5_v1.active_checkpoints where profile_revision = 4)
    + (select count(*) from xrpl_r5_v1.recovery_runs where profile_revision = 4)
    + (select count(*) from xrpl_r5_v1.recovery_batches where profile_revision = 4)
  into v_revision4_rows;

  if v_revision4_rows <> 0 then
    raise exception 'r5_revision4_migration_must_not_create_runtime_state';
  end if;
end;
$assertions$;
