alter table xrpl_resource_guard_v2.tick_accounting
  drop constraint if exists tick_accounting_pkey;
alter table xrpl_resource_guard_v2.tick_accounting
  add primary key (session_id, tick_id, accounting_digest);

create or replace function public.xrpl_read_revision3_accounting_context(
  p_owner text,
  p_tick_id text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_tick xrpl_steady_v1.ticks%rowtype;
  v_required boolean;
  v_window jsonb;
begin
  select * into v_tick
  from xrpl_steady_v1.ticks
  where tick_id = p_tick_id;

  if not found
    or v_tick.status <> 'leased'
    or v_tick.lease_owner is distinct from p_owner
    or v_tick.lease_expires_at is null
    or v_tick.lease_expires_at <= p_observed_at then
    raise exception 'revision-3 accounting context ownership is invalid';
  end if;

  select resource_guard_enabled into v_required
  from xrpl_steady_v1.sessions
  where session_id = v_tick.session_id;

  v_window := public.xrpl_read_revision3_accounting_window(p_observed_at);

  return jsonb_build_object(
    'schemaVersion', 1,
    'required', coalesce(v_required, false),
    'sessionId', v_tick.session_id,
    'tickId', v_tick.tick_id,
    'profileRevision', 3,
    'profileIdentityDigest',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    'priorConservativeEgress31dBytes',
      (v_window->>'priorConservativeEgress31dBytes')::bigint,
    'priorInvocations31d', (v_window->>'priorInvocations31d')::bigint,
    'checks', jsonb_build_object(
      'exactTickOwnership', true,
      'guardedSessionRequiresAccounting', coalesce(v_required, false),
      'unguardedQualificationPreserved', not coalesce(v_required, false),
      'failedAttemptsIncludedInRollingEgress', true
    )
  );
end;
$$;

create or replace function public.xrpl_record_revision3_tick_accounting(
  p_owner text,
  p_tick_id text,
  p_recorded_at timestamptz,
  p_accounting_digest text,
  p_accounting jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_tick xrpl_steady_v1.ticks%rowtype;
  v_existing xrpl_resource_guard_v2.tick_accounting%rowtype;
  v_input jsonb;
  v_result jsonb;
  v_thresholds jsonb;
  v_checks jsonb;
  v_failures jsonb;
  v_allowed boolean;
  v_ledger_count integer;
  v_network_request_count integer;
  v_database_request_count integer;
  v_transaction_count integer;
  v_metadata_node_count integer;
  v_normalized_record_count integer;
  v_payload_chunk_count integer;
  v_relationship_count integer;
  v_exact_wire_bytes bigint;
  v_serialized_live_bytes bigint;
  v_object_overhead_bytes bigint;
  v_dynamic_memory_upper_bound_bytes bigint;
  v_conservative_memory_upper_bound_bytes bigint;
  v_conservative_tick_egress_upper_bound_bytes bigint;
  v_conservative_egress_31d_upper_bound_bytes bigint;
  v_projected_invocations_31d bigint;
begin
  if p_owner is null or btrim(p_owner) = ''
    or p_tick_id is null or btrim(p_tick_id) = ''
    or p_accounting_digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_accounting) <> 'object' then
    raise exception 'invalid revision-3 accounting request';
  end if;

  select * into v_tick
  from xrpl_steady_v1.ticks
  where tick_id = p_tick_id
  for update;

  if not found
    or v_tick.status <> 'leased'
    or v_tick.lease_owner is distinct from p_owner
    or v_tick.lease_expires_at is null
    or v_tick.lease_expires_at <= p_recorded_at then
    raise exception 'revision-3 accounting tick ownership is invalid';
  end if;

  if p_accounting->>'profileId' <> 'supabase_free_postgres_pgcron_edge'
    or (p_accounting->>'profileRevision')::integer <> 3
    or p_accounting->>'profileIdentityDigest'
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67' then
    raise exception 'revision-3 accounting profile identity changed';
  end if;

  v_input := p_accounting->'input';
  v_result := p_accounting->'result';
  if jsonb_typeof(v_input) <> 'object' or jsonb_typeof(v_result) <> 'object' then
    raise exception 'revision-3 accounting input or result is missing';
  end if;

  v_failures := v_result->'failures';
  v_thresholds := v_result->'thresholds';
  v_checks := v_result->'checks';
  v_allowed := (v_result->>'allowed')::boolean;
  if (v_result->>'schemaVersion')::integer <> 1
    or (v_result->>'profileRevision')::integer <> 3
    or jsonb_typeof(v_failures) <> 'array'
    or jsonb_typeof(v_thresholds) <> 'object'
    or jsonb_typeof(v_checks) <> 'object'
    or (v_allowed and jsonb_array_length(v_failures) <> 0)
    or (not v_allowed and jsonb_array_length(v_failures) = 0) then
    raise exception 'revision-3 accounting result is inconsistent';
  end if;

  if coalesce((v_checks->>'unavailableProviderMemoryNotClaimed')::boolean, false) is not true
    or coalesce((v_checks->>'unavailableProviderEgressNotClaimed')::boolean, false) is not true
    or coalesce((v_checks->>'fixedRuntimeReserveApplied')::boolean, false) is not true
    or coalesce((v_checks->>'serializedBytesAmplified')::boolean, false) is not true
    or coalesce((v_checks->>'objectOverheadApplied')::boolean, false) is not true
    or coalesce((v_checks->>'allNetworkDirectionsCounted')::boolean, false) is not true
    or coalesce((v_checks->>'preMutationDecision')::boolean, false) is not true then
    raise exception 'revision-3 accounting checks are incomplete';
  end if;

  if (v_thresholds->>'projectMemoryHaltBytes')::bigint <> 234881024
    or (v_thresholds->>'providerMemoryHardBytes')::bigint <> 268435456
    or (v_thresholds->>'projectTickEgressHaltBytes')::bigint <> 33554432
    or (v_thresholds->>'projectEgressHalt31dBytes')::bigint <> 4294967296
    or (v_thresholds->>'providerEgressHard31dBytes')::bigint <> 5368709120
    or (v_thresholds->>'projectInvocationHalt31d')::bigint <> 400000
    or (v_thresholds->>'providerInvocationHard31d')::bigint <> 500000 then
    raise exception 'revision-3 accounting thresholds changed';
  end if;

  v_ledger_count := (v_input->>'ledgerCount')::integer;
  v_network_request_count := (v_input->>'networkRequestCount')::integer;
  v_database_request_count := (v_input->>'databaseRequestCount')::integer;
  v_transaction_count := (v_input->>'transactionCount')::integer;
  v_metadata_node_count := (v_input->>'metadataNodeCount')::integer;
  v_normalized_record_count := (v_input->>'normalizedRecordCount')::integer;
  v_payload_chunk_count := (v_input->>'payloadChunkCount')::integer;
  v_relationship_count := (v_input->>'relationshipCount')::integer;
  v_exact_wire_bytes := (v_result->>'exactWireBytes')::bigint;
  v_serialized_live_bytes := (v_result->>'serializedLiveBytes')::bigint;
  v_object_overhead_bytes := (v_result->>'objectOverheadBytes')::bigint;
  v_dynamic_memory_upper_bound_bytes := (v_result->>'dynamicMemoryUpperBoundBytes')::bigint;
  v_conservative_memory_upper_bound_bytes :=
    (v_result->>'conservativeMemoryUpperBoundBytes')::bigint;
  v_conservative_tick_egress_upper_bound_bytes :=
    (v_result->>'conservativeTickEgressUpperBoundBytes')::bigint;
  v_conservative_egress_31d_upper_bound_bytes :=
    (v_result->>'conservativeEgress31dUpperBoundBytes')::bigint;
  v_projected_invocations_31d := (v_result->>'projectedInvocations31d')::bigint;

  if v_ledger_count < 0
    or v_network_request_count < 0
    or v_database_request_count < 0
    or v_transaction_count < 0
    or v_metadata_node_count < 0
    or v_normalized_record_count < 0
    or v_payload_chunk_count < 0
    or v_relationship_count < 0
    or v_exact_wire_bytes < 0
    or v_serialized_live_bytes < 0
    or v_object_overhead_bytes < 0
    or v_dynamic_memory_upper_bound_bytes < 0
    or v_conservative_memory_upper_bound_bytes < 0
    or v_conservative_tick_egress_upper_bound_bytes < 0
    or v_conservative_egress_31d_upper_bound_bytes < 0
    or v_projected_invocations_31d < 0 then
    raise exception 'revision-3 accounting contains a negative value';
  end if;

  if v_allowed and (
    v_ledger_count not between 0 and 24
    or v_network_request_count not between 1 and 64
    or v_database_request_count not between 1 and 16
    or v_transaction_count not between 0 and 4096
    or v_metadata_node_count not between 0 and 32768
    or v_normalized_record_count not between 0 and 16384
    or v_payload_chunk_count not between 0 and 1024
    or v_relationship_count not between 0 and 65536
    or v_conservative_memory_upper_bound_bytes >= 234881024
    or v_conservative_tick_egress_upper_bound_bytes >= 33554432
    or v_conservative_egress_31d_upper_bound_bytes >= 4294967296
    or v_projected_invocations_31d >= 400000
  ) then
    raise exception 'revision-3 safe accounting crossed a halt threshold';
  end if;

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
    v_tick.session_id, v_tick.tick_id,
    'supabase_free_postgres_pgcron_edge', 3,
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    p_accounting_digest, v_allowed,
    v_ledger_count, v_network_request_count, v_database_request_count,
    v_transaction_count, v_metadata_node_count, v_normalized_record_count,
    v_payload_chunk_count, v_relationship_count,
    v_exact_wire_bytes, v_serialized_live_bytes, v_object_overhead_bytes,
    v_dynamic_memory_upper_bound_bytes, v_conservative_memory_upper_bound_bytes,
    v_conservative_tick_egress_upper_bound_bytes,
    v_conservative_egress_31d_upper_bound_bytes, v_projected_invocations_31d,
    p_accounting, p_recorded_at
  ) on conflict (session_id, tick_id, accounting_digest) do nothing;

  select * into v_existing
  from xrpl_resource_guard_v2.tick_accounting
  where session_id = v_tick.session_id
    and tick_id = v_tick.tick_id
    and accounting_digest = p_accounting_digest;

  if not found or v_existing.allowed is distinct from v_allowed then
    raise exception 'revision-3 accounting replay conflicts with retained evidence';
  end if;

  return jsonb_build_object(
    'recorded', true,
    'sessionId', v_existing.session_id,
    'tickId', v_existing.tick_id,
    'profileRevision', v_existing.profile_revision,
    'profileIdentityDigest', v_existing.profile_identity_digest,
    'accountingDigest', v_existing.accounting_digest,
    'allowed', v_existing.allowed,
    'recordedAt', v_existing.recorded_at
  );
end;
$$;

create or replace function xrpl_resource_guard_v2.enforce_completed_tick()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_accounting xrpl_resource_guard_v2.tick_accounting%rowtype;
  v_enabled boolean;
begin
  if new.status <> 'completed' or old.status is not distinct from 'completed' then
    return new;
  end if;

  select resource_guard_enabled into v_enabled
  from xrpl_steady_v1.sessions
  where session_id = new.session_id;

  if not coalesce(v_enabled, false) then
    return new;
  end if;

  select * into v_accounting
  from xrpl_resource_guard_v2.tick_accounting
  where session_id = new.session_id and tick_id = new.tick_id
  order by recorded_at desc, created_at desc
  limit 1;

  if not found
    or not v_accounting.allowed
    or v_accounting.profile_revision <> 3
    or v_accounting.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_accounting.recorded_at > coalesce(new.completed_at, clock_timestamp())
    or v_accounting.conservative_memory_upper_bound_bytes >= 234881024
    or v_accounting.conservative_tick_egress_upper_bound_bytes >= 33554432
    or v_accounting.conservative_egress_31d_upper_bound_bytes >= 4294967296
    or v_accounting.projected_invocations_31d >= 400000 then
    raise exception 'revision3_resource_accounting_precommit';
  end if;

  return new;
end;
$$;

create or replace function public.xrpl_read_revision3_tick_accounting(
  p_session_id text,
  p_tick_id text
)
returns jsonb
language sql
security definer
set search_path = public, xrpl_resource_guard_v2, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'schemaVersion', latest.schema_version,
        'sessionId', latest.session_id,
        'tickId', latest.tick_id,
        'profileId', latest.profile_id,
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
        'accounting', latest.accounting,
        'recordedAt', latest.recorded_at,
        'attemptCount', (
          select count(*)
          from xrpl_resource_guard_v2.tick_accounting attempts
          where attempts.session_id = p_session_id and attempts.tick_id = p_tick_id
        )
      )
      from (
        select *
        from xrpl_resource_guard_v2.tick_accounting
        where session_id = p_session_id and tick_id = p_tick_id
        order by recorded_at desc, created_at desc
        limit 1
      ) latest
    ),
    jsonb_build_object('found', false, 'attemptCount', 0)
  );
$$;

revoke all on function public.xrpl_read_revision3_accounting_context(
  text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.xrpl_read_revision3_accounting_context(
  text, text, timestamptz
) to service_role;
