do $$
declare
  v_signature constant text :=
    'public.xrpl_adopt_r5_committed_active_descendants(text,timestamp with time zone)';
  v_function regprocedure;
  v_definition text;
  v_updated text;
  v_old constant text := E'    or (v_boundary->>''drainedStepCount'')::integer <> 0\n';
  v_new constant text := E'    or (v_boundary->>''drainedStepCount'')::integer < 0\n    or (v_boundary->>''drainedStepCount'')::integer > 256\n    or coalesce((v_boundary->''checks''->>''onlyExistingCommitOrFinalizeDrained'')::boolean, false) is not true\n';
  v_removed_bytes integer;
begin
  v_function := to_regprocedure(v_signature);
  if v_function is null then
    raise exception 'r5_adoption_qualified_drain_function_missing';
  end if;

  v_definition := pg_get_functiondef(v_function);
  v_removed_bytes := length(v_definition) - length(replace(v_definition, v_old, ''));
  if v_removed_bytes <> length(v_old) then
    raise exception 'r5_adoption_qualified_drain_exact_clause_missing';
  end if;

  if position('public.xrpl_drain_r5_checkpoint_boundary' in v_definition) = 0
    or position('noScanExecuted' in v_definition) = 0
    or position('onePendingScan' in v_definition) = 0
    or position('pendingScanBoundToWatermark' in v_definition) = 0
    or position('noInflightWork' in v_definition) = 0
    or position('r5_recovery_adoption_boundary_invalid' in v_definition) = 0 then
    raise exception 'r5_adoption_qualified_drain_boundary_contract_changed';
  end if;

  v_updated := replace(v_definition, v_old, v_new);
  execute v_updated;

  v_definition := pg_get_functiondef(v_function);
  if position('(v_boundary ->> ''drainedStepCount''::text)::integer <> 0' in v_definition) <> 0
    or position('(v_boundary ->> ''drainedStepCount''::text)::integer < 0' in v_definition) = 0
    or position('(v_boundary ->> ''drainedStepCount''::text)::integer > 256' in v_definition) = 0
    or position('onlyExistingCommitOrFinalizeDrained' in v_definition) = 0
    or position('noScanExecuted' in v_definition) = 0
    or position('pendingScanBoundToWatermark' in v_definition) = 0
    or position('noInflightWork' in v_definition) = 0 then
    raise exception 'r5_adoption_qualified_drain_replacement_invalid';
  end if;
end;
$$;

revoke all on function public.xrpl_adopt_r5_committed_active_descendants(
  text, timestamptz
) from public, anon, authenticated;

grant execute on function public.xrpl_adopt_r5_committed_active_descendants(
  text, timestamptz
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_adopt_r5_committed_active_descendants(text, timestamptz) to supabase_admin';
  end if;
end;
$$;
