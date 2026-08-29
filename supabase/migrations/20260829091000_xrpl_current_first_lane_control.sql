-- Control helpers for the current-first lane. These functions are service-role
-- only and do not advance either the current or history watermark.

create or replace function public.xrpl_read_current_first_state()
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_current_v1, pg_temp
as $$
declare
  v_state xrpl_current_v1.state%rowtype;
begin
  select * into v_state
  from xrpl_current_v1.state
  where profile_id = 'supabase-current-devnet';

  if not found then
    return jsonb_build_object('available', false, 'reason', 'not_prepared');
  end if;

  return jsonb_build_object(
    'available', true,
    'profileId', v_state.profile_id,
    'network', v_state.network,
    'epochId', v_state.epoch_id,
    'baseIdentity', v_state.base_identity,
    'ledgerIndex', v_state.ledger_index,
    'ledgerHash', v_state.ledger_hash,
    'historyCompleteThroughLedger', v_state.history_complete_through_ledger,
    'historyDeferredFromLedger', v_state.history_deferred_from_ledger,
    'historyDeferredThroughLedger', v_state.history_deferred_through_ledger,
    'historyDeferredLedgers', v_state.history_deferred_ledgers,
    'historyDeferredRecords', v_state.history_deferred_records,
    'status', v_state.status,
    'leased', v_state.lease_owner is not null
      and v_state.lease_expires_at is not null
      and v_state.lease_expires_at > now(),
    'updatedAt', v_state.updated_at
  );
end;
$$;

create or replace function public.xrpl_release_current_first_lane(
  p_owner text,
  p_released_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_current_v1, pg_temp
as $$
declare
  v_state xrpl_current_v1.state%rowtype;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_released_at is null then
    raise exception 'current_first_release_invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-current-first-lane', 0));
  select * into v_state
  from xrpl_current_v1.state
  where profile_id = 'supabase-current-devnet'
  for update;

  if not found or v_state.lease_owner is distinct from p_owner then
    raise exception 'current_first_release_lease_invalid';
  end if;

  update xrpl_current_v1.state
  set lease_owner = null,
      lease_expires_at = null,
      updated_at = p_released_at
  where profile_id = 'supabase-current-devnet'
  returning * into v_state;

  return jsonb_build_object(
    'released', true,
    'ledgerIndex', v_state.ledger_index,
    'ledgerHash', v_state.ledger_hash
  );
end;
$$;

revoke all on function public.xrpl_read_current_first_state()
  from public, anon, authenticated;
revoke all on function public.xrpl_release_current_first_lane(text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.xrpl_read_current_first_state()
  to service_role;
grant execute on function public.xrpl_release_current_first_lane(text, timestamptz)
  to service_role;
