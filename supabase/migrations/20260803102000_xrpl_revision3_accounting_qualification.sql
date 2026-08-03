create table if not exists xrpl_resource_guard_v2.qualifications (
  qualification_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  guard_kind text not null check (guard_kind in (
    'missing_accounting',
    'unsafe_accounting',
    'memory_halt',
    'tick_egress_halt',
    'monthly_egress_halt',
    'invocation_halt',
    'future_record'
  )),
  rejected boolean not null,
  result jsonb not null,
  created_at timestamptz not null
);

revoke all on table xrpl_resource_guard_v2.qualifications
  from public, anon, authenticated;

create or replace function public.xrpl_read_revision3_session_accounting(
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_session xrpl_steady_v1.sessions%rowtype;
  v_latest jsonb;
  v_attempt_count integer;
  v_allowed_attempt_count integer;
  v_unsafe_attempt_count integer;
  v_completed_tick_count integer;
  v_accounted_completed_tick_count integer;
  v_latest_count integer;
  v_all_latest_allowed boolean;
  v_all_below_thresholds boolean;
  v_all_recorded_before_completion boolean;
  v_active_stream public.xrpl_phase_streams%rowtype;
  v_active_watermark public.xrpl_phase_watermarks%rowtype;
begin
  select * into v_session
  from xrpl_steady_v1.sessions
  where session_id = p_session_id;
  if not found then
    return jsonb_build_object('found', false, 'sessionId', p_session_id);
  end if;

  with latest as (
    select distinct on (tick_id) *
    from xrpl_resource_guard_v2.tick_accounting
    where session_id = p_session_id
    order by tick_id, recorded_at desc, created_at desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tickId', latest.tick_id,
      'profileRevision', latest.profile_revision,
      'profileIdentityDigest', latest.profile_identity_digest,
      'accountingDigest', latest.accounting_digest,
      'allowed', latest.allowed,
      'ledgerCount', latest.ledger_count,
      'networkRequestCount', latest.network_request_count,
      'databaseRequestCount', latest.database_request_count,
      'transactionCount', latest.transaction_count,
      'metadataNodeCount', latest.metadata_node_count,
      'normalizedRecordCount', latest.normalized_record_count,
      'payloadChunkCount', latest.payload_chunk_count,
      'relationshipCount', latest.relationship_count,
      'exactWireBytes', latest.exact_wire_bytes,
      'serializedLiveBytes', latest.serialized_live_bytes,
      'objectOverheadBytes', latest.object_overhead_bytes,
      'dynamicMemoryUpperBoundBytes', latest.dynamic_memory_upper_bound_bytes,
      'conservativeMemoryUpperBoundBytes', latest.conservative_memory_upper_bound_bytes,
      'conservativeTickEgressUpperBoundBytes',
        latest.conservative_tick_egress_upper_bound_bytes,
      'conservativeEgress31dUpperBoundBytes',
        latest.conservative_egress_31d_upper_bound_bytes,
      'projectedInvocations31d', latest.projected_invocations_31d,
      'recordedAt', latest.recorded_at,
      'checks', latest.accounting->'result'->'checks'
    ) order by latest.tick_id
  ), '[]'::jsonb)
  into v_latest
  from latest;

  select count(*)::integer,
         count(*) filter (where allowed)::integer,
         count(*) filter (where not allowed)::integer
  into v_attempt_count, v_allowed_attempt_count, v_unsafe_attempt_count
  from xrpl_resource_guard_v2.tick_accounting
  where session_id = p_session_id;

  select count(*)::integer
  into v_completed_tick_count
  from xrpl_steady_v1.ticks
  where session_id = p_session_id and status = 'completed';

  with latest as (
    select distinct on (tick_id) *
    from xrpl_resource_guard_v2.tick_accounting
    where session_id = p_session_id
    order by tick_id, recorded_at desc, created_at desc
  )
  select count(*)::integer,
         coalesce(bool_and(latest.allowed), false),
         coalesce(bool_and(
           latest.conservative_memory_upper_bound_bytes < 234881024
           and latest.conservative_tick_egress_upper_bound_bytes < 33554432
           and latest.conservative_egress_31d_upper_bound_bytes < 4294967296
           and latest.projected_invocations_31d < 400000
         ), false),
         coalesce(bool_and(latest.recorded_at <= ticks.completed_at), false),
         count(*) filter (
           where ticks.status = 'completed'
             and latest.allowed
             and latest.recorded_at <= ticks.completed_at
         )::integer
  into v_latest_count, v_all_latest_allowed, v_all_below_thresholds,
       v_all_recorded_before_completion, v_accounted_completed_tick_count
  from latest
  join xrpl_steady_v1.ticks ticks
    on ticks.session_id = latest.session_id and ticks.tick_id = latest.tick_id;

  select * into v_active_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  select * into v_active_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  return jsonb_build_object(
    'found', true,
    'schemaVersion', 1,
    'sessionId', v_session.session_id,
    'sessionStatus', v_session.status,
    'resourceGuardEnabled', v_session.resource_guard_enabled,
    'profileId', 'supabase_free_postgres_pgcron_edge',
    'profileRevision', 3,
    'profileIdentityDigest',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    'targetTicks', v_session.target_ticks,
    'completedTicks', v_session.completed_ticks,
    'committedLedgers', v_session.committed_ledgers,
    'attemptCount', v_attempt_count,
    'allowedAttemptCount', v_allowed_attempt_count,
    'unsafeAttemptCount', v_unsafe_attempt_count,
    'completedTickCount', v_completed_tick_count,
    'latestAccountingCount', v_latest_count,
    'accountedCompletedTickCount', v_accounted_completed_tick_count,
    'latestAccountings', v_latest,
    'activeSource', jsonb_build_object(
      'profileId', v_active_stream.profile_id,
      'status', v_active_stream.status,
      'network', v_active_stream.network,
      'epochId', v_active_stream.epoch_id,
      'baseIdentity', v_active_stream.base_identity,
      'ledgerIndex', v_active_watermark.ledger_index,
      'ledgerHash', v_active_watermark.ledger_hash,
      'workId', v_active_watermark.work_id
    ),
    'checks', jsonb_build_object(
      'guardedSession', v_session.resource_guard_enabled,
      'exactRevision3Identity', true,
      'oneLatestAccountingPerCompletedTick',
        v_latest_count = v_completed_tick_count
        and v_accounted_completed_tick_count = v_completed_tick_count,
      'allLatestAllowed', v_all_latest_allowed,
      'allBelowThresholds', v_all_below_thresholds,
      'allRecordedBeforeCompletion', v_all_recorded_before_completion,
      'providerPeakMemoryClaimed', false,
      'providerEgressClaimed', false,
      'activeProfileReadOnly', true
    )
  );
end;
$$;

create or replace function public.xrpl_qualify_revision3_accounting_precommit(
  p_qualification_id text,
  p_guard_kind text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_session_id text;
  v_tick_id text;
  v_stream_before public.xrpl_phase_streams%rowtype;
  v_watermark_before public.xrpl_phase_watermarks%rowtype;
  v_stream_after public.xrpl_phase_streams%rowtype;
  v_watermark_after public.xrpl_phase_watermarks%rowtype;
  v_rejected boolean := false;
  v_reason text;
  v_allowed boolean := true;
  v_memory bigint := 100000000;
  v_tick_egress bigint := 1000000;
  v_monthly_egress bigint := 1000000000;
  v_invocations bigint := 100000;
  v_recorded_at timestamptz := p_observed_at;
  v_counts jsonb;
  v_result jsonb;
  v_digest text;
begin
  if p_qualification_id !~ '^[a-z0-9][a-z0-9-]{7,79}$' then
    raise exception 'invalid revision-3 qualification id';
  end if;
  if p_guard_kind not in (
    'missing_accounting', 'unsafe_accounting', 'memory_halt',
    'tick_egress_halt', 'monthly_egress_halt', 'invocation_halt',
    'future_record'
  ) then
    raise exception 'invalid revision-3 qualification guard kind';
  end if;
  if exists (
    select 1 from xrpl_resource_guard_v2.qualifications
    where qualification_id = p_qualification_id
  ) then
    return (
      select result from xrpl_resource_guard_v2.qualifications
      where qualification_id = p_qualification_id
    );
  end if;

  select * into v_stream_before
  from public.xrpl_phase_streams where profile_id = 'supabase-devnet';
  select * into v_watermark_before
  from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet';
  if not found or v_stream_before.status <> 'active' then
    raise exception 'active source is unavailable for revision-3 qualification';
  end if;

  v_session_id := concat('r4c3-', p_qualification_id);
  v_tick_id := concat('steady:v1:', v_session_id, ':tick:1');

  insert into xrpl_steady_v1.sessions (
    session_id, source_profile_id, target_profile_id, network, epoch_id,
    base_identity, status, target_ticks, batch_size,
    completed_ticks, committed_ledgers,
    anchor_ledger_index, anchor_ledger_hash, anchor_work_id,
    anchor_epoch_id, anchor_base_identity,
    watermark_ledger_index, watermark_ledger_hash, watermark_work_id,
    resource_guard_enabled, resource_guard_status, resource_guard_checked_at,
    prepared_at, completed_at, updated_at
  ) values (
    v_session_id, 'supabase-devnet', 'supabase-devnet-steady-qualification',
    'devnet', 'supabase-r4c2c-v1', concat('r4c3-qualification-', p_qualification_id),
    'halted', 6, 24, 0, 0,
    v_watermark_before.ledger_index, v_watermark_before.ledger_hash,
    v_watermark_before.work_id, v_watermark_before.epoch_id,
    v_watermark_before.base_identity,
    v_watermark_before.ledger_index, v_watermark_before.ledger_hash,
    v_watermark_before.work_id,
    true, 'passed', p_observed_at,
    p_observed_at, p_observed_at, p_observed_at
  );

  insert into xrpl_steady_v1.ticks (
    session_id, tick_id, tick_sequence, scheduled_minute, status,
    lease_owner, lease_expires_at, start_ledger_index, end_ledger_index,
    expected_parent_hash, claimed_at
  ) values (
    v_session_id, v_tick_id, 1, date_trunc('minute', p_observed_at),
    'leased', concat('qualification-', p_guard_kind), p_observed_at + interval '10 minutes',
    v_watermark_before.ledger_index + 1, v_watermark_before.ledger_index + 24,
    v_watermark_before.ledger_hash, p_observed_at
  );

  if p_guard_kind = 'unsafe_accounting' then
    v_allowed := false;
  elsif p_guard_kind = 'memory_halt' then
    v_memory := 234881024;
  elsif p_guard_kind = 'tick_egress_halt' then
    v_tick_egress := 33554432;
  elsif p_guard_kind = 'monthly_egress_halt' then
    v_monthly_egress := 4294967296;
  elsif p_guard_kind = 'invocation_halt' then
    v_invocations := 400000;
  elsif p_guard_kind = 'future_record' then
    v_recorded_at := p_observed_at + interval '1 minute';
  end if;

  if p_guard_kind <> 'missing_accounting' then
    v_digest := repeat(substr(md5(p_qualification_id || p_guard_kind), 1, 1), 64);
    insert into xrpl_resource_guard_v2.tick_accounting (
      session_id, tick_id, profile_id, profile_revision,
      profile_identity_digest, accounting_digest, allowed,
      ledger_count, network_request_count, database_request_count,
      transaction_count, metadata_node_count, normalized_record_count,
      payload_chunk_count, relationship_count,
      exact_wire_bytes, serialized_live_bytes, object_overhead_bytes,
      dynamic_memory_upper_bound_bytes, conservative_memory_upper_bound_bytes,
      conservative_tick_egress_upper_bound_bytes,
      conservative_egress_31d_upper_bound_bytes, projected_invocations_31d,
      accounting, recorded_at
    ) values (
      v_session_id, v_tick_id, 'supabase_free_postgres_pgcron_edge', 3,
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      v_digest, v_allowed,
      24, 25, 6, 1, 1, 1, 24, 1,
      1000000, 1000000, 1000000, 1000000, v_memory,
      v_tick_egress, v_monthly_egress, v_invocations,
      jsonb_build_object(
        'schemaVersion', 1,
        'purpose', 'r4c3-accounting-precommit-qualification',
        'guardKind', p_guard_kind,
        'allowed', v_allowed
      ),
      v_recorded_at
    );
  end if;

  begin
    update xrpl_steady_v1.ticks
    set status = 'completed',
        final_ledger_hash = v_watermark_before.ledger_hash,
        work_count = 24,
        record_count = 0,
        message_count = 0,
        successor_count = 0,
        works_digest = repeat('a', 64),
        rows_digest = repeat('b', 64),
        fetch_milliseconds = 1,
        normalize_milliseconds = 1,
        edge_wall_milliseconds = 1,
        database_milliseconds = 1,
        lease_owner = null,
        lease_expires_at = null,
        completed_at = p_observed_at,
        error_message = null
    where session_id = v_session_id and tick_id = v_tick_id;
  exception when others then
    if position('revision3_resource_accounting_precommit' in sqlerrm) > 0 then
      v_rejected := true;
      v_reason := sqlerrm;
    else
      raise;
    end if;
  end;

  select jsonb_build_object(
    'ticks', count(*) filter (where status = 'completed'),
    'works', (select count(*) from xrpl_steady_v1.works where session_id = v_session_id),
    'messages', (select count(*) from xrpl_steady_v1.messages where session_id = v_session_id),
    'successors', (select count(*) from xrpl_steady_v1.successors where session_id = v_session_id),
    'accountingAttempts', (
      select count(*) from xrpl_resource_guard_v2.tick_accounting
      where session_id = v_session_id
    )
  ) into v_counts
  from xrpl_steady_v1.ticks where session_id = v_session_id;

  select * into v_stream_after
  from public.xrpl_phase_streams where profile_id = 'supabase-devnet';
  select * into v_watermark_after
  from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet';

  if not v_rejected
    or (v_counts->>'ticks')::integer <> 0
    or (v_counts->>'works')::integer <> 0
    or (v_counts->>'messages')::integer <> 0
    or (v_counts->>'successors')::integer <> 0
    or v_stream_after is distinct from v_stream_before
    or v_watermark_after is distinct from v_watermark_before then
    raise exception 'revision-3 qualification did not fail closed:%', p_guard_kind;
  end if;

  v_result := jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r4c3-accounting-precommit-qualification',
    'qualificationId', p_qualification_id,
    'guardKind', p_guard_kind,
    'rejected', v_rejected,
    'reason', v_reason,
    'guardedCounts', v_counts,
    'checks', jsonb_build_object(
      'precommitRejected', v_rejected,
      'noCompletedTick', (v_counts->>'ticks')::integer = 0,
      'noWorkCommitted', (v_counts->>'works')::integer = 0,
      'noMessageReserved', (v_counts->>'messages')::integer = 0,
      'noSuccessorReserved', (v_counts->>'successors')::integer = 0,
      'activeProfileReadOnly', true,
      'exactRevision3Identity', true
    )
  );

  insert into xrpl_resource_guard_v2.qualifications (
    qualification_id, guard_kind, rejected, result, created_at
  ) values (
    p_qualification_id, p_guard_kind, v_rejected, v_result, p_observed_at
  );

  delete from xrpl_steady_v1.sessions where session_id = v_session_id;
  return v_result;
end;
$$;

revoke all on function public.xrpl_read_revision3_session_accounting(text)
  from public, anon, authenticated;
revoke all on function public.xrpl_qualify_revision3_accounting_precommit(
  text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.xrpl_read_revision3_session_accounting(text)
  to service_role;
grant execute on function public.xrpl_qualify_revision3_accounting_precommit(
  text, text, timestamptz
) to service_role;
