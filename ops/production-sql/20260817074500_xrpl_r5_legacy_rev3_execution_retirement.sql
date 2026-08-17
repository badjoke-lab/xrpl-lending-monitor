do $retire$
declare
  v_active_status text;
  v_active_error text;
  v_active_revision integer;
  v_active_network text;
  v_runnable bigint;
  v_leased bigint;
begin
  select status, last_error, profile_revision, network
  into v_active_status, v_active_error, v_active_revision, v_active_network
  from xrpl_r5_v1.recovery_runs
  where run_id = 'r5-recovery-selected-revision4-minute2-entry';

  if not found
    or v_active_status <> 'halted'
    or v_active_error <> 'r5_recovery_database_halt'
    or v_active_revision <> 4
    or v_active_network <> 'devnet' then
    raise exception 'legacy_rev3_retirement_active_revision4_halt_drift';
  end if;

  select count(*) into v_runnable
  from xrpl_r5_v1.recovery_runs
  where profile_revision = 3 and status in ('prepared', 'running');
  if v_runnable <> 0 then
    raise exception 'legacy_rev3_retirement_runnable_run_present';
  end if;

  select count(*) into v_leased
  from xrpl_r5_v1.recovery_batches b
  join xrpl_r5_v1.recovery_runs r on r.run_id = b.run_id
  where r.profile_revision = 3 and b.status = 'leased';
  if v_leased <> 0 then
    raise exception 'legacy_rev3_retirement_leased_batch_present';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_prepare_r5_active_recovery(text,text,text,bigint,text,timestamp with time zone)'::regprocedure)
      <> '8ac86e50f0e06ebdc9cfc850b11fd2cf4e0b914bddc85de0b8f9f7710f3822b9' then
    raise exception 'legacy_rev3_retirement_prepare_source_drift';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'::regprocedure)
      <> '6fefeb1d8e0d8ade1e036045c2dc04e69961e4f96edd2047e0aa1f221171788e' then
    raise exception 'legacy_rev3_retirement_claim_source_drift';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'::regprocedure)
      <> 'bfeca7872b75a1b1f9d9cce0cf3690c50ec766919d8304b5b96b2324eacf7ba4' then
    raise exception 'legacy_rev3_retirement_prepared_head_claim_source_drift';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'::regprocedure)
      <> '3ef6454d76902c8ede45931235bfaf64723053b28d938a9591963145f3e80bee' then
    raise exception 'legacy_rev3_retirement_complete_source_drift';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_create_r5_active_checkpoint_strict(text,timestamp with time zone)'::regprocedure)
      <> 'd17d392292b4ca38c9b1f85fb0d8f2bebe3cd6db978ca42a70cfd3bc3deb133c' then
    raise exception 'legacy_rev3_retirement_checkpoint_strict_keep_source_drift';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_create_r5_active_checkpoint(text,timestamp with time zone)'::regprocedure)
      <> '2dbc86350f9852180c00c3cb7c0e9df5688e5e66f099b874e39f358701661b16' then
    raise exception 'legacy_rev3_retirement_checkpoint_wrapper_keep_source_drift';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_create_r5_revision4_active_checkpoint(text,text,timestamp with time zone)'::regprocedure)
      <> '84266f22d3cdc39d9a1441b1c0723263711d902634dc46af1aae354597ee9744' then
    raise exception 'legacy_rev3_retirement_revision4_checkpoint_keep_source_drift';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_claim_multichunk_witness_phase(text,timestamp with time zone,integer)'::regprocedure)
      <> '9a436a899eef035f2b59fdcc54c7ab4bf04cacbed353cdddc1005774144a108f' then
    raise exception 'legacy_rev3_retirement_witness_keep_source_drift';
  end if;

  if (select encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
      from pg_proc p where p.oid = 'public.xrpl_read_throughput_resource_baseline(timestamp with time zone,integer)'::regprocedure)
      <> '338c5318b8a93768f86f9492e7c3a665a542010e3017bd738b8590e834ec61e1' then
    raise exception 'legacy_rev3_retirement_baseline_keep_source_drift';
  end if;
end;
$retire$;

revoke all privileges on function public.xrpl_prepare_r5_active_recovery(text,text,text,bigint,text,timestamp with time zone)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)
  from public, anon, authenticated, service_role;
