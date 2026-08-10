create schema if not exists xrpl_qualification_archive_v1;
revoke all on schema xrpl_qualification_archive_v1 from public, anon, authenticated;

create table if not exists xrpl_qualification_archive_v1.steady_reclaim_authorizations (
  authorization_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  issue_number integer not null check (issue_number = 1261),
  decision_comment_id bigint not null check (decision_comment_id > 0),
  approved_by text not null check (approved_by = 'badjoke-lab'),
  authorization_digest text not null check (authorization_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists xrpl_qualification_archive_v1.steady_reclaims (
  archive_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  authorization_id text not null references xrpl_qualification_archive_v1.steady_reclaim_authorizations(authorization_id),
  source_workflow_run_id bigint not null check (source_workflow_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  source_artifact_id bigint not null check (source_artifact_id > 0),
  source_artifact_digest text not null check (source_artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  retained_session_id text not null,
  retained_tick_count integer not null check (retained_tick_count = 6),
  reclaimed_schema text not null check (reclaimed_schema = 'xrpl_steady_v1'),
  physical_bytes_before bigint not null check (physical_bytes_before > 0),
  physical_bytes_after bigint not null check (physical_bytes_after >= 0),
  table_counts_before jsonb not null check (jsonb_typeof(table_counts_before) = 'object'),
  active_watermark_before jsonb not null check (jsonb_typeof(active_watermark_before) = 'object'),
  active_watermark_after jsonb not null check (jsonb_typeof(active_watermark_after) = 'object'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  reclaimed_at timestamptz not null
);

revoke all on table xrpl_qualification_archive_v1.steady_reclaim_authorizations from public, anon, authenticated;
revoke all on table xrpl_qualification_archive_v1.steady_reclaims from public, anon, authenticated;

create or replace function public.xrpl_preview_steady_qualification_reclaim()
returns jsonb
language plpgsql security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_session xrpl_steady_v1.sessions%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_bytes bigint;
begin
  select * into v_session from xrpl_steady_v1.sessions where session_id = 'r4c2d-steady-msflb8fo-5ebc5adc';
  select * into v_watermark from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet';
  select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint into v_bytes
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'xrpl_steady_v1' and c.relkind in ('r','m','p');
  return jsonb_build_object(
    'schemaVersion', 1,
    'schema', 'xrpl_steady_v1',
    'retainedSessionId', 'r4c2d-steady-msflb8fo-5ebc5adc',
    'sourceWorkflowRunId', 30975277983,
    'sourceCommit', 'd7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c',
    'sourceArtifactId', 8924984813,
    'sourceArtifactDigest', 'sha256:76f4580d83c053dadfe8a707c7bf53b53d99d361fd12c12adefe76061a9dafa3',
    'physicalBytes', v_bytes,
    'sessionFound', v_session is not null,
    'sessionStatus', case when v_session is null then null else v_session.status end,
    'completedTicks', case when v_session is null then null else v_session.completed_ticks end,
    'committedLedgers', case when v_session is null then null else v_session.committed_ledgers end,
    'activeWatermark', case when v_watermark is null then null else jsonb_build_object('ledgerIndex', v_watermark.ledger_index, 'ledgerHash', v_watermark.ledger_hash, 'workId', v_watermark.work_id) end,
    'mutationPerformed', false
  );
end;
$$;

revoke all on function public.xrpl_preview_steady_qualification_reclaim() from public, anon, authenticated;
grant execute on function public.xrpl_preview_steady_qualification_reclaim() to service_role;

create or replace function public.xrpl_execute_steady_qualification_reclaim(p_authorization_id text)
returns jsonb
language plpgsql security definer
set search_path = public, xrpl_steady_v1, xrpl_qualification_archive_v1, pg_temp
as $$
declare
  v_auth xrpl_qualification_archive_v1.steady_reclaim_authorizations%rowtype;
  v_session xrpl_steady_v1.sessions%rowtype;
  v_wm_before public.xrpl_phase_watermarks%rowtype;
  v_wm_after public.xrpl_phase_watermarks%rowtype;
  v_before bigint;
  v_after bigint;
  v_lease_count bigint;
  v_running_count bigint;
  v_tick_count bigint;
  v_completed_ticks bigint;
  v_counts jsonb;
  v_active_before jsonb;
  v_active_after jsonb;
  v_evidence jsonb;
  v_final_evidence jsonb;
  v_digest text;
  v_archive_id constant text := 'r5-steady-reclaim-20260811-v1';
  v_rows_after bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4f-steady-qualification-reclaim', 0));
  select * into v_auth from xrpl_qualification_archive_v1.steady_reclaim_authorizations where authorization_id = p_authorization_id for update;
  if not found or v_auth.schema_version <> 1 or v_auth.issue_number <> 1261 or v_auth.approved_by <> 'badjoke-lab' or v_auth.expires_at <= clock_timestamp() or v_auth.used_at is not null then
    raise exception 'r4f_steady_reclaim_authorization_invalid_or_expired';
  end if;
  select * into v_session from xrpl_steady_v1.sessions where session_id = 'r4c2d-steady-msflb8fo-5ebc5adc' for share;
  if not found or v_session.status <> 'completed' or v_session.target_ticks <> 6 or v_session.batch_size <> 24 or v_session.completed_ticks <> 6 or v_session.committed_ledgers <> 144 or v_session.source_profile_id <> 'supabase-devnet' or v_session.target_profile_id <> 'supabase-devnet-steady-qualification' or v_session.network <> 'devnet' or v_session.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'r4f_steady_reclaim_retained_session_invalid';
  end if;
  select count(*) into v_running_count from xrpl_steady_v1.sessions where status = 'running';
  if v_running_count <> 0 then raise exception 'r4f_steady_reclaim_running_session_present'; end if;
  select count(*) into v_lease_count from xrpl_steady_v1.ticks where lease_owner is not null and lease_expires_at is not null;
  if v_lease_count <> 0 then raise exception 'r4f_steady_reclaim_active_lease_present'; end if;
  select count(*) into v_tick_count from xrpl_steady_v1.ticks where session_id = v_session.session_id;
  select count(*) into v_completed_ticks from xrpl_steady_v1.ticks where session_id = v_session.session_id and status = 'completed';
  if v_tick_count <> 6 or v_completed_ticks <> 6 then raise exception 'r4f_steady_reclaim_tick_evidence_invalid'; end if;
  select * into v_wm_before from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet' for share;
  if not found then raise exception 'r4f_steady_reclaim_active_watermark_missing'; end if;
  select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint into v_before
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'xrpl_steady_v1' and c.relkind in ('r','m','p');
  if v_before < 80000000 then raise exception 'r4f_steady_reclaim_storage_below_expected_boundary'; end if;
  v_counts := jsonb_build_object(
    'sessions', (select count(*)::bigint from xrpl_steady_v1.sessions),
    'ticks', (select count(*)::bigint from xrpl_steady_v1.ticks),
    'works', (select count(*)::bigint from xrpl_steady_v1.works),
    'messages', (select count(*)::bigint from xrpl_steady_v1.messages),
    'successors', (select count(*)::bigint from xrpl_steady_v1.successors),
    'payloadChunks', (select count(*)::bigint from xrpl_steady_v1.payload_chunks),
    'referenceRows', (select count(*)::bigint from xrpl_steady_v1.reference_rows),
    'commitChunks', (select count(*)::bigint from xrpl_steady_v1.commit_chunks)
  );
  v_active_before := jsonb_build_object('ledgerIndex', v_wm_before.ledger_index, 'ledgerHash', v_wm_before.ledger_hash, 'workId', v_wm_before.work_id);
  v_evidence := jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r5-steady-qualification-storage-reclaim',
    'authorizationId', p_authorization_id,
    'issueNumber', 1261,
    'decisionCommentId', v_auth.decision_comment_id,
    'authorizationDigest', v_auth.authorization_digest,
    'sourceWorkflowRunId', 30975277983,
    'sourceCommit', 'd7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c',
    'sourceArtifactId', 8924984813,
    'sourceArtifactDigest', 'sha256:76f4580d83c053dadfe8a707c7bf53b53d99d361fd12c12adefe76061a9dafa3',
    'sourceSteadyEvidenceSha256', 'fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c',
    'profileId', 'supabase_free_postgres_pgcron_edge',
    'profileRevision', 2,
    'profileIdentityDigest', 'c42edf0a1708fd2b7ea9f2e72dab32b87c1d66b260752efe38fec321253d3998',
    'retainedSessionId', v_session.session_id,
    'retainedTickCount', 6,
    'retainedCommittedLedgers', 144,
    'physicalBytesBefore', v_before,
    'tableCountsBefore', v_counts,
    'activeWatermarkBefore', v_active_before,
    'boundaries', jsonb_build_object('publicReaderUnchanged', true, 'mainnetDisabled', true, 'stabilizationAuthorized', false, 'soakAuthorized', false, 'activeR5TablesUntouched', true, 'activePublicTablesUntouched', true, 'canonicalHistoryUntouched', true, 'revision3AccountingUntouched', true, 'g3Rerun', false, 'reclaimScope', 'xrpl_steady_v1_only')
  );
  insert into xrpl_qualification_archive_v1.steady_reclaims (
    archive_id, authorization_id, source_workflow_run_id, source_commit, source_artifact_id, source_artifact_digest,
    retained_session_id, retained_tick_count, reclaimed_schema, physical_bytes_before, physical_bytes_after,
    table_counts_before, active_watermark_before, active_watermark_after, evidence, evidence_digest, reclaimed_at
  ) values (
    v_archive_id, p_authorization_id, 30975277983, 'd7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c', 8924984813,
    'sha256:76f4580d83c053dadfe8a707c7bf53b53d99d361fd12c12adefe76061a9dafa3', v_session.session_id, 6,
    'xrpl_steady_v1', v_before, 0, v_counts, v_active_before, '{}'::jsonb, v_evidence,
    public.xrpl_transfer_json_digest(v_evidence), clock_timestamp()
  );
  truncate table xrpl_steady_v1.payload_chunks, xrpl_steady_v1.reference_rows, xrpl_steady_v1.commit_chunks,
    xrpl_steady_v1.messages, xrpl_steady_v1.successors, xrpl_steady_v1.works, xrpl_steady_v1.ticks, xrpl_steady_v1.sessions;
  select
    (select count(*) from xrpl_steady_v1.sessions) + (select count(*) from xrpl_steady_v1.ticks) +
    (select count(*) from xrpl_steady_v1.works) + (select count(*) from xrpl_steady_v1.messages) +
    (select count(*) from xrpl_steady_v1.successors) + (select count(*) from xrpl_steady_v1.payload_chunks) +
    (select count(*) from xrpl_steady_v1.reference_rows) + (select count(*) from xrpl_steady_v1.commit_chunks)
  into v_rows_after;
  if v_rows_after <> 0 then raise exception 'r4f_steady_reclaim_live_rows_remain'; end if;
  select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint into v_after
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'xrpl_steady_v1' and c.relkind in ('r','m','p');
  select * into v_wm_after from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet' for share;
  if not found or v_wm_after.ledger_index is distinct from v_wm_before.ledger_index or v_wm_after.ledger_hash is distinct from v_wm_before.ledger_hash or v_wm_after.work_id is distinct from v_wm_before.work_id then
    raise exception 'r4f_steady_reclaim_active_watermark_changed';
  end if;
  v_active_after := jsonb_build_object('ledgerIndex', v_wm_after.ledger_index, 'ledgerHash', v_wm_after.ledger_hash, 'workId', v_wm_after.work_id);
  v_final_evidence := v_evidence || jsonb_build_object('physicalBytesAfter', v_after, 'activeWatermarkAfter', v_active_after);
  v_digest := public.xrpl_transfer_json_digest(v_final_evidence);
  update xrpl_qualification_archive_v1.steady_reclaims
  set physical_bytes_after = v_after, active_watermark_after = v_active_after, evidence = v_final_evidence, evidence_digest = v_digest, reclaimed_at = clock_timestamp()
  where archive_id = v_archive_id;
  update xrpl_qualification_archive_v1.steady_reclaim_authorizations set used_at = clock_timestamp() where authorization_id = p_authorization_id;
  if public.xrpl_transfer_json_digest((select evidence from xrpl_qualification_archive_v1.steady_reclaims where archive_id = v_archive_id)) is distinct from
     (select evidence_digest from xrpl_qualification_archive_v1.steady_reclaims where archive_id = v_archive_id) then
    raise exception 'r4f_steady_reclaim_archive_digest_mismatch';
  end if;
  return jsonb_build_object('reclaimed', true, 'archiveId', v_archive_id, 'physicalBytesBefore', v_before, 'physicalBytesAfter', v_after, 'activeWatermarkUnchanged', true, 'canonicalHistoryUntouched', true, 'authorizationConsumed', true);
end;
$$;

revoke all on function public.xrpl_execute_steady_qualification_reclaim(text) from public, anon, authenticated;
grant execute on function public.xrpl_execute_steady_qualification_reclaim(text) to service_role;
