create or replace function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  p_run_id text,
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer default 55
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_claim jsonb;
  v_projected_invocations bigint;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_now is null
    or p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'r5_recovery_prepared_head_claim_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_run.profile_revision <> 3
    or v_run.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_run.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_run.source_profile_id <> 'supabase-devnet'
    or v_run.network <> 'devnet'
    or v_run.epoch_id <> 'supabase-r4c2c-v1'
    or v_run.batch_size <> 24 then
    raise exception 'r5_recovery_prepared_head_run_invalid';
  end if;

  if v_run.status = 'caught_up' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'recovery_already_caught_up',
      'runId', v_run.run_id,
      'watermarkLedgerIndex', v_run.current_watermark_ledger_index
    );
  end if;
  if v_run.status = 'halted' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'recovery_halted',
      'runId', v_run.run_id,
      'error', v_run.last_error
    );
  end if;
  if v_run.status not in ('prepared', 'running') then
    raise exception 'r5_recovery_prepared_head_run_not_claimable';
  end if;

  if v_run.current_watermark_ledger_index
      >= v_run.initial_validated_head_ledger_index then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'fresh_head_refresh_required',
      'runId', v_run.run_id,
      'watermarkLedgerIndex', v_run.current_watermark_ledger_index,
      'retainedValidatedHeadLedgerIndex',
        v_run.initial_validated_head_ledger_index,
      'activeRecoveryStarted', v_run.status = 'running',
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationNotStarted', true,
      'soakNotStarted', true
    );
  end if;

  v_claim := public.xrpl_claim_r5_active_recovery_batch(
    p_run_id,
    p_owner,
    v_run.initial_validated_head_ledger_index,
    v_run.initial_validated_head_ledger_hash,
    p_now,
    p_lease_seconds
  );

  if coalesce((v_claim->>'claimed')::boolean, false) is not true then
    return v_claim || jsonb_build_object(
      'retainedPreparedHeadUsed', true,
      'networkReadOccurredBeforeReservation', false
    );
  end if;

  v_projected_invocations := (v_claim->>'projectedInvocations31d')::bigint;
  if v_projected_invocations <= 0 then
    raise exception 'r5_recovery_prepared_head_invocation_context_invalid';
  end if;

  return v_claim || jsonb_build_object(
    'network', v_run.network,
    'epochId', v_run.epoch_id,
    'baseIdentity', v_run.base_identity,
    'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
    'currentWatermarkLedgerHash', v_run.current_watermark_ledger_hash,
    'currentWatermarkWorkId', v_run.current_watermark_work_id,
    'priorInvocations31d', v_projected_invocations - 1,
    'retainedPreparedHeadUsed', true,
    'retainedValidatedHeadLedgerIndex',
      v_run.initial_validated_head_ledger_index,
    'retainedValidatedHeadLedgerHash',
      v_run.initial_validated_head_ledger_hash,
    'reservationBeforeAnyNetworkRead', true,
    'freshHeadMustCoverReservedEndBeforeFetch', true
  );
end;
$$;

revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) from public, anon, authenticated;

grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text, text, timestamptz, integer) to supabase_admin';
  end if;
end;
$$;
