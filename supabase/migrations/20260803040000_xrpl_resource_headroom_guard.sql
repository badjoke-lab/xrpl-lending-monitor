create schema if not exists xrpl_resource_guard_v1;

create table if not exists xrpl_resource_guard_v1.external_snapshots (
  snapshot_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  source_run_id bigint not null,
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  observed_at timestamptz not null,
  logs_window_hours integer not null check (logs_window_hours = 24),
  management_api_available boolean not null,
  invocation_count_24h bigint not null check (invocation_count_24h >= 0),
  projected_invocations_31d bigint not null check (projected_invocations_31d >= 0),
  function_count integer not null check (function_count > 0),
  max_bundle_bytes bigint not null check (max_bundle_bytes > 0),
  max_bundle_name text not null,
  bundle_count integer not null check (bundle_count > 0),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists xrpl_resource_guard_v1.events (
  event_id bigserial primary key,
  session_id text,
  tick_id text,
  guard_kind text not null check (guard_kind in (
    'database', 'connections', 'edge_wall', 'external_snapshot', 'invocations', 'bundle'
  )),
  qualification boolean not null default false,
  observed_value numeric,
  halt_value numeric,
  snapshot jsonb not null,
  created_at timestamptz not null
);

alter table xrpl_steady_v1.sessions
  add column if not exists cron_job_id bigint,
  add column if not exists cron_job_name text,
  add column if not exists resource_guard_status text not null default 'unknown'
    check (resource_guard_status in ('unknown', 'passed', 'halted')),
  add column if not exists resource_guard_checked_at timestamptz;

revoke all on schema xrpl_resource_guard_v1 from public, anon, authenticated;
revoke all on all tables in schema xrpl_resource_guard_v1 from public, anon, authenticated;

create or replace function xrpl_resource_guard_v1.current_snapshot(
  p_observed_at timestamptz,
  p_test_override jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v1, pg_temp
as $$
declare
  v_external xrpl_resource_guard_v1.external_snapshots%rowtype;
  v_database_bytes bigint;
  v_connections integer;
  v_max_edge_wall numeric;
  v_external_fresh boolean;
  v_projected_invocations bigint;
  v_max_bundle_bytes bigint;
  v_database_halt constant bigint := 400000000;
  v_database_hard constant bigint := 500000000;
  v_connection_halt constant integer := 45;
  v_connection_hard constant integer := 60;
  v_edge_wall_halt constant numeric := 45000;
  v_edge_wall_hard constant numeric := 150000;
  v_invocation_halt constant bigint := 400000;
  v_invocation_hard constant bigint := 500000;
  v_bundle_halt constant bigint := 4000000;
  v_bundle_hard constant bigint := 5000000;
  v_failures jsonb := '[]'::jsonb;
  v_allowed boolean;
begin
  select * into v_external
  from xrpl_resource_guard_v1.external_snapshots
  order by observed_at desc, snapshot_id desc
  limit 1;

  v_database_bytes := pg_database_size(current_database());
  select count(*)::integer into v_connections
  from pg_stat_activity
  where datname = current_database();
  select coalesce(max(edge_wall_milliseconds), 0) into v_max_edge_wall
  from xrpl_steady_v1.ticks
  where status = 'completed'
    and completed_at >= p_observed_at - interval '24 hours';

  v_external_fresh := v_external.snapshot_id is not null
    and v_external.management_api_available
    and v_external.observed_at >= p_observed_at - interval '25 hours';
  v_projected_invocations := coalesce(v_external.projected_invocations_31d, v_invocation_hard);
  v_max_bundle_bytes := coalesce(v_external.max_bundle_bytes, v_bundle_hard);

  if p_test_override is not null then
    if p_test_override ? 'databaseBytes' then
      v_database_bytes := (p_test_override->>'databaseBytes')::bigint;
    end if;
    if p_test_override ? 'connectionCount' then
      v_connections := (p_test_override->>'connectionCount')::integer;
    end if;
    if p_test_override ? 'maxEdgeWallMilliseconds' then
      v_max_edge_wall := (p_test_override->>'maxEdgeWallMilliseconds')::numeric;
    end if;
    if p_test_override ? 'externalFresh' then
      v_external_fresh := (p_test_override->>'externalFresh')::boolean;
    end if;
    if p_test_override ? 'projectedInvocations31d' then
      v_projected_invocations := (p_test_override->>'projectedInvocations31d')::bigint;
    end if;
    if p_test_override ? 'maxBundleBytes' then
      v_max_bundle_bytes := (p_test_override->>'maxBundleBytes')::bigint;
    end if;
  end if;

  if v_database_bytes >= v_database_halt then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'kind', 'database', 'observed', v_database_bytes, 'halt', v_database_halt
    ));
  end if;
  if v_connections >= v_connection_halt then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'kind', 'connections', 'observed', v_connections, 'halt', v_connection_halt
    ));
  end if;
  if v_max_edge_wall >= v_edge_wall_halt then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'kind', 'edge_wall', 'observed', v_max_edge_wall, 'halt', v_edge_wall_halt
    ));
  end if;
  if not v_external_fresh then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'kind', 'external_snapshot', 'observed', 0, 'halt', 1
    ));
  end if;
  if v_projected_invocations >= v_invocation_halt then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'kind', 'invocations', 'observed', v_projected_invocations, 'halt', v_invocation_halt
    ));
  end if;
  if v_max_bundle_bytes >= v_bundle_halt then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'kind', 'bundle', 'observed', v_max_bundle_bytes, 'halt', v_bundle_halt
    ));
  end if;

  v_allowed := jsonb_array_length(v_failures) = 0;

  return jsonb_build_object(
    'schemaVersion', 1,
    'observedAt', p_observed_at,
    'allowed', v_allowed,
    'failures', v_failures,
    'measurements', jsonb_build_object(
      'databaseBytes', v_database_bytes,
      'connectionCount', v_connections,
      'maxEdgeWallMilliseconds24h', v_max_edge_wall,
      'externalSnapshotFresh', v_external_fresh,
      'externalSnapshotObservedAt', v_external.observed_at,
      'invocationCount24h', v_external.invocation_count_24h,
      'projectedInvocations31d', v_projected_invocations,
      'functionCount', v_external.function_count,
      'maxBundleBytes', v_max_bundle_bytes,
      'maxBundleName', v_external.max_bundle_name,
      'bundleCount', v_external.bundle_count
    ),
    'thresholds', jsonb_build_object(
      'databaseHaltBytes', v_database_halt,
      'databaseHardBytes', v_database_hard,
      'connectionHalt', v_connection_halt,
      'connectionHard', v_connection_hard,
      'edgeWallHaltMilliseconds', v_edge_wall_halt,
      'edgeWallHardMilliseconds', v_edge_wall_hard,
      'invocationHalt31d', v_invocation_halt,
      'invocationHard31d', v_invocation_hard,
      'bundleHaltBytes', v_bundle_halt,
      'bundleHardBytes', v_bundle_hard
    ),
    'coverage', jsonb_build_object(
      'databaseStorage', true,
      'databaseConnections', true,
      'edgeWall', true,
      'functionInvocations', v_external_fresh,
      'bundleSize', v_external_fresh,
      'edgeCpu', false,
      'edgeMemory', false,
      'bandwidth', false,
      'billingAndOverage', false
    )
  );
end;
$$;

create or replace function public.xrpl_record_external_resource_snapshot(
  p_snapshot_id text,
  p_source_run_id bigint,
  p_source_commit text,
  p_observed_at timestamptz,
  p_invocation_count_24h bigint,
  p_projected_invocations_31d bigint,
  p_function_count integer,
  p_max_bundle_bytes bigint,
  p_max_bundle_name text,
  p_bundle_count integer,
  p_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_resource_guard_v1, pg_temp
as $$
begin
  if p_snapshot_id !~ '^[a-z0-9][a-z0-9-]{7,99}$'
    or p_source_run_id <= 0
    or p_source_commit !~ '^[a-f0-9]{40}$'
    or p_invocation_count_24h < 0
    or p_projected_invocations_31d < p_invocation_count_24h
    or p_function_count < 1
    or p_max_bundle_bytes < 1
    or p_bundle_count < 1
    or p_evidence_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid external resource snapshot';
  end if;

  insert into xrpl_resource_guard_v1.external_snapshots (
    snapshot_id, source_run_id, source_commit, observed_at,
    logs_window_hours, management_api_available,
    invocation_count_24h, projected_invocations_31d,
    function_count, max_bundle_bytes, max_bundle_name,
    bundle_count, evidence_digest
  ) values (
    p_snapshot_id, p_source_run_id, p_source_commit, p_observed_at,
    24, true, p_invocation_count_24h, p_projected_invocations_31d,
    p_function_count, p_max_bundle_bytes, p_max_bundle_name,
    p_bundle_count, p_evidence_digest
  );

  return xrpl_resource_guard_v1.current_snapshot(p_observed_at, null);
end;
$$;

create or replace function public.xrpl_guard_network_steady_session(p_observed_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v1, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_session xrpl_steady_v1.sessions%rowtype;
  v_failure jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-network-steady', 0));
  v_snapshot := xrpl_resource_guard_v1.current_snapshot(p_observed_at, null);

  select * into v_session
  from xrpl_steady_v1.sessions
  where status = 'running'
  order by prepared_at
  limit 1
  for update;

  if coalesce((v_snapshot->>'allowed')::boolean, false) then
    if v_session.session_id is not null then
      update xrpl_steady_v1.sessions
      set resource_guard_status = 'passed',
          resource_guard_checked_at = p_observed_at,
          updated_at = p_observed_at
      where session_id = v_session.session_id;
    end if;
    return jsonb_build_object(
      'allowed', true,
      'sessionId', v_session.session_id,
      'snapshot', v_snapshot
    );
  end if;

  if v_session.session_id is not null then
    update xrpl_steady_v1.sessions
    set status = 'halted',
        resource_guard_status = 'halted',
        resource_guard_checked_at = p_observed_at,
        last_error = left(concat('resource_guard:', v_snapshot->'failures'), 2000),
        lease_owner = null,
        lease_expires_at = null,
        completed_at = p_observed_at,
        updated_at = p_observed_at
    where session_id = v_session.session_id;

    for v_failure in select value from jsonb_array_elements(v_snapshot->'failures')
    loop
      insert into xrpl_resource_guard_v1.events (
        session_id, guard_kind, qualification, observed_value,
        halt_value, snapshot, created_at
      ) values (
        v_session.session_id, v_failure->>'kind', false,
        (v_failure->>'observed')::numeric,
        (v_failure->>'halt')::numeric,
        v_snapshot, p_observed_at
      );
    end loop;
  end if;

  return jsonb_build_object(
    'allowed', false,
    'sessionId', v_session.session_id,
    'snapshot', v_snapshot
  );
end;
$$;

create or replace function xrpl_resource_guard_v1.enforce_completed_tick()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v1, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    v_snapshot := xrpl_resource_guard_v1.current_snapshot(
      coalesce(new.completed_at, clock_timestamp()),
      jsonb_build_object('maxEdgeWallMilliseconds', new.edge_wall_milliseconds)
    );
    if not coalesce((v_snapshot->>'allowed')::boolean, false) then
      raise exception 'resource_guard_precommit:%', v_snapshot->'failures';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists xrpl_steady_resource_guard_precommit on xrpl_steady_v1.ticks;
create trigger xrpl_steady_resource_guard_precommit
before update on xrpl_steady_v1.ticks
for each row
execute function xrpl_resource_guard_v1.enforce_completed_tick();

create or replace function xrpl_resource_guard_v1.schedule_session_cron()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, cron, vault, pg_temp
as $$
declare
  v_name text;
  v_job_id bigint;
begin
  v_name := left(concat('xrpl-steady-', new.session_id), 63);
  select cron.schedule(
    v_name,
    '* * * * *',
    format($cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'xrpl_project_url')
          || '/functions/v1/xrpl-steady-resource-guarded-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'xrpl_secret_key')
        ),
        body := jsonb_build_object('source', 'pg_cron', 'scheduled_at', now()),
        timeout_milliseconds := 50000
      );
    $cron$)
  ) into v_job_id;

  update xrpl_steady_v1.sessions
  set cron_job_id = v_job_id, cron_job_name = v_name
  where session_id = new.session_id;
  return new;
end;
$$;

create or replace function xrpl_resource_guard_v1.unschedule_session_cron()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, cron, pg_temp
as $$
begin
  if old.status = 'running' and new.status in ('completed', 'halted')
    and old.cron_job_id is not null then
    perform cron.unschedule(old.cron_job_id);
    new.cron_job_id := null;
    new.cron_job_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists xrpl_steady_schedule_session_cron on xrpl_steady_v1.sessions;
create trigger xrpl_steady_schedule_session_cron
after insert on xrpl_steady_v1.sessions
for each row when (new.status = 'running')
execute function xrpl_resource_guard_v1.schedule_session_cron();

drop trigger if exists xrpl_steady_unschedule_session_cron on xrpl_steady_v1.sessions;
create trigger xrpl_steady_unschedule_session_cron
before update on xrpl_steady_v1.sessions
for each row
execute function xrpl_resource_guard_v1.unschedule_session_cron();

create or replace function public.xrpl_qualify_resource_guard_fail_closed(
  p_qualification_id text,
  p_guard_kind text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v1, pg_temp
as $$
declare
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_after public.xrpl_phase_watermarks%rowtype;
  v_override jsonb;
  v_snapshot jsonb;
  v_session_id text;
  v_tick_count integer;
  v_work_count integer;
  v_message_count integer;
  v_successor_count integer;
  v_failure jsonb;
begin
  if p_qualification_id !~ '^[a-z0-9][a-z0-9-]{7,79}$'
    or p_guard_kind not in ('database', 'connections', 'edge_wall', 'external_snapshot', 'invocations', 'bundle') then
    raise exception 'invalid resource guard qualification identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-network-steady', 0));
  if exists (select 1 from xrpl_steady_v1.sessions where status = 'running') then
    raise exception 'resource guard qualification requires no running steady session';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found then raise exception 'active watermark unavailable'; end if;

  v_session_id := concat('guard-', p_qualification_id, '-', p_guard_kind);
  insert into xrpl_steady_v1.sessions (
    session_id, source_profile_id, target_profile_id, network, epoch_id,
    base_identity, status, target_ticks, batch_size,
    anchor_ledger_index, anchor_ledger_hash, anchor_work_id,
    anchor_epoch_id, anchor_base_identity,
    watermark_ledger_index, watermark_ledger_hash, watermark_work_id,
    prepared_at, updated_at
  ) values (
    v_session_id, 'supabase-devnet', 'supabase-devnet-steady-qualification',
    'devnet', 'supabase-r4c2c-v1', concat('guard-', p_qualification_id),
    'running', 6, 24,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    v_watermark.epoch_id, v_watermark.base_identity,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    p_observed_at, p_observed_at
  );

  v_override := jsonb_build_object(
    'databaseBytes', 1,
    'connectionCount', 1,
    'maxEdgeWallMilliseconds', 1,
    'externalFresh', true,
    'projectedInvocations31d', 1,
    'maxBundleBytes', 1
  );
  v_override := case p_guard_kind
    when 'database' then v_override || jsonb_build_object('databaseBytes', 400000000)
    when 'connections' then v_override || jsonb_build_object('connectionCount', 45)
    when 'edge_wall' then v_override || jsonb_build_object('maxEdgeWallMilliseconds', 45000)
    when 'external_snapshot' then v_override || jsonb_build_object('externalFresh', false)
    when 'invocations' then v_override || jsonb_build_object('projectedInvocations31d', 400000)
    when 'bundle' then v_override || jsonb_build_object('maxBundleBytes', 4000000)
  end;

  v_snapshot := xrpl_resource_guard_v1.current_snapshot(p_observed_at, v_override);
  if coalesce((v_snapshot->>'allowed')::boolean, true)
    or jsonb_array_length(v_snapshot->'failures') <> 1
    or v_snapshot->'failures'->0->>'kind' <> p_guard_kind then
    raise exception 'resource guard qualification did not isolate %', p_guard_kind;
  end if;

  update xrpl_steady_v1.sessions
  set status = 'halted',
      resource_guard_status = 'halted',
      resource_guard_checked_at = p_observed_at,
      last_error = concat('qualification_resource_guard:', p_guard_kind),
      completed_at = p_observed_at,
      updated_at = p_observed_at
  where session_id = v_session_id;

  v_failure := v_snapshot->'failures'->0;
  insert into xrpl_resource_guard_v1.events (
    session_id, guard_kind, qualification, observed_value,
    halt_value, snapshot, created_at
  ) values (
    v_session_id, p_guard_kind, true,
    (v_failure->>'observed')::numeric,
    (v_failure->>'halt')::numeric,
    v_snapshot, p_observed_at
  );

  select count(*) into v_tick_count from xrpl_steady_v1.ticks where session_id = v_session_id;
  select count(*) into v_work_count from xrpl_steady_v1.works where session_id = v_session_id;
  select count(*) into v_message_count from xrpl_steady_v1.messages where session_id = v_session_id;
  select count(*) into v_successor_count from xrpl_steady_v1.successors where session_id = v_session_id;

  select * into v_after from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet';
  if v_tick_count <> 0 or v_work_count <> 0 or v_message_count <> 0 or v_successor_count <> 0
    or v_after.ledger_index < v_watermark.ledger_index
    or v_after.epoch_id <> v_watermark.epoch_id
    or v_after.base_identity <> v_watermark.base_identity then
    raise exception 'resource guard qualification mutated guarded or active state';
  end if;

  return jsonb_build_object(
    'qualificationId', p_qualification_id,
    'guardKind', p_guard_kind,
    'sessionId', v_session_id,
    'halted', true,
    'snapshot', v_snapshot,
    'guardedCounts', jsonb_build_object(
      'ticks', v_tick_count,
      'works', v_work_count,
      'messages', v_message_count,
      'successors', v_successor_count
    ),
    'activeBefore', jsonb_build_object(
      'ledgerIndex', v_watermark.ledger_index,
      'ledgerHash', v_watermark.ledger_hash,
      'workId', v_watermark.work_id,
      'epochId', v_watermark.epoch_id,
      'baseIdentity', v_watermark.base_identity
    ),
    'activeAfter', jsonb_build_object(
      'ledgerIndex', v_after.ledger_index,
      'ledgerHash', v_after.ledger_hash,
      'workId', v_after.work_id,
      'epochId', v_after.epoch_id,
      'baseIdentity', v_after.base_identity
    ),
    'checks', jsonb_build_object(
      'exactGuardIsolated', true,
      'noTickReserved', v_tick_count = 0,
      'noWorkCommitted', v_work_count = 0,
      'noMessageReserved', v_message_count = 0,
      'noSuccessorReserved', v_successor_count = 0,
      'activeProfileNonRegressing', v_after.ledger_index >= v_watermark.ledger_index,
      'activeSourceIdentityPreserved', v_after.epoch_id = v_watermark.epoch_id
        and v_after.base_identity = v_watermark.base_identity
    )
  );
end;
$$;

do $$
declare
  v_existing record;
begin
  for v_existing in
    select jobid from cron.job
    where jobname = 'xrpl-lending-monitor-steady-qualification-minute'
       or jobname like 'xrpl-steady-%'
  loop
    perform cron.unschedule(v_existing.jobid);
  end loop;
end;
$$;

revoke all on function xrpl_resource_guard_v1.current_snapshot(timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.xrpl_record_external_resource_snapshot(text, bigint, text, timestamptz, bigint, bigint, integer, bigint, text, integer, text) from public, anon, authenticated;
revoke all on function public.xrpl_guard_network_steady_session(timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_qualify_resource_guard_fail_closed(text, text, timestamptz) from public, anon, authenticated;
grant execute on function xrpl_resource_guard_v1.current_snapshot(timestamptz, jsonb) to service_role;
grant execute on function public.xrpl_record_external_resource_snapshot(text, bigint, text, timestamptz, bigint, bigint, integer, bigint, text, integer, text) to service_role;
grant execute on function public.xrpl_guard_network_steady_session(timestamptz) to service_role;
grant execute on function public.xrpl_qualify_resource_guard_fail_closed(text, text, timestamptz) to service_role;
