create or replace function public.xrpl_ensure_remote_seven_class_epoch(
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stream public.xrpl_phase_streams%rowtype;
  v_message_id text;
  v_payload jsonb;
  v_message public.xrpl_phase_messages%rowtype;
  v_committed_count integer;
begin
  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet'
  for update;

  if not found then
    raise exception 'Supabase phase stream is unavailable';
  end if;
  if v_stream.epoch_id <> 'supabase-r4c2c-v1' then
    return jsonb_build_object(
      'ready', false,
      'reason', 'migration_not_applied',
      'epoch_id', v_stream.epoch_id
    );
  end if;

  select count(*)::integer into v_committed_count
  from public.xrpl_phase_work
  where profile_id = v_stream.profile_id
    and epoch_id = v_stream.epoch_id
    and status = 'committed';

  v_message_id := public.xrpl_phase_scan_message_id(
    v_stream.network,
    v_stream.epoch_id,
    v_stream.base_identity,
    v_stream.immutable_base_ledger_index,
    v_stream.immutable_base_ledger_hash,
    0
  );
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'scan',
    'messageId', v_message_id,
    'network', v_stream.network,
    'epochId', v_stream.epoch_id,
    'baseIdentity', v_stream.base_identity,
    'expectedPreviousLedgerIndex', v_stream.immutable_base_ledger_index,
    'expectedPreviousLedgerHash', v_stream.immutable_base_ledger_hash,
    'scanSequence', 0
  );

  if v_stream.status = 'halted' then
    if v_committed_count <> 0
      or exists (
        select 1
        from public.xrpl_phase_watermarks
        where profile_id = v_stream.profile_id
      )
      or v_stream.last_error_classification not in ('base_mismatch', 'epoch_mismatch')
      or coalesce(v_stream.last_error_message, '') not like '%R4C2b%' then
      return jsonb_build_object(
        'ready', false,
        'reason', 'terminal_halt',
        'classification', v_stream.last_error_classification,
        'message', v_stream.last_error_message
      );
    end if;

    select * into v_message
    from public.xrpl_phase_messages
    where message_id = v_message_id
    for update;
    if not found or v_message.payload <> v_payload then
      raise exception 'seven-class initial scan identity is unavailable';
    end if;
    if v_message.status <> 'error'
      or v_message.error_classification not in ('base_mismatch', 'epoch_mismatch') then
      raise exception 'seven-class deployment-race message is not recoverable';
    end if;

    update public.xrpl_phase_messages
    set
      status = 'pending',
      available_at = p_now,
      lease_owner = null,
      lease_expires_at = null,
      result = null,
      successor_message_id = null,
      error_classification = null,
      error_message = null,
      completed_at = null,
      updated_at = p_now
    where message_id = v_message_id;

    update public.xrpl_phase_streams
    set
      status = 'active',
      last_error_classification = null,
      last_error_message = null,
      updated_at = p_now
    where profile_id = v_stream.profile_id;

    return jsonb_build_object(
      'ready', true,
      'recovered', true,
      'epoch_id', v_stream.epoch_id,
      'message_id', v_message_id
    );
  end if;

  if v_stream.status <> 'active' then
    return jsonb_build_object('ready', false, 'reason', 'invalid_stream_status');
  end if;

  if v_committed_count = 0
    and not exists (
      select 1
      from public.xrpl_phase_watermarks
      where profile_id = v_stream.profile_id
    ) then
    perform public.xrpl_phase_insert_message(
      v_stream.profile_id,
      'scan',
      v_message_id,
      v_payload,
      p_now,
      p_now
    );
  end if;

  return jsonb_build_object(
    'ready', true,
    'recovered', false,
    'epoch_id', v_stream.epoch_id
  );
end;
$$;

revoke all on function public.xrpl_ensure_remote_seven_class_epoch(timestamptz)
  from public;
grant execute on function public.xrpl_ensure_remote_seven_class_epoch(timestamptz)
  to service_role;
