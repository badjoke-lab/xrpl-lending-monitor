do $$
declare
  v_signature constant text :=
    'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)';
  v_function regprocedure;
  v_definition text;
  v_updated text;
  v_forbidden constant text := E'    or v_pending_scan.attempt_count <> 0\n';
  v_removed_bytes integer;
begin
  v_function := to_regprocedure(v_signature);
  if v_function is null then
    raise exception 'r5_completion_preserve_scan_retry_function_missing';
  end if;

  v_definition := pg_get_functiondef(v_function);
  v_removed_bytes := length(v_definition) - length(replace(v_definition, v_forbidden, ''));
  if v_removed_bytes <> length(v_forbidden) then
    raise exception 'r5_completion_preserve_scan_retry_exact_clause_missing';
  end if;

  if position('r5_recovery_batch_completion_pending_scan_invalid' in v_definition) = 0
    or position('(v_pending_scan.payload->>''expectedPreviousLedgerIndex'')::bigint' in v_definition) = 0
    or position('upper(v_pending_scan.payload->>''expectedPreviousLedgerHash'')' in v_definition) = 0
    or position('v_pending_scan.payload->>''epochId'' <> v_run.epoch_id' in v_definition) = 0
    or position('v_pending_scan.payload->>''baseIdentity'' <> v_run.base_identity' in v_definition) = 0 then
    raise exception 'r5_completion_preserve_scan_retry_boundary_contract_changed';
  end if;

  v_updated := replace(v_definition, v_forbidden, '');
  execute v_updated;

  v_definition := pg_get_functiondef(v_function);
  if position('v_pending_scan.attempt_count <> 0' in v_definition) <> 0
    or position('r5_recovery_batch_completion_pending_scan_invalid' in v_definition) = 0
    or position('(v_pending_scan.payload->>''expectedPreviousLedgerIndex'')::bigint' in v_definition) = 0
    or position('upper(v_pending_scan.payload->>''expectedPreviousLedgerHash'')' in v_definition) = 0
    or position('v_pending_scan.payload->>''epochId'' <> v_run.epoch_id' in v_definition) = 0
    or position('v_pending_scan.payload->>''baseIdentity'' <> v_run.base_identity' in v_definition) = 0 then
    raise exception 'r5_completion_preserve_scan_retry_replacement_invalid';
  end if;
end;
$$;

revoke all on function public.xrpl_complete_r5_active_recovery_batch(
  text, text, text, timestamptz, text, text, text, text,
  bigint, numeric, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.xrpl_complete_r5_active_recovery_batch(
  text, text, text, timestamptz, text, text, text, text,
  bigint, numeric, numeric, numeric
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_complete_r5_active_recovery_batch(text, text, text, timestamptz, text, text, text, text, bigint, numeric, numeric, numeric) to supabase_admin';
  end if;
end;
$$;
