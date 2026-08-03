do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_create_r5_active_checkpoint(text, timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_read_r5_active_checkpoint(text) to supabase_admin';
    execute 'grant execute on function public.xrpl_prepare_r5_active_recovery(text, text, text, bigint, text, timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_read_r5_active_recovery(text) to supabase_admin';
  end if;

  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    execute 'grant execute on function public.xrpl_read_r5_active_checkpoint(text) to supabase_read_only_user';
    execute 'grant execute on function public.xrpl_read_r5_active_recovery(text) to supabase_read_only_user';
  end if;
end;
$$;

revoke all on function public.xrpl_create_r5_active_checkpoint(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_read_r5_active_checkpoint(text)
  from public, anon, authenticated;
revoke all on function public.xrpl_prepare_r5_active_recovery(
  text, text, text, bigint, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_read_r5_active_recovery(text)
  from public, anon, authenticated;
