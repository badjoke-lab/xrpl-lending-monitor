alter function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
  text,
  timestamptz
) rename to xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict;

create or replace function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
  p_run_id text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_drain jsonb;
  v_rebind jsonb;
  v_drained_step_count integer;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_now is null then
    raise exception 'r5_recovery_prebatch_rebind_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  v_drain := public.xrpl_drain_r5_checkpoint_boundary(
    'r5-prebatch-rebind',
    p_now
  );

  v_drained_step_count := (v_drain->>'drainedStepCount')::integer;
  if coalesce((v_drain->>'drained')::boolean, false) is not true
    or v_drained_step_count < 0
    or v_drained_step_count > 256
    or coalesce((v_drain->'checks'->>'collectorQuiescent')::boolean, false) is not true
    or coalesce((v_drain->'checks'->>'activeStreamHealthy')::boolean, false) is not true
    or coalesce((v_drain->'checks'->>'onlyExistingCommitOrFinalizeDrained')::boolean, false) is not true
    or coalesce((v_drain->'checks'->>'noScanExecuted')::boolean, false) is not true
    or coalesce((v_drain->'checks'->>'onePendingScan')::boolean, false) is not true
    or coalesce((v_drain->'checks'->>'pendingScanBoundToWatermark')::boolean, false) is not true
    or coalesce((v_drain->'checks'->>'noInflightWork')::boolean, false) is not true
    or coalesce((v_drain->'checks'->>'watermarkIdentityPreserved')::boolean, false) is not true then
    raise exception 'r5_recovery_prebatch_boundary_drain_invalid';
  end if;

  v_rebind := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(
    p_run_id,
    p_now + make_interval(secs => v_drained_step_count + 1)
  );

  return v_rebind || jsonb_build_object(
    'prebatchBoundaryDrain', v_drain,
    'boundaryDrainBeforeRebind', true,
    'onlyExistingCommitOrFinalizeDrained', true,
    'noScanExecutedBeforeRebind', true
  );
end;
$$;

revoke all on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(
  text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
  text, timestamptz
) from public, anon, authenticated;

grant execute on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(
  text, timestamptz
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'revoke all on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(text, timestamptz) from supabase_admin';
    execute 'grant execute on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(text, timestamptz) to supabase_admin';
  end if;
end;
$$;
