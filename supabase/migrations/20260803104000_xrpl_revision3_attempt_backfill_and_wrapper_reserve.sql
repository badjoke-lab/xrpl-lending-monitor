create or replace function xrpl_resource_guard_v2.apply_wrapper_success_reserve()
returns trigger
language plpgsql
security definer
set search_path = xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_wrapper_reserve constant bigint := 4194304;
begin
  if old.status = 'open' and new.status = 'succeeded' then
    if new.finalized_egress_upper_bound_bytes is null
      or new.finalized_egress_upper_bound_bytes < 0 then
      raise exception 'revision3_wrapper_egress_accounting_missing';
    end if;

    new.finalized_egress_upper_bound_bytes :=
      new.finalized_egress_upper_bound_bytes + v_wrapper_reserve;

    if new.finalized_egress_upper_bound_bytes >= 33554432 then
      raise exception 'revision3_wrapper_egress_halt';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists xrpl_revision3_wrapper_success_reserve
  on xrpl_resource_guard_v2.attempts;
create trigger xrpl_revision3_wrapper_success_reserve
before update on xrpl_resource_guard_v2.attempts
for each row
execute function xrpl_resource_guard_v2.apply_wrapper_success_reserve();

-- Revision-3 tick accounting existed briefly before attempt reservations were introduced.
-- Represent every legacy session/minute with the full 128 MiB crash reservation so the
-- existing greatest(attempt total, legacy total) window cannot undercount across the seam.
insert into xrpl_resource_guard_v2.attempts (
  session_id,
  attempt_id,
  profile_id,
  profile_revision,
  profile_identity_digest,
  scheduled_minute,
  status,
  reserved_egress_upper_bound_bytes,
  finalized_egress_upper_bound_bytes,
  accounting_digest,
  tick_id,
  error_message,
  started_at,
  finalized_at
)
select
  accounting.session_id,
  concat(
    'r4c3-backfill:',
    substr(md5(accounting.session_id || ':' || tick.scheduled_minute::text), 1, 24)
  ),
  'supabase_free_postgres_pgcron_edge',
  3,
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
  tick.scheduled_minute,
  'failed',
  134217728,
  null,
  null,
  tick.tick_id,
  'legacy_tick_accounting_conservative_backfill',
  min(accounting.recorded_at),
  max(accounting.recorded_at)
from xrpl_resource_guard_v2.tick_accounting accounting
join xrpl_steady_v1.ticks tick
  on tick.session_id = accounting.session_id
 and tick.tick_id = accounting.tick_id
left join xrpl_resource_guard_v2.attempts existing
  on existing.session_id = accounting.session_id
 and existing.scheduled_minute = tick.scheduled_minute
where existing.session_id is null
group by accounting.session_id, tick.scheduled_minute, tick.tick_id
on conflict (session_id, scheduled_minute) do nothing;

revoke all on function xrpl_resource_guard_v2.apply_wrapper_success_reserve()
  from public, anon, authenticated;
