-- Revision-4 must never enter the revision-3-only memory-retry RPC.
--
-- The revision-4 runtime RPC migration cloned the then-current progressive
-- prepared-head claim function. That source function had acquired a
-- revision-3 recovery-only branch which calls xrpl_claim_r5_memory_retry_batch.
-- The clone correctly rewrote the normal claim/rebind/adoption functions but
-- intentionally had no revision-4 memory-retry equivalent, leaving that one
-- revision-3 RPC call in the revision-4 wrapper.
--
-- Production one-minute activation smoke on 2026-08-15 exposed the mismatch:
-- a zero-progress revision-4 run in prepared state was rebound to the active
-- boundary and then failed with r5_memory_retry_claim_run_invalid before any
-- ledger batch could be claimed. The activation workflow rolled back and kept
-- the existing collector schedule.
--
-- This follow-up changes only the revision-4 prepared-head wrapper. It removes
-- exactly the revision-3 memory-retry probe block so a running revision-4 run
-- proceeds to the already-qualified revision-4 base claim. Revision-3 remains
-- untouched. All revision-4 profile, selection, resource, quiescence, 12-ledger
-- claim-cap, continuous-head, and completion guards remain in their existing
-- functions.

do $patch$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'
  );
  v_revision3_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'
  );
  v_definition text;
  v_patched text;
  v_revision3_definition text;
  v_old_block text := E'    v_claim := public.xrpl_claim_r5_memory_retry_batch(\n'
    || E'      p_run_id,\n'
    || E'      p_owner,\n'
    || E'      p_now,\n'
    || E'      p_lease_seconds\n'
    || E'    );\n\n'
    || E'    if coalesce((v_claim->>''claimed'')::boolean, false) is true then\n'
    || E'      v_projected_invocations := (v_claim->>''projectedInvocations31d'')::bigint;\n'
    || E'      return v_claim || jsonb_build_object(\n'
    || E'        ''network'', v_run.network,\n'
    || E'        ''epochId'', v_run.epoch_id,\n'
    || E'        ''baseIdentity'', v_run.base_identity,\n'
    || E'        ''currentWatermarkLedgerIndex'', v_run.current_watermark_ledger_index,\n'
    || E'        ''currentWatermarkLedgerHash'', v_run.current_watermark_ledger_hash,\n'
    || E'        ''currentWatermarkWorkId'', v_run.current_watermark_work_id,\n'
    || E'        ''priorInvocations31d'', v_projected_invocations - 1,\n'
    || E'        ''retainedPreparedHeadUsed'', true,\n'
    || E'        ''retainedValidatedHeadLedgerIndex'',\n'
    || E'          v_run.initial_validated_head_ledger_index,\n'
    || E'        ''retainedValidatedHeadLedgerHash'',\n'
    || E'          v_run.initial_validated_head_ledger_hash,\n'
    || E'        ''reservationBeforeAnyNetworkRead'', true,\n'
    || E'        ''freshHeadMustCoverReservedEndBeforeFetch'', true,\n'
    || E'        ''prebatchRebind'', v_rebind\n'
    || E'      );\n'
    || E'    end if;\n\n'
    || E'    if v_claim->>''reason'' <> ''no_memory_retry'' then\n'
    || E'      raise exception ''r5_recovery_memory_retry_claim_unexpected'';\n'
    || E'    end if;\n';
  v_old_count integer;
  v_revision3_count integer;
begin
  if v_signature is null or v_revision3_signature is null then
    raise exception 'r5_revision4_prepared_head_memory_retry_function_missing';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  select pg_get_functiondef(v_revision3_signature) into v_revision3_definition;

  v_old_count := (
    length(v_definition) - length(replace(v_definition, v_old_block, ''))
  ) / length(v_old_block);
  v_revision3_count := (
    length(v_revision3_definition)
      - length(replace(v_revision3_definition, 'public.xrpl_claim_r5_memory_retry_batch(', ''))
  ) / length('public.xrpl_claim_r5_memory_retry_batch(');

  if v_old_count <> 1
    or v_revision3_count <> 1
    or position('v_run.profile_revision <> 4' in v_definition) = 0
    or position('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(' in v_definition) = 0
    or position('public.xrpl_claim_r5_revision4_recovery_batch(' in v_definition) = 0
    or position('public.xrpl_adopt_r5_revision4_committed_active_descendants(' in v_definition) = 0
    or position('pendingScanLockHeldThroughClaim' in v_definition) = 0
    or position('noScanExecutedBeforeClaim' in v_definition) = 0 then
    raise exception 'r5_revision4_prepared_head_memory_retry_source_drift';
  end if;

  v_patched := replace(v_definition, v_old_block, '');
  execute v_patched;

  select pg_get_functiondef(v_signature) into v_patched;

  if position('public.xrpl_claim_r5_memory_retry_batch(' in v_patched) <> 0
    or position('r5_recovery_memory_retry_claim_unexpected' in v_patched) <> 0
    or position('v_run.profile_revision <> 4' in v_patched) = 0
    or position('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(' in v_patched) = 0
    or position('public.xrpl_claim_r5_revision4_recovery_batch(' in v_patched) = 0
    or position('public.xrpl_adopt_r5_revision4_committed_active_descendants(' in v_patched) = 0
    or position('pendingScanLockHeldThroughClaim' in v_patched) = 0
    or position('noScanExecutedBeforeClaim' in v_patched) = 0 then
    raise exception 'r5_revision4_prepared_head_memory_retry_patch_invalid';
  end if;

  -- The revision-3 recovery path must retain its dedicated memory retry branch.
  select pg_get_functiondef(v_revision3_signature) into v_revision3_definition;
  if position('public.xrpl_claim_r5_memory_retry_batch(' in v_revision3_definition) = 0
    or position('v_run.profile_revision <> 3' in v_revision3_definition) = 0 then
    raise exception 'r5_revision3_memory_retry_contract_changed';
  end if;
end;
$patch$;

revoke all on function public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamptz,integer) to supabase_admin';
  end if;
end;
$$;
