alter table xrpl_steady_v1.sessions
  add column if not exists resource_guard_enabled boolean not null default false;

create or replace function public.xrpl_read_resource_guard_snapshot(p_observed_at timestamptz)
returns jsonb
language sql
security definer
set search_path = public, xrpl_resource_guard_v1, pg_temp
as $$
  select xrpl_resource_guard_v1.current_snapshot(p_observed_at, null);
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

  select * into v_session
  from xrpl_steady_v1.sessions
  where status = 'running' and resource_guard_enabled
  order by prepared_at
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'allowed', true,
      'sessionId', null,
      'guardEnabled', false,
      'snapshot', null
    );
  end if;

  v_snapshot := xrpl_resource_guard_v1.current_snapshot(p_observed_at, null);
  if coalesce((v_snapshot->>'allowed')::boolean, false) then
    update xrpl_steady_v1.sessions
    set resource_guard_status = 'passed',
        resource_guard_checked_at = p_observed_at,
        updated_at = p_observed_at
    where session_id = v_session.session_id;

    return jsonb_build_object(
      'allowed', true,
      'sessionId', v_session.session_id,
      'guardEnabled', true,
      'snapshot', v_snapshot
    );
  end if;

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

  return jsonb_build_object(
    'allowed', false,
    'sessionId', v_session.session_id,
    'guardEnabled', true,
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

  v_snapshot := xrpl_resource_guard_v1.current_snapshot(
    coalesce(new.completed_at, clock_timestamp()),
    jsonb_build_object('maxEdgeWallMilliseconds', new.edge_wall_milliseconds)
  );
  if not coalesce((v_snapshot->>'allowed')::boolean, false) then
    raise exception 'resource_guard_precommit:%', v_snapshot->'failures';
  end if;
  return new;
end;
$$;

create or replace function xrpl_resource_guard_v1.schedule_session_cron()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, cron, vault, pg_temp
as $$
declare
  v_name text;
  v_job_id bigint;
  v_function_path text;
begin
  v_name := left(concat('xrpl-steady-', new.session_id), 63);
  v_function_path := case
    when new.resource_guard_enabled then '/functions/v1/xrpl-resource-headroom-guard'
    else '/functions/v1/xrpl-steady-batch-tick'
  end;

  select cron.schedule(
    v_name,
    '* * * * *',
    format($cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'xrpl_project_url')
          || %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'xrpl_secret_key')
        ),
        body := jsonb_build_object('source', 'pg_cron', 'scheduled_at', now()),
        timeout_milliseconds := 50000
      );
    $cron$, v_function_path)
  ) into v_job_id;

  update xrpl_steady_v1.sessions
  set cron_job_id = v_job_id, cron_job_name = v_name
  where session_id = new.session_id;
  return new;
end;
$$;

create or replace function public.xrpl_prepare_guarded_network_steady_session(
  p_session_id text,
  p_prepared_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v1, pg_temp
as $$
declare
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_snapshot jsonb;
begin
  if p_session_id !~ '^[a-z0-9][a-z0-9-]{7,79}$' then
    raise exception 'invalid guarded steady session id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-network-steady', 0));
  if exists (select 1 from xrpl_steady_v1.sessions where status = 'running') then
    raise exception 'another steady qualification session is already running';
  end if;
  if exists (select 1 from xrpl_steady_v1.sessions where session_id = p_session_id) then
    raise exception 'guarded steady qualification session already exists';
  end if;

  v_snapshot := xrpl_resource_guard_v1.current_snapshot(p_prepared_at, null);
  if not coalesce((v_snapshot->>'allowed')::boolean, false) then
    raise exception 'resource guard blocks guarded session:%', v_snapshot->'failures';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'active Supabase Devnet stream is unavailable';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found then
    raise exception 'active Supabase Devnet watermark is unavailable';
  end if;

  insert into xrpl_steady_v1.sessions (
    session_id, source_profile_id, target_profile_id, network, epoch_id,
    base_identity, status, target_ticks, batch_size,
    anchor_ledger_index, anchor_ledger_hash, anchor_work_id,
    anchor_epoch_id, anchor_base_identity,
    watermark_ledger_index, watermark_ledger_hash, watermark_work_id,
    resource_guard_enabled, resource_guard_status, resource_guard_checked_at,
    prepared_at, updated_at
  ) values (
    p_session_id, 'supabase-devnet', 'supabase-devnet-steady-qualification',
    'devnet', 'supabase-r4c2c-v1', concat('guarded-steady-', p_session_id),
    'running', 6, 24,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    v_watermark.epoch_id, v_watermark.base_identity,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    true, 'passed', p_prepared_at,
    p_prepared_at, p_prepared_at
  );

  return jsonb_build_object(
    'prepared', true,
    'sessionId', p_session_id,
    'resourceGuardEnabled', true,
    'targetTicks', 6,
    'batchSize', 24,
    'snapshot', v_snapshot,
    'anchor', jsonb_build_object(
      'ledgerIndex', v_watermark.ledger_index,
      'ledgerHash', v_watermark.ledger_hash,
      'workId', v_watermark.work_id,
      'epochId', v_watermark.epoch_id,
      'baseIdentity', v_watermark.base_identity
    )
  );
end;
$$;

revoke all on function public.xrpl_read_resource_guard_snapshot(timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_prepare_guarded_network_steady_session(text, timestamptz) from public, anon, authenticated;
grant execute on function public.xrpl_read_resource_guard_snapshot(timestamptz) to service_role;
grant execute on function public.xrpl_prepare_guarded_network_steady_session(text, timestamptz) to service_role;