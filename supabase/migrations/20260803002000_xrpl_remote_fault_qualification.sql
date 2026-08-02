create schema if not exists xrpl_fault_v1;

create table if not exists xrpl_fault_v1.xrpl_phase_streams
  (like public.xrpl_phase_streams including all);
create table if not exists xrpl_fault_v1.xrpl_phase_messages
  (like public.xrpl_phase_messages including all);
create table if not exists xrpl_fault_v1.xrpl_phase_successors
  (like public.xrpl_phase_successors including all);

create table if not exists xrpl_fault_v1.fault_metadata (
  fixture_id text primary key,
  schema_version integer not null check (schema_version = 1),
  profile_id text not null unique,
  active_profile_id text not null,
  active_network text not null check (active_network = 'devnet'),
  active_epoch_id text not null,
  active_base_identity text not null,
  active_ledger_index bigint not null check (active_ledger_index > 0),
  active_ledger_hash text not null check (active_ledger_hash ~ '^[A-F0-9]{64}$'),
  active_work_id text not null,
  prepared_at timestamptz not null
);

create table if not exists xrpl_fault_v1.fault_events (
  event_id text primary key,
  scenario text not null check (scenario in ('rollback', 'retry', 'stale', 'terminal')),
  event_type text not null check (
    event_type in (
      'rollback-sentinel',
      'rollback-observed',
      'retry-scheduled',
      'terminal-halt'
    )
  ),
  message_id text not null,
  details jsonb not null,
  created_at timestamptz not null
);

create or replace function public.xrpl_prepare_remote_fault_qualification(
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_fixture_id constant text := 'r4c2c-remote-fault-qualification-v1';
  v_profile_id constant text := 'supabase-devnet-fault-qualification';
  v_active_profile_id constant text := 'supabase-devnet';
  v_metadata xrpl_fault_v1.fault_metadata%rowtype;
  v_active_stream public.xrpl_phase_streams%rowtype;
  v_active_watermark public.xrpl_phase_watermarks%rowtype;
  v_scenarios constant text[] := array['rollback', 'retry', 'stale', 'terminal', 'halt-probe'];
  v_scenario text;
  v_message_id text;
begin
  select * into v_metadata
  from xrpl_fault_v1.fault_metadata
  where fixture_id = v_fixture_id;

  if found then
    return jsonb_build_object(
      'prepared', true,
      'duplicate', true,
      'fixtureId', v_metadata.fixture_id,
      'profileId', v_metadata.profile_id,
      'activeProfileId', v_metadata.active_profile_id,
      'activeLedgerIndex', v_metadata.active_ledger_index,
      'activeLedgerHash', v_metadata.active_ledger_hash,
      'activeWorkId', v_metadata.active_work_id
    );
  end if;

  if exists (select 1 from xrpl_fault_v1.xrpl_phase_streams)
    or exists (select 1 from xrpl_fault_v1.xrpl_phase_messages)
    or exists (select 1 from xrpl_fault_v1.xrpl_phase_successors)
    or exists (select 1 from xrpl_fault_v1.fault_events) then
    raise exception 'fault_qualification_target_not_empty';
  end if;

  select * into v_active_stream
  from public.xrpl_phase_streams
  where profile_id = v_active_profile_id
  for share;

  if not found
    or v_active_stream.status <> 'active'
    or v_active_stream.network <> 'devnet'
    or v_active_stream.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'fault_qualification_active_stream_unavailable';
  end if;

  select * into v_active_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_active_profile_id
  for share;

  if not found
    or v_active_watermark.network <> v_active_stream.network
    or v_active_watermark.epoch_id <> v_active_stream.epoch_id
    or v_active_watermark.base_identity <> v_active_stream.base_identity then
    raise exception 'fault_qualification_active_watermark_unavailable';
  end if;

  insert into xrpl_fault_v1.xrpl_phase_streams (
    profile_id, schema_version, network, epoch_id, base_identity,
    immutable_base_ledger_index, immutable_base_ledger_hash,
    status, last_error_classification, last_error_message,
    created_at, updated_at
  ) values (
    v_profile_id, 1, 'devnet', 'supabase-r4c2c-v1',
    'r4c2c-remote-fault-qualification-base-v1',
    v_active_watermark.ledger_index, v_active_watermark.ledger_hash,
    'active', null, null, p_now, p_now
  );

  foreach v_scenario in array v_scenarios loop
    v_message_id := concat('fault:v1:', v_scenario);
    insert into xrpl_fault_v1.xrpl_phase_messages (
      message_id, schema_version, profile_id, phase, payload,
      status, available_at, attempt_count, lease_owner,
      lease_expires_at, result, successor_message_id,
      error_classification, error_message,
      created_at, updated_at, completed_at
    ) values (
      v_message_id, 1, v_profile_id, 'scan',
      jsonb_build_object(
        'schemaVersion', 1,
        'phase', 'scan',
        'messageId', v_message_id,
        'scenario', v_scenario
      ),
      'pending', p_now, 0, null, null, null, null,
      null, null, p_now, p_now, null
    );
  end loop;

  insert into xrpl_fault_v1.fault_metadata (
    fixture_id, schema_version, profile_id, active_profile_id,
    active_network, active_epoch_id, active_base_identity,
    active_ledger_index, active_ledger_hash, active_work_id,
    prepared_at
  ) values (
    v_fixture_id, 1, v_profile_id, v_active_profile_id,
    v_active_watermark.network, v_active_watermark.epoch_id,
    v_active_watermark.base_identity, v_active_watermark.ledger_index,
    v_active_watermark.ledger_hash, v_active_watermark.work_id,
    p_now
  );

  return jsonb_build_object(
    'prepared', true,
    'duplicate', false,
    'fixtureId', v_fixture_id,
    'profileId', v_profile_id,
    'activeProfileId', v_active_profile_id,
    'activeLedgerIndex', v_active_watermark.ledger_index,
    'activeLedgerHash', v_active_watermark.ledger_hash,
    'activeWorkId', v_active_watermark.work_id,
    'messageIds', jsonb_build_object(
      'rollback', 'fault:v1:rollback',
      'retry', 'fault:v1:retry',
      'stale', 'fault:v1:stale',
      'terminal', 'fault:v1:terminal',
      'haltProbe', 'fault:v1:halt-probe'
    )
  );
end;
$$;

create or replace function public.xrpl_claim_remote_fault_message(
  p_message_id text,
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet-fault-qualification';
  v_stream xrpl_fault_v1.xrpl_phase_streams%rowtype;
  v_message xrpl_fault_v1.xrpl_phase_messages%rowtype;
  v_previous_status text;
  v_previous_owner text;
  v_previous_expiry timestamptz;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200 then
    raise exception 'invalid fault qualification owner';
  end if;
  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid fault qualification lease duration';
  end if;

  select * into v_stream
  from xrpl_fault_v1.xrpl_phase_streams
  where profile_id = v_profile_id
  for update;

  if not found then
    raise exception 'fault qualification stream is unavailable';
  end if;
  if v_stream.status = 'halted' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'stream_halted',
      'messageId', p_message_id,
      'classification', v_stream.last_error_classification
    );
  end if;

  select * into v_message
  from xrpl_fault_v1.xrpl_phase_messages
  where message_id = p_message_id
    and profile_id = v_profile_id
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'message_not_found');
  end if;
  if v_message.status in ('completed', 'error') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'terminal_message_state',
      'status', v_message.status,
      'messageId', p_message_id
    );
  end if;
  if v_message.status = 'leased' and v_message.lease_expires_at > p_now then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'lease_active',
      'messageId', p_message_id,
      'leaseOwner', v_message.lease_owner,
      'leaseExpiresAt', v_message.lease_expires_at
    );
  end if;
  if v_message.status in ('pending', 'retry') and v_message.available_at > p_now then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'not_ready',
      'messageId', p_message_id,
      'availableAt', v_message.available_at
    );
  end if;

  v_previous_status := v_message.status;
  v_previous_owner := v_message.lease_owner;
  v_previous_expiry := v_message.lease_expires_at;

  update xrpl_fault_v1.xrpl_phase_messages
  set
    status = 'leased',
    attempt_count = attempt_count + 1,
    lease_owner = p_owner,
    lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
    error_classification = null,
    error_message = null,
    updated_at = p_now
  where message_id = p_message_id
  returning * into v_message;

  return jsonb_build_object(
    'claimed', true,
    'messageId', v_message.message_id,
    'scenario', v_message.payload->>'scenario',
    'attemptCount', v_message.attempt_count,
    'leaseOwner', v_message.lease_owner,
    'leaseExpiresAt', v_message.lease_expires_at,
    'reclaimed', v_previous_status = 'leased',
    'previousLeaseOwner', v_previous_owner,
    'previousLeaseExpiresAt', v_previous_expiry
  );
end;
$$;

create or replace function public.xrpl_complete_remote_fault_message(
  p_message_id text,
  p_owner text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_message xrpl_fault_v1.xrpl_phase_messages%rowtype;
begin
  select * into v_message
  from xrpl_fault_v1.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found then
    raise exception 'fault qualification message is unavailable';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'messageId', v_message.message_id
    );
  end if;
  if v_message.status = 'error' then
    raise exception 'fault qualification message is terminal';
  end if;
  if v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  update xrpl_fault_v1.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'completed',
      'scenario', v_message.payload->>'scenario'
    ),
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'messageId', p_message_id,
    'scenario', v_message.payload->>'scenario'
  );
end;
$$;

create or replace function public.xrpl_inject_remote_fault_rollback(
  p_message_id text,
  p_owner text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet-fault-qualification';
  v_successor_id constant text := 'fault:v1:rollback-successor';
  v_message xrpl_fault_v1.xrpl_phase_messages%rowtype;
begin
  select * into v_message
  from xrpl_fault_v1.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found
    or v_message.payload->>'scenario' <> 'rollback'
    or v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_now then
    raise exception 'fault rollback injection boundary is invalid';
  end if;

  insert into xrpl_fault_v1.fault_events (
    event_id, scenario, event_type, message_id, details, created_at
  ) values (
    'fault-event:v1:rollback-sentinel', 'rollback', 'rollback-sentinel',
    p_message_id, jsonb_build_object('mustRollback', true), p_now
  );

  insert into xrpl_fault_v1.xrpl_phase_messages (
    message_id, schema_version, profile_id, phase, payload,
    status, available_at, attempt_count, created_at, updated_at
  ) values (
    v_successor_id, 1, v_profile_id, 'scan',
    jsonb_build_object(
      'schemaVersion', 1,
      'phase', 'scan',
      'messageId', v_successor_id,
      'scenario', 'rollback-synthetic-successor'
    ),
    'pending', p_now, 0, p_now, p_now
  );

  insert into xrpl_fault_v1.xrpl_phase_successors (
    current_message_id, successor_message_id, reserved_at
  ) values (p_message_id, v_successor_id, p_now);

  update xrpl_fault_v1.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object('invalidCommit', true),
    successor_message_id = v_successor_id,
    completed_at = p_now,
    updated_at = p_now
  where message_id = p_message_id;

  raise exception 'injected_interruption_rollback';
end;
$$;

create or replace function public.xrpl_record_remote_fault_rollback_observation(
  p_message_id text,
  p_owner text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_message xrpl_fault_v1.xrpl_phase_messages%rowtype;
begin
  select * into v_message
  from xrpl_fault_v1.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found
    or v_message.payload->>'scenario' <> 'rollback'
    or v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.successor_message_id is not null
    or exists (
      select 1 from xrpl_fault_v1.xrpl_phase_messages
      where message_id = 'fault:v1:rollback-successor'
    )
    or exists (
      select 1 from xrpl_fault_v1.xrpl_phase_successors
      where current_message_id = p_message_id
    )
    or exists (
      select 1 from xrpl_fault_v1.fault_events
      where event_type = 'rollback-sentinel'
    ) then
    raise exception 'fault rollback was not atomic';
  end if;

  insert into xrpl_fault_v1.fault_events (
    event_id, scenario, event_type, message_id, details, created_at
  ) values (
    'fault-event:v1:rollback-observed', 'rollback', 'rollback-observed',
    p_message_id,
    jsonb_build_object(
      'messageRemainedLeased', true,
      'sentinelAbsent', true,
      'successorAbsent', true
    ),
    p_observed_at
  )
  on conflict (event_id) do nothing;

  return jsonb_build_object(
    'observed', true,
    'messageRemainedLeased', true,
    'sentinelAbsent', true,
    'successorAbsent', true
  );
end;
$$;

create or replace function public.xrpl_schedule_remote_fault_retry(
  p_message_id text,
  p_owner text,
  p_failed_at timestamptz,
  p_backoff_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_message xrpl_fault_v1.xrpl_phase_messages%rowtype;
  v_available_at timestamptz;
begin
  if p_backoff_seconds <> 30 then
    raise exception 'fault qualification backoff must remain exactly 30 seconds';
  end if;

  select * into v_message
  from xrpl_fault_v1.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.payload->>'scenario' <> 'retry' then
    raise exception 'fault retry message is unavailable';
  end if;
  if v_message.status = 'retry' then
    return jsonb_build_object(
      'scheduled', true,
      'duplicate', true,
      'availableAt', v_message.available_at,
      'attemptCount', v_message.attempt_count
    );
  end if;
  if v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_failed_at then
    return jsonb_build_object('scheduled', false, 'reason', 'lease_lost');
  end if;

  v_available_at := p_failed_at + make_interval(secs => p_backoff_seconds);

  update xrpl_fault_v1.xrpl_phase_messages
  set
    status = 'retry',
    available_at = v_available_at,
    lease_owner = null,
    lease_expires_at = null,
    error_classification = 'transient',
    error_message = 'injected transient qualification failure',
    updated_at = p_failed_at
  where message_id = p_message_id;

  insert into xrpl_fault_v1.fault_events (
    event_id, scenario, event_type, message_id, details, created_at
  ) values (
    'fault-event:v1:retry-scheduled', 'retry', 'retry-scheduled',
    p_message_id,
    jsonb_build_object(
      'failedAt', p_failed_at,
      'availableAt', v_available_at,
      'backoffSeconds', p_backoff_seconds
    ),
    p_failed_at
  )
  on conflict (event_id) do nothing;

  return jsonb_build_object(
    'scheduled', true,
    'duplicate', false,
    'availableAt', v_available_at,
    'backoffSeconds', p_backoff_seconds,
    'attemptCount', v_message.attempt_count
  );
end;
$$;

create or replace function public.xrpl_terminal_halt_remote_fault(
  p_message_id text,
  p_owner text,
  p_halted_at timestamptz,
  p_classification text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet-fault-qualification';
  v_stream xrpl_fault_v1.xrpl_phase_streams%rowtype;
  v_message xrpl_fault_v1.xrpl_phase_messages%rowtype;
begin
  if p_classification <> 'integrity' then
    raise exception 'fault terminal classification must remain integrity';
  end if;
  if p_error_message <> 'injected terminal qualification failure' then
    raise exception 'fault terminal message changed';
  end if;

  select * into v_stream
  from xrpl_fault_v1.xrpl_phase_streams
  where profile_id = v_profile_id
  for update;
  select * into v_message
  from xrpl_fault_v1.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.payload->>'scenario' <> 'terminal' then
    raise exception 'fault terminal message is unavailable';
  end if;

  if v_stream.status = 'halted' and v_message.status = 'error' then
    if v_stream.last_error_classification <> p_classification
      or v_stream.last_error_message <> p_error_message
      or v_message.error_classification <> p_classification
      or v_message.error_message <> p_error_message
      or v_message.successor_message_id is not null
      or exists (
        select 1 from xrpl_fault_v1.xrpl_phase_successors
        where current_message_id = p_message_id
      ) then
      raise exception 'fault terminal replay identity conflict';
    end if;
    return jsonb_build_object(
      'halted', true,
      'duplicate', true,
      'classification', p_classification,
      'successorReserved', false
    );
  end if;

  if v_stream.status <> 'active'
    or v_message.status <> 'leased'
    or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_halted_at then
    return jsonb_build_object('halted', false, 'reason', 'lease_or_stream_lost');
  end if;

  update xrpl_fault_v1.xrpl_phase_messages
  set
    status = 'error',
    lease_owner = null,
    lease_expires_at = null,
    error_classification = p_classification,
    error_message = p_error_message,
    updated_at = p_halted_at
  where message_id = p_message_id;

  update xrpl_fault_v1.xrpl_phase_streams
  set
    status = 'halted',
    last_error_classification = p_classification,
    last_error_message = p_error_message,
    updated_at = p_halted_at
  where profile_id = v_profile_id;

  insert into xrpl_fault_v1.fault_events (
    event_id, scenario, event_type, message_id, details, created_at
  ) values (
    'fault-event:v1:terminal-halt', 'terminal', 'terminal-halt',
    p_message_id,
    jsonb_build_object(
      'classification', p_classification,
      'errorMessage', p_error_message,
      'successorReserved', false
    ),
    p_halted_at
  )
  on conflict (event_id) do nothing;

  return jsonb_build_object(
    'halted', true,
    'duplicate', false,
    'classification', p_classification,
    'successorReserved', false
  );
end;
$$;

create or replace function public.xrpl_read_remote_fault_evidence()
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_metadata xrpl_fault_v1.fault_metadata%rowtype;
  v_stream xrpl_fault_v1.xrpl_phase_streams%rowtype;
  v_messages jsonb;
  v_events jsonb;
  v_successors jsonb;
  v_status_counts jsonb;
  v_rollback xrpl_fault_v1.xrpl_phase_messages%rowtype;
  v_retry xrpl_fault_v1.xrpl_phase_messages%rowtype;
  v_stale xrpl_fault_v1.xrpl_phase_messages%rowtype;
  v_terminal xrpl_fault_v1.xrpl_phase_messages%rowtype;
  v_halt_probe xrpl_fault_v1.xrpl_phase_messages%rowtype;
begin
  select * into v_metadata
  from xrpl_fault_v1.fault_metadata
  where fixture_id = 'r4c2c-remote-fault-qualification-v1';
  select * into v_stream
  from xrpl_fault_v1.xrpl_phase_streams
  where profile_id = 'supabase-devnet-fault-qualification';

  select * into v_rollback from xrpl_fault_v1.xrpl_phase_messages
    where message_id = 'fault:v1:rollback';
  select * into v_retry from xrpl_fault_v1.xrpl_phase_messages
    where message_id = 'fault:v1:retry';
  select * into v_stale from xrpl_fault_v1.xrpl_phase_messages
    where message_id = 'fault:v1:stale';
  select * into v_terminal from xrpl_fault_v1.xrpl_phase_messages
    where message_id = 'fault:v1:terminal';
  select * into v_halt_probe from xrpl_fault_v1.xrpl_phase_messages
    where message_id = 'fault:v1:halt-probe';

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at, rows.message_id), '[]'::jsonb)
  into v_messages
  from xrpl_fault_v1.xrpl_phase_messages as rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at, rows.event_id), '[]'::jsonb)
  into v_events
  from xrpl_fault_v1.fault_events as rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.current_message_id), '[]'::jsonb)
  into v_successors
  from xrpl_fault_v1.xrpl_phase_successors as rows;

  select coalesce(jsonb_object_agg(status, count), '{}'::jsonb)
  into v_status_counts
  from (
    select status, count(*)::integer as count
    from xrpl_fault_v1.xrpl_phase_messages
    group by status
  ) statuses;

  return jsonb_build_object(
    'schemaVersion', 1,
    'fixtureId', v_metadata.fixture_id,
    'profileId', v_metadata.profile_id,
    'activeProfileId', v_metadata.active_profile_id,
    'activeAnchor', jsonb_build_object(
      'network', v_metadata.active_network,
      'epochId', v_metadata.active_epoch_id,
      'baseIdentity', v_metadata.active_base_identity,
      'ledgerIndex', v_metadata.active_ledger_index,
      'ledgerHash', v_metadata.active_ledger_hash,
      'workId', v_metadata.active_work_id
    ),
    'stream', to_jsonb(v_stream),
    'messages', v_messages,
    'events', v_events,
    'successors', v_successors,
    'messageStatusCounts', v_status_counts,
    'checks', jsonb_build_object(
      'interruptionRolledBack',
        exists (
          select 1 from xrpl_fault_v1.fault_events
          where event_type = 'rollback-observed'
        )
        and not exists (
          select 1 from xrpl_fault_v1.fault_events
          where event_type = 'rollback-sentinel'
        )
        and not exists (
          select 1 from xrpl_fault_v1.xrpl_phase_messages
          where message_id = 'fault:v1:rollback-successor'
        ),
      'rollbackMessageCompleted', v_rollback.status = 'completed',
      'retryBackoffApplied',
        exists (
          select 1 from xrpl_fault_v1.fault_events
          where event_type = 'retry-scheduled'
            and (details->>'backoffSeconds')::integer = 30
        )
        and v_retry.status = 'completed'
        and v_retry.attempt_count = 2,
      'staleLeaseReclaimed', v_stale.status = 'completed' and v_stale.attempt_count = 2,
      'terminalHaltApplied',
        v_stream.status = 'halted'
        and v_stream.last_error_classification = 'integrity'
        and v_terminal.status = 'error'
        and v_terminal.error_classification = 'integrity',
      'terminalSuccessorAbsent',
        v_terminal.successor_message_id is null
        and not exists (
          select 1 from xrpl_fault_v1.xrpl_phase_successors
          where current_message_id = v_terminal.message_id
        ),
      'haltProbeRemainsPending', v_halt_probe.status = 'pending' and v_halt_probe.attempt_count = 0,
      'noSuccessorsReserved', not exists (select 1 from xrpl_fault_v1.xrpl_phase_successors)
    )
  );
end;
$$;

revoke all on schema xrpl_fault_v1 from public, anon, authenticated;
revoke all on all tables in schema xrpl_fault_v1 from public, anon, authenticated;

revoke all on function public.xrpl_prepare_remote_fault_qualification(timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_claim_remote_fault_message(text, text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.xrpl_complete_remote_fault_message(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_inject_remote_fault_rollback(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_record_remote_fault_rollback_observation(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_schedule_remote_fault_retry(text, text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.xrpl_terminal_halt_remote_fault(text, text, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.xrpl_read_remote_fault_evidence()
  from public, anon, authenticated;

grant usage on schema xrpl_fault_v1 to service_role;
grant select, insert, update on all tables in schema xrpl_fault_v1 to service_role;
grant execute on function public.xrpl_prepare_remote_fault_qualification(timestamptz) to service_role;
grant execute on function public.xrpl_claim_remote_fault_message(text, text, timestamptz, integer) to service_role;
grant execute on function public.xrpl_complete_remote_fault_message(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_inject_remote_fault_rollback(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_record_remote_fault_rollback_observation(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_schedule_remote_fault_retry(text, text, timestamptz, integer) to service_role;
grant execute on function public.xrpl_terminal_halt_remote_fault(text, text, timestamptz, text, text) to service_role;
grant execute on function public.xrpl_read_remote_fault_evidence() to service_role;
