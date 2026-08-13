-- Follow-up for the already-applied 20260813060000 continuous-head migration.
--
-- The base migration is immutable. This follow-up adds the missing zero-progress
-- active-boundary rebind needed to switch from the still-running legacy minute
-- collector to revision-4 R5 without skipping any ledger or deleting history.
-- Resource guards remain unchanged and fail closed.

create or replace function public.xrpl_refresh_r5_revision4_continuous_head(
  p_run_id text,
  p_validated_head_ledger_index bigint,
  p_validated_head_ledger_hash text,
  p_refreshed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, xrpl_resource_guard_v1, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_runtime public.xrpl_collector_runtime%rowtype;
  v_leased_batches integer;
  v_total_batches bigint;
  v_snapshot_projection bigint;
  v_snapshot_observed_at timestamptz;
  v_rearmed boolean := false;
  v_reopened boolean := false;
  v_rebound boolean := false;
  v_rebind jsonb := null;
  v_status text;
  v_invocation_halt constant bigint := 400000;
begin
  if p_run_id <> 'r5-recovery-selected-revision4-entry'
    or p_validated_head_ledger_index <= 0
    or p_validated_head_ledger_hash !~ '^[A-F0-9]{64}$'
    or p_refreshed_at is null then
    raise exception 'r5_revision4_continuous_head_invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_run.profile_revision <> 4
    or v_run.profile_identity_digest <>
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
    or v_run.selection_digest !~ '^[a-f0-9]{64}$'
    or v_run.source_profile_id <> 'supabase-devnet'
    or v_run.network <> 'devnet'
    or v_run.epoch_id <> 'supabase-r4c2c-v1'
    or v_run.status not in ('prepared', 'running', 'caught_up', 'halted') then
    raise exception 'r5_revision4_continuous_head_run_invalid';
  end if;

  select * into v_runtime
  from public.xrpl_collector_runtime
  where profile_id = 'supabase-devnet';

  if not found
    or v_runtime.network <> 'devnet'
    or v_runtime.status <> 'stopped'
    or v_runtime.lease_owner is not null
    or v_runtime.lease_expires_at is not null
    or v_runtime.last_error is not null
    or v_runtime.consecutive_failures <> 0 then
    raise exception 'r5_revision4_continuous_head_collector_not_quiescent';
  end if;

  select
    count(*)::bigint,
    count(*) filter (
      where status = 'leased' and lease_expires_at > p_refreshed_at
    )::integer
  into v_total_batches, v_leased_batches
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id;

  if v_leased_batches <> 0 then
    raise exception 'r5_revision4_continuous_head_batch_lease_active';
  end if;

  if v_run.status = 'halted' then
    if v_run.last_error <> 'r5_recovery_monthly_invocation_halt' then
      return jsonb_build_object(
        'refreshed', false,
        'reason', 'non_invocation_halt_requires_operator',
        'runId', v_run.run_id,
        'error', v_run.last_error
      );
    end if;

    if v_total_batches <> 0
      or v_run.completed_batches <> 0
      or v_run.committed_ledgers <> 0
      or v_run.last_accounting_digest is not null then
      return jsonb_build_object(
        'refreshed', false,
        'reason', 'invocation_halt_contains_recovery_progress',
        'runId', v_run.run_id
      );
    end if;

    select projected_invocations_31d, observed_at
    into v_snapshot_projection, v_snapshot_observed_at
    from xrpl_resource_guard_v1.external_snapshots
    order by observed_at desc, snapshot_id desc
    limit 1;

    if v_snapshot_projection is null
      or v_snapshot_observed_at is null
      or v_snapshot_observed_at < p_refreshed_at - interval '25 hours' then
      return jsonb_build_object(
        'refreshed', false,
        'reason', 'provider_snapshot_stale',
        'runId', v_run.run_id
      );
    end if;

    if v_snapshot_projection >= v_invocation_halt then
      return jsonb_build_object(
        'refreshed', false,
        'reason', 'monthly_invocation_halt',
        'runId', v_run.run_id,
        'providerProjectedInvocations31d', v_snapshot_projection
      );
    end if;

    update xrpl_r5_v1.recovery_runs
    set status = 'prepared',
        started_at = null,
        completed_at = null,
        last_error = null,
        updated_at = p_refreshed_at
    where run_id = v_run.run_id;
    v_rearmed := true;

    select * into v_run
    from xrpl_r5_v1.recovery_runs
    where run_id = p_run_id
    for update;
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';

  if not found
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity then
    raise exception 'r5_revision4_continuous_head_watermark_identity_invalid';
  end if;

  if v_watermark.ledger_index < v_run.current_watermark_ledger_index then
    raise exception 'r5_revision4_continuous_head_watermark_regression';
  end if;

  if v_watermark.ledger_index = v_run.current_watermark_ledger_index then
    if v_watermark.ledger_hash <> v_run.current_watermark_ledger_hash
      or v_watermark.work_id <> v_run.current_watermark_work_id then
      raise exception 'r5_revision4_continuous_head_same_ledger_identity_conflict';
    end if;
  else
    if v_run.status <> 'prepared'
      or v_total_batches <> 0
      or v_run.completed_batches <> 0
      or v_run.committed_ledgers <> 0
      or v_run.last_accounting_digest is not null
      or v_run.last_error is not null
      or v_run.started_at is not null
      or v_run.completed_at is not null then
      return jsonb_build_object(
        'refreshed', false,
        'reason', 'active_boundary_drift_requires_operator',
        'runId', v_run.run_id,
        'retainedWatermarkLedgerIndex', v_run.current_watermark_ledger_index,
        'activeWatermarkLedgerIndex', v_watermark.ledger_index
      );
    end if;

    v_rebind := public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(
      p_run_id,
      p_refreshed_at
    );
    v_rebound := true;

    select * into v_run
    from xrpl_r5_v1.recovery_runs
    where run_id = p_run_id
    for update;
    select * into v_watermark
    from public.xrpl_phase_watermarks
    where profile_id = 'supabase-devnet';

    if not found
      or v_run.current_watermark_ledger_index <> v_watermark.ledger_index
      or v_run.current_watermark_ledger_hash <> v_watermark.ledger_hash
      or v_run.current_watermark_work_id <> v_watermark.work_id then
      raise exception 'r5_revision4_continuous_head_rebind_not_exact';
    end if;
  end if;

  if p_validated_head_ledger_index < v_watermark.ledger_index then
    raise exception 'r5_revision4_continuous_head_behind_watermark';
  end if;
  if p_validated_head_ledger_index = v_watermark.ledger_index
    and p_validated_head_ledger_hash <> v_watermark.ledger_hash then
    raise exception 'r5_revision4_continuous_head_hash_conflict';
  end if;

  if v_run.status = 'caught_up' then
    if p_validated_head_ledger_index = v_watermark.ledger_index then
      return jsonb_build_object(
        'refreshed', true,
        'reason', 'already_at_fresh_head',
        'runId', v_run.run_id,
        'status', 'caught_up',
        'workAvailable', false,
        'watermarkLedgerIndex', v_watermark.ledger_index,
        'validatedHeadLedgerIndex', p_validated_head_ledger_index,
        'prebatchRebound', v_rebound,
        'prebatchRebind', v_rebind,
        'claimResourceGuardsStillRequired', true,
        'publicReaderUnchanged', true,
        'mainnetDisabled', true
      );
    end if;

    v_status := 'running';
    update xrpl_r5_v1.recovery_runs
    set status = 'running',
        completed_at = null,
        initial_validated_head_ledger_index = p_validated_head_ledger_index,
        initial_validated_head_ledger_hash = p_validated_head_ledger_hash,
        last_error = null,
        updated_at = p_refreshed_at
    where run_id = v_run.run_id;
    v_reopened := true;
  else
    v_status := v_run.status;
    update xrpl_r5_v1.recovery_runs
    set initial_validated_head_ledger_index = p_validated_head_ledger_index,
        initial_validated_head_ledger_hash = p_validated_head_ledger_hash,
        updated_at = p_refreshed_at
    where run_id = v_run.run_id;
  end if;

  return jsonb_build_object(
    'refreshed', true,
    'reason', case
      when v_rearmed and v_rebound then 'invocation_halt_rearmed_and_active_boundary_rebound'
      when v_rearmed then 'invocation_halt_rearmed_after_fresh_snapshot'
      when v_rebound then 'active_boundary_rebound'
      when v_reopened then 'caught_up_run_reopened_for_new_head'
      else 'validated_head_refreshed'
    end,
    'runId', v_run.run_id,
    'status', v_status,
    'workAvailable', p_validated_head_ledger_index > v_watermark.ledger_index,
    'watermarkLedgerIndex', v_watermark.ledger_index,
    'watermarkLedgerHash', v_watermark.ledger_hash,
    'validatedHeadLedgerIndex', p_validated_head_ledger_index,
    'validatedHeadLedgerHash', p_validated_head_ledger_hash,
    'lagLedgers', p_validated_head_ledger_index - v_watermark.ledger_index,
    'rearmedAfterFreshInvocationSnapshot', v_rearmed,
    'prebatchRebound', v_rebound,
    'prebatchRebind', v_rebind,
    'reopenedAfterCaughtUp', v_reopened,
    'claimResourceGuardsStillRequired', true,
    'publicReaderUnchanged', true,
    'mainnetDisabled', true
  );
end;
$$;

revoke all on function public.xrpl_refresh_r5_revision4_continuous_head(
  text, bigint, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.xrpl_refresh_r5_revision4_continuous_head(
  text, bigint, text, timestamptz
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_refresh_r5_revision4_continuous_head(text,bigint,text,timestamp with time zone) to supabase_admin';
  end if;
end;
$$;