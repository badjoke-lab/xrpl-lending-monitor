-- Allow the one-minute revision-4 runtime to use a fresh recovery run without
-- rewriting or adopting the already-qualified partial revision-4 run.
--
-- This patch changes only the exact run-id admission guard of the existing
-- continuous-head function. All quiescence, watermark, resource, ACL, Devnet,
-- and Mainnet-disabled behavior remains inherited from the reviewed function.

do $patch$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_refresh_r5_revision4_continuous_head(text,bigint,text,timestamp with time zone)'
  );
  v_definition text;
  v_patched text;
  v_after text;
  v_old_guard constant text :=
    'if p_run_id <> ''r5-recovery-selected-revision4-entry''';
  v_new_guard constant text :=
    'if p_run_id not in (''r5-recovery-selected-revision4-entry'', ''r5-recovery-selected-revision4-minute-entry'')';
begin
  if v_signature is null then
    raise exception 'r5_revision4_minute_run_binding_source_missing';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  if position(v_old_guard in v_definition) = 0
    or position('active_boundary_drift_requires_operator' in v_definition) = 0
    or position('provider_snapshot_stale' in v_definition) = 0
    or position('monthly_invocation_halt' in v_definition) = 0
    or position('claimResourceGuardsStillRequired' in v_definition) = 0
    or position('mainnetDisabled' in v_definition) = 0
    or position('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(' in v_definition) = 0 then
    raise exception 'r5_revision4_minute_run_binding_source_drift';
  end if;

  v_patched := replace(v_definition, v_old_guard, v_new_guard);

  if v_patched = v_definition
    or position(v_new_guard in v_patched) = 0
    or position(v_old_guard in v_patched) <> 0 then
    raise exception 'r5_revision4_minute_run_binding_patch_invalid';
  end if;

  execute v_patched;

  select pg_get_functiondef(v_signature) into v_after;
  if position(v_new_guard in v_after) = 0
    or position('active_boundary_drift_requires_operator' in v_after) = 0
    or position('provider_snapshot_stale' in v_after) = 0
    or position('monthly_invocation_halt' in v_after) = 0
    or position('claimResourceGuardsStillRequired' in v_after) = 0
    or position('mainnetDisabled' in v_after) = 0 then
    raise exception 'r5_revision4_minute_run_binding_postcondition_failed';
  end if;
end;
$patch$;
