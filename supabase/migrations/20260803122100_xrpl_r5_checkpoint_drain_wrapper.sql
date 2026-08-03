alter function public.xrpl_create_r5_active_checkpoint(text, timestamptz)
  rename to xrpl_create_r5_active_checkpoint_strict;

create function public.xrpl_create_r5_active_checkpoint(
  p_checkpoint_id text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner text;
  v_drain jsonb;
  v_checkpoint jsonb;
  v_checkpoint_at timestamptz;
begin
  if p_checkpoint_id !~ '^r5-checkpoint-[a-z0-9][a-z0-9-]{7,79}$'
    or p_observed_at is null then
    raise exception 'r5_checkpoint_invalid_identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0));

  v_owner := concat(
    'r5-checkpoint-drain-',
    substr(encode(extensions.digest(convert_to(p_checkpoint_id, 'UTF8'), 'sha256'), 'hex'), 1, 24)
  );
  v_drain := public.xrpl_drain_r5_checkpoint_boundary(v_owner, p_observed_at);
  if coalesce((v_drain->>'drained')::boolean, false) is not true
    or v_drain->>'purpose' <> 'r5-checkpoint-boundary-drain'
    or coalesce((v_drain #>> '{checks,pendingScanBoundToWatermark}')::boolean, false)
      is not true
    or coalesce((v_drain #>> '{checks,noInflightWork}')::boolean, false)
      is not true
    or coalesce((v_drain #>> '{checks,noScanExecuted}')::boolean, false)
      is not true then
    raise exception 'r5_checkpoint_boundary_drain_unqualified';
  end if;

  v_checkpoint_at := p_observed_at
    + make_interval(secs => coalesce((v_drain->>'drainedStepCount')::integer, 0) + 1);
  v_checkpoint := public.xrpl_create_r5_active_checkpoint_strict(
    p_checkpoint_id,
    v_checkpoint_at
  );

  return v_checkpoint || jsonb_build_object(
    'boundaryDrain', jsonb_build_object(
      'schemaVersion', v_drain->'schemaVersion',
      'purpose', v_drain->'purpose',
      'drainedStepCount', v_drain->'drainedStepCount',
      'drainedPhases', v_drain->'drainedPhases',
      'watermarkBefore', v_drain->'watermarkBefore',
      'watermarkAfter', v_drain->'watermarkAfter',
      'pendingScan', v_drain->'pendingScan',
      'checks', v_drain->'checks'
    )
  );
end;
$$;

revoke all on function public.xrpl_create_r5_active_checkpoint(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.xrpl_create_r5_active_checkpoint(text, timestamptz)
  to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_create_r5_active_checkpoint(text, timestamptz) to supabase_admin';
  end if;
end;
$$;
