create table if not exists xrpl_r5_v1.recovery_runs (
  run_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  checkpoint_id text not null references xrpl_r5_v1.active_checkpoints(checkpoint_id),
  checkpoint_state_digest text not null check (checkpoint_state_digest ~ '^[a-f0-9]{64}$'),
  profile_id text not null check (profile_id = 'supabase_free_postgres_pgcron_edge'),
  profile_revision integer not null check (profile_revision = 3),
  profile_identity_digest text not null check (
    profile_identity_digest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
  ),
  selection_digest text not null check (
    selection_digest = '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
  ),
  source_profile_id text not null check (source_profile_id = 'supabase-devnet'),
  network text not null check (network = 'devnet'),
  epoch_id text not null check (epoch_id = 'supabase-r4c2c-v1'),
  base_identity text not null,
  status text not null check (status in ('prepared', 'running', 'caught_up', 'halted')),
  batch_size integer not null check (batch_size = 24),
  checkpoint_watermark_ledger_index bigint not null check (checkpoint_watermark_ledger_index > 0),
  checkpoint_watermark_ledger_hash text not null check (
    checkpoint_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  checkpoint_watermark_work_id text not null,
  start_watermark_ledger_index bigint not null check (start_watermark_ledger_index > 0),
  start_watermark_ledger_hash text not null check (
    start_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  start_watermark_work_id text not null,
  initial_validated_head_ledger_index bigint not null check (
    initial_validated_head_ledger_index > 0
  ),
  initial_validated_head_ledger_hash text not null check (
    initial_validated_head_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  checkpoint_to_start_ledgers bigint not null check (checkpoint_to_start_ledgers >= 0),
  initial_lag_ledgers bigint not null check (initial_lag_ledgers >= 0),
  descendant_work_count bigint not null check (descendant_work_count >= 0),
  current_watermark_ledger_index bigint not null check (current_watermark_ledger_index > 0),
  current_watermark_ledger_hash text not null check (
    current_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  current_watermark_work_id text not null,
  completed_batches bigint not null default 0 check (completed_batches >= 0),
  committed_ledgers bigint not null default 0 check (committed_ledgers >= 0),
  last_accounting_digest text check (
    last_accounting_digest is null or last_accounting_digest ~ '^[a-f0-9]{64}$'
  ),
  last_error text,
  prepared_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null,
  constraint xrpl_r5_recovery_checkpoint_order check (
    start_watermark_ledger_index >= checkpoint_watermark_ledger_index
  ),
  constraint xrpl_r5_recovery_head_order check (
    initial_validated_head_ledger_index >= start_watermark_ledger_index
  ),
  constraint xrpl_r5_recovery_status_time check (
    (status = 'prepared' and started_at is null and completed_at is null)
    or (status = 'running' and started_at is not null and completed_at is null)
    or (status = 'caught_up' and completed_at is not null)
    or status = 'halted'
  )
);

revoke all on table xrpl_r5_v1.recovery_runs from public, anon, authenticated;

create or replace function public.xrpl_prepare_r5_active_recovery(
  p_run_id text,
  p_checkpoint_id text,
  p_checkpoint_state_digest text,
  p_validated_head_ledger_index bigint,
  p_validated_head_ledger_hash text,
  p_prepared_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_checkpoint xrpl_r5_v1.active_checkpoints%rowtype;
  v_existing xrpl_r5_v1.recovery_runs%rowtype;
  v_runtime public.xrpl_collector_runtime%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_pending_scan public.xrpl_phase_messages%rowtype;
  v_predecessor public.xrpl_phase_messages%rowtype;
  v_current_work public.xrpl_phase_work%rowtype;
  v_pending_count integer;
  v_leased_count integer;
  v_retry_count integer;
  v_inflight_work_count integer;
  v_checkpoint_to_start bigint;
  v_initial_lag bigint;
  v_descendant_count bigint := 0;
  v_single_ledger_chain boolean := true;
  v_hash_linked_chain boolean := true;
  v_first_previous_index bigint;
  v_first_expected_parent_hash text;
  v_last_ledger_index bigint;
  v_last_ledger_hash text;
  v_last_work_id text;
  v_status text;
  v_completed_at timestamptz;
begin
  if p_run_id !~ '^r5-recovery-[a-z0-9][a-z0-9-]{7,79}$'
    or p_checkpoint_id !~ '^r5-checkpoint-[a-z0-9][a-z0-9-]{7,79}$'
    or p_checkpoint_state_digest !~ '^[a-f0-9]{64}$'
    or p_validated_head_ledger_index <= 0
    or p_validated_head_ledger_hash !~ '^[A-F0-9]{64}$'
    or p_prepared_at is null then
    raise exception 'r5_recovery_prepare_invalid_identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  lock table public.xrpl_collector_runtime in share mode;
  lock table public.xrpl_phase_streams in share mode;
  lock table public.xrpl_phase_messages in share mode;
  lock table public.xrpl_phase_successors in share mode;
  lock table public.xrpl_phase_work in share mode;
  lock table public.xrpl_phase_watermarks in share mode;
  lock table xrpl_r5_v1.active_checkpoints in share mode;

  select * into v_checkpoint
  from xrpl_r5_v1.active_checkpoints
  where checkpoint_id = p_checkpoint_id;
  if not found
    or v_checkpoint.profile_id <> 'supabase_free_postgres_pgcron_edge'
    or v_checkpoint.profile_revision <> 3
    or v_checkpoint.profile_identity_digest
      <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    or v_checkpoint.selection_digest
      <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    or v_checkpoint.state_digest <> p_checkpoint_state_digest
    or public.xrpl_transfer_json_digest(v_checkpoint.state) <> v_checkpoint.state_digest
    or v_checkpoint.source_profile_id <> 'supabase-devnet'
    or v_checkpoint.network <> 'devnet'
    or v_checkpoint.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'r5_recovery_prepare_checkpoint_invalid';
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
    raise exception 'r5_recovery_prepare_collector_not_quiescent';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  if not found
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1'
    or v_stream.base_identity <> v_checkpoint.base_identity
    or v_stream.status <> 'active'
    or v_stream.last_error_classification is not null
    or v_stream.last_error_message is not null then
    raise exception 'r5_recovery_prepare_active_stream_invalid';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found
    or v_watermark.network <> v_stream.network
    or v_watermark.epoch_id <> v_stream.epoch_id
    or v_watermark.base_identity <> v_stream.base_identity
    or v_watermark.ledger_index < v_checkpoint.watermark_ledger_index then
    raise exception 'r5_recovery_prepare_watermark_invalid';
  end if;

  if p_validated_head_ledger_index < v_watermark.ledger_index then
    raise exception 'r5_recovery_prepare_head_behind_watermark';
  end if;

  select
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'leased')::integer,
    count(*) filter (where status = 'retry')::integer
  into v_pending_count, v_leased_count, v_retry_count
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet';
  if v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0 then
    raise exception 'r5_recovery_prepare_scheduler_not_quiescent';
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
    or v_pending_scan.payload->>'epochId' <> v_stream.epoch_id
    or v_pending_scan.payload->>'baseIdentity' <> v_stream.base_identity then
    raise exception 'r5_recovery_prepare_pending_scan_invalid';
  end if;

  select messages.* into v_predecessor
  from public.xrpl_phase_successors successors
  join public.xrpl_phase_messages messages
    on messages.message_id = successors.current_message_id
  where successors.successor_message_id = v_pending_scan.message_id;
  if not found
    or v_predecessor.profile_id <> 'supabase-devnet'
    or v_predecessor.phase <> 'finalize'
    or v_predecessor.status <> 'completed'
    or v_predecessor.result->>'status' <> 'committed'
    or v_predecessor.result->>'workId' <> v_watermark.work_id
    or (v_predecessor.result->>'ledgerIndex')::bigint <> v_watermark.ledger_index
    or upper(v_predecessor.result->>'ledgerHash') <> v_watermark.ledger_hash then
    raise exception 'r5_recovery_prepare_successor_chain_invalid';
  end if;

  select * into v_current_work
  from public.xrpl_phase_work
  where work_id = v_watermark.work_id;
  if not found
    or v_current_work.profile_id <> 'supabase-devnet'
    or v_current_work.status <> 'committed'
    or v_current_work.scanned_end_ledger_index <> v_watermark.ledger_index
    or v_current_work.final_ledger_hash <> v_watermark.ledger_hash
    or v_current_work.committed_at is null then
    raise exception 'r5_recovery_prepare_current_work_invalid';
  end if;

  select count(*)::integer into v_inflight_work_count
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
    and status in ('planned', 'staged', 'committing', 'finalizing');
  if v_inflight_work_count <> 0 then
    raise exception 'r5_recovery_prepare_inflight_work_present';
  end if;

  v_checkpoint_to_start :=
    v_watermark.ledger_index - v_checkpoint.watermark_ledger_index;
  if v_checkpoint_to_start = 0 then
    if v_watermark.ledger_hash <> v_checkpoint.watermark_ledger_hash
      or v_watermark.work_id <> v_checkpoint.watermark_work_id then
      raise exception 'r5_recovery_prepare_checkpoint_watermark_changed_identity';
    end if;
  else
    with chain as (
      select
        row_number() over (order by work.start_ledger_index, work.work_id)::bigint as ordinal,
        work.*,
        lag(work.scanned_end_ledger_index) over (
          order by work.start_ledger_index, work.work_id
        ) as prior_end_ledger_index,
        lag(work.final_ledger_hash) over (
          order by work.start_ledger_index, work.work_id
        ) as prior_final_ledger_hash
      from public.xrpl_phase_work work
      where work.profile_id = 'supabase-devnet'
        and work.status = 'committed'
        and work.start_ledger_index > v_checkpoint.watermark_ledger_index
        and work.scanned_end_ledger_index <= v_watermark.ledger_index
    )
    select
      count(*)::bigint,
      coalesce(bool_and(
        chain.start_ledger_index = chain.previous_ledger_index + 1
        and chain.scanned_end_ledger_index = chain.start_ledger_index
      ), false),
      coalesce(bool_and(
        case when chain.ordinal = 1 then
          chain.previous_ledger_index = v_checkpoint.watermark_ledger_index
          and chain.expected_parent_hash = v_checkpoint.watermark_ledger_hash
        else
          chain.previous_ledger_index = chain.prior_end_ledger_index
          and chain.start_ledger_index = chain.prior_end_ledger_index + 1
          and chain.expected_parent_hash = chain.prior_final_ledger_hash
        end
      ), false),
      min(chain.previous_ledger_index) filter (where chain.ordinal = 1),
      min(chain.expected_parent_hash) filter (where chain.ordinal = 1),
      max(chain.scanned_end_ledger_index),
      (array_agg(chain.final_ledger_hash order by chain.start_ledger_index desc, chain.work_id desc))[1],
      (array_agg(chain.work_id order by chain.start_ledger_index desc, chain.work_id desc))[1]
    into
      v_descendant_count,
      v_single_ledger_chain,
      v_hash_linked_chain,
      v_first_previous_index,
      v_first_expected_parent_hash,
      v_last_ledger_index,
      v_last_ledger_hash,
      v_last_work_id
    from chain;

    if v_descendant_count <> v_checkpoint_to_start
      or not v_single_ledger_chain
      or not v_hash_linked_chain
      or v_first_previous_index <> v_checkpoint.watermark_ledger_index
      or v_first_expected_parent_hash <> v_checkpoint.watermark_ledger_hash
      or v_last_ledger_index <> v_watermark.ledger_index
      or v_last_ledger_hash <> v_watermark.ledger_hash
      or v_last_work_id <> v_watermark.work_id then
      raise exception 'r5_recovery_prepare_checkpoint_descendant_chain_invalid';
    end if;
  end if;

  v_initial_lag := p_validated_head_ledger_index - v_watermark.ledger_index;
  v_status := case when v_initial_lag = 0 then 'caught_up' else 'prepared' end;
  v_completed_at := case when v_initial_lag = 0 then p_prepared_at else null end;

  select * into v_existing
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id
  for update;
  if found then
    if v_existing.checkpoint_id <> p_checkpoint_id
      or v_existing.checkpoint_state_digest <> p_checkpoint_state_digest
      or v_existing.start_watermark_ledger_index <> v_watermark.ledger_index
      or v_existing.start_watermark_ledger_hash <> v_watermark.ledger_hash
      or v_existing.start_watermark_work_id <> v_watermark.work_id
      or v_existing.initial_validated_head_ledger_index
        <> p_validated_head_ledger_index
      or v_existing.initial_validated_head_ledger_hash
        <> p_validated_head_ledger_hash
      or v_existing.initial_lag_ledgers <> v_initial_lag then
      raise exception 'r5_recovery_prepare_identity_conflict';
    end if;
    return public.xrpl_read_r5_active_recovery(v_existing.run_id);
  end if;

  insert into xrpl_r5_v1.recovery_runs (
    run_id, checkpoint_id, checkpoint_state_digest,
    profile_id, profile_revision, profile_identity_digest, selection_digest,
    source_profile_id, network, epoch_id, base_identity, status, batch_size,
    checkpoint_watermark_ledger_index, checkpoint_watermark_ledger_hash,
    checkpoint_watermark_work_id,
    start_watermark_ledger_index, start_watermark_ledger_hash,
    start_watermark_work_id,
    initial_validated_head_ledger_index, initial_validated_head_ledger_hash,
    checkpoint_to_start_ledgers, initial_lag_ledgers, descendant_work_count,
    current_watermark_ledger_index, current_watermark_ledger_hash,
    current_watermark_work_id, prepared_at, completed_at, updated_at
  ) values (
    p_run_id, p_checkpoint_id, p_checkpoint_state_digest,
    'supabase_free_postgres_pgcron_edge', 3,
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
    'supabase-devnet', 'devnet', 'supabase-r4c2c-v1', v_stream.base_identity,
    v_status, 24,
    v_checkpoint.watermark_ledger_index, v_checkpoint.watermark_ledger_hash,
    v_checkpoint.watermark_work_id,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    p_validated_head_ledger_index, p_validated_head_ledger_hash,
    v_checkpoint_to_start, v_initial_lag, v_descendant_count,
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    p_prepared_at, v_completed_at, p_prepared_at
  );

  return public.xrpl_read_r5_active_recovery(p_run_id);
end;
$$;

create or replace function public.xrpl_read_r5_active_recovery(
  p_run_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_r5_v1, pg_temp
as $$
declare
  v_run xrpl_r5_v1.recovery_runs%rowtype;
begin
  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = p_run_id;
  if not found then
    return jsonb_build_object('found', false, 'runId', p_run_id);
  end if;

  return jsonb_build_object(
    'found', true,
    'schemaVersion', v_run.schema_version,
    'purpose', 'r5-supabase-active-recovery-summary',
    'runId', v_run.run_id,
    'checkpointId', v_run.checkpoint_id,
    'checkpointStateDigest', v_run.checkpoint_state_digest,
    'profileId', v_run.profile_id,
    'profileRevision', v_run.profile_revision,
    'profileIdentityDigest', v_run.profile_identity_digest,
    'selectionDigest', v_run.selection_digest,
    'sourceProfileId', v_run.source_profile_id,
    'network', v_run.network,
    'epochId', v_run.epoch_id,
    'baseIdentity', v_run.base_identity,
    'status', v_run.status,
    'batchSize', v_run.batch_size,
    'checkpointWatermark', jsonb_build_object(
      'ledgerIndex', v_run.checkpoint_watermark_ledger_index,
      'ledgerHash', v_run.checkpoint_watermark_ledger_hash,
      'workId', v_run.checkpoint_watermark_work_id
    ),
    'startWatermark', jsonb_build_object(
      'ledgerIndex', v_run.start_watermark_ledger_index,
      'ledgerHash', v_run.start_watermark_ledger_hash,
      'workId', v_run.start_watermark_work_id
    ),
    'initialValidatedHead', jsonb_build_object(
      'ledgerIndex', v_run.initial_validated_head_ledger_index,
      'ledgerHash', v_run.initial_validated_head_ledger_hash
    ),
    'checkpointToStartLedgers', v_run.checkpoint_to_start_ledgers,
    'initialLagLedgers', v_run.initial_lag_ledgers,
    'descendantWorkCount', v_run.descendant_work_count,
    'currentWatermark', jsonb_build_object(
      'ledgerIndex', v_run.current_watermark_ledger_index,
      'ledgerHash', v_run.current_watermark_ledger_hash,
      'workId', v_run.current_watermark_work_id
    ),
    'completedBatches', v_run.completed_batches,
    'committedLedgers', v_run.committed_ledgers,
    'lastAccountingDigest', v_run.last_accounting_digest,
    'lastError', v_run.last_error,
    'preparedAt', v_run.prepared_at,
    'startedAt', v_run.started_at,
    'completedAt', v_run.completed_at,
    'updatedAt', v_run.updated_at,
    'checks', jsonb_build_object(
      'exactRevision3Identity',
        v_run.profile_id = 'supabase_free_postgres_pgcron_edge'
        and v_run.profile_revision = 3
        and v_run.profile_identity_digest
          = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      'exactSelectionBound',
        v_run.selection_digest
          = '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
      'checkpointDigestBound', v_run.checkpoint_state_digest ~ '^[a-f0-9]{64}$',
      'checkpointDescendantChainProved',
        v_run.descendant_work_count = v_run.checkpoint_to_start_ledgers,
      'headNotBehindStart',
        v_run.initial_validated_head_ledger_index >= v_run.start_watermark_ledger_index,
      'lagArithmeticExact',
        v_run.initial_lag_ledgers
          = v_run.initial_validated_head_ledger_index - v_run.start_watermark_ledger_index,
      'activeRecoveryStarted', v_run.status = 'running',
      'caughtUp', v_run.status = 'caught_up',
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationAuthorized', false,
      'soakAuthorized', false
    )
  );
end;
$$;

revoke all on function public.xrpl_prepare_r5_active_recovery(
  text, text, text, bigint, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.xrpl_read_r5_active_recovery(text)
  from public, anon, authenticated;
grant execute on function public.xrpl_prepare_r5_active_recovery(
  text, text, text, bigint, text, timestamptz
) to service_role;
grant execute on function public.xrpl_read_r5_active_recovery(text)
  to service_role;
