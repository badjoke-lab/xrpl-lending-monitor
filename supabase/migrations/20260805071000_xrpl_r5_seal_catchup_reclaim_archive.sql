create table if not exists xrpl_qualification_archive_v1.catchup_reclaim_seals (
  archive_id text primary key
    references xrpl_qualification_archive_v1.catchup_reclaims(archive_id)
    on update restrict
    on delete restrict,
  schema_version integer not null default 1 check (schema_version = 1),
  source_workflow_run_id bigint not null check (source_workflow_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  source_artifact_id bigint not null check (source_artifact_id > 0),
  source_artifact_digest text not null check (source_artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  retained_run_id text not null,
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  source_catchup_evidence_sha256 text not null check (source_catchup_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  source_steady_evidence_sha256 text not null check (source_steady_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  checks jsonb not null check (jsonb_typeof(checks) = 'object'),
  sealed_at timestamptz not null
);

revoke all on table xrpl_qualification_archive_v1.catchup_reclaim_seals
  from public, anon, authenticated;

comment on table xrpl_qualification_archive_v1.catchup_reclaim_seals is
  'Deploy-time integrity seal for a reclaimed catch-up qualification archive. Read-only runtime verification compares immutable pinned fields without executing the private digest function.';

do $$
declare
  v_archive_id constant text := 'r5-catchup-reclaim-20260805-v1';
  v_source_workflow_run_id constant bigint := 30975277983;
  v_source_commit constant text := 'd7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c';
  v_source_artifact_id constant bigint := 8918144753;
  v_source_artifact_digest constant text := 'sha256:c0f519dc4a1fe5dfff3f0ae79641cc84fd54e99fb2f0b2d073f20639e1dda2ac';
  v_retained_run_id constant text := 'r4c2d-msflb2xi-9529f8e9';
  v_source_catchup_evidence_sha256 constant text := '165f01e582bc4e52e1676d143a240429d203ae803bd0eabfb4c5069ac7d6870b';
  v_source_steady_evidence_sha256 constant text := 'fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c';
  v_archive xrpl_qualification_archive_v1.catchup_reclaims%rowtype;
  v_seal xrpl_qualification_archive_v1.catchup_reclaim_seals%rowtype;
  v_recomputed_digest text;
  v_checks jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-catchup-reclaim-seal', 0));

  select * into v_archive
  from xrpl_qualification_archive_v1.catchup_reclaims
  where archive_id = v_archive_id
  for share;

  if not found
    or v_archive.schema_version <> 1
    or v_archive.source_workflow_run_id <> v_source_workflow_run_id
    or v_archive.source_commit <> v_source_commit
    or v_archive.source_artifact_id <> v_source_artifact_id
    or v_archive.source_artifact_digest <> v_source_artifact_digest
    or v_archive.retained_run_id <> v_retained_run_id
    or v_archive.retained_trial_count <> 5
    or v_archive.reclaimed_schema <> 'xrpl_catchup_v1'
    or v_archive.physical_bytes_before <= 17000000
    or (v_archive.evidence->>'sourceCatchUpEvidenceSha256') is distinct from v_source_catchup_evidence_sha256
    or (v_archive.evidence->>'sourceSteadyEvidenceSha256') is distinct from v_source_steady_evidence_sha256
    or (v_archive.evidence->>'recoveryRunId') is distinct from 'r5-recovery-selected-revision3-entry'
    or (v_archive.evidence->>'profileId') is distinct from 'supabase_free_postgres_pgcron_edge'
    or (v_archive.evidence->>'profileRevision')::integer is distinct from 3
    or (v_archive.evidence->>'profileIdentityDigest') is distinct from
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or (v_archive.evidence->>'selectionDigest') is distinct from
      '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or jsonb_typeof(v_archive.evidence->'retainedTrials') is distinct from 'array'
    or jsonb_array_length(v_archive.evidence->'retainedTrials') is distinct from 5
    or (v_archive.evidence#>>'{boundaries,publicReaderUnchanged}')::boolean is not true
    or (v_archive.evidence#>>'{boundaries,mainnetDisabled}')::boolean is not true
    or (v_archive.evidence#>>'{boundaries,stabilizationAuthorized}')::boolean is not false
    or (v_archive.evidence#>>'{boundaries,soakAuthorized}')::boolean is not false
    or (v_archive.evidence#>>'{boundaries,activeR5TablesUntouched}')::boolean is not true
    or (v_archive.evidence#>>'{boundaries,activePublicTablesUntouched}')::boolean is not true
    or (v_archive.evidence#>>'{boundaries,steadyQualificationUntouched}')::boolean is not true
    or (v_archive.evidence#>>'{boundaries,revision3AccountingUntouched}')::boolean is not true then
    raise exception 'r5_catchup_reclaim_seal_archive_boundary_invalid';
  end if;

  v_recomputed_digest := public.xrpl_transfer_json_digest(v_archive.evidence);
  if v_recomputed_digest is distinct from v_archive.evidence_digest then
    raise exception 'r5_catchup_reclaim_seal_digest_mismatch';
  end if;

  v_checks := jsonb_build_object(
    'archiveDigestRecomputedAtDeploy', true,
    'exactSourceArtifactPinned', true,
    'fiveRetainedTrialsPresent', true,
    'activeR5TablesUntouched', true,
    'activePublicTablesUntouched', true,
    'steadyQualificationUntouched', true,
    'revision3AccountingUntouched', true,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true,
    'stabilizationAuthorized', false,
    'soakAuthorized', false,
    'privateDigestExecuteNotGranted', true
  );

  insert into xrpl_qualification_archive_v1.catchup_reclaim_seals (
    archive_id,
    source_workflow_run_id,
    source_commit,
    source_artifact_id,
    source_artifact_digest,
    retained_run_id,
    evidence_digest,
    source_catchup_evidence_sha256,
    source_steady_evidence_sha256,
    checks,
    sealed_at
  ) values (
    v_archive_id,
    v_source_workflow_run_id,
    v_source_commit,
    v_source_artifact_id,
    v_source_artifact_digest,
    v_retained_run_id,
    v_recomputed_digest,
    v_source_catchup_evidence_sha256,
    v_source_steady_evidence_sha256,
    v_checks,
    clock_timestamp()
  )
  on conflict (archive_id) do nothing;

  select * into v_seal
  from xrpl_qualification_archive_v1.catchup_reclaim_seals
  where archive_id = v_archive_id
  for share;

  if not found
    or v_seal.schema_version <> 1
    or v_seal.source_workflow_run_id <> v_source_workflow_run_id
    or v_seal.source_commit <> v_source_commit
    or v_seal.source_artifact_id <> v_source_artifact_id
    or v_seal.source_artifact_digest <> v_source_artifact_digest
    or v_seal.retained_run_id <> v_retained_run_id
    or v_seal.evidence_digest <> v_recomputed_digest
    or v_seal.source_catchup_evidence_sha256 <> v_source_catchup_evidence_sha256
    or v_seal.source_steady_evidence_sha256 <> v_source_steady_evidence_sha256
    or v_seal.checks <> v_checks then
    raise exception 'r5_catchup_reclaim_seal_existing_row_invalid';
  end if;
end;
$$;
