revoke all privileges on function public.xrpl_prepare_network_steady_session(text,timestamp with time zone)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.xrpl_claim_network_steady_tick(text,timestamp with time zone,timestamp with time zone,integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.xrpl_record_revision3_tick_accounting(text,text,timestamp with time zone,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.xrpl_complete_network_steady_tick(text,text,timestamp with time zone,text,text,numeric,numeric,numeric)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.xrpl_begin_revision3_attempt(text,text,timestamp with time zone,timestamp with time zone)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.xrpl_finalize_revision3_attempt(text,text,text,text,bigint,text,text,timestamp with time zone)
  from public, anon, authenticated, service_role;
revoke all privileges on function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()
  from public, anon, authenticated, service_role;
revoke all privileges on function xrpl_resource_guard_v2.qualify_transfer_on_completion()
  from public, anon, authenticated, service_role;
