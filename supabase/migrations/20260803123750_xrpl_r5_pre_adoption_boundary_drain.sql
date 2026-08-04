do $$
declare
  v_boundary jsonb;
  v_step_count integer;
begin
  if exists (
    select 1
    from xrpl_r5_v1.recovery_runs
    where run_id = 'r5-recovery-selected-revision3-entry'
      and status = 'running'
  ) then
    v_boundary := public.xrpl_drain_r5_checkpoint_boundary(
      'r5-pre-adoption-drain',
      clock_timestamp()
    );

    v_step_count := (v_boundary->>'drainedStepCount')::integer;
    if coalesce((v_boundary->>'drained')::boolean, false) is not true
      or v_step_count < 0
      or v_step_count > 256
      or coalesce((v_boundary->'checks'->>'collectorQuiescent')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'activeStreamHealthy')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'onlyExistingCommitOrFinalizeDrained')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'noScanExecuted')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'onePendingScan')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'pendingScanBoundToWatermark')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'noInflightWork')::boolean, false) is not true
      or v_boundary->>'sourceProfileId' <> 'supabase-devnet'
      or v_boundary->>'network' <> 'devnet'
      or v_boundary->>'epochId' <> 'supabase-r4c2c-v1' then
      raise exception 'r5_pre_adoption_boundary_drain_invalid';
    end if;
  end if;
end;
$$;
