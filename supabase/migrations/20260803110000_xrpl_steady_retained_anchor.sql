create or replace function public.xrpl_prepare_network_steady_session(
  p_session_id text,
  p_prepared_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, pg_temp
as $$
declare
  v_stream public.xrpl_phase_streams%rowtype;
  v_active_watermark public.xrpl_phase_watermarks%rowtype;
  v_anchor public.xrpl_phase_work%rowtype;
  v_target public.xrpl_phase_work%rowtype;
  v_retained_count integer;
  v_single_ledger_window boolean;
  v_contiguous_window boolean;
begin
  if p_session_id !~ '^[a-z0-9][a-z0-9-]{7,79}$' then
    raise exception 'invalid steady session id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-network-steady', 0));

  if exists (select 1 from xrpl_steady_v1.sessions where status = 'running') then
    raise exception 'another steady qualification session is already running';
  end if;
  if exists (select 1 from xrpl_steady_v1.sessions where session_id = p_session_id) then
    raise exception 'steady qualification session already exists';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'active Supabase Devnet stream is unavailable';
  end if;

  select * into v_active_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found
    or v_active_watermark.epoch_id <> v_stream.epoch_id
    or v_active_watermark.base_identity <> v_stream.base_identity then
    raise exception 'active Supabase Devnet watermark is unavailable or changed identity';
  end if;

  with latest as (
    select work.*
    from public.xrpl_phase_work as work
    where work.profile_id = 'supabase-devnet'
      and work.epoch_id = 'supabase-r4c2c-v1'
      and work.status = 'committed'
      and work.start_ledger_index <= v_active_watermark.ledger_index
    order by work.start_ledger_index desc, work.work_id desc
    limit 145
  ), ordered as (
    select
      row_number() over (order by latest.start_ledger_index, latest.work_id)::integer as ordinal,
      latest.*,
      lag(latest.scanned_end_ledger_index) over (
        order by latest.start_ledger_index, latest.work_id
      ) as prior_end_ledger_index,
      lag(latest.final_ledger_hash) over (
        order by latest.start_ledger_index, latest.work_id
      ) as prior_final_ledger_hash
    from latest
  )
  select
    count(*)::integer,
    coalesce(bool_and(
      ordered.start_ledger_index = ordered.previous_ledger_index + 1
      and ordered.scanned_end_ledger_index = ordered.start_ledger_index
    ), false),
    coalesce(bool_and(
      ordered.ordinal = 1
      or (
        ordered.previous_ledger_index = ordered.prior_end_ledger_index
        and ordered.start_ledger_index = ordered.prior_end_ledger_index + 1
        and ordered.expected_parent_hash = ordered.prior_final_ledger_hash
      )
    ), false)
  into v_retained_count, v_single_ledger_window, v_contiguous_window
  from ordered;

  if v_retained_count <> 145 then
    raise exception 'steady retained source window is incomplete';
  end if;
  if not v_single_ledger_window or not v_contiguous_window then
    raise exception 'steady retained source window is not a contiguous one-ledger chain';
  end if;

  with latest as (
    select work.*
    from public.xrpl_phase_work as work
    where work.profile_id = 'supabase-devnet'
      and work.epoch_id = 'supabase-r4c2c-v1'
      and work.status = 'committed'
      and work.start_ledger_index <= v_active_watermark.ledger_index
    order by work.start_ledger_index desc, work.work_id desc
    limit 145
  )
  select * into v_anchor
  from latest
  order by start_ledger_index, work_id
  limit 1;

  with latest as (
    select work.*
    from public.xrpl_phase_work as work
    where work.profile_id = 'supabase-devnet'
      and work.epoch_id = 'supabase-r4c2c-v1'
      and work.status = 'committed'
      and work.start_ledger_index <= v_active_watermark.ledger_index
    order by work.start_ledger_index desc, work.work_id desc
    limit 145
  )
  select * into v_target
  from latest
  order by start_ledger_index desc, work_id desc
  limit 1;

  if v_target.work_id <> v_active_watermark.work_id
    or v_target.scanned_end_ledger_index <> v_active_watermark.ledger_index
    or v_target.final_ledger_hash <> v_active_watermark.ledger_hash then
    raise exception 'steady retained source window is not bound to the captured active watermark';
  end if;

  if v_target.scanned_end_ledger_index <> v_anchor.scanned_end_ledger_index + 144 then
    raise exception 'steady retained source window does not contain an exact 144-ledger target';
  end if;

  insert into xrpl_steady_v1.sessions (
    session_id, source_profile_id, target_profile_id, network, epoch_id,
    base_identity, status, target_ticks, batch_size,
    anchor_ledger_index, anchor_ledger_hash, anchor_work_id,
    anchor_epoch_id, anchor_base_identity,
    watermark_ledger_index, watermark_ledger_hash, watermark_work_id,
    prepared_at, updated_at
  ) values (
    p_session_id, 'supabase-devnet', 'supabase-devnet-steady-qualification',
    'devnet', 'supabase-r4c2c-v1', concat('steady-', p_session_id),
    'running', 6, 24,
    v_anchor.scanned_end_ledger_index, v_anchor.final_ledger_hash, v_anchor.work_id,
    v_stream.epoch_id, v_stream.base_identity,
    v_anchor.scanned_end_ledger_index, v_anchor.final_ledger_hash, v_anchor.work_id,
    p_prepared_at, p_prepared_at
  );

  return jsonb_build_object(
    'prepared', true,
    'sessionId', p_session_id,
    'targetTicks', 6,
    'batchSize', 24,
    'sourceMode', 'retained-contiguous-network-replay',
    'retainedWorkCount', v_retained_count,
    'anchor', jsonb_build_object(
      'ledgerIndex', v_anchor.scanned_end_ledger_index,
      'ledgerHash', v_anchor.final_ledger_hash,
      'workId', v_anchor.work_id,
      'epochId', v_stream.epoch_id,
      'baseIdentity', v_stream.base_identity
    ),
    'capturedActiveWatermark', jsonb_build_object(
      'ledgerIndex', v_active_watermark.ledger_index,
      'ledgerHash', v_active_watermark.ledger_hash,
      'workId', v_active_watermark.work_id,
      'epochId', v_active_watermark.epoch_id,
      'baseIdentity', v_active_watermark.base_identity
    ),
    'target', jsonb_build_object(
      'ledgerIndex', v_target.scanned_end_ledger_index,
      'ledgerHash', v_target.final_ledger_hash,
      'workId', v_target.work_id
    ),
    'checks', jsonb_build_object(
      'exact145RetainedWorks', v_retained_count = 145,
      'singleLedgerWorks', v_single_ledger_window,
      'contiguousHashLinkedWindow', v_contiguous_window,
      'exact144LedgerAdvance',
        v_target.scanned_end_ledger_index = v_anchor.scanned_end_ledger_index + 144,
      'targetBoundToCapturedActiveWatermark', true,
      'activeSourceIdentityPreserved', true,
      'activeProfileReadOnly', true
    )
  );
end;
$$;

revoke all on function public.xrpl_prepare_network_steady_session(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.xrpl_prepare_network_steady_session(text, timestamptz)
  to service_role;
