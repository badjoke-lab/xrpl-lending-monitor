create or replace function public.xrpl_drain_r5_checkpoint_boundary(
  p_owner text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_runtime public.xrpl_collector_runtime%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark_before public.xrpl_phase_watermarks%rowtype;
  v_watermark_after public.xrpl_phase_watermarks%rowtype;
  v_pending public.xrpl_phase_messages%rowtype;
  v_work public.xrpl_phase_work%rowtype;
  v_chunk public.xrpl_phase_payload_chunks%rowtype;
  v_claim jsonb;
  v_completion jsonb;
  v_rows_json text;
  v_rows_digest text;
  v_pending_count integer;
  v_leased_count integer;
  v_retry_count integer;
  v_inflight_work_count integer;
  v_step integer := 0;
  v_step_at timestamptz;
  v_drained_phases jsonb := '[]'::jsonb;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200
    or p_observed_at is null then
    raise exception 'r5_checkpoint_drain_invalid_identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-checkpoint-boundary-drain', 0));

  select * into v_runtime
  from public.xrpl_collector_runtime
  where profile_id = 'supabase-devnet'
  for update;
  if not found
    or v_runtime.network <> 'devnet'
    or v_runtime.status <> 'stopped'
    or v_runtime.lease_owner is not null
    or v_runtime.lease_expires_at is not null
    or v_runtime.last_error is not null
    or v_runtime.consecutive_failures <> 0 then
    raise exception 'r5_checkpoint_drain_collector_not_quiescent';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet'
  for update;
  if not found
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1'
    or v_stream.status <> 'active'
    or v_stream.last_error_classification is not null
    or v_stream.last_error_message is not null then
    raise exception 'r5_checkpoint_drain_stream_invalid';
  end if;

  select * into v_watermark_before
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found
    or v_watermark_before.network <> v_stream.network
    or v_watermark_before.epoch_id <> v_stream.epoch_id
    or v_watermark_before.base_identity <> v_stream.base_identity then
    raise exception 'r5_checkpoint_drain_watermark_invalid';
  end if;

  loop
    if v_step > 256 then
      raise exception 'r5_checkpoint_drain_step_limit';
    end if;

    select
      count(*) filter (where status = 'pending')::integer,
      count(*) filter (where status = 'leased')::integer,
      count(*) filter (where status = 'retry')::integer
    into v_pending_count, v_leased_count, v_retry_count
    from public.xrpl_phase_messages
    where profile_id = 'supabase-devnet';

    if v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0 then
      raise exception 'r5_checkpoint_drain_scheduler_not_quiescent';
    end if;

    select * into v_pending
    from public.xrpl_phase_messages
    where profile_id = 'supabase-devnet' and status = 'pending'
    for update;
    if not found then
      raise exception 'r5_checkpoint_drain_pending_message_missing';
    end if;

    select * into v_watermark_after
    from public.xrpl_phase_watermarks
    where profile_id = 'supabase-devnet';
    if not found
      or v_watermark_after.network <> v_stream.network
      or v_watermark_after.epoch_id <> v_stream.epoch_id
      or v_watermark_after.base_identity <> v_stream.base_identity then
      raise exception 'r5_checkpoint_drain_watermark_changed_identity';
    end if;

    if v_pending.phase = 'scan' then
      if (v_pending.payload->>'expectedPreviousLedgerIndex')::bigint
          <> v_watermark_after.ledger_index
        or upper(v_pending.payload->>'expectedPreviousLedgerHash')
          <> v_watermark_after.ledger_hash
        or v_pending.payload->>'network' <> v_stream.network
        or v_pending.payload->>'epochId' <> v_stream.epoch_id
        or v_pending.payload->>'baseIdentity' <> v_stream.base_identity then
        raise exception 'r5_checkpoint_drain_scan_not_bound_to_watermark';
      end if;

      select count(*)::integer into v_inflight_work_count
      from public.xrpl_phase_work
      where profile_id = 'supabase-devnet'
        and status in ('planned', 'staged', 'committing', 'finalizing');
      if v_inflight_work_count <> 0 then
        raise exception 'r5_checkpoint_drain_scan_has_inflight_work';
      end if;

      return jsonb_build_object(
        'drained', true,
        'schemaVersion', 1,
        'purpose', 'r5-checkpoint-boundary-drain',
        'profileId', 'supabase_free_postgres_pgcron_edge',
        'profileRevision', 3,
        'profileIdentityDigest',
          '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
        'sourceProfileId', 'supabase-devnet',
        'network', v_stream.network,
        'epochId', v_stream.epoch_id,
        'baseIdentity', v_stream.base_identity,
        'drainedStepCount', v_step,
        'drainedPhases', v_drained_phases,
        'watermarkBefore', jsonb_build_object(
          'ledgerIndex', v_watermark_before.ledger_index,
          'ledgerHash', v_watermark_before.ledger_hash,
          'workId', v_watermark_before.work_id
        ),
        'watermarkAfter', jsonb_build_object(
          'ledgerIndex', v_watermark_after.ledger_index,
          'ledgerHash', v_watermark_after.ledger_hash,
          'workId', v_watermark_after.work_id
        ),
        'pendingScan', jsonb_build_object(
          'messageId', v_pending.message_id,
          'scanSequence', (v_pending.payload->>'scanSequence')::integer,
          'expectedPreviousLedgerIndex',
            (v_pending.payload->>'expectedPreviousLedgerIndex')::bigint,
          'expectedPreviousLedgerHash',
            upper(v_pending.payload->>'expectedPreviousLedgerHash'),
          'availableAt', v_pending.available_at
        ),
        'checks', jsonb_build_object(
          'collectorQuiescent', true,
          'activeStreamHealthy', true,
          'onlyExistingCommitOrFinalizeDrained', true,
          'noScanExecuted', true,
          'onePendingScan', true,
          'pendingScanBoundToWatermark', true,
          'noInflightWork', true,
          'watermarkIdentityPreserved', true,
          'publicReaderUnchanged', true,
          'mainnetDisabled', true,
          'activeRecoveryStarted', false,
          'stabilizationAuthorized', false,
          'soakAuthorized', false
        )
      );
    end if;

    if v_pending.phase not in ('commit', 'finalize') then
      raise exception 'r5_checkpoint_drain_unexpected_pending_phase';
    end if;

    v_step_at := p_observed_at + make_interval(secs => v_step);
    v_claim := public.xrpl_claim_next_phase(p_owner, v_step_at, 55);
    if coalesce((v_claim->>'claimed')::boolean, false) is not true
      or v_claim->>'message_id' <> v_pending.message_id
      or v_claim->>'phase' <> v_pending.phase then
      raise exception 'r5_checkpoint_drain_claim_conflict';
    end if;

    if v_pending.phase = 'commit' then
      select * into v_work
      from public.xrpl_phase_work
      where work_id = v_pending.payload->>'workId';
      if not found
        or v_work.profile_id <> 'supabase-devnet'
        or v_work.status not in ('staged', 'committing')
        or v_work.previous_ledger_index <> v_watermark_after.ledger_index
        or v_work.expected_parent_hash <> v_watermark_after.ledger_hash then
        raise exception 'r5_checkpoint_drain_commit_work_invalid';
      end if;

      select * into v_chunk
      from public.xrpl_phase_payload_chunks
      where work_id = v_work.work_id
        and chunk_index = (v_pending.payload->>'chunkIndex')::integer;
      if not found or v_chunk.encoding <> 'normalized-payload-chunk-json-v1' then
        raise exception 'r5_checkpoint_drain_commit_chunk_missing';
      end if;

      begin
        v_rows_json := ((v_chunk.payload_json::jsonb)->'records')::text;
      exception when others then
        raise exception 'r5_checkpoint_drain_commit_payload_invalid';
      end;
      if v_rows_json is null
        or jsonb_typeof(v_rows_json::jsonb) <> 'array'
        or jsonb_array_length(v_rows_json::jsonb) <> v_chunk.record_count then
        raise exception 'r5_checkpoint_drain_commit_rows_invalid';
      end if;
      v_rows_digest := encode(
        extensions.digest(convert_to(v_rows_json, 'UTF8'), 'sha256'),
        'hex'
      );

      v_completion := public.xrpl_complete_portable_commit_phase(
        p_owner,
        v_pending.message_id,
        v_step_at + interval '100 milliseconds',
        v_rows_json,
        v_rows_digest
      );
    else
      select * into v_work
      from public.xrpl_phase_work
      where work_id = v_pending.payload->>'workId';
      if not found
        or v_work.profile_id <> 'supabase-devnet'
        or v_work.status not in ('committing', 'finalizing')
        or v_work.previous_ledger_index <> v_watermark_after.ledger_index
        or v_work.expected_parent_hash <> v_watermark_after.ledger_hash then
        raise exception 'r5_checkpoint_drain_finalize_work_invalid';
      end if;

      v_completion := public.xrpl_complete_portable_finalize_phase(
        p_owner,
        v_pending.message_id,
        v_step_at + interval '100 milliseconds'
      );
    end if;

    if coalesce((v_completion->>'completed')::boolean, false) is not true then
      raise exception 'r5_checkpoint_drain_completion_rejected';
    end if;

    v_drained_phases := v_drained_phases || jsonb_build_array(
      jsonb_build_object(
        'sequence', v_step + 1,
        'phase', v_pending.phase,
        'messageId', v_pending.message_id,
        'workId', v_pending.payload->>'workId',
        'chunkIndex', case
          when v_pending.phase = 'commit'
            then (v_pending.payload->>'chunkIndex')::integer
          else null
        end,
        'successorMessageId', v_completion->>'successor_message_id'
      )
    );
    v_step := v_step + 1;
  end loop;
end;
$$;

revoke all on function public.xrpl_drain_r5_checkpoint_boundary(text, timestamptz)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_drain_r5_checkpoint_boundary(text, timestamptz) to supabase_admin';
  end if;
end;
$$;
