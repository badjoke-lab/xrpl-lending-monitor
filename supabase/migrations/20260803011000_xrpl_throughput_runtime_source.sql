create or replace view public.xrpl_probe_runtime as
select
  1::bigint as id,
  runtime.tick_count,
  runtime.consecutive_failures,
  runtime.last_started_at as last_tick_at,
  runtime.last_completed_at as last_success_at,
  runtime.last_error,
  runtime.updated_at
from public.xrpl_collector_runtime as runtime
where runtime.profile_id = 'supabase-devnet';

revoke all on public.xrpl_probe_runtime from public, anon, authenticated;
grant select on public.xrpl_probe_runtime to service_role;

comment on view public.xrpl_probe_runtime is
  'Read-only R4C2d compatibility projection over the active Supabase Devnet collector runtime.';
