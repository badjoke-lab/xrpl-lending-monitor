create or replace function public.xrpl_claim_remote_fault_message(
  p_message_id text,
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_fault_v1, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet-fault-qualification';
  v_stream xrpl_fault_v1.xrpl_phase_streams%rowtype;
  v_message xrpl_fault_v1.xrpl_phase_messages%rowtype;
  v_previous_status text;
  v_previous_owner text;
  v_previous_expiry timestamptz;
  v_effective_lease_seconds integer;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200 then
    raise exception 'invalid fault qualification owner';
  end if;
  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid fault qualification lease duration';
  end if;

  select * into v_stream
  from xrpl_fault_v1.xrpl_phase_streams
  where profile_id = v_profile_id
  for update;

  if not found then
    raise exception 'fault qualification stream is unavailable';
  end if;
  if v_stream.status = 'halted' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'stream_halted',
      'messageId', p_message_id,
      'classification', v_stream.last_error_classification
    );
  end if;

  select * into v_message
  from xrpl_fault_v1.xrpl_phase_messages
  where message_id = p_message_id
    and profile_id = v_profile_id
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'message_not_found');
  end if;
  if v_message.status in ('completed', 'error') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'terminal_message_state',
      'status', v_message.status,
      'messageId', p_message_id
    );
  end if;
  if v_message.status = 'leased' and v_message.lease_expires_at > p_now then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'lease_active',
      'messageId', p_message_id,
      'leaseOwner', v_message.lease_owner,
      'leaseExpiresAt', v_message.lease_expires_at
    );
  end if;
  if v_message.status in ('pending', 'retry') and v_message.available_at > p_now then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'not_ready',
      'messageId', p_message_id,
      'availableAt', v_message.available_at
    );
  end if;

  v_previous_status := v_message.status;
  v_previous_owner := v_message.lease_owner;
  v_previous_expiry := v_message.lease_expires_at;
  v_effective_lease_seconds := case
    when v_message.payload->>'scenario' = 'stale' then p_lease_seconds
    else 300
  end;

  update xrpl_fault_v1.xrpl_phase_messages
  set
    status = 'leased',
    attempt_count = attempt_count + 1,
    lease_owner = p_owner,
    lease_expires_at = p_now + make_interval(secs => v_effective_lease_seconds),
    error_classification = null,
    error_message = null,
    updated_at = p_now
  where message_id = p_message_id
  returning * into v_message;

  return jsonb_build_object(
    'claimed', true,
    'messageId', v_message.message_id,
    'scenario', v_message.payload->>'scenario',
    'attemptCount', v_message.attempt_count,
    'leaseOwner', v_message.lease_owner,
    'leaseExpiresAt', v_message.lease_expires_at,
    'effectiveLeaseSeconds', v_effective_lease_seconds,
    'reclaimed', v_previous_status = 'leased',
    'previousLeaseOwner', v_previous_owner,
    'previousLeaseExpiresAt', v_previous_expiry
  );
end;
$$;

revoke all on function public.xrpl_claim_remote_fault_message(text, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.xrpl_claim_remote_fault_message(text, text, timestamptz, integer)
  to service_role;
