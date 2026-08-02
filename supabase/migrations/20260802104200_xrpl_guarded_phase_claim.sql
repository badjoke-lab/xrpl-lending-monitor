create or replace function public.xrpl_claim_next_phase(
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_epoch jsonb;
  v_message public.xrpl_phase_messages%rowtype;
  v_previous_owner text;
  v_previous_expiry timestamptz;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200 then
    raise exception 'invalid phase owner';
  end if;
  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid phase lease duration';
  end if;

  v_epoch := public.xrpl_ensure_remote_seven_class_epoch(p_now);
  if coalesce((v_epoch->>'ready')::boolean, false) is not true then
    return jsonb_build_object(
      'claimed', false,
      'reason', coalesce(v_epoch->>'reason', 'seven_class_epoch_not_ready'),
      'activation', v_epoch
    );
  end if;

  select * into v_message
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet'
    and (
      (status in ('pending', 'retry') and available_at <= p_now)
      or (status = 'leased' and lease_expires_at <= p_now)
    )
  order by available_at, created_at, message_id
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'no_ready_message',
      'activation', v_epoch
    );
  end if;

  v_previous_owner := v_message.lease_owner;
  v_previous_expiry := v_message.lease_expires_at;

  update public.xrpl_phase_messages
  set
    status = 'leased',
    lease_owner = p_owner,
    lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1,
    updated_at = p_now
  where message_id = v_message.message_id
  returning * into v_message;

  return jsonb_build_object(
    'claimed', true,
    'reclaimed', v_previous_owner is not null,
    'previous_lease_owner', v_previous_owner,
    'previous_lease_expires_at', v_previous_expiry,
    'message_id', v_message.message_id,
    'phase', v_message.phase,
    'payload', v_message.payload,
    'attempt_count', v_message.attempt_count,
    'lease_expires_at', v_message.lease_expires_at,
    'activation', v_epoch
  );
end;
$$;

revoke all on function public.xrpl_claim_next_phase(text, timestamptz, integer)
  from public;
grant execute on function public.xrpl_claim_next_phase(text, timestamptz, integer)
  to service_role;
