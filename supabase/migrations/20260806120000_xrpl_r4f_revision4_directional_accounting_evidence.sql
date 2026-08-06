create extension if not exists pgcrypto with schema extensions;

create schema if not exists xrpl_r4f_v1;

revoke all on schema xrpl_r4f_v1 from public;
revoke all on schema xrpl_r4f_v1 from anon;
revoke all on schema xrpl_r4f_v1 from authenticated;

grant usage on schema xrpl_r4f_v1 to service_role;

create table if not exists xrpl_r4f_v1.directional_accounting_evidence (
  observation_id text primary key,
  attempt_id text not null,
  observed_at timestamptz not null,
  disposition text not null check (
    disposition in (
      'shadow_completed',
      'shadow_failed',
      'shadow_retry',
      'shadow_repair',
      'shadow_adopted'
    )
  ),
  profile_id text not null check (
    profile_id = 'supabase_free_postgres_pgcron_edge'
  ),
  profile_revision integer not null check (profile_revision = 4),
  profile_identity_digest text not null check (
    profile_identity_digest = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
  ),
  accounting_schema_version integer not null check (accounting_schema_version = 1),
  accounting_json text not null,
  accounting_digest text not null check (
    accounting_digest ~ '^[a-f0-9]{64}$'
  ),
  observation_count integer not null check (observation_count >= 0),
  directional_wire_bytes bigint not null check (directional_wire_bytes >= 0),
  rolling_billable_egress_upper_bound_bytes bigint not null check (
    rolling_billable_egress_upper_bound_bytes >= 0
  ),
  memory_transport_upper_bound_bytes bigint not null check (
    memory_transport_upper_bound_bytes >= 0
  ),
  unexplained_directional_delta_reserve_bytes bigint not null check (
    unexplained_directional_delta_reserve_bytes >= 0
  ),
  memory_supplemental jsonb not null check (
    jsonb_typeof(memory_supplemental) = 'object'
  ),
  checks jsonb not null check (jsonb_typeof(checks) = 'object'),
  source_run_id bigint not null check (source_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  recovery_mutation_committed boolean not null default false check (
    recovery_mutation_committed = false
  ),
  public_reader_unchanged boolean not null default true check (
    public_reader_unchanged = true
  ),
  mainnet_disabled boolean not null default true check (
    mainnet_disabled = true
  ),
  stabilization_authorized boolean not null default false check (
    stabilization_authorized = false
  ),
  soak_authorized boolean not null default false check (
    soak_authorized = false
  ),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists xrpl_r4f_v1.directional_accounting_observations (
  observation_id text not null references xrpl_r4f_v1.directional_accounting_evidence(observation_id) on delete restrict,
  sequence integer not null check (sequence >= 0),
  operation_id text not null check (
    operation_id ~ '^[a-z0-9][a-z0-9._:-]{2,159}$'
  ),
  boundary_id text not null check (
    boundary_id in (
      'invoker_to_edge_request',
      'edge_to_invoker_response',
      'edge_to_xrpl_request',
      'xrpl_to_edge_response',
      'edge_to_database_request',
      'database_to_edge_response',
      'edge_to_edge_request',
      'edge_to_edge_response'
    )
  ),
  body_bytes bigint not null check (body_bytes >= 0),
  framing_reserve_bytes bigint not null check (framing_reserve_bytes >= 0),
  total_bytes bigint generated always as (body_bytes + framing_reserve_bytes) stored,
  rolling_billable_egress_bytes bigint not null check (
    rolling_billable_egress_bytes >= 0
  ),
  memory_transport_bytes bigint not null check (memory_transport_bytes >= 0),
  counts_toward_rolling_billable_egress boolean not null,
  counts_toward_memory_transport boolean not null check (
    counts_toward_memory_transport = true
  ),
  primary key (observation_id, sequence),
  unique (observation_id, operation_id),
  check (memory_transport_bytes = body_bytes + framing_reserve_bytes),
  check (
    rolling_billable_egress_bytes = case
      when counts_toward_rolling_billable_egress
        then body_bytes + framing_reserve_bytes
      else 0
    end
  )
);

revoke all on table xrpl_r4f_v1.directional_accounting_evidence from public;
revoke all on table xrpl_r4f_v1.directional_accounting_evidence from anon;
revoke all on table xrpl_r4f_v1.directional_accounting_evidence from authenticated;
revoke all on table xrpl_r4f_v1.directional_accounting_observations from public;
revoke all on table xrpl_r4f_v1.directional_accounting_observations from anon;
revoke all on table xrpl_r4f_v1.directional_accounting_observations from authenticated;

grant select, insert on table xrpl_r4f_v1.directional_accounting_evidence to service_role;
grant select, insert on table xrpl_r4f_v1.directional_accounting_observations to service_role;

create or replace function public.xrpl_record_r4f_revision4_directional_accounting(
  p_accounting_json text,
  p_accounting_digest text,
  p_source_run_id bigint,
  p_source_commit text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, xrpl_r4f_v1, extensions
as $$
declare
  v_document jsonb;
  v_observation jsonb;
  v_existing_digest text;
  v_observation_id text;
  v_attempt_id text;
  v_disposition text;
  v_observed_at timestamptz;
  v_computed_digest text;
  v_boundary_id text;
  v_operation_id text;
  v_sequence integer;
  v_body_numeric numeric;
  v_framing_numeric numeric;
  v_body_bytes bigint;
  v_framing_bytes bigint;
  v_total_bytes bigint;
  v_rolling_included boolean;
  v_rolling_directional numeric := 0;
  v_memory_directional numeric := 0;
  v_observation_count integer := 0;
  v_unexplained numeric;
  v_canonical_json numeric;
  v_payload numeric;
  v_normalized_overhead numeric;
  v_allocator_reserve numeric;
  v_expected_rolling numeric;
  v_expected_memory numeric;
  v_document_rolling numeric;
  v_document_memory numeric;
  v_document_directional_rolling numeric;
  v_document_directional_memory numeric;
  v_safe_integer_limit constant numeric := 9007199254740991;
begin
  if p_accounting_json is null or length(p_accounting_json) = 0 then
    raise exception 'accounting_json_unavailable';
  end if;
  if p_accounting_digest is null or p_accounting_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'accounting_digest_invalid';
  end if;
  if p_source_run_id is null or p_source_run_id <= 0 then
    raise exception 'source_run_id_invalid';
  end if;
  if p_source_commit is null or p_source_commit !~ '^[a-f0-9]{40}$' then
    raise exception 'source_commit_invalid';
  end if;

  begin
    v_document := p_accounting_json::jsonb;
  exception when others then
    raise exception 'accounting_json_invalid';
  end;

  v_computed_digest := encode(
    extensions.digest(convert_to(p_accounting_json, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_computed_digest <> p_accounting_digest then
    raise exception 'accounting_digest_mismatch';
  end if;

  if (v_document->>'schemaVersion') <> '1'
    or (v_document->>'profileId') <> 'supabase_free_postgres_pgcron_edge'
    or (v_document->>'profileRevision') <> '4'
    or (v_document->>'profileIdentityDigest') <> '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
  then
    raise exception 'revision4_identity_mismatch';
  end if;

  v_observation_id := v_document->>'observationId';
  v_attempt_id := v_document->>'attemptId';
  v_disposition := v_document->>'disposition';
  if v_observation_id is null or v_observation_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then
    raise exception 'observation_id_invalid';
  end if;
  if v_attempt_id is null or v_attempt_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then
    raise exception 'attempt_id_invalid';
  end if;
  if v_disposition not in (
    'shadow_completed',
    'shadow_failed',
    'shadow_retry',
    'shadow_repair',
    'shadow_adopted'
  ) then
    raise exception 'disposition_invalid';
  end if;
  begin
    v_observed_at := (v_document->>'observedAt')::timestamptz;
  exception when others then
    raise exception 'observed_at_invalid';
  end;
  if v_document->>'observedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' then
    raise exception 'observed_at_not_canonical_utc';
  end if;

  if v_document->'checks' is null
    or jsonb_typeof(v_document->'checks') <> 'object'
    or (v_document#>>'{checks,exactProfileIdentityBound}') <> 'true'
    or (v_document#>>'{checks,canonicalAccountingJsonRetained}') <> 'true'
    or (v_document#>>'{checks,everyObservationDirectionBoundByContract}') <> 'true'
    or (v_document#>>'{checks,inboundBytesRemainInMemoryTransport}') <> 'true'
    or (v_document#>>'{checks,blanketAllDirectionMultiplierUsed}') <> 'false'
    or (v_document#>>'{checks,recoveryMutationCommitted}') <> 'false'
    or (v_document#>>'{checks,publicReaderUnchanged}') <> 'true'
    or (v_document#>>'{checks,mainnetDisabled}') <> 'true'
    or (v_document#>>'{checks,stabilizationAuthorized}') <> 'false'
    or (v_document#>>'{checks,soakAuthorized}') <> 'false'
  then
    raise exception 'safety_checks_invalid';
  end if;

  if v_document->'observations' is null
    or jsonb_typeof(v_document->'observations') <> 'array'
  then
    raise exception 'observations_invalid';
  end if;

  for v_observation, v_sequence in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(v_document->'observations') with ordinality
  loop
    if jsonb_typeof(v_observation) <> 'object'
      or (v_observation->>'schemaVersion') <> '1'
      or (v_observation->>'sequence') !~ '^[0-9]+$'
      or (v_observation->>'sequence')::numeric <> v_sequence
    then
      raise exception 'observation_sequence_invalid';
    end if;

    v_operation_id := v_observation->>'operationId';
    v_boundary_id := v_observation->>'boundaryId';
    if v_operation_id is null
      or v_operation_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$'
    then
      raise exception 'operation_id_invalid';
    end if;
    if v_boundary_id not in (
      'invoker_to_edge_request',
      'edge_to_invoker_response',
      'edge_to_xrpl_request',
      'xrpl_to_edge_response',
      'edge_to_database_request',
      'database_to_edge_response',
      'edge_to_edge_request',
      'edge_to_edge_response'
    ) then
      raise exception 'boundary_id_invalid';
    end if;

    if (v_observation->>'bodyBytes') !~ '^[0-9]+$'
      or (v_observation->>'framingReserveBytes') !~ '^[0-9]+$'
    then
      raise exception 'observation_bytes_invalid';
    end if;
    v_body_numeric := (v_observation->>'bodyBytes')::numeric;
    v_framing_numeric := (v_observation->>'framingReserveBytes')::numeric;
    if v_body_numeric > v_safe_integer_limit
      or v_framing_numeric > v_safe_integer_limit
      or v_body_numeric + v_framing_numeric > v_safe_integer_limit
    then
      raise exception 'observation_bytes_exceed_safe_integer';
    end if;
    v_body_bytes := v_body_numeric::bigint;
    v_framing_bytes := v_framing_numeric::bigint;
    v_total_bytes := v_body_bytes + v_framing_bytes;
    v_rolling_included := v_boundary_id not in (
      'invoker_to_edge_request',
      'xrpl_to_edge_response'
    );

    v_memory_directional := v_memory_directional + v_total_bytes;
    if v_rolling_included then
      v_rolling_directional := v_rolling_directional + v_total_bytes;
    end if;
    if v_memory_directional > v_safe_integer_limit
      or v_rolling_directional > v_safe_integer_limit
    then
      raise exception 'directional_total_exceeds_safe_integer';
    end if;
    v_observation_count := v_observation_count + 1;
  end loop;

  if exists (
    select 1
    from (
      select value->>'operationId' as operation_id
      from jsonb_array_elements(v_document->'observations')
    ) operation_ids
    group by operation_id
    having count(*) > 1
  ) then
    raise exception 'operation_id_duplicated';
  end if;

  if v_document->'memorySupplemental' is null
    or jsonb_typeof(v_document->'memorySupplemental') <> 'object'
  then
    raise exception 'memory_supplemental_invalid';
  end if;
  if (v_document#>>'{memorySupplemental,canonicalJsonBytes}') !~ '^[0-9]+$'
    or (v_document#>>'{memorySupplemental,payloadBytes}') !~ '^[0-9]+$'
    or (v_document#>>'{memorySupplemental,normalizedObjectOverheadBytes}') !~ '^[0-9]+$'
    or (v_document#>>'{memorySupplemental,allocatorReserveBytes}') !~ '^[0-9]+$'
    or (v_document->>'unexplainedDirectionalDeltaReserveBytes') !~ '^[0-9]+$'
    or (v_document->>'rollingBillableEgressUpperBoundBytes') !~ '^[0-9]+$'
    or (v_document->>'memoryTransportUpperBoundBytes') !~ '^[0-9]+$'
    or (v_document#>>'{directionalSummary,rollingBillableEgressUpperBoundBytes}') !~ '^[0-9]+$'
    or (v_document#>>'{directionalSummary,memoryTransportBytes}') !~ '^[0-9]+$'
  then
    raise exception 'accounting_totals_invalid';
  end if;

  v_canonical_json := (v_document#>>'{memorySupplemental,canonicalJsonBytes}')::numeric;
  v_payload := (v_document#>>'{memorySupplemental,payloadBytes}')::numeric;
  v_normalized_overhead := (v_document#>>'{memorySupplemental,normalizedObjectOverheadBytes}')::numeric;
  v_allocator_reserve := (v_document#>>'{memorySupplemental,allocatorReserveBytes}')::numeric;
  v_unexplained := (v_document->>'unexplainedDirectionalDeltaReserveBytes')::numeric;
  v_document_rolling := (v_document->>'rollingBillableEgressUpperBoundBytes')::numeric;
  v_document_memory := (v_document->>'memoryTransportUpperBoundBytes')::numeric;
  v_document_directional_rolling := (v_document#>>'{directionalSummary,rollingBillableEgressUpperBoundBytes}')::numeric;
  v_document_directional_memory := (v_document#>>'{directionalSummary,memoryTransportBytes}')::numeric;

  if greatest(
    v_canonical_json,
    v_payload,
    v_normalized_overhead,
    v_allocator_reserve,
    v_unexplained,
    v_document_rolling,
    v_document_memory,
    v_document_directional_rolling,
    v_document_directional_memory
  ) > v_safe_integer_limit then
    raise exception 'accounting_total_exceeds_safe_integer';
  end if;

  v_expected_rolling := v_rolling_directional + v_unexplained;
  v_expected_memory := v_memory_directional
    + v_canonical_json
    + v_payload
    + v_normalized_overhead
    + v_allocator_reserve;

  if v_document_directional_rolling <> v_rolling_directional
    or v_document_directional_memory <> v_memory_directional
    or v_document_rolling <> v_expected_rolling
    or v_document_memory <> v_expected_memory
  then
    raise exception 'accounting_total_mismatch';
  end if;

  select accounting_digest
  into v_existing_digest
  from xrpl_r4f_v1.directional_accounting_evidence
  where observation_id = v_observation_id;

  if found then
    if v_existing_digest <> p_accounting_digest then
      raise exception 'observation_identity_conflict';
    end if;
    return jsonb_build_object(
      'schemaVersion', 1,
      'observationId', v_observation_id,
      'accountingDigest', p_accounting_digest,
      'idempotent', true,
      'recoveryMutationCommitted', false,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationAuthorized', false,
      'soakAuthorized', false
    );
  end if;

  insert into xrpl_r4f_v1.directional_accounting_evidence (
    observation_id,
    attempt_id,
    observed_at,
    disposition,
    profile_id,
    profile_revision,
    profile_identity_digest,
    accounting_schema_version,
    accounting_json,
    accounting_digest,
    observation_count,
    directional_wire_bytes,
    rolling_billable_egress_upper_bound_bytes,
    memory_transport_upper_bound_bytes,
    unexplained_directional_delta_reserve_bytes,
    memory_supplemental,
    checks,
    source_run_id,
    source_commit
  ) values (
    v_observation_id,
    v_attempt_id,
    v_observed_at,
    v_disposition,
    'supabase_free_postgres_pgcron_edge',
    4,
    '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
    1,
    p_accounting_json,
    p_accounting_digest,
    v_observation_count,
    v_memory_directional::bigint,
    v_document_rolling::bigint,
    v_document_memory::bigint,
    v_unexplained::bigint,
    v_document->'memorySupplemental',
    v_document->'checks',
    p_source_run_id,
    p_source_commit
  );

  for v_observation, v_sequence in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(v_document->'observations') with ordinality
  loop
    v_boundary_id := v_observation->>'boundaryId';
    v_body_bytes := (v_observation->>'bodyBytes')::bigint;
    v_framing_bytes := (v_observation->>'framingReserveBytes')::bigint;
    v_total_bytes := v_body_bytes + v_framing_bytes;
    v_rolling_included := v_boundary_id not in (
      'invoker_to_edge_request',
      'xrpl_to_edge_response'
    );

    insert into xrpl_r4f_v1.directional_accounting_observations (
      observation_id,
      sequence,
      operation_id,
      boundary_id,
      body_bytes,
      framing_reserve_bytes,
      rolling_billable_egress_bytes,
      memory_transport_bytes,
      counts_toward_rolling_billable_egress,
      counts_toward_memory_transport
    ) values (
      v_observation_id,
      v_sequence,
      v_observation->>'operationId',
      v_boundary_id,
      v_body_bytes,
      v_framing_bytes,
      case when v_rolling_included then v_total_bytes else 0 end,
      v_total_bytes,
      v_rolling_included,
      true
    );
  end loop;

  return jsonb_build_object(
    'schemaVersion', 1,
    'observationId', v_observation_id,
    'accountingDigest', p_accounting_digest,
    'observationCount', v_observation_count,
    'rollingBillableEgressUpperBoundBytes', v_document_rolling::bigint,
    'memoryTransportUpperBoundBytes', v_document_memory::bigint,
    'idempotent', false,
    'recoveryMutationCommitted', false,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true,
    'stabilizationAuthorized', false,
    'soakAuthorized', false
  );
end;
$$;

create or replace function public.xrpl_read_r4f_revision4_directional_accounting(
  p_observation_id text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, xrpl_r4f_v1
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'evidence', to_jsonb(e),
    'observations', coalesce(
      (
        select jsonb_agg(to_jsonb(o) order by o.sequence)
        from xrpl_r4f_v1.directional_accounting_observations o
        where o.observation_id = e.observation_id
      ),
      '[]'::jsonb
    ),
    'checks', jsonb_build_object(
      'exactRevision4Identity',
        e.profile_id = 'supabase_free_postgres_pgcron_edge'
        and e.profile_revision = 4
        and e.profile_identity_digest = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
      'observationCountReconciles',
        e.observation_count = (
          select count(*)
          from xrpl_r4f_v1.directional_accounting_observations o
          where o.observation_id = e.observation_id
        ),
      'recoveryMutationCommitted', e.recovery_mutation_committed,
      'publicReaderUnchanged', e.public_reader_unchanged,
      'mainnetDisabled', e.mainnet_disabled,
      'stabilizationAuthorized', e.stabilization_authorized,
      'soakAuthorized', e.soak_authorized
    )
  )
  from xrpl_r4f_v1.directional_accounting_evidence e
  where e.observation_id = p_observation_id;
$$;

revoke all on function public.xrpl_record_r4f_revision4_directional_accounting(text, text, bigint, text) from public;
revoke all on function public.xrpl_record_r4f_revision4_directional_accounting(text, text, bigint, text) from anon;
revoke all on function public.xrpl_record_r4f_revision4_directional_accounting(text, text, bigint, text) from authenticated;
grant execute on function public.xrpl_record_r4f_revision4_directional_accounting(text, text, bigint, text) to service_role;

revoke all on function public.xrpl_read_r4f_revision4_directional_accounting(text) from public;
revoke all on function public.xrpl_read_r4f_revision4_directional_accounting(text) from anon;
revoke all on function public.xrpl_read_r4f_revision4_directional_accounting(text) from authenticated;
grant execute on function public.xrpl_read_r4f_revision4_directional_accounting(text) to service_role;
