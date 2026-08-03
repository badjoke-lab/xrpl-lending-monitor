alter table xrpl_steady_v1.ticks
  add column if not exists memory_samples jsonb,
  add column if not exists memory_high_water_bytes bigint,
  add column if not exists memory_sample_count integer;

alter table xrpl_steady_v1.ticks
  drop constraint if exists xrpl_steady_memory_high_water_nonnegative;
alter table xrpl_steady_v1.ticks
  add constraint xrpl_steady_memory_high_water_nonnegative
  check (memory_high_water_bytes is null or memory_high_water_bytes >= 0);

alter table xrpl_steady_v1.ticks
  drop constraint if exists xrpl_steady_memory_sample_count_range;
alter table xrpl_steady_v1.ticks
  add constraint xrpl_steady_memory_sample_count_range
  check (memory_sample_count is null or memory_sample_count between 6 and 12);

create or replace function public.xrpl_record_network_steady_memory(
  p_owner text,
  p_tick_id text,
  p_recorded_at timestamptz,
  p_memory_samples jsonb,
  p_memory_high_water_bytes bigint,
  p_memory_sample_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_tick xrpl_steady_v1.ticks%rowtype;
  v_session xrpl_steady_v1.sessions%rowtype;
  v_sample record;
  v_calculated_high_water bigint := 0;
  v_count integer := 0;
  v_phases text[] := array[]::text[];
  v_required_phases constant text[] := array[
    'request_start',
    'after_claim',
    'after_head',
    'after_fetch',
    'after_normalize',
    'before_commit'
  ];
  v_memory_halt_bytes constant bigint := 209715200;
begin
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-network-steady', 0));

  select * into v_tick
  from xrpl_steady_v1.ticks
  where tick_id = p_tick_id
  for update;
  if not found or v_tick.status <> 'leased' or v_tick.lease_owner <> p_owner then
    raise exception 'steady memory tick lease lost';
  end if;

  select * into v_session
  from xrpl_steady_v1.sessions
  where session_id = v_tick.session_id
  for update;
  if not found
    or v_session.status <> 'running'
    or v_session.lease_owner <> p_owner
    or v_session.lease_expires_at <= p_recorded_at then
    raise exception 'steady memory session lease lost';
  end if;

  if jsonb_typeof(p_memory_samples) <> 'array'
    or jsonb_array_length(p_memory_samples) <> p_memory_sample_count
    or p_memory_sample_count < 6
    or p_memory_sample_count > 12 then
    raise exception 'steady memory sample shape changed';
  end if;

  for v_sample in
    select value, ordinality::integer as ordinal
    from jsonb_array_elements(p_memory_samples) with ordinality
    order by ordinality
  loop
    if jsonb_typeof(v_sample.value) <> 'object'
      or coalesce(v_sample.value->>'phase', '') = ''
      or (v_sample.value->>'rssBytes')::bigint < 0
      or (v_sample.value->>'heapTotalBytes')::bigint < 0
      or (v_sample.value->>'heapUsedBytes')::bigint < 0
      or (v_sample.value->>'externalBytes')::bigint < 0
      or (v_sample.value->>'heapUsedBytes')::bigint > (v_sample.value->>'heapTotalBytes')::bigint then
      raise exception 'steady memory sample % is invalid', v_sample.ordinal;
    end if;
    if (v_sample.value->>'phase') = any(v_phases) then
      raise exception 'steady memory phase duplicated: %', v_sample.value->>'phase';
    end if;
    v_phases := array_append(v_phases, v_sample.value->>'phase');
    v_calculated_high_water := greatest(
      v_calculated_high_water,
      (v_sample.value->>'rssBytes')::bigint
    );
    v_count := v_count + 1;
  end loop;

  if not v_required_phases <@ v_phases
    or v_count <> p_memory_sample_count
    or v_calculated_high_water <> p_memory_high_water_bytes then
    raise exception 'steady memory phase or high-water parity failed';
  end if;
  if p_memory_high_water_bytes >= v_memory_halt_bytes then
    raise exception 'steady memory halt threshold reached:%', p_memory_high_water_bytes;
  end if;

  update xrpl_steady_v1.ticks
  set
    memory_samples = p_memory_samples,
    memory_high_water_bytes = p_memory_high_water_bytes,
    memory_sample_count = p_memory_sample_count
  where session_id = v_tick.session_id and tick_id = p_tick_id;

  return jsonb_build_object(
    'recorded', true,
    'sessionId', v_tick.session_id,
    'tickId', p_tick_id,
    'memoryHighWaterBytes', p_memory_high_water_bytes,
    'memorySampleCount', p_memory_sample_count,
    'memoryHaltBytes', v_memory_halt_bytes,
    'belowHaltThreshold', p_memory_high_water_bytes < v_memory_halt_bytes
  );
end;
$$;

create or replace function public.xrpl_read_network_steady_memory(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_session xrpl_steady_v1.sessions%rowtype;
  v_ticks jsonb;
  v_completed_count integer;
  v_measured_completed_count integer;
  v_max_high_water bigint;
  v_memory_halt_bytes constant bigint := 209715200;
  v_memory_hard_bytes constant bigint := 268435456;
begin
  select * into v_session
  from xrpl_steady_v1.sessions
  where session_id = p_session_id;
  if not found then raise exception 'steady memory session not found'; end if;

  select count(*)::integer into v_completed_count
  from xrpl_steady_v1.ticks
  where session_id = p_session_id and status = 'completed';

  select count(*)::integer, coalesce(max(memory_high_water_bytes), 0)
  into v_measured_completed_count, v_max_high_water
  from xrpl_steady_v1.ticks
  where session_id = p_session_id
    and status = 'completed'
    and memory_samples is not null
    and memory_sample_count between 6 and 12
    and memory_high_water_bytes is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tickId', tick_id,
    'tickSequence', tick_sequence,
    'status', status,
    'memoryHighWaterBytes', memory_high_water_bytes,
    'memorySampleCount', memory_sample_count,
    'memorySamples', memory_samples
  ) order by tick_sequence), '[]'::jsonb)
  into v_ticks
  from xrpl_steady_v1.ticks
  where session_id = p_session_id;

  return jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r4c2d-steady-memory-guard',
    'sessionId', p_session_id,
    'sessionStatus', v_session.status,
    'completedTicks', v_completed_count,
    'measuredCompletedTicks', v_measured_completed_count,
    'memoryHighWaterBytes', v_max_high_water,
    'memoryHaltBytes', v_memory_halt_bytes,
    'memoryHardBytes', v_memory_hard_bytes,
    'ticks', v_ticks,
    'checks', jsonb_build_object(
      'allCompletedTicksMeasured', v_completed_count > 0 and v_measured_completed_count = v_completed_count,
      'sixCompletedTicksMeasured', v_completed_count = 6 and v_measured_completed_count = 6,
      'highWaterBelowHalt', v_max_high_water < v_memory_halt_bytes,
      'haltBelowHard', v_memory_halt_bytes < v_memory_hard_bytes,
      'profileSelected', false,
      'g8Qualified', false
    )
  );
end;
$$;

revoke all on function public.xrpl_record_network_steady_memory(text, text, timestamptz, jsonb, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.xrpl_read_network_steady_memory(text)
  from public, anon, authenticated;
grant execute on function public.xrpl_record_network_steady_memory(text, text, timestamptz, jsonb, bigint, integer)
  to service_role;
grant execute on function public.xrpl_read_network_steady_memory(text)
  to service_role;