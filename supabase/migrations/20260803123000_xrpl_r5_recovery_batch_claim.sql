create table if not exists xrpl_r5_v1.recovery_batches (
  run_id text not null references xrpl_r5_v1.recovery_runs(run_id) on delete cascade,
  batch_id text not null,
  schema_version integer not null default 1 check (schema_version = 1),
  batch_sequence bigint not null check (batch_sequence > 0),
  status text not null check (status in ('leased', 'completed', 'halted')),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count > 0),
  start_ledger_index bigint not null check (start_ledger_index > 0),
  end_ledger_index bigint not null check (end_ledger_index >= start_ledger_index),
  ledger_count integer not null check (ledger_count between 1 and 24),
  expected_parent_hash text not null check (expected_parent_hash ~ '^[A-F0-9]{64}$'),
  observed_head_ledger_index bigint not null check (observed_head_ledger_index >= end_ledger_index),
  observed_head_ledger_hash text not null check (observed_head_ledger_hash ~ '^[A-F0-9]{64}$'),
  profile_id text not null check (profile_id = 'supabase_free_postgres_pgcron_edge'),
  profile_revision integer not null check (profile_revision = 3),
  profile_identity_digest text not null check (
    profile_identity_digest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
  ),
  selection_digest text not null check (
    selection_digest = '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
  ),
  reserved_egress_upper_bound_bytes bigint not null check (
    reserved_egress_upper_bound_bytes = 134217728
  ),
  finalized_egress_upper_bound_bytes bigint check (
    finalized_egress_upper_bound_bytes is null
    or finalized_egress_upper_bound_bytes between 0 and 33554431
  ),
  prior_conservative_egress_31d_bytes bigint not null check (
    prior_conservative_egress_31d_bytes >= 0
  ),
  projected_conservative_egress_31d_bytes bigint not null check (
    projected_conservative_egress_31d_bytes >= reserved_egress_upper_bound_bytes
  ),
  prior_invocations_31d bigint not null check (prior_invocations_31d >= 0),
  projected_invocations_31d bigint not null check (projected_invocations_31d >= 0),
  accounting_digest text check (
    accounting_digest is null or accounting_digest ~ '^[a-f0-9]{64}$'
  ),
  final_ledger_hash text check (
    final_ledger_hash is null or final_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  final_work_id text,
  works_digest text check (works_digest is null or works_digest ~ '^[a-f0-9]{64}$'),
  rows_digest text check (rows_digest is null or rows_digest ~ '^[a-f0-9]{64}$'),
  error_message text,
  claimed_at timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null,
  primary key (run_id, batch_id),
  unique (run_id, batch_sequence),
  unique (run_id, start_ledger_index),
  constraint xrpl_r5_recovery_batch_range check (
    end_ledger_index = start_ledger_index + ledger_count - 1
  ),
  constraint xrpl_r5_recovery_batch_lease_pair check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  ),
  constraint xrpl_r5_recovery_batch_completion check (
    (status = 'completed'
      and completed_at is not null
      and finalized_egress_upper_bound_bytes is not null
      and accounting_digest is not null
      and final_ledger_hash is not null
      and final_work_id is not null
      and works_digest is not null
      and rows_digest is not null
      and error_message is null)
    or (status = 'halted' and completed_at is not null and error_message is not null)
    or status = 'leased'
  )
);

create unique index if not exists xrpl_r5_one_leased_batch_per_run_idx
  on xrpl_r5_v1.recovery_batches(run_id)
  where status = 'leased';

create index if not exists xrpl_r5_recovery_batches_claimed_idx
  on xrpl_r5_v1.recovery_batches(claimed_at desc);

revoke all on table xrpl_r5_v1.recovery_batches
  from public, anon, authenticated;

create or replace function public.xrpl_claim_r5_active_recovery_batch(
  p_run_id text,
  p_owner text,
  p_validated_head_ledger_index bigint,
  p_validated_head_ledger_hash text,
  p_now timestamptz,
  p_lease_seconds integer default 55
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, xrpl_resource_guard_v1, xrpl_resource_guard_v2, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_runtime public.xrpl_collector_runtime%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_pending_scan public.xrpl_phase_messages%rowtype;
  v_existing xrpl_r5_v1.recovery_batches%rowtype;
  v_pending_count integer;
  v_leased_count integer;
  v_retry_count integer;
  v_inflight_work_count integer;
  v_sequence bigint;
  v_batch_id text;
  v_start bigint;
  v_end bigint;
  v_count integer;
  v_steady_attempt_egress bigint;
  v_legacy_egress bigint;
  v_recovery_egress bigint;
  v_prior_egress bigint;
  v_steady_attempt_count bigint;
  v_recovery_attempt_count bigint;
  v_provider_invocations bigint;
  v_provider_observed_at timestamptz;
  v_prior_invocations bigint;
  v_projected_invocations bigint;
  v_reserved constant bigint := 134217728;
  v_egress_halt constant bigint := 4294967296;
  v_invocation_halt constant bigint := 400000;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_validated_head_ledger_index <= 0
    or p_validated_head_ledger_hash !~ '^[A-F0-9]{64}$'
    or p_now is null
    or p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'r5_recovery_batch_invalid_claim';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;

  if not found
    or v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_run.profile_revision <> 3
    or v_run.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_run.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_run.source_profile_id <> 'supabase-devnet'
    or v_run.network <> 'devnet'
    or v_run.epoch_id <> 'supabase-r4c2c-v1'
    or v_run.batch_size <> 24 then
    raise exception 'r5_recovery_batch_run_invalid';
  end if;

  if v_run.status = 'caught_up' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'recovery_already_caught_up',
      'runId', v_run.run_id,
      'watermarkLedgerIndex', v_run.current_watermark_ledger_index
    );
  end if;
  if v_run.status = 'halted' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'recovery_halted',
      'runId', v_run.run_id,
      'error', v_run.last_error
    );
  end if;
  if v_run.status not in ('prepared', 'running') then
    raise exception 'r5_recovery_batch_run_not_claimable';
  end if;

  select * into v_runtime
  from public.xrpl_collector_runtime
  where profile_id = 'supabase-devnet';
  if not found
    or v_runtime.network <> 'devnet'
    or v_runtime.status <> 'stopped'
    or v_runtime.lease_owner is not null
    or v_runtime.lease_expires_at is not null
    or v_runtime.last_error is not null
    or v_runtime.consecutive_failures <> 0 then
    raise exception 'r5_recovery_batch_collector_not_quiescent';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> v_run.network
    or v_stream.epoch_id <> v_run.epoch_id
    or v_stream.base_identity <> v_run.base_identity
    or v_stream.last_error_classification is not null
    or v_stream.last_error_message is not null then
    raise exception 'r5_recovery_batch_stream_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found
    or v_watermark.network <> v_run.network
    or v_watermark.epoch_id <> v_run.epoch_id
    or v_watermark.base_identity <> v_run.base_identity
    or v_watermark.ledger_index <> v_run.current_watermark_ledger_index
    or v_watermark.ledger_hash <> v_run.current_watermark_ledger_hash
    or v_watermark.work_id <> v_run.current_watermark_work_id then
    raise exception 'r5_recovery_batch_watermark_drift';
  end if;

  select
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'leased')::integer,
    count(*) filter (where status = 'retry')::integer
  into v_pending_count, v_leased_count, v_retry_count
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet';

  if v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0 then
    raise exception 'r5_recovery_batch_scheduler_not_quiescent';
  end if;

  select * into v_pending_scan
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet' and status = 'pending';

  if not found
    or v_pending_scan.phase <> 'scan'
    or (v_pending_scan.payload->>'expectedPreviousLedgerIndex')::bigint
      <> v_watermark.ledger_index
    or upper(v_pending_scan.payload->>'expectedPreviousLedgerHash')
      <> v_watermark.ledger_hash
    or v_pending_scan.payload->>'epochId' <> v_run.epoch_id
    or v_pending_scan.payload->>'baseIdentity' <> v_run.base_identity then
    raise exception 'r5_recovery_batch_pending_scan_invalid';
  end if;

  select count(*)::integer into v_inflight_work_count
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
    and status in ('planned', 'staged', 'committing', 'finalizing');
  if v_inflight_work_count <> 0 then
    raise exception 'r5_recovery_batch_inflight_work_present';
  end if;

  if p_validated_head_ledger_index < v_watermark.ledger_index then
    raise exception 'r5_recovery_batch_head_behind_watermark';
  end if;
  if p_validated_head_ledger_index = v_watermark.ledger_index then
    if p_validated_head_ledger_hash <> v_watermark.ledger_hash then
      raise exception 'r5_recovery_batch_head_hash_conflict';
    end if;
    update xrpl_r5_v1.recovery_runs
    set status = 'caught_up',
        started_at = coalesce(started_at, p_now),
        completed_at = coalesce(completed_at, p_now),
        last_error = null,
        updated_at = p_now
    where run_id = v_run.run_id;
    return jsonb_build_object(
      'claimed', false,
      'reason', 'caught_up_at_claim_boundary',
      'runId', v_run.run_id,
      'watermarkLedgerIndex', v_watermark.ledger_index,
      'watermarkLedgerHash', v_watermark.ledger_hash
    );
  end if;

  select * into v_existing
  from xrpl_r5_v1.recovery_batches
  where run_id = v_run.run_id and status = 'leased'
  for update;
  if found then
    if v_existing.lease_expires_at > p_now then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'batch_lease_active',
        'runId', v_run.run_id,
        'batchId', v_existing.batch_id,
        'leaseExpiresAt', v_existing.lease_expires_at
      );
    end if;
    if v_existing.start_ledger_index <> v_watermark.ledger_index + 1
      or v_existing.expected_parent_hash <> v_watermark.ledger_hash then
      raise exception 'r5_recovery_batch_reclaim_boundary_changed';
    end if;
    update xrpl_r5_v1.recovery_batches
    set lease_owner = p_owner,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        observed_head_ledger_index = greatest(
          observed_head_ledger_index, p_validated_head_ledger_index
        ),
        observed_head_ledger_hash = case
          when p_validated_head_ledger_index >= observed_head_ledger_index
            then p_validated_head_ledger_hash
          else observed_head_ledger_hash
        end,
        updated_at = p_now
    where run_id = v_existing.run_id and batch_id = v_existing.batch_id
    returning * into v_existing;
    return jsonb_build_object(
      'claimed', true,
      'reclaimed', true,
      'runId', v_existing.run_id,
      'batchId', v_existing.batch_id,
      'batchSequence', v_existing.batch_sequence,
      'startLedgerIndex', v_existing.start_ledger_index,
      'endLedgerIndex', v_existing.end_ledger_index,
      'ledgerCount', v_existing.ledger_count,
      'expectedParentHash', v_existing.expected_parent_hash,
      'leaseExpiresAt', v_existing.lease_expires_at,
      'reservedEgressUpperBoundBytes', v_existing.reserved_egress_upper_bound_bytes
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
  into v_steady_attempt_egress, v_steady_attempt_count
  from xrpl_resource_guard_v2.attempts
  where started_at >= p_now - interval '31 days'
    and started_at <= p_now;

  select coalesce(sum(conservative_tick_egress_upper_bound_bytes), 0)::bigint
  into v_legacy_egress
  from xrpl_resource_guard_v2.tick_accounting
  where recorded_at >= p_now - interval '31 days'
    and recorded_at <= p_now;

  select coalesce(sum(
    case when status = 'completed'
      then finalized_egress_upper_bound_bytes
      else reserved_egress_upper_bound_bytes
    end
  ), 0)::bigint,
  count(*)::bigint
  into v_recovery_egress, v_recovery_attempt_count
  from xrpl_r5_v1.recovery_batches
  where claimed_at >= p_now - interval '31 days'
    and claimed_at <= p_now;

  v_prior_egress := greatest(v_steady_attempt_egress, v_legacy_egress)
    + v_recovery_egress;

  select projected_invocations_31d, observed_at
  into v_provider_invocations, v_provider_observed_at
  from xrpl_resource_guard_v1.external_snapshots
  order by observed_at desc, snapshot_id desc
  limit 1;

  if v_provider_invocations is null
    or v_provider_observed_at is null
    or v_provider_observed_at < p_now - interval '25 hours' then
    v_provider_invocations := v_invocation_halt;
  end if;

  v_prior_invocations := greatest(
    v_provider_invocations,
    (v_steady_attempt_count + v_recovery_attempt_count) * 2
  );
  v_projected_invocations := greatest(
    v_provider_invocations,
    (v_steady_attempt_count + v_recovery_attempt_count + 1) * 2
  );

  if v_prior_egress + v_reserved >= v_egress_halt
    or v_projected_invocations >= v_invocation_halt then
    update xrpl_r5_v1.recovery_runs
    set status = 'halted',
        started_at = coalesce(started_at, p_now),
        last_error = case
          when v_prior_egress + v_reserved >= v_egress_halt
            then 'r5_recovery_monthly_egress_halt'
          else 'r5_recovery_monthly_invocation_halt'
        end,
        updated_at = p_now
    where run_id = v_run.run_id;
    return jsonb_build_object(
      'claimed', false,
      'reason', case
        when v_prior_egress + v_reserved >= v_egress_halt
          then 'monthly_egress_upper_bound_halt'
        else 'monthly_invocation_halt'
      end,
      'runId', v_run.run_id,
      'priorConservativeEgress31dBytes', v_prior_egress,
      'projectedConservativeEgress31dBytes', v_prior_egress + v_reserved,
      'priorInvocations31d', v_prior_invocations,
      'projectedInvocations31d', v_projected_invocations
    );
  end if;

  v_sequence := v_run.completed_batches + 1;
  v_start := v_watermark.ledger_index + 1;
  v_count := least(24::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;
  v_end := v_start + v_count - 1;
  v_batch_id := concat(
    'r5-batch-v1-', v_run.run_id, '-', lpad(v_sequence::text, 8, '0')
  );

  insert into xrpl_r5_v1.recovery_batches (
    run_id, batch_id, batch_sequence, status,
    lease_owner, lease_expires_at, attempt_count,
    start_ledger_index, end_ledger_index, ledger_count,
    expected_parent_hash, observed_head_ledger_index, observed_head_ledger_hash,
    profile_id, profile_revision, profile_identity_digest, selection_digest,
    reserved_egress_upper_bound_bytes,
    prior_conservative_egress_31d_bytes,
    projected_conservative_egress_31d_bytes,
    prior_invocations_31d, projected_invocations_31d,
    claimed_at, updated_at
  ) values (
    v_run.run_id, v_batch_id, v_sequence, 'leased',
    p_owner, p_now + make_interval(secs => p_lease_seconds), 1,
    v_start, v_end, v_count,
    v_watermark.ledger_hash, p_validated_head_ledger_index,
    p_validated_head_ledger_hash,
    'supabase_free_postgres_pgcron_edge', 3,
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
    v_reserved, v_prior_egress, v_prior_egress + v_reserved,
    v_prior_invocations, v_projected_invocations,
    p_now, p_now
  ) returning * into v_existing;

  update xrpl_r5_v1.recovery_runs
  set status = 'running',
      started_at = coalesce(started_at, p_now),
      last_error = null,
      updated_at = p_now
  where run_id = v_run.run_id;

  return jsonb_build_object(
    'claimed', true,
    'reclaimed', false,
    'runId', v_existing.run_id,
    'batchId', v_existing.batch_id,
    'batchSequence', v_existing.batch_sequence,
    'startLedgerIndex', v_existing.start_ledger_index,
    'endLedgerIndex', v_existing.end_ledger_index,
    'ledgerCount', v_existing.ledger_count,
    'expectedParentHash', v_existing.expected_parent_hash,
    'observedHeadLedgerIndex', v_existing.observed_head_ledger_index,
    'observedHeadLedgerHash', v_existing.observed_head_ledger_hash,
    'leaseExpiresAt', v_existing.lease_expires_at,
    'profileRevision', v_existing.profile_revision,
    'profileIdentityDigest', v_existing.profile_identity_digest,
    'selectionDigest', v_existing.selection_digest,
    'reservedEgressUpperBoundBytes', v_existing.reserved_egress_upper_bound_bytes,
    'priorConservativeEgress31dBytes', v_existing.prior_conservative_egress_31d_bytes,
    'projectedConservativeEgress31dBytes',
      v_existing.projected_conservative_egress_31d_bytes,
    'priorInvocations31d', v_existing.prior_invocations_31d,
    'projectedInvocations31d', v_existing.projected_invocations_31d,
    'checks', jsonb_build_object(
      'activeCollectorStopped', true,
      'singlePendingScanBoundToWatermark', true,
      'noInflightWork', true,
      'reservationBeforeNetworkFetch', true,
      'openOrFailedBatchRetainsFullReservation', true,
      'batchBoundedToTwentyFourLedgers', true,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationNotStarted', true,
      'soakNotStarted', true
    )
  );
end;
$$;

create or replace function public.xrpl_fail_r5_active_recovery_batch(
  p_run_id text,
  p_batch_id text,
  p_owner text,
  p_error_message text,
  p_failed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_batch xrpl_r5_v1.recovery_batches%rowtype;
  v_error text;
begin
  if p_owner is null or btrim(p_owner) = '' or p_failed_at is null then
    raise exception 'r5_recovery_batch_invalid_failure';
  end if;
  v_error := left(coalesce(nullif(btrim(p_error_message), ''), 'r5_recovery_batch_failed'), 2000);

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select * into v_batch
  from xrpl_r5_v1.recovery_batches
  where run_id = p_run_id and batch_id = p_batch_id
  for update;
  if not found then
    raise exception 'r5_recovery_batch_missing';
  end if;
  if v_batch.status = 'halted' then
    return jsonb_build_object(
      'failed', true,
      'replayed', true,
      'runId', v_batch.run_id,
      'batchId', v_batch.batch_id,
      'error', v_batch.error_message,
      'effectiveEgressUpperBoundBytes', v_batch.reserved_egress_upper_bound_bytes
    );
  end if;
  if v_batch.status <> 'leased' or v_batch.lease_owner is distinct from p_owner then
    raise exception 'r5_recovery_batch_failure_owner_conflict';
  end if;

  update xrpl_r5_v1.recovery_batches
  set status = 'halted',
      lease_owner = null,
      lease_expires_at = null,
      error_message = v_error,
      completed_at = p_failed_at,
      updated_at = p_failed_at
  where run_id = v_batch.run_id and batch_id = v_batch.batch_id
  returning * into v_batch;

  update xrpl_r5_v1.recovery_runs
  set status = 'halted',
      started_at = coalesce(started_at, p_failed_at),
      last_error = v_error,
      updated_at = p_failed_at
  where run_id = v_batch.run_id;

  return jsonb_build_object(
    'failed', true,
    'replayed', false,
    'runId', v_batch.run_id,
    'batchId', v_batch.batch_id,
    'error', v_batch.error_message,
    'reservedEgressUpperBoundBytes', v_batch.reserved_egress_upper_bound_bytes,
    'effectiveEgressUpperBoundBytes', v_batch.reserved_egress_upper_bound_bytes,
    'checks', jsonb_build_object(
      'reservationRetainedAfterFailure', true,
      'activeTablesNotMutatedByFailureFinalization', true,
      'recoveryRunHalted', true
    )
  );
end;
$$;

create or replace function public.xrpl_read_r5_active_recovery_batch(
  p_run_id text,
  p_batch_id text
)
returns jsonb
language sql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'schemaVersion', batch.schema_version,
        'runId', batch.run_id,
        'batchId', batch.batch_id,
        'batchSequence', batch.batch_sequence,
        'status', batch.status,
        'attemptCount', batch.attempt_count,
        'startLedgerIndex', batch.start_ledger_index,
        'endLedgerIndex', batch.end_ledger_index,
        'ledgerCount', batch.ledger_count,
        'expectedParentHash', batch.expected_parent_hash,
        'observedHeadLedgerIndex', batch.observed_head_ledger_index,
        'observedHeadLedgerHash', batch.observed_head_ledger_hash,
        'profileId', batch.profile_id,
        'profileRevision', batch.profile_revision,
        'profileIdentityDigest', batch.profile_identity_digest,
        'selectionDigest', batch.selection_digest,
        'reservedEgressUpperBoundBytes', batch.reserved_egress_upper_bound_bytes,
        'finalizedEgressUpperBoundBytes', batch.finalized_egress_upper_bound_bytes,
        'priorConservativeEgress31dBytes', batch.prior_conservative_egress_31d_bytes,
        'projectedConservativeEgress31dBytes',
          batch.projected_conservative_egress_31d_bytes,
        'priorInvocations31d', batch.prior_invocations_31d,
        'projectedInvocations31d', batch.projected_invocations_31d,
        'accountingDigest', batch.accounting_digest,
        'finalLedgerHash', batch.final_ledger_hash,
        'finalWorkId', batch.final_work_id,
        'worksDigest', batch.works_digest,
        'rowsDigest', batch.rows_digest,
        'error', batch.error_message,
        'claimedAt', batch.claimed_at,
        'leaseExpiresAt', batch.lease_expires_at,
        'completedAt', batch.completed_at,
        'updatedAt', batch.updated_at
      )
      from xrpl_r5_v1.recovery_batches batch
      where batch.run_id = p_run_id and batch.batch_id = p_batch_id
    ),
    jsonb_build_object('schemaVersion', 1, 'found', false)
  )
$$;

revoke all on function public.xrpl_claim_r5_active_recovery_batch(
  text, text, bigint, text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.xrpl_fail_r5_active_recovery_batch(
  text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_read_r5_active_recovery_batch(text, text)
  from public, anon, authenticated;

grant execute on function public.xrpl_claim_r5_active_recovery_batch(
  text, text, bigint, text, timestamptz, integer
) to service_role;
grant execute on function public.xrpl_fail_r5_active_recovery_batch(
  text, text, text, text, timestamptz
) to service_role;
grant execute on function public.xrpl_read_r5_active_recovery_batch(text, text)
  to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_claim_r5_active_recovery_batch(text, text, bigint, text, timestamptz, integer) to supabase_admin';
    execute 'grant execute on function public.xrpl_fail_r5_active_recovery_batch(text, text, text, text, timestamptz) to supabase_admin';
    execute 'grant execute on function public.xrpl_read_r5_active_recovery_batch(text, text) to supabase_admin';
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    execute 'grant execute on function public.xrpl_read_r5_active_recovery_batch(text, text) to supabase_read_only_user';
  end if;
end;
$$;
