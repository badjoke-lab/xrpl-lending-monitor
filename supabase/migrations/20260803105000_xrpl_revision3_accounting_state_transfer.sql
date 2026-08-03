create schema if not exists xrpl_resource_restore_v1;

create table if not exists xrpl_resource_restore_v1.targets (
  target_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  source_session_id text not null,
  profile_id text not null check (profile_id = 'supabase_free_postgres_pgcron_edge'),
  profile_revision integer not null check (profile_revision = 3),
  profile_identity_digest text not null check (
    profile_identity_digest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
  ),
  source_observed_at timestamptz not null,
  state_digest text not null check (state_digest ~ '^[a-f0-9]{64}$'),
  attempt_count integer not null check (attempt_count >= 0),
  accounting_count integer not null check (accounting_count >= 0),
  effective_egress_bytes bigint not null check (effective_egress_bytes >= 0),
  reserved_invocations bigint not null check (reserved_invocations >= 0),
  restored_at timestamptz not null
);

create table if not exists xrpl_resource_restore_v1.attempt_rows (
  target_id text not null references xrpl_resource_restore_v1.targets(target_id) on delete cascade,
  session_id text not null,
  attempt_id text not null,
  scheduled_minute timestamptz not null,
  status text not null check (status in ('open', 'succeeded', 'failed', 'deferred')),
  reserved_egress_upper_bound_bytes bigint not null check (reserved_egress_upper_bound_bytes >= 0),
  finalized_egress_upper_bound_bytes bigint,
  row_data jsonb not null,
  primary key (target_id, session_id, scheduled_minute)
);

create table if not exists xrpl_resource_restore_v1.accounting_rows (
  target_id text not null references xrpl_resource_restore_v1.targets(target_id) on delete cascade,
  session_id text not null,
  tick_id text not null,
  accounting_digest text not null check (accounting_digest ~ '^[a-f0-9]{64}$'),
  allowed boolean not null,
  conservative_tick_egress_upper_bound_bytes bigint not null check (
    conservative_tick_egress_upper_bound_bytes >= 0
  ),
  conservative_egress_31d_upper_bound_bytes bigint not null check (
    conservative_egress_31d_upper_bound_bytes >= 0
  ),
  projected_invocations_31d bigint not null check (projected_invocations_31d >= 0),
  recorded_at timestamptz not null,
  row_data jsonb not null,
  primary key (target_id, session_id, tick_id, accounting_digest)
);

create table if not exists xrpl_resource_guard_v2.transfer_qualifications (
  session_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  state_digest text not null check (state_digest ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null
);

revoke all on schema xrpl_resource_restore_v1 from public, anon, authenticated;
revoke all on all tables in schema xrpl_resource_restore_v1 from public, anon, authenticated;
revoke all on table xrpl_resource_guard_v2.transfer_qualifications
  from public, anon, authenticated;

create or replace function xrpl_resource_guard_v2.build_accounting_transfer_state(
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_attempts jsonb;
  v_accounting jsonb;
  v_attempt_egress bigint;
  v_legacy_egress bigint;
  v_attempt_count integer;
begin
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.session_id, rows.scheduled_minute), '[]'::jsonb),
         coalesce(sum(
           case when rows.status = 'succeeded'
             then rows.finalized_egress_upper_bound_bytes
             else rows.reserved_egress_upper_bound_bytes
           end
         ), 0)::bigint,
         count(*)::integer
  into v_attempts, v_attempt_egress, v_attempt_count
  from (
    select *
    from xrpl_resource_guard_v2.attempts
    where started_at >= p_observed_at - interval '31 days'
      and started_at <= p_observed_at
  ) rows;

  select coalesce(jsonb_agg(
           to_jsonb(rows)
           order by rows.session_id, rows.tick_id, rows.recorded_at, rows.accounting_digest
         ), '[]'::jsonb),
         coalesce(sum(rows.conservative_tick_egress_upper_bound_bytes), 0)::bigint
  into v_accounting, v_legacy_egress
  from (
    select *
    from xrpl_resource_guard_v2.tick_accounting
    where recorded_at >= p_observed_at - interval '31 days'
      and recorded_at <= p_observed_at
  ) rows;

  return jsonb_build_object(
    'schemaVersion', 1,
    'profileId', 'supabase_free_postgres_pgcron_edge',
    'profileRevision', 3,
    'profileIdentityDigest',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    'observedAt', p_observed_at,
    'attempts', v_attempts,
    'tickAccounting', v_accounting,
    'summary', jsonb_build_object(
      'attemptCount', jsonb_array_length(v_attempts),
      'accountingCount', jsonb_array_length(v_accounting),
      'attemptEgressBytes', v_attempt_egress,
      'legacyAccountingEgressBytes', v_legacy_egress,
      'effectiveEgressBytes', greatest(v_attempt_egress, v_legacy_egress),
      'reservedInvocations', v_attempt_count::bigint * 2
    )
  );
end;
$$;

create or replace function xrpl_resource_restore_v1.build_restored_accounting_state(
  p_target_id text
)
returns jsonb
language plpgsql
security definer
set search_path = xrpl_resource_restore_v1, pg_temp
as $$
declare
  v_target xrpl_resource_restore_v1.targets%rowtype;
  v_attempts jsonb;
  v_accounting jsonb;
  v_attempt_egress bigint;
  v_legacy_egress bigint;
  v_attempt_count integer;
begin
  select * into v_target
  from xrpl_resource_restore_v1.targets
  where target_id = p_target_id;
  if not found then raise exception 'revision3_accounting_restore_target_missing'; end if;

  select coalesce(jsonb_agg(row_data order by session_id, scheduled_minute), '[]'::jsonb),
         coalesce(sum(
           case when status = 'succeeded'
             then finalized_egress_upper_bound_bytes
             else reserved_egress_upper_bound_bytes
           end
         ), 0)::bigint,
         count(*)::integer
  into v_attempts, v_attempt_egress, v_attempt_count
  from xrpl_resource_restore_v1.attempt_rows
  where target_id = p_target_id;

  select coalesce(jsonb_agg(
           row_data order by session_id, tick_id, recorded_at, accounting_digest
         ), '[]'::jsonb),
         coalesce(sum(conservative_tick_egress_upper_bound_bytes), 0)::bigint
  into v_accounting, v_legacy_egress
  from xrpl_resource_restore_v1.accounting_rows
  where target_id = p_target_id;

  return jsonb_build_object(
    'schemaVersion', 1,
    'profileId', v_target.profile_id,
    'profileRevision', v_target.profile_revision,
    'profileIdentityDigest', v_target.profile_identity_digest,
    'observedAt', v_target.source_observed_at,
    'attempts', v_attempts,
    'tickAccounting', v_accounting,
    'summary', jsonb_build_object(
      'attemptCount', jsonb_array_length(v_attempts),
      'accountingCount', jsonb_array_length(v_accounting),
      'attemptEgressBytes', v_attempt_egress,
      'legacyAccountingEgressBytes', v_legacy_egress,
      'effectiveEgressBytes', greatest(v_attempt_egress, v_legacy_egress),
      'reservedInvocations', v_attempt_count::bigint * 2
    )
  );
end;
$$;

create or replace function public.xrpl_restore_revision3_accounting_state(
  p_target_id text,
  p_source_session_id text,
  p_state jsonb,
  p_state_digest text,
  p_restored_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_resource_restore_v1, pg_temp
as $$
declare
  v_digest text;
  v_summary jsonb;
  v_existing xrpl_resource_restore_v1.targets%rowtype;
  v_restored jsonb;
  v_row jsonb;
begin
  if p_target_id !~ '^[a-z0-9][a-z0-9-]{7,79}$'
    or p_source_session_id is null or btrim(p_source_session_id) = ''
    or p_state_digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_state) <> 'object' then
    raise exception 'revision3_accounting_restore_invalid_identity';
  end if;

  v_digest := public.xrpl_transfer_json_digest(p_state);
  if v_digest <> p_state_digest then
    raise exception 'revision3_accounting_state_digest_mismatch';
  end if;
  if (p_state->>'schemaVersion')::integer <> 1
    or p_state->>'profileId' <> 'supabase_free_postgres_pgcron_edge'
    or (p_state->>'profileRevision')::integer <> 3
    or p_state->>'profileIdentityDigest'
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or jsonb_typeof(p_state->'attempts') <> 'array'
    or jsonb_typeof(p_state->'tickAccounting') <> 'array'
    or jsonb_typeof(p_state->'summary') <> 'object' then
    raise exception 'revision3_accounting_state_schema_mismatch';
  end if;

  v_summary := p_state->'summary';
  select * into v_existing
  from xrpl_resource_restore_v1.targets
  where target_id = p_target_id
  for update;
  if found then
    v_restored := xrpl_resource_restore_v1.build_restored_accounting_state(p_target_id);
    if v_existing.source_session_id <> p_source_session_id
      or v_existing.state_digest <> p_state_digest
      or v_restored <> p_state
      or public.xrpl_transfer_json_digest(v_restored) <> p_state_digest then
      raise exception 'revision3_accounting_restore_conflict';
    end if;
    return jsonb_build_object(
      'restored', true,
      'duplicate', true,
      'targetId', p_target_id,
      'stateDigest', p_state_digest,
      'attemptCount', v_existing.attempt_count,
      'accountingCount', v_existing.accounting_count,
      'effectiveEgressBytes', v_existing.effective_egress_bytes,
      'reservedInvocations', v_existing.reserved_invocations
    );
  end if;

  insert into xrpl_resource_restore_v1.targets (
    target_id, source_session_id, profile_id, profile_revision,
    profile_identity_digest, source_observed_at, state_digest,
    attempt_count, accounting_count, effective_egress_bytes,
    reserved_invocations, restored_at
  ) values (
    p_target_id, p_source_session_id,
    'supabase_free_postgres_pgcron_edge', 3,
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    (p_state->>'observedAt')::timestamptz, p_state_digest,
    (v_summary->>'attemptCount')::integer,
    (v_summary->>'accountingCount')::integer,
    (v_summary->>'effectiveEgressBytes')::bigint,
    (v_summary->>'reservedInvocations')::bigint,
    p_restored_at
  );

  for v_row in select value from jsonb_array_elements(p_state->'attempts')
  loop
    insert into xrpl_resource_restore_v1.attempt_rows (
      target_id, session_id, attempt_id, scheduled_minute, status,
      reserved_egress_upper_bound_bytes, finalized_egress_upper_bound_bytes,
      row_data
    ) values (
      p_target_id, v_row->>'session_id', v_row->>'attempt_id',
      (v_row->>'scheduled_minute')::timestamptz, v_row->>'status',
      (v_row->>'reserved_egress_upper_bound_bytes')::bigint,
      nullif(v_row->>'finalized_egress_upper_bound_bytes', '')::bigint,
      v_row
    );
  end loop;

  for v_row in select value from jsonb_array_elements(p_state->'tickAccounting')
  loop
    insert into xrpl_resource_restore_v1.accounting_rows (
      target_id, session_id, tick_id, accounting_digest, allowed,
      conservative_tick_egress_upper_bound_bytes,
      conservative_egress_31d_upper_bound_bytes,
      projected_invocations_31d, recorded_at, row_data
    ) values (
      p_target_id, v_row->>'session_id', v_row->>'tick_id',
      v_row->>'accounting_digest', (v_row->>'allowed')::boolean,
      (v_row->>'conservative_tick_egress_upper_bound_bytes')::bigint,
      (v_row->>'conservative_egress_31d_upper_bound_bytes')::bigint,
      (v_row->>'projected_invocations_31d')::bigint,
      (v_row->>'recorded_at')::timestamptz, v_row
    );
  end loop;

  v_restored := xrpl_resource_restore_v1.build_restored_accounting_state(p_target_id);
  if v_restored <> p_state
    or public.xrpl_transfer_json_digest(v_restored) <> p_state_digest then
    raise exception 'revision3_accounting_restore_parity_failure';
  end if;

  return jsonb_build_object(
    'restored', true,
    'duplicate', false,
    'targetId', p_target_id,
    'stateDigest', p_state_digest,
    'attemptCount', jsonb_array_length(p_state->'attempts'),
    'accountingCount', jsonb_array_length(p_state->'tickAccounting'),
    'effectiveEgressBytes', (v_summary->>'effectiveEgressBytes')::bigint,
    'reservedInvocations', (v_summary->>'reservedInvocations')::bigint
  );
end;
$$;

create or replace function public.xrpl_qualify_revision3_accounting_transfer(
  p_session_id text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_steady_v1, xrpl_resource_guard_v2,
  xrpl_resource_restore_v1, pg_temp
as $$
declare
  v_existing jsonb;
  v_session xrpl_steady_v1.sessions%rowtype;
  v_state jsonb;
  v_digest text;
  v_target_id text;
  v_first jsonb;
  v_duplicate jsonb;
  v_tamper_rejected boolean := false;
  v_stream_before public.xrpl_phase_streams%rowtype;
  v_watermark_before public.xrpl_phase_watermarks%rowtype;
  v_stream_after public.xrpl_phase_streams%rowtype;
  v_watermark_after public.xrpl_phase_watermarks%rowtype;
  v_result jsonb;
begin
  select result into v_existing
  from xrpl_resource_guard_v2.transfer_qualifications
  where session_id = p_session_id;
  if found then return v_existing; end if;

  select * into v_session
  from xrpl_steady_v1.sessions
  where session_id = p_session_id;
  if not found or v_session.status <> 'completed'
    or not v_session.resource_guard_enabled
    or v_session.completed_ticks <> 6
    or v_session.committed_ledgers <> 144 then
    raise exception 'revision3_accounting_transfer_session_incomplete';
  end if;

  select * into v_stream_before
  from public.xrpl_phase_streams where profile_id = 'supabase-devnet';
  select * into v_watermark_before
  from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet';

  v_state := xrpl_resource_guard_v2.build_accounting_transfer_state(p_observed_at);
  v_digest := public.xrpl_transfer_json_digest(v_state);
  v_target_id := left(concat('r4c3-resource-', p_session_id), 79);

  v_first := public.xrpl_restore_revision3_accounting_state(
    v_target_id, p_session_id, v_state, v_digest, p_observed_at
  );
  v_duplicate := public.xrpl_restore_revision3_accounting_state(
    v_target_id, p_session_id, v_state, v_digest, p_observed_at
  );

  begin
    perform public.xrpl_restore_revision3_accounting_state(
      left(concat(v_target_id, '-tamper'), 79), p_session_id,
      v_state || jsonb_build_object('profileRevision', 2),
      v_digest, p_observed_at
    );
  exception when others then
    if position('revision3_accounting_state_digest_mismatch' in sqlerrm) > 0 then
      v_tamper_rejected := true;
    else
      raise;
    end if;
  end;

  select * into v_stream_after
  from public.xrpl_phase_streams where profile_id = 'supabase-devnet';
  select * into v_watermark_after
  from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet';

  if coalesce((v_first->>'duplicate')::boolean, true)
    or not coalesce((v_duplicate->>'duplicate')::boolean, false)
    or not v_tamper_rejected
    or (v_first->>'stateDigest') <> v_digest
    or (v_first->>'effectiveEgressBytes')::bigint
      <> (v_state #>> '{summary,effectiveEgressBytes}')::bigint
    or (v_first->>'reservedInvocations')::bigint
      <> (v_state #>> '{summary,reservedInvocations}')::bigint
    or v_stream_after.status <> v_stream_before.status
    or v_stream_after.epoch_id <> v_stream_before.epoch_id
    or v_stream_after.base_identity <> v_stream_before.base_identity
    or v_watermark_after.ledger_index < v_watermark_before.ledger_index then
    raise exception 'revision3_accounting_transfer_qualification_failed';
  end if;

  v_result := jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r4c3-accounting-state-transfer-qualification',
    'sessionId', p_session_id,
    'targetId', v_target_id,
    'stateDigest', v_digest,
    'attemptCount', v_state #>> '{summary,attemptCount}',
    'accountingCount', v_state #>> '{summary,accountingCount}',
    'effectiveEgressBytes', v_state #>> '{summary,effectiveEgressBytes}',
    'reservedInvocations', v_state #>> '{summary,reservedInvocations}',
    'checks', jsonb_build_object(
      'rolling31dStateExported', true,
      'typedRestoreCompleted', true,
      'canonicalDigestParity', true,
      'duplicateRestoreConverged', true,
      'digestTamperRejected', true,
      'effectiveEgressPreserved', true,
      'reservedInvocationsPreserved', true,
      'activeProfileReadOnly', true
    )
  );

  insert into xrpl_resource_guard_v2.transfer_qualifications (
    session_id, state_digest, result, created_at
  ) values (p_session_id, v_digest, v_result, p_observed_at);

  return v_result;
end;
$$;

create or replace function xrpl_resource_guard_v2.qualify_transfer_on_completion()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_resource_guard_v2, pg_temp
as $$
begin
  if old.status is distinct from 'completed'
    and new.status = 'completed'
    and new.resource_guard_enabled then
    perform public.xrpl_qualify_revision3_accounting_transfer(
      new.session_id, statement_timestamp()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists xrpl_revision3_accounting_transfer_on_completion
  on xrpl_steady_v1.sessions;
create trigger xrpl_revision3_accounting_transfer_on_completion
after update of status on xrpl_steady_v1.sessions
for each row
execute function xrpl_resource_guard_v2.qualify_transfer_on_completion();

create or replace function public.xrpl_read_revision3_transfer_qualification(
  p_session_id text
)
returns jsonb
language sql
security definer
set search_path = public, xrpl_resource_guard_v2, pg_temp
as $$
  select coalesce(
    (
      select result
      from xrpl_resource_guard_v2.transfer_qualifications
      where session_id = p_session_id
    ),
    jsonb_build_object('found', false, 'sessionId', p_session_id)
  );
$$;

revoke all on function xrpl_resource_guard_v2.build_accounting_transfer_state(timestamptz)
  from public, anon, authenticated;
revoke all on function xrpl_resource_restore_v1.build_restored_accounting_state(text)
  from public, anon, authenticated;
revoke all on function public.xrpl_restore_revision3_accounting_state(
  text, text, jsonb, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_qualify_revision3_accounting_transfer(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_read_revision3_transfer_qualification(text)
  from public, anon, authenticated;
grant execute on function public.xrpl_read_revision3_transfer_qualification(text)
  to service_role;
