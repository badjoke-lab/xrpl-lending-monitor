create schema if not exists xrpl_catchup_v1;

create or replace function public.xrpl_read_isolated_catchup_trial(p_trial_id text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'trialId', p_trial_id,
    'status', 'uninitialized'
  )
$$;

revoke all on function public.xrpl_read_isolated_catchup_trial(text) from public, anon, authenticated;
grant execute on function public.xrpl_read_isolated_catchup_trial(text) to service_role;
