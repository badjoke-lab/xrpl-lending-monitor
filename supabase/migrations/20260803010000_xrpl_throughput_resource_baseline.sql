create or replace function public.xrpl_read_throughput_resource_baseline(
  p_observed_at timestamptz,
  p_window_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet';
  v_window_start timestamptz;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_throughput jsonb;
  v_work_latency jsonb;
  v_phase_attempts jsonb;
  v_storage jsonb;
  v_rows jsonb;
  v_payload jsonb;
  v_scheduler jsonb;
  v_connections jsonb;
  v_runtime jsonb;
begin
  if p_observed_at is null then
    raise exception 'throughput baseline observed_at is required';
  end if;
  if p_window_minutes not in (60, 360, 1440) then
    raise exception 'throughput baseline window must be 60, 360, or 1440 minutes';
  end if;

  v_window_start := p_observed_at - make_interval(mins => p_window_minutes);

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = v_profile_id;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_profile_id;

  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1'
    or v_watermark.network <> v_stream.network
    or v_watermark.epoch_id <> v_stream.epoch_id
    or v_watermark.base_identity <> v_stream.base_identity then
    raise exception 'throughput baseline active profile identity is unavailable';
  end if;

  with minute_series as (
    select generate_series(
      date_trunc('minute', v_window_start),
      date_trunc('minute', p_observed_at) - interval '1 minute',
      interval '1 minute'
    ) as minute_start
  ), committed as (
    select
      date_trunc('minute', committed_at) as minute_start,
      sum(scanned_end_ledger_index - start_ledger_index + 1)::integer as ledgers,
      count(*)::integer as works,
      sum((semantic_counts_json::jsonb->>'totalRecords')::integer)::bigint as records
    from public.xrpl_phase_work
    where profile_id = v_profile_id
      and status = 'committed'
      and committed_at is not null
      and committed_at >= v_window_start
      and committed_at < p_observed_at
    group by 1
  ), buckets as (
    select
      series.minute_start,
      coalesce(committed.ledgers, 0)::integer as ledgers,
      coalesce(committed.works, 0)::integer as works,
      coalesce(committed.records, 0)::bigint as records
    from minute_series as series
    left join committed using (minute_start)
  ), totals as (
    select
      count(*)::integer as observed_minutes,
      sum(ledgers)::bigint as committed_ledgers,
      sum(works)::bigint as committed_works,
      sum(records)::bigint as committed_records,
      avg(ledgers)::numeric as average_ledgers_per_minute,
      percentile_cont(0.5) within group (order by ledgers)::numeric as p50_ledgers_per_minute,
      percentile_cont(0.95) within group (order by ledgers)::numeric as p95_ledgers_per_minute,
      max(ledgers)::integer as max_ledgers_per_minute,
      count(*) filter (where ledgers > 0)::integer as productive_minutes,
      count(*) filter (where ledgers = 0)::integer as zero_minutes
    from buckets
  )
  select jsonb_build_object(
    'windowMinutes', p_window_minutes,
    'windowStart', v_window_start,
    'windowEnd', p_observed_at,
    'observedMinutes', observed_minutes,
    'committedLedgers', committed_ledgers,
    'committedWorks', committed_works,
    'committedRecords', committed_records,
    'averageLedgersPerMinute', round(average_ledgers_per_minute, 6),
    'p50LedgersPerMinute', round(p50_ledgers_per_minute, 6),
    'p95LedgersPerMinute', round(p95_ledgers_per_minute, 6),
    'maxLedgersPerMinute', max_ledgers_per_minute,
    'productiveMinutes', productive_minutes,
    'zeroMinutes', zero_minutes,
    'steadyThreshold', 21,
    'catchUpThreshold', 30,
    'steadyP95Passed', p95_ledgers_per_minute > 21,
    'catchUpAveragePassed', average_ledgers_per_minute > 30
  ) into v_throughput
  from totals;

  select jsonb_build_object(
    'sampleCount', count(*),
    'p50Milliseconds', coalesce(round(percentile_cont(0.5) within group (
      order by extract(epoch from (committed_at - created_at)) * 1000
    )::numeric, 3), 0),
    'p95Milliseconds', coalesce(round(percentile_cont(0.95) within group (
      order by extract(epoch from (committed_at - created_at)) * 1000
    )::numeric, 3), 0),
    'maxMilliseconds', coalesce(round(max(
      extract(epoch from (committed_at - created_at)) * 1000
    )::numeric, 3), 0)
  ) into v_work_latency
  from public.xrpl_phase_work
  where profile_id = v_profile_id
    and status = 'committed'
    and committed_at is not null
    and committed_at >= v_window_start
    and committed_at < p_observed_at;

  select coalesce(jsonb_object_agg(phase, phase_value order by phase), '{}'::jsonb)
  into v_phase_attempts
  from (
    select
      phase,
      jsonb_build_object(
        'messages', count(*),
        'completed', count(*) filter (where status = 'completed'),
        'retry', count(*) filter (where status = 'retry'),
        'error', count(*) filter (where status = 'error'),
        'p50Attempts', coalesce(percentile_cont(0.5) within group (order by attempt_count), 0),
        'p95Attempts', coalesce(percentile_cont(0.95) within group (order by attempt_count), 0),
        'maxAttempts', coalesce(max(attempt_count), 0)
      ) as phase_value
    from public.xrpl_phase_messages
    where profile_id = v_profile_id
      and created_at >= v_window_start
      and created_at < p_observed_at
    group by phase
  ) phases;

  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'phaseStreamsBytes', pg_total_relation_size('public.xrpl_phase_streams'::regclass),
    'phaseMessagesBytes', pg_total_relation_size('public.xrpl_phase_messages'::regclass),
    'phaseSuccessorsBytes', pg_total_relation_size('public.xrpl_phase_successors'::regclass),
    'phaseWorkBytes', pg_total_relation_size('public.xrpl_phase_work'::regclass),
    'payloadChunksBytes', pg_total_relation_size('public.xrpl_phase_payload_chunks'::regclass),
    'referenceRowsBytes', pg_total_relation_size('public.xrpl_phase_reference_rows'::regclass),
    'commitChunksBytes', pg_total_relation_size('public.xrpl_phase_commit_chunks'::regclass),
    'watermarksBytes', pg_total_relation_size('public.xrpl_phase_watermarks'::regclass)
  ) into v_storage;

  select jsonb_build_object(
    'phaseStreams', (select count(*) from public.xrpl_phase_streams where profile_id = v_profile_id),
    'phaseMessages', (select count(*) from public.xrpl_phase_messages where profile_id = v_profile_id),
    'phaseSuccessors', (
      select count(*)
      from public.xrpl_phase_successors as successors
      where exists (
        select 1
        from public.xrpl_phase_messages as messages
        where messages.profile_id = v_profile_id
          and messages.message_id = successors.current_message_id
      )
    ),
    'phaseWork', (select count(*) from public.xrpl_phase_work where profile_id = v_profile_id),
    'payloadChunks', (
      select count(*)
      from public.xrpl_phase_payload_chunks as chunks
      where exists (
        select 1 from public.xrpl_phase_work as work
        where work.profile_id = v_profile_id and work.work_id = chunks.work_id
      )
    ),
    'referenceRows', (
      select count(*)
      from public.xrpl_phase_reference_rows as rows
      where exists (
        select 1 from public.xrpl_phase_work as work
        where work.profile_id = v_profile_id and work.work_id = rows.work_id
      )
    ),
    'commitChunks', (
      select count(*)
      from public.xrpl_phase_commit_chunks as chunks
      where exists (
        select 1 from public.xrpl_phase_work as work
        where work.profile_id = v_profile_id and work.work_id = chunks.work_id
      )
    ),
    'watermarks', (select count(*) from public.xrpl_phase_watermarks where profile_id = v_profile_id)
  ) into v_rows;

  select jsonb_build_object(
    'sampleCount', count(*),
    'totalBytes', coalesce(sum(octet_length(payload_json::text)), 0),
    'p50Bytes', coalesce(percentile_cont(0.5) within group (order by octet_length(payload_json::text)), 0),
    'p95Bytes', coalesce(percentile_cont(0.95) within group (order by octet_length(payload_json::text)), 0),
    'maxBytes', coalesce(max(octet_length(payload_json::text)), 0),
    'configuredCeilingBytes', 512000,
    'maxInsideConfiguredCeiling', coalesce(max(octet_length(payload_json::text)), 0) <= 512000
  ) into v_payload
  from public.xrpl_phase_payload_chunks as chunks
  where exists (
    select 1
    from public.xrpl_phase_work as work
    where work.profile_id = v_profile_id
      and work.work_id = chunks.work_id
      and work.created_at >= v_window_start
      and work.created_at < p_observed_at
  );

  select jsonb_build_object(
    'sampleCount', count(*),
    'totalPayloadBytes', coalesce(sum(octet_length(payload::text)), 0),
    'p50PayloadBytes', coalesce(percentile_cont(0.5) within group (order by octet_length(payload::text)), 0),
    'p95PayloadBytes', coalesce(percentile_cont(0.95) within group (order by octet_length(payload::text)), 0),
    'maxPayloadBytes', coalesce(max(octet_length(payload::text)), 0),
    'configuredCeilingBytes', 16000,
    'maxInsideConfiguredCeiling', coalesce(max(octet_length(payload::text)), 0) <= 16000,
    'pending', count(*) filter (where status = 'pending'),
    'leased', count(*) filter (where status = 'leased'),
    'retry', count(*) filter (where status = 'retry'),
    'completed', count(*) filter (where status = 'completed'),
    'error', count(*) filter (where status = 'error')
  ) into v_scheduler
  from public.xrpl_phase_messages
  where profile_id = v_profile_id;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where state = 'active'),
    'idle', count(*) filter (where state = 'idle'),
    'idleInTransaction', count(*) filter (where state = 'idle in transaction'),
    'maxConnectionsSetting', current_setting('max_connections')::integer,
    'usageRatio', round(count(*)::numeric / current_setting('max_connections')::numeric, 6)
  ) into v_connections
  from pg_stat_activity
  where datname = current_database();

  select jsonb_build_object(
    'tickCount', tick_count,
    'consecutiveFailures', consecutive_failures,
    'lastTickAt', last_tick_at,
    'lastSuccessAt', last_success_at,
    'lastError', last_error,
    'updatedAt', updated_at
  ) into v_runtime
  from public.xrpl_probe_runtime
  where id = 1;

  return jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r4c2d-throughput-resource-baseline',
    'profile', jsonb_build_object(
      'profileId', v_profile_id,
      'network', v_stream.network,
      'epochId', v_stream.epoch_id,
      'baseIdentity', v_stream.base_identity,
      'streamStatus', v_stream.status,
      'watermarkLedgerIndex', v_watermark.ledger_index,
      'watermarkLedgerHash', v_watermark.ledger_hash,
      'watermarkWorkId', v_watermark.work_id
    ),
    'observedAt', p_observed_at,
    'throughput', v_throughput,
    'workLatency', v_work_latency,
    'phaseAttempts', v_phase_attempts,
    'storage', v_storage,
    'rows', v_rows,
    'payload', v_payload,
    'scheduler', v_scheduler,
    'connections', v_connections,
    'runtime', v_runtime,
    'measurementCoverage', jsonb_build_object(
      'committedThroughput', true,
      'workLatency', true,
      'phaseAttempts', true,
      'databaseStorage', true,
      'tableStorage', true,
      'rowCounts', true,
      'payloadBytes', true,
      'schedulerPayloadBytes', true,
      'databaseConnections', true,
      'edgeCpu', false,
      'edgeMemory', false,
      'edgeInvocationCount', false,
      'bandwidth', false,
      'billingAndOverage', false
    )
  );
end;
$$;

revoke all on function public.xrpl_read_throughput_resource_baseline(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.xrpl_read_throughput_resource_baseline(timestamptz, integer)
  to service_role;
