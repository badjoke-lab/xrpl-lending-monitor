alter function public.xrpl_read_revision3_session_accounting(text)
  rename to xrpl_read_revision3_session_accounting_unbarriered;

create or replace function public.xrpl_read_revision3_session_accounting(
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_attempt integer;
begin
  for v_attempt in 1..40
  loop
    v_result := public.xrpl_read_revision3_session_accounting_unbarriered(p_session_id);

    if coalesce((v_result->>'resourceGuardEnabled')::boolean, false) is not true
      or coalesce(v_result->>'sessionStatus', '') <> 'completed'
      or coalesce(
        (v_result #>> '{checks,resourceAccountingStateTransferQualified}')::boolean,
        false
      ) is true then
      return v_result;
    end if;

    perform pg_sleep(0.25);
  end loop;

  -- Returning the unqualified completed result after the bounded barrier keeps
  -- the existing remote verifier fail-closed instead of hiding a stuck wrapper
  -- finalization or transfer qualification.
  return v_result;
end;
$$;

revoke all on function public.xrpl_read_revision3_session_accounting(text)
  from public, anon, authenticated;
grant execute on function public.xrpl_read_revision3_session_accounting(text)
  to service_role;
