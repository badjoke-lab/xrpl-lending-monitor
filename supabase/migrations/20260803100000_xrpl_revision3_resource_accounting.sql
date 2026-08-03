create schema if not exists xrpl_resource_guard_v2;

create table if not exists xrpl_resource_guard_v2.tick_accounting (
  session_id text not null,
  tick_id text not null,
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null check (profile_id = 'supabase_free_postgres_pgcron_edge'),
  profile_revision integer not null check (profile_revision = 3),
  profile_identity_digest text not null check (
    profile_identity_digest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
  ),
  accounting_digest text not null check (accounting_digest ~ '^[a-f0-9]{64}$'),
  allowed boolean not null check (allowed),
  ledger_count integer not null check (ledger_count between 1 and 24),
  network_request_count integer not null check (network_request_count between 1 and 64),
  database_request_count integer not null check (database_request_count between 1 and 16),
  transaction_count integer not null check (transaction_count between 0 and 4096),
  metadata_node_count integer not null check (metadata_node_count between 0 and 32768),
  normalized_record_count integer not null check (normalized_record_count between 0 and 16384),
  payload_chunk_count integer not null check (payload_chunk_count between 0 and 1024),
  relationship_count integer not null check (relationship_count between 0 and 65536),
  exact_wire_bytes bigint not null check (exact_wire_bytes >= 0),
  serialized_live_bytes bigint not null check (serialized_live_bytes >= 0),
  object_overhead_bytes bigint not null check (object_overhead_bytes >= 0),
  dynamic_memory_upper_bound_bytes bigint not null check (dynamic_memory_upper_bound_bytes >= 0),
  conservative_memory_upper_bound_bytes bigint not null check (
    conservative_memory_upper_bound_bytes >= 0
    and conservative_memory_upper_bound_bytes < 234881024
  ),
  conservative_tick_egress_upper_bound_bytes bigint not null check (
    conservative_tick_egress_upper_bound_bytes >= 0
    and conservative_tick_egress_upper_bound_bytes < 33554432
  ),
  conservative_egress_31d_upper_bound_bytes bigint not null check (
    conservative_egress_31d_upper_bound_bytes >= 0
    and conservative_egress_31d_upper_bound_bytes < 4294967296
  ),
  projected_invocations_31d bigint not null check (
    projected_invocations_31d >= 0
    and projected_invocations_31d < 400000
  ),
  accounting jsonb not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_id, tick_id),
  foreign key (session_id, tick_id)
    references xrpl_steady_v1.ticks(session_id, tick_id)
    on delete cascade
);

create index if not exists xrpl_revision3_tick_accounting_recorded_idx
  on xrpl_resource_guard_v2.tick_accounting (recorded_at desc);

revoke all on schema xrpl_resource_guard_v2 from public, anon, authenticated;
revoke all on all tables in schema xrpl_resource_guard_v2 from public, anon, authenticated;

create or replace function public.xrpl_read_revision3_accounting_window(
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_resource_guard_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_prior_egress bigint;
  v_prior_invocations bigint;
  v_external_observed_at timestamptz;
begin
  select coalesce(sum(conservative_tick_egress_upper_bound_bytes), 0)::bigint
    into v_prior_egress
  from xrpl_resource_guard_v2.tick_accounting
  where allowed
    and recorded_at >= p_observed_at - interval '31 days'
    and recorded_at <= p_observed_at;

  select projected_invocations_31d, observed_at
    into v_prior_invocations, v_external_observed_at
  from xrpl_resource_guard_v1.external_snapshots
  order by observed_at desc, snapshot_id desc
  limit 1;

  if v_prior_invocations is null
    or v_external_observed_at is null
    or v_external_observed_at < p_observed_at - interval '25 hours' then
    v_prior_invocations := 400000;
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'profileRevision', 3,
    'profileIdentityDigest', '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    'observedAt', p_observed_at,
    'priorConservativeEgress31dBytes', v_prior_egress,
    'priorInvocations31d', v_prior_invocations,
    'externalInvocationSnapshotObservedAt', v_external_observed_at,
    'thresholds', jsonb_build_object(
      'projectEgressHalt31dBytes', 4294967296,
      'providerEgressHard31dBytes', 5368709120,
      'projectInvocationHalt31d', 400000,
      'providerInvocationHard31d', 500000
    ),
    'checks', jsonb_build_object(
      'providerEgressCounterClaimed', false,
      'applicationAccountingOnly', true,
      'freshInvocationSnapshotRequired', true
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
  if (v_result->>'schemaVersion')::integer <> 1
    or (v_result->>'profileRevision')::integer <> 3
    or coalesce((v_result->>'allowed')::boolean, false) is not true
    or jsonb_typeof(v_failures) <> 'array'
    or jsonb_array_length(v_failures) <> 0
    or jsonb_typeof(v_thresholds) <> 'object'
    or jsonb_typeof(v_checks) <> 'object' then
    raise exception 'revision-3 accounting result is not safe';
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

  if (v_input->>'ledgerCount')::integer not between 1 and 24
    or (v_input->>'networkRequestCount')::integer not between 1 and 64
    or (v_input->>'databaseRequestCount')::integer not between 1 and 16
    or (v_input->>'transactionCount')::integer not between 0 and 4096
    or (v_input->>'metadataNodeCount')::integer not between 0 and 32768
    or (v_input->>'normalizedRecordCount')::integer not between 0 and 16384
    or (v_input->>'payloadChunkCount')::integer not between 0 and 1024
    or (v_input->>'relationshipCount')::integer not between 0 and 65536 then
    raise exception 'revision-3 accounting object counts are unsafe';
  end if;

  if (v_result->>'conservativeMemoryUpperBoundBytes')::bigint >= 234881024
    or (v_result->>'conservativeTickEgressUpperBoundBytes')::bigint >= 33554432
    or (v_result->>'conservativeEgress31dUpperBoundBytes')::bigint >= 4294967296
    or (v_result->>'projectedInvocations31d')::bigint >= 400000 then
    raise exception 'revision-3 accounting crossed a halt threshold';
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
    p_accounting_digest, true,
    (v_input->>'ledgerCount')::integer,
    (v_input->>'networkRequestCount')::integer,
    (v_input->>'databaseRequestCount')::integer,
    (v_input->>'transactionCount')::integer,
    (v_input->>'metadataNodeCount')::integer,
    (v_input->>'normalizedRecordCount')::integer,
    (v_input->>'payloadChunkCount')::integer,
    (v_input->>'relationshipCount')::integer,
    (v_result->>'exactWireBytes')::bigint,
    (v_result->>'serializedLiveBytes')::bigint,
    (v_result->>'objectOverheadBytes')::bigint,
    (v_result->>'dynamicMemoryUpperBoundBytes')::bigint,
    (v_result->>'conservativeMemoryUpperBoundBytes')::bigint,
    (v_result->>'conservativeTickEgressUpperBoundBytes')::bigint,
    (v_result->>'conservativeEgress31dUpperBoundBytes')::bigint,
    (v_result->>'projectedInvocations31d')::bigint,
    p_accounting, p_recorded_at
  ) on conflict (session_id, tick_id) do nothing;

  select * into v_existing
  from xrpl_resource_guard_v2.tick_accounting
  where session_id = v_tick.session_id and tick_id = v_tick.tick_id;

  if not found or v_existing.accounting_digest <> p_accounting_digest then
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
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select * into v_accounting
    from xrpl_resource_guard_v2.tick_accounting
    where session_id = new.session_id and tick_id = new.tick_id;

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
  end if;
  return new;
end;
$$;

drop trigger if exists xrpl_steady_revision3_accounting_precommit
  on xrpl_steady_v1.ticks;
create trigger xrpl_steady_revision3_accounting_precommit
before update on xrpl_steady_v1.ticks
for each row
execute function xrpl_resource_guard_v2.enforce_completed_tick();

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
        'schemaVersion', schema_version,
        'sessionId', session_id,
        'tickId', tick_id,
        'profileId', profile_id,
        'profileRevision', profile_revision,
        'profileIdentityDigest', profile_identity_digest,
        'accountingDigest', accounting_digest,
        'allowed', allowed,
        'ledgerCount', ledger_count,
        'networkRequestCount', network_request_count,
        'databaseRequestCount', database_request_count,
        'transactionCount', transaction_count,
        'metadataNodeCount', metadata_node_count,
        'normalizedRecordCount', normalized_record_count,
        'payloadChunkCount', payload_chunk_count,
        'relationshipCount', relationship_count,
        'exactWireBytes', exact_wire_bytes,
        'serializedLiveBytes', serialized_live_bytes,
        'objectOverheadBytes', object_overhead_bytes,
        'dynamicMemoryUpperBoundBytes', dynamic_memory_upper_bound_bytes,
        'conservativeMemoryUpperBoundBytes', conservative_memory_upper_bound_bytes,
        'conservativeTickEgressUpperBoundBytes', conservative_tick_egress_upper_bound_bytes,
        'conservativeEgress31dUpperBoundBytes', conservative_egress_31d_upper_bound_bytes,
        'projectedInvocations31d', projected_invocations_31d,
        'recordedAt', recorded_at
      )
      from xrpl_resource_guard_v2.tick_accounting
      where session_id = p_session_id and tick_id = p_tick_id
    ),
    jsonb_build_object('found', false)
  );
$$;

revoke all on function public.xrpl_read_revision3_accounting_window(timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_record_revision3_tick_accounting(
  text, text, timestamptz, text, jsonb
) from public, anon, authenticated;
revoke all on function public.xrpl_read_revision3_tick_accounting(text, text)
  from public, anon, authenticated;

grant execute on function public.xrpl_read_revision3_accounting_window(timestamptz)
  to service_role;
grant execute on function public.xrpl_record_revision3_tick_accounting(
  text, text, timestamptz, text, jsonb
) to service_role;
grant execute on function public.xrpl_read_revision3_tick_accounting(text, text)
  to service_role;
