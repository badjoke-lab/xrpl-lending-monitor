create or replace function xrpl_resource_guard_v2.enforce_completed_tick()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_accounting xrpl_resource_guard_v2.tick_accounting%rowtype;
  v_enabled boolean;
  v_completion_time timestamptz := statement_timestamp();
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
    or v_accounting.recorded_at > v_completion_time
    or v_accounting.created_at > v_completion_time
    or v_accounting.conservative_memory_upper_bound_bytes >= 234881024
    or v_accounting.conservative_tick_egress_upper_bound_bytes >= 33554432
    or v_accounting.conservative_egress_31d_upper_bound_bytes >= 4294967296
    or v_accounting.projected_invocations_31d >= 400000 then
    raise exception 'revision3_resource_accounting_precommit';
  end if;

  -- The accounting RPC commits before the completion RPC. Persist the database
  -- statement time rather than the caller-prepared timestamp so the later
  -- qualification read proves the same server-observed ordering as this trigger.
  new.completed_at := v_completion_time;
  return new;
end;
$$;
