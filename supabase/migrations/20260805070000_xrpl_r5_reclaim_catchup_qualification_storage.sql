create schema if not exists xrpl_qualification_archive_v1;

revoke all on schema xrpl_qualification_archive_v1 from public, anon, authenticated;

create table if not exists xrpl_qualification_archive_v1.catchup_reclaims (
  archive_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  source_workflow_run_id bigint not null check (source_workflow_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  source_artifact_id bigint not null check (source_artifact_id > 0),
  source_artifact_digest text not null check (source_artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  retained_run_id text not null,
  retained_trial_count integer not null check (retained_trial_count = 5),
  reclaimed_schema text not null check (reclaimed_schema = 'xrpl_catchup_v1'),
  physical_bytes_before bigint not null check (physical_bytes_before > 0),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  archived_at timestamptz not null
);

revoke all on table xrpl_qualification_archive_v1.catchup_reclaims
  from public, anon, authenticated;

comment on table xrpl_qualification_archive_v1.catchup_reclaims is
  'Compact retained evidence for the exact completed catch-up qualification whose replayable raw rows were reclaimed during active R5 recovery.';

do $$
declare
  v_archive_id constant text := 'r5-catchup-reclaim-20260805-v1';
  v_recovery_run_id constant text := 'r5-recovery-selected-revision3-entry';
  v_retained_run_id constant text := 'r4c2d-msflb2xi-9529f8e9';
  v_source_workflow_run_id constant bigint := 30975277983;
  v_source_commit constant text := 'd7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c';
  v_source_artifact_id constant bigint := 8918144753;
  v_source_artifact_digest constant text := 'sha256:c0f519dc4a1fe5dfff3f0ae79641cc84fd54e99fb2f0b2d073f20639e1dda2ac';
  v_source_catchup_evidence_sha256 constant text := '165f01e582bc4e52e1676d143a240429d203ae803bd0eabfb4c5069ac7d6870b';
  v_source_steady_evidence_sha256 constant text := 'fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c';
  v_recovery xrpl_r5_v1.recovery_runs%rowtype;
  v_retained_trials jsonb;
  v_table_counts jsonb;
  v_evidence jsonb;
  v_evidence_digest text;
  v_physical_bytes_before bigint;
  v_active_trial_count bigint;
  v_live_row_count_after bigint;
  v_watermark_before_index bigint;
  v_watermark_before_hash text;
  v_watermark_before_work_id text;
  v_watermark_after_index bigint;
  v_watermark_after_hash text;
  v_watermark_after_work_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-catchup-qualification-reclaim', 0));

  select * into v_recovery
  from xrpl_r5_v1.recovery_runs
  where run_id = v_recovery_run_id
  for share;

  if not found
    or v_recovery.status not in ('running', 'caught_up')
    or v_recovery.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_recovery.profile_revision <> 3
    or v_recovery.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_recovery.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_recovery.network <> 'devnet'
    or v_recovery.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'r5_catchup_reclaim_recovery_boundary_invalid';
  end if;

  select ledger_index, ledger_hash, work_id
  into v_watermark_before_index, v_watermark_before_hash, v_watermark_before_work_id
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  if not found then
    raise exception 'r5_catchup_reclaim_active_watermark_missing';
  end if;

  select count(*)::bigint into v_active_trial_count
  from xrpl_catchup_v1.trials
  where status in ('prepared', 'running');

  if v_active_trial_count <> 0 then
    raise exception 'r5_catchup_reclaim_active_trial_present';
  end if;

  select jsonb_agg(to_jsonb(trial) order by trial.trial_id)
  into v_retained_trials
  from xrpl_catchup_v1.trials trial
  where trial.trial_id in (
    v_retained_run_id || '-t1',
    v_retained_run_id || '-t2',
    v_retained_run_id || '-t3',
    v_retained_run_id || '-t4',
    v_retained_run_id || '-t5'
  );

  if jsonb_typeof(v_retained_trials) <> 'array'
    or jsonb_array_length(v_retained_trials) <> 5
    or exists (
      select 1
      from jsonb_array_elements(v_retained_trials) item
      where item->>'status' <> 'completed'
         or item->>'source_profile_id' <> 'supabase-devnet'
         or item->>'target_profile_id' <> 'supabase-devnet-catchup-qualification'
         or item->>'network' <> 'devnet'
         or item->>'epoch_id' <> 'supabase-r4c2c-v1'
         or (item->>'source_count')::integer <> 64
         or (item->>'source_row_count')::integer
              <> (item->>'target_row_count')::integer
         or item->>'source_rows_digest' <> item->>'target_rows_digest'
         or (item->>'message_count')::integer <> 193
         or (item->>'completed_message_count')::integer <> 192
         or (item->>'pending_message_count')::integer <> 1
         or (item->>'successor_count')::integer <> 192
         or (item->>'db_elapsed_milliseconds')::numeric <= 0
         or (item->'result'->>'committedWorks')::integer <> 64
         or (item->'result'->>'rowDigestParity')::boolean is not true
         or (item->>'active_after_ledger_index')::bigint
              < (item->>'active_before_ledger_index')::bigint
    ) then
    raise exception 'r5_catchup_reclaim_retained_evidence_invalid';
  end if;

  select coalesce(sum(pg_total_relation_size(class.oid)), 0)::bigint
  into v_physical_bytes_before
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'xrpl_catchup_v1'
    and class.relkind in ('r', 'm', 'p');

  if v_physical_bytes_before <= 17000000 then
    raise exception 'r5_catchup_reclaim_storage_below_required_recovery_margin';
  end if;

  v_table_counts := jsonb_build_object(
    'trials', (select count(*)::bigint from xrpl_catchup_v1.trials),
    'sourceWorks', (select count(*)::bigint from xrpl_catchup_v1.source_works),
    'streams', (select count(*)::bigint from xrpl_catchup_v1.streams),
    'messages', (select count(*)::bigint from xrpl_catchup_v1.messages),
    'successors', (select count(*)::bigint from xrpl_catchup_v1.successors),
    'work', (select count(*)::bigint from xrpl_catchup_v1.work),
    'payloadChunks', (select count(*)::bigint from xrpl_catchup_v1.payload_chunks),
    'referenceRows', (select count(*)::bigint from xrpl_catchup_v1.reference_rows),
    'commitChunks', (select count(*)::bigint from xrpl_catchup_v1.commit_chunks),
    'watermarks', (select count(*)::bigint from xrpl_catchup_v1.watermarks)
  );

  v_evidence := jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r5-catchup-qualification-storage-reclaim',
    'sourceWorkflowRunId', v_source_workflow_run_id,
    'sourceCommit', v_source_commit,
    'sourceArtifactId', v_source_artifact_id,
    'sourceArtifactDigest', v_source_artifact_digest,
    'sourceCatchUpEvidenceSha256', v_source_catchup_evidence_sha256,
    'sourceSteadyEvidenceSha256', v_source_steady_evidence_sha256,
    'recoveryRunId', v_recovery_run_id,
    'recoveryStatus', v_recovery.status,
    'profileId', v_recovery.profile_id,
    'profileRevision', v_recovery.profile_revision,
    'profileIdentityDigest', v_recovery.profile_identity_digest,
    'selectionDigest', v_recovery.selection_digest,
    'retainedRunId', v_retained_run_id,
    'retainedTrials', v_retained_trials,
    'tableCountsBefore', v_table_counts,
    'physicalBytesBefore', v_physical_bytes_before,
    'activeWatermarkBefore', jsonb_build_object(
      'ledgerIndex', v_watermark_before_index,
      'ledgerHash', v_watermark_before_hash,
      'workId', v_watermark_before_work_id
    ),
    'boundaries', jsonb_build_object(
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationAuthorized', false,
      'soakAuthorized', false,
      'activeR5TablesUntouched', true,
      'activePublicTablesUntouched', true,
      'steadyQualificationUntouched', true,
      'revision3AccountingUntouched', true
    )
  );
  v_evidence_digest := public.xrpl_transfer_json_digest(v_evidence);

  insert into xrpl_qualification_archive_v1.catchup_reclaims (
    archive_id,
    source_workflow_run_id,
    source_commit,
    source_artifact_id,
    source_artifact_digest,
    retained_run_id,
    retained_trial_count,
    reclaimed_schema,
    physical_bytes_before,
    evidence,
    evidence_digest,
    archived_at
  ) values (
    v_archive_id,
    v_source_workflow_run_id,
    v_source_commit,
    v_source_artifact_id,
    v_source_artifact_digest,
    v_retained_run_id,
    5,
    'xrpl_catchup_v1',
    v_physical_bytes_before,
    v_evidence,
    v_evidence_digest,
    clock_timestamp()
  );

  truncate table
    xrpl_catchup_v1.successors,
    xrpl_catchup_v1.messages,
    xrpl_catchup_v1.payload_chunks,
    xrpl_catchup_v1.reference_rows,
    xrpl_catchup_v1.commit_chunks,
    xrpl_catchup_v1.work,
    xrpl_catchup_v1.watermarks,
    xrpl_catchup_v1.streams,
    xrpl_catchup_v1.source_works,
    xrpl_catchup_v1.trials;

  select
      (select count(*) from xrpl_catchup_v1.trials)
    + (select count(*) from xrpl_catchup_v1.source_works)
    + (select count(*) from xrpl_catchup_v1.streams)
    + (select count(*) from xrpl_catchup_v1.messages)
    + (select count(*) from xrpl_catchup_v1.successors)
    + (select count(*) from xrpl_catchup_v1.work)
    + (select count(*) from xrpl_catchup_v1.payload_chunks)
    + (select count(*) from xrpl_catchup_v1.reference_rows)
    + (select count(*) from xrpl_catchup_v1.commit_chunks)
    + (select count(*) from xrpl_catchup_v1.watermarks)
  into v_live_row_count_after;

  if v_live_row_count_after <> 0 then
    raise exception 'r5_catchup_reclaim_live_rows_remain';
  end if;

  select ledger_index, ledger_hash, work_id
  into v_watermark_after_index, v_watermark_after_hash, v_watermark_after_work_id
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  if v_watermark_after_index is distinct from v_watermark_before_index
    or v_watermark_after_hash is distinct from v_watermark_before_hash
    or v_watermark_after_work_id is distinct from v_watermark_before_work_id then
    raise exception 'r5_catchup_reclaim_active_watermark_changed';
  end if;

  if public.xrpl_transfer_json_digest(v_evidence) <> v_evidence_digest then
    raise exception 'r5_catchup_reclaim_archive_digest_mismatch';
  end if;
end;
$$;
