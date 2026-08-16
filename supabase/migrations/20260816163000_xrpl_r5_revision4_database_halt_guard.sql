create or replace function xrpl_r5_v1.database_claim_allowed(p_database_bytes bigint)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select p_database_bytes < 400000000::bigint
$$;

revoke all on function xrpl_r5_v1.database_claim_allowed(bigint)
  from public, anon, authenticated, service_role;

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
  );
  v_definition text;
  v_patched_definition text;
  v_decl_anchor constant text := 'v_inflight_work_count integer;';
  v_decl_patch constant text := E'v_inflight_work_count integer;\n  v_database_bytes bigint;\n  v_database_halt constant bigint := 400000000;';
  v_guard_anchor constant text := E'if v_inflight_work_count <> 0 then\n    raise exception ''r5_recovery_batch_inflight_work_present'';\n  end if;\n\n  if p_validated_head_ledger_index < v_watermark.ledger_index then';
  v_guard_patch constant text := E'if v_inflight_work_count <> 0 then\n    raise exception ''r5_recovery_batch_inflight_work_present'';\n  end if;\n\n  v_database_bytes := pg_database_size(current_database());\n  if not xrpl_r5_v1.database_claim_allowed(v_database_bytes) then\n    update xrpl_r5_v1.recovery_runs\n    set\n      status = ''halted'',\n      started_at = coalesce(started_at, p_now),\n      last_error = ''r5_recovery_database_halt'',\n      updated_at = p_now\n    where run_id = v_run.run_id;\n\n    return jsonb_build_object(\n      ''claimed'', false,\n      ''state'', ''halted'',\n      ''reason'', ''r5_recovery_database_halt'',\n      ''runId'', v_run.run_id,\n      ''databaseBytes'', v_database_bytes,\n      ''databaseHaltBytes'', v_database_halt,\n      ''databaseHeadroomBytes'', v_database_halt - v_database_bytes\n    );\n  end if;\n\n  if p_validated_head_ledger_index < v_watermark.ledger_index then';
  v_decl_count integer;
  v_guard_count integer;
begin
  if v_signature is null then
    raise exception 'r5_revision4_database_halt_claim_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('xrpl-r5-active-recovery', 0)
  );

  if xrpl_r5_v1.database_claim_allowed(399999999::bigint) is not true
    or xrpl_r5_v1.database_claim_allowed(400000000::bigint) is not false
    or xrpl_r5_v1.database_claim_allowed(400000001::bigint) is not false then
    raise exception 'r5_revision4_database_halt_boundary_invalid';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  if position('r5_recovery_database_halt' in v_definition) <> 0
    or position('database_claim_allowed(v_database_bytes)' in v_definition) <> 0 then
    raise exception 'r5_revision4_database_halt_already_installed';
  end if;

  v_decl_count := (
    length(v_definition) - length(replace(v_definition, v_decl_anchor, ''))
  ) / length(v_decl_anchor);
  v_guard_count := (
    length(v_definition) - length(replace(v_definition, v_guard_anchor, ''))
  ) / length(v_guard_anchor);

  if v_decl_count <> 1 or v_guard_count <> 1 then
    raise exception 'r5_revision4_database_halt_source_definition_drift';
  end if;

  v_patched_definition := replace(v_definition, v_decl_anchor, v_decl_patch);
  v_patched_definition := replace(v_patched_definition, v_guard_anchor, v_guard_patch);
  execute v_patched_definition;

  select pg_get_functiondef(v_signature) into v_patched_definition;

  if position('v_database_halt constant bigint := 400000000' in v_patched_definition) = 0
    or position('v_database_bytes := pg_database_size(current_database())' in v_patched_definition) = 0
    or position('if not xrpl_r5_v1.database_claim_allowed(v_database_bytes) then' in v_patched_definition) = 0
    or position('last_error = ''r5_recovery_database_halt''' in v_patched_definition) = 0
    or position('''databaseHaltBytes'', v_database_halt' in v_patched_definition) = 0
    or position('''databaseHeadroomBytes'', v_database_halt - v_database_bytes' in v_patched_definition) = 0 then
    raise exception 'r5_revision4_database_halt_patch_verification_failed';
  end if;

  if position('v_database_bytes := pg_database_size(current_database())' in v_patched_definition)
       >= position('if p_validated_head_ledger_index < v_watermark.ledger_index then' in v_patched_definition)
    or position('v_database_bytes := pg_database_size(current_database())' in v_patched_definition)
       >= position('select * into v_existing' in v_patched_definition) then
    raise exception 'r5_revision4_database_halt_guard_order_invalid';
  end if;
end;
$migration$;

do $assertion$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
  );
  v_definition text;
begin
  if v_signature is null then
    raise exception 'r5_revision4_database_halt_assertion_claim_missing';
  end if;

  if xrpl_r5_v1.database_claim_allowed(399999999::bigint) is not true
    or xrpl_r5_v1.database_claim_allowed(400000000::bigint) is not false
    or xrpl_r5_v1.database_claim_allowed(400000001::bigint) is not false then
    raise exception 'r5_revision4_database_halt_assertion_boundary_invalid';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  if position('v_database_bytes := pg_database_size(current_database())' in v_definition) = 0
    or position('r5_recovery_database_halt' in v_definition) = 0
    or position('database_claim_allowed(v_database_bytes)' in v_definition) = 0
    or position('v_database_bytes := pg_database_size(current_database())' in v_definition)
       >= position('if p_validated_head_ledger_index < v_watermark.ledger_index then' in v_definition)
    or position('v_database_bytes := pg_database_size(current_database())' in v_definition)
       >= position('select * into v_existing' in v_definition) then
    raise exception 'r5_revision4_database_halt_assertion_post_state_invalid';
  end if;
end;
$assertion$;