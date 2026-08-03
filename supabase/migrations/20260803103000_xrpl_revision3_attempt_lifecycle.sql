create table if not exists xrpl_resource_guard_v2.attempts (
  session_id text not null,
  attempt_id text not null,
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null check (profile_id = 'supabase_free_postgres_pgcron_edge'),
  profile_revision integer not null check (profile_revision = 3),
  profile_identity_digest text not null check (
    profile_identity_digest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
  ),
  scheduled_minute timestamptz not null,
  status text not null check (status in ('open', 'succeeded', 'failed', 'deferred')),
  reserved_egress_upper_bound_bytes bigint not null check (
    reserved_egress_upper_bound_bytes = 134217728
  ),
  finalized_egress_upper_bound_bytes bigint check (
    finalized_egress_upper_bound_bytes is null
    or finalized_egress_upper_bound_bytes >= 0
  ),
  accounting_digest text check (
    accounting_digest is null or accounting_digest ~ '^[a-f0-9]{64}$'
  ),
  tick_id text,
  error_message text,
  started_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_id, attempt_id),
  unique (session_id, scheduled_minute),
  foreign key (session_id)
    references xrpl_steady_v1.sessions(session_id)
    on delete cascade,
  constraint xrpl_revision3_attempt_finalization check (
    (status = 'open'
      and finalized_egress_upper_bound_bytes is null
      and finalized_at is null)
    or
    (status = 'succeeded'
      and finalized_egress_upper_bound_bytes is not null
      and finalized_egress_upper_bound_bytes < 33554432
      and accounting_digest is not null
      and tick_id is not null
      and finalized_at is not null)
    or
    (status in ('failed', 'deferred')
      and finalized_at is not null)
  )
);

create index if not exists xrpl_revision3_attempts_started_idx
  on xrpl_resource_guard_v2.attempts (started_at desc);

revoke all on table xrpl_resource_guard_v2.attempts
  from public, anon, authenticated;

create or replace function xrpl_resource_guard_v2.attempt_effective_egress(
  p_status text,
  p_reserved bigint,
  p_finalized bigint
)
returns bigint
language sql
immutable
strict
as $$
  select case
    when p_status = 'succeeded' then p_finalized
    else p_reserved
  end;
$$;

create or replace function public.xrpl_begin_revision3_attempt(
  p_session_id text,
  p_attempt_id text,
  p_scheduled_at timestamptz,
  p_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_session xrpl_steady_v1.sessions%rowtype;
  v_existing xrpl_resource_guard_v2.attempts%rowtype;
  v_scheduled_minute timestamptz;
  v_attempt_egress bigint;
  v_legacy_egress bigint;
  v_prior_egress bigint;
  v_attempt_count bigint;
  v_provider_invocations bigint;
  v_provider_observed_at timestamptz;
  v_prior_invocations bigint;
  v_projected_invocations bigint;
  v_reserved constant bigint := 134217728;
  v_egress_halt constant bigint := 4294967296;
  v_invocation_halt constant bigint := 400000;
begin
  if p_session_id !~ '^[a-z0-9][a-z0-9-]{7,79}$'
    or p_attempt_id !~ '^[a-z0-9][a-z0-9:-]{7,159}$'
    or p_scheduled_at is null
    or p_started_at is null then
    raise exception 'invalid revision-3 attempt identity';
  end if;

  v_scheduled_minute := date_trunc('minute', p_scheduled_at);
  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c3-attempt-' || p_session_id, 0));

  select * into v_session
  from xrpl_steady_v1.sessions
  where session_id = p_session_id
  for update;

  if not found
    or v_session.status <> 'running'
    or not v_session.resource_guard_enabled then
    raise exception 'revision-3 attempt requires one running guarded session';
  end if;

  select * into v_existing
  from xrpl_resource_guard_v2.attempts
  where session_id = p_session_id
    and scheduled_minute = v_scheduled_minute;

  if found then
    if v_existing.attempt_id <> p_attempt_id then
      raise exception 'revision-3 attempt minute conflicts with retained identity';
    end if;
    return jsonb_build_object(
      'allowed', v_existing.status = 'open',
      'replayed', true,
      'sessionId', v_existing.session_id,
      'attemptId', v_existing.attempt_id,
      'scheduledMinute', v_existing.scheduled_minute,
      'status', v_existing.status,
      'reservedEgressUpperBoundBytes', v_existing.reserved_egress_upper_bound_bytes,
      'profileRevision', v_existing.profile_revision,
      'profileIdentityDigest', v_existing.profile_identity_digest
    );
  end if;

  select coalesce(sum(
    xrpl_resource_guard_v2.attempt_effective_egress(
      status,
      reserved_egress_upper_bound_bytes,
      coalesce(finalized_egress_upper_bound_bytes, reserved_egress_upper_bound_bytes)
    )
  ), 0)::bigint,
  count(*)::bigint
  into v_attempt_egress, v_attempt_count
  from xrpl_resource_guard_v2.attempts
  where started_at >= p_started_at - interval '31 days'
    and started_at <= p_started_at;

  select coalesce(sum(conservative_tick_egress_upper_bound_bytes), 0)::bigint
  into v_legacy_egress
  from xrpl_resource_guard_v2.tick_accounting
  where recorded_at >= p_started_at - interval '31 days'
    and recorded_at <= p_started_at;

  v_prior_egress := greatest(v_attempt_egress, v_legacy_egress);

  select projected_invocations_31d, observed_at
  into v_provider_invocations, v_provider_observed_at
  from xrpl_resource_guard_v1.external_snapshots
  order by observed_at desc, snapshot_id desc
  limit 1;

  if v_provider_invocations is null
    or v_provider_observed_at is null
    or v_provider_observed_at < p_started_at - interval '25 hours' then
    v_provider_invocations := v_invocation_halt;
  end if;

  v_prior_invocations := greatest(v_provider_invocations, v_attempt_count * 2);
  v_projected_invocations := greatest(v_provider_invocations, (v_attempt_count + 1) * 2);

  if v_prior_egress + v_reserved >= v_egress_halt
    or v_projected_invocations >= v_invocation_halt then
    update xrpl_steady_v1.sessions
    set status = 'halted',
        resource_guard_status = 'halted',
        resource_guard_checked_at = p_started_at,
        last_error = case
          when v_prior_egress + v_reserved >= v_egress_halt
            then 'revision3_attempt_monthly_egress_halt'
          else 'revision3_attempt_monthly_invocation_halt'
        end,
        lease_owner = null,
        lease_expires_at = null,
        completed_at = p_started_at,
        updated_at = p_started_at
    where session_id = p_session_id;

    return jsonb_build_object(
      'allowed', false,
      'replayed', false,
      'sessionId', p_session_id,
      'attemptId', p_attempt_id,
      'scheduledMinute', v_scheduled_minute,
      'reservedEgressUpperBoundBytes', v_reserved,
      'priorConservativeEgress31dBytes', v_prior_egress,
      'projectedConservativeEgress31dBytes', v_prior_egress + v_reserved,
      'priorInvocations31d', v_prior_invocations,
      'projectedInvocations31d', v_projected_invocations,
      'failure', case
        when v_prior_egress + v_reserved >= v_egress_halt
          then 'monthly_egress_upper_bound_halt'
        else 'monthly_invocation_halt'
      end
    );
  end if;

  insert into xrpl_resource_guard_v2.attempts (
    session_id, attempt_id, profile_id, profile_revision,
    profile_identity_digest, scheduled_minute, status,
    reserved_egress_upper_bound_bytes, started_at
  ) values (
    p_session_id, p_attempt_id,
    'supabase_free_postgres_pgcron_edge', 3,
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    v_scheduled_minute, 'open', v_reserved, p_started_at
  );

  return jsonb_build_object(
    'allowed', true,
    'replayed', false,
    'sessionId', p_session_id,
    'attemptId', p_attempt_id,
    'scheduledMinute', v_scheduled_minute,
    'status', 'open',
    'reservedEgressUpperBoundBytes', v_reserved,
    'priorConservativeEgress31dBytes', v_prior_egress,
    'projectedConservativeEgress31dBytes', v_prior_egress + v_reserved,
    'priorInvocations31d', greatest(v_provider_invocations, (v_attempt_count + 1) * 2 - 1),
    'projectedInvocations31d', v_projected_invocations,
    'profileRevision', 3,
    'profileIdentityDigest',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    'checks', jsonb_build_object(
      'reservedBeforeDownstreamInvocation', true,
      'openAttemptCountsAtFullReservation', true,
      'crashCannotRemoveReservation', true,
      'twoFunctionInvocationsReserved', true,
      'providerEgressCounterClaimed', false
    )
  );
end;
$$;

create or replace function public.xrpl_finalize_revision3_attempt(
  p_session_id text,
  p_attempt_id text,
  p_status text,
  p_tick_id text,
  p_finalized_egress_upper_bound_bytes bigint,
  p_accounting_digest text,
  p_error_message text,
  p_finalized_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_attempt xrpl_resource_guard_v2.attempts%rowtype;
  v_target_status text;
  v_finalized_egress bigint;
begin
  if p_status not in ('succeeded', 'failed', 'deferred')
    or p_finalized_at is null then
    raise exception 'invalid revision-3 attempt finalization';
  end if;

  select * into v_attempt
  from xrpl_resource_guard_v2.attempts
  where session_id = p_session_id and attempt_id = p_attempt_id
  for update;

  if not found then
    raise exception 'revision-3 attempt reservation is missing';
  end if;

  if v_attempt.status <> 'open' then
    if v_attempt.status <> p_status
      or v_attempt.tick_id is distinct from p_tick_id
      or v_attempt.accounting_digest is distinct from p_accounting_digest then
      raise exception 'revision-3 attempt replay conflicts with retained finalization';
    end if;
    return jsonb_build_object(
      'finalized', true,
      'replayed', true,
      'sessionId', v_attempt.session_id,
      'attemptId', v_attempt.attempt_id,
      'status', v_attempt.status,
      'effectiveEgressUpperBoundBytes',
        xrpl_resource_guard_v2.attempt_effective_egress(
          v_attempt.status,
          v_attempt.reserved_egress_upper_bound_bytes,
          coalesce(v_attempt.finalized_egress_upper_bound_bytes,
            v_attempt.reserved_egress_upper_bound_bytes)
        )
    );
  end if;

  v_target_status := p_status;
  if p_status = 'succeeded' then
    if p_tick_id is null or btrim(p_tick_id) = ''
      or p_accounting_digest !~ '^[a-f0-9]{64}$'
      or p_finalized_egress_upper_bound_bytes is null
      or p_finalized_egress_upper_bound_bytes < 0
      or p_finalized_egress_upper_bound_bytes >= 33554432 then
      raise exception 'safe revision-3 attempt finalization is incomplete';
    end if;
    v_finalized_egress := p_finalized_egress_upper_bound_bytes;
  else
    v_finalized_egress := null;
  end if;

  update xrpl_resource_guard_v2.attempts
  set status = v_target_status,
      tick_id = nullif(btrim(coalesce(p_tick_id, '')), ''),
      finalized_egress_upper_bound_bytes = v_finalized_egress,
      accounting_digest = case
        when v_target_status = 'succeeded' then p_accounting_digest
        else null
      end,
      error_message = case
        when v_target_status = 'succeeded' then null
        else left(coalesce(p_error_message, v_target_status), 2000)
      end,
      finalized_at = p_finalized_at
  where session_id = p_session_id and attempt_id = p_attempt_id
  returning * into v_attempt;

  return jsonb_build_object(
    'finalized', true,
    'replayed', false,
    'sessionId', v_attempt.session_id,
    'attemptId', v_attempt.attempt_id,
    'status', v_attempt.status,
    'tickId', v_attempt.tick_id,
    'reservedEgressUpperBoundBytes', v_attempt.reserved_egress_upper_bound_bytes,
    'finalizedEgressUpperBoundBytes', v_attempt.finalized_egress_upper_bound_bytes,
    'effectiveEgressUpperBoundBytes',
      xrpl_resource_guard_v2.attempt_effective_egress(
        v_attempt.status,
        v_attempt.reserved_egress_upper_bound_bytes,
        coalesce(v_attempt.finalized_egress_upper_bound_bytes,
          v_attempt.reserved_egress_upper_bound_bytes)
      ),
    'accountingDigest', v_attempt.accounting_digest,
    'finalizedAt', v_attempt.finalized_at,
    'checks', jsonb_build_object(
      'succeededAttemptShrinksToAccountedUpperBound', v_attempt.status <> 'succeeded'
        or v_attempt.finalized_egress_upper_bound_bytes < v_attempt.reserved_egress_upper_bound_bytes,
      'failedOrDeferredAttemptRetainsFullReservation', v_attempt.status = 'succeeded'
        or v_attempt.finalized_egress_upper_bound_bytes is null,
      'reservationNeverDeletedByFinalization', true
    )
  );
end;
$$;

create or replace function public.xrpl_read_revision3_accounting_context(
  p_owner text,
  p_tick_id text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_tick xrpl_steady_v1.ticks%rowtype;
  v_required boolean;
  v_current_attempt xrpl_resource_guard_v2.attempts%rowtype;
  v_attempt_egress bigint;
  v_legacy_egress bigint;
  v_prior_egress bigint;
  v_attempt_count bigint;
  v_provider_invocations bigint;
  v_provider_observed_at timestamptz;
  v_prior_invocations bigint;
begin
  select * into v_tick
  from xrpl_steady_v1.ticks
  where tick_id = p_tick_id;

  if not found
    or v_tick.status <> 'leased'
    or v_tick.lease_owner is distinct from p_owner
    or v_tick.lease_expires_at is null
    or v_tick.lease_expires_at <= p_observed_at then
    raise exception 'revision-3 accounting context ownership is invalid';
  end if;

  select resource_guard_enabled into v_required
  from xrpl_steady_v1.sessions
  where session_id = v_tick.session_id;

  if coalesce(v_required, false) then
    select * into v_current_attempt
    from xrpl_resource_guard_v2.attempts
    where session_id = v_tick.session_id
      and scheduled_minute = v_tick.scheduled_minute;
    if not found or v_current_attempt.status <> 'open' then
      raise exception 'revision-3 guarded tick lacks one open pre-network attempt';
    end if;
  end if;

  select coalesce(sum(
    xrpl_resource_guard_v2.attempt_effective_egress(
      status,
      reserved_egress_upper_bound_bytes,
      coalesce(finalized_egress_upper_bound_bytes, reserved_egress_upper_bound_bytes)
    )
  ), 0)::bigint,
  count(*)::bigint
  into v_attempt_egress, v_attempt_count
  from xrpl_resource_guard_v2.attempts
  where started_at >= p_observed_at - interval '31 days'
    and started_at <= p_observed_at;

  select coalesce(sum(conservative_tick_egress_upper_bound_bytes), 0)::bigint
  into v_legacy_egress
  from xrpl_resource_guard_v2.tick_accounting
  where recorded_at >= p_observed_at - interval '31 days'
    and recorded_at <= p_observed_at;

  v_prior_egress := greatest(
    case
      when coalesce(v_required, false)
        then greatest(v_attempt_egress - v_current_attempt.reserved_egress_upper_bound_bytes, 0)
      else v_attempt_egress
    end,
    v_legacy_egress
  );

  select projected_invocations_31d, observed_at
  into v_provider_invocations, v_provider_observed_at
  from xrpl_resource_guard_v1.external_snapshots
  order by observed_at desc, snapshot_id desc
  limit 1;

  if v_provider_invocations is null
    or v_provider_observed_at is null
    or v_provider_observed_at < p_observed_at - interval '25 hours' then
    v_provider_invocations := 400000;
  end if;

  v_prior_invocations := greatest(
    v_provider_invocations,
    case
      when coalesce(v_required, false) then greatest(v_attempt_count * 2 - 1, 0)
      else v_attempt_count * 2
    end
  );

  return jsonb_build_object(
    'schemaVersion', 1,
    'required', coalesce(v_required, false),
    'sessionId', v_tick.session_id,
    'tickId', v_tick.tick_id,
    'attemptId', v_current_attempt.attempt_id,
    'profileRevision', 3,
    'profileIdentityDigest',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    'priorConservativeEgress31dBytes', v_prior_egress,
    'priorInvocations31d', v_prior_invocations,
    'checks', jsonb_build_object(
      'exactTickOwnership', true,
      'guardedSessionRequiresAccounting', coalesce(v_required, false),
      'unguardedQualificationPreserved', not coalesce(v_required, false),
      'guardedAttemptReservedBeforeNetwork', not coalesce(v_required, false)
        or v_current_attempt.status = 'open',
      'openAttemptExcludedFromCurrentTickPriorEgress', true,
      'openAndFailedAttemptsIncludedInRollingEgress', true,
      'twoFunctionInvocationsReservedPerGuardedAttempt', true
    )
  );
end;
$$;

create or replace function public.xrpl_read_revision3_attempt(
  p_session_id text,
  p_attempt_id text
)
returns jsonb
language sql
security definer
set search_path = public, xrpl_resource_guard_v2, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'found', true,
        'schemaVersion', schema_version,
        'sessionId', session_id,
        'attemptId', attempt_id,
        'profileId', profile_id,
        'profileRevision', profile_revision,
        'profileIdentityDigest', profile_identity_digest,
        'scheduledMinute', scheduled_minute,
        'status', status,
        'reservedEgressUpperBoundBytes', reserved_egress_upper_bound_bytes,
        'finalizedEgressUpperBoundBytes', finalized_egress_upper_bound_bytes,
        'effectiveEgressUpperBoundBytes',
          xrpl_resource_guard_v2.attempt_effective_egress(
            status,
            reserved_egress_upper_bound_bytes,
            coalesce(finalized_egress_upper_bound_bytes, reserved_egress_upper_bound_bytes)
          ),
        'accountingDigest', accounting_digest,
        'tickId', tick_id,
        'errorMessage', error_message,
        'startedAt', started_at,
        'finalizedAt', finalized_at
      )
      from xrpl_resource_guard_v2.attempts
      where session_id = p_session_id and attempt_id = p_attempt_id
    ),
    jsonb_build_object('found', false)
  );
$$;

revoke all on function xrpl_resource_guard_v2.attempt_effective_egress(text, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.xrpl_begin_revision3_attempt(text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_finalize_revision3_attempt(
  text, text, text, text, bigint, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_read_revision3_attempt(text, text)
  from public, anon, authenticated;
grant execute on function public.xrpl_begin_revision3_attempt(text, text, timestamptz, timestamptz)
  to service_role;
grant execute on function public.xrpl_finalize_revision3_attempt(
  text, text, text, text, bigint, text, text, timestamptz
) to service_role;
grant execute on function public.xrpl_read_revision3_attempt(text, text)
  to service_role;
