drop trigger if exists xrpl_revision3_accounting_transfer_on_completion
  on xrpl_steady_v1.sessions;

create or replace function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_session xrpl_steady_v1.sessions%rowtype;
begin
  if old.status = 'open' and new.status = 'succeeded' then
    select * into v_session
    from xrpl_steady_v1.sessions
    where session_id = new.session_id;

    if found
      and v_session.status = 'completed'
      and v_session.resource_guard_enabled
      and v_session.completed_ticks = 6
      and v_session.committed_ledgers = 144 then
      perform public.xrpl_qualify_revision3_accounting_transfer(
        new.session_id, statement_timestamp()
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists xrpl_revision3_transfer_after_attempt_finalization
  on xrpl_resource_guard_v2.attempts;
create trigger xrpl_revision3_transfer_after_attempt_finalization
after update of status on xrpl_resource_guard_v2.attempts
for each row
execute function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization();

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
  v_transfer jsonb;
  v_transfer_qualified boolean;
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

  select result into v_transfer
  from xrpl_resource_guard_v2.transfer_qualifications
  where session_id = p_session_id;
  v_transfer_qualified := found
    and v_transfer #>> '{checks,rolling31dStateExported}' = 'true'
    and v_transfer #>> '{checks,typedRestoreCompleted}' = 'true'
    and v_transfer #>> '{checks,canonicalDigestParity}' = 'true'
    and v_transfer #>> '{checks,duplicateRestoreConverged}' = 'true'
    and v_transfer #>> '{checks,digestTamperRejected}' = 'true'
    and v_transfer #>> '{checks,effectiveEgressPreserved}' = 'true'
    and v_transfer #>> '{checks,reservedInvocationsPreserved}' = 'true'
    and v_transfer #>> '{checks,activeProfileReadOnly}' = 'true';

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
    'transferQualification', coalesce(
      v_transfer,
      jsonb_build_object('found', false, 'sessionId', p_session_id)
    ),
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
      'resourceAccountingStateTransferQualified', v_transfer_qualified,
      'providerPeakMemoryClaimed', false,
      'providerEgressClaimed', false,
      'activeProfileReadOnly', v_transfer_qualified
    )
  );
end;
$$;
