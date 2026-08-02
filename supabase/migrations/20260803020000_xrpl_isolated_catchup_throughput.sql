create schema if not exists xrpl_catchup_v1;

create table if not exists xrpl_catchup_v1.trials (
  trial_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  source_profile_id text not null check (source_profile_id = 'supabase-devnet'),
  target_profile_id text not null check (target_profile_id = 'supabase-devnet-catchup-qualification'),
  network text not null check (network = 'devnet'),
  epoch_id text not null check (epoch_id = 'supabase-r4c2c-v1'),
  status text not null check (status in ('prepared', 'running', 'completed', 'error')),
  source_count integer not null check (source_count = 64),
  source_start_ledger_index bigint not null,
  source_end_ledger_index bigint not null,
  source_start_parent_hash text not null check (source_start_parent_hash ~ '^[A-F0-9]{64}$'),
  source_end_ledger_hash text not null check (source_end_ledger_hash ~ '^[A-F0-9]{64}$'),
  active_before_ledger_index bigint not null,
  active_before_ledger_hash text not null check (active_before_ledger_hash ~ '^[A-F0-9]{64}$'),
  active_before_work_id text not null,
  active_after_ledger_index bigint,
  active_after_ledger_hash text,
  active_after_work_id text,
  source_row_count integer,
  target_row_count integer,
  source_rows_digest text,
  target_rows_digest text,
  message_count integer,
  completed_message_count integer,
  pending_message_count integer,
  successor_count integer,
  db_elapsed_milliseconds numeric,
  started_at timestamptz,
  completed_at timestamptz,
  prepared_at timestamptz not null,
  result jsonb
);

create table if not exists xrpl_catchup_v1.source_works (
  trial_id text not null references xrpl_catchup_v1.trials(trial_id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 64),
  work_id text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  expected_parent_hash text not null check (expected_parent_hash ~ '^[A-F0-9]{64}$'),
  scanned_end_ledger_index bigint not null,
  final_ledger_hash text not null check (final_ledger_hash ~ '^[A-F0-9]{64}$'),
  plan_json text not null,
  semantic_counts_json text not null,
  payload_digest text not null,
  expected_payload_chunks integer not null,
  expected_commit_chunks integer not null,
  source_committed_at timestamptz not null,
  primary key (trial_id, ordinal),
  unique (trial_id, work_id)
);

create table if not exists xrpl_catchup_v1.streams (
  trial_id text primary key references xrpl_catchup_v1.trials(trial_id) on delete cascade,
  profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  immutable_base_ledger_index bigint not null,
  immutable_base_ledger_hash text not null,
  status text not null check (status in ('active', 'halted')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists xrpl_catchup_v1.messages (
  trial_id text not null references xrpl_catchup_v1.trials(trial_id) on delete cascade,
  message_id text not null,
  ordinal integer not null check (ordinal between 1 and 65),
  phase text not null check (phase in ('scan', 'commit', 'finalize')),
  payload jsonb not null,
  status text not null check (status in ('pending', 'leased', 'completed', 'error')),
  available_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  result jsonb,
  successor_message_id text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key (trial_id, message_id)
);

create table if not exists xrpl_catchup_v1.successors (
  trial_id text not null references xrpl_catchup_v1.trials(trial_id) on delete cascade,
  current_message_id text not null,
  successor_message_id text not null,
  reserved_at timestamptz not null,
  primary key (trial_id, current_message_id),
  unique (trial_id, successor_message_id)
);

create table if not exists xrpl_catchup_v1.work (
  trial_id text not null references xrpl_catchup_v1.trials(trial_id) on delete cascade,
  ordinal integer not null,
  work_id text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  expected_parent_hash text not null,
  scanned_end_ledger_index bigint not null,
  final_ledger_hash text not null,
  status text not null check (status in ('staged', 'committing', 'finalizing', 'committed', 'error')),
  plan_json text not null,
  semantic_counts_json text not null,
  payload_digest text not null,
  expected_payload_chunks integer not null,
  expected_commit_chunks integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  committed_at timestamptz,
  primary key (trial_id, work_id),
  unique (trial_id, ordinal)
);

create table if not exists xrpl_catchup_v1.payload_chunks (
  trial_id text not null,
  work_id text not null,
  chunk_index integer not null,
  encoding text not null,
  payload_json text not null,
  payload_digest text not null,
  encoded_digest text,
  byte_count integer not null,
  record_count integer not null,
  created_at timestamptz not null,
  primary key (trial_id, work_id, chunk_index),
  foreign key (trial_id, work_id) references xrpl_catchup_v1.work(trial_id, work_id) on delete cascade
);

create table if not exists xrpl_catchup_v1.reference_rows (
  trial_id text not null,
  work_id text not null,
  semantic_class text not null,
  canonical_key text not null,
  source_ledger_index bigint not null,
  source_ledger_hash text not null,
  source_transaction_hash text,
  object_id text,
  relationship_ids jsonb not null,
  value_json text,
  is_tombstone boolean not null,
  created_at timestamptz not null,
  primary key (trial_id, work_id, semantic_class, canonical_key),
  foreign key (trial_id, work_id) references xrpl_catchup_v1.work(trial_id, work_id) on delete cascade
);

create table if not exists xrpl_catchup_v1.commit_chunks (
  trial_id text not null,
  work_id text not null,
  chunk_index integer not null,
  status text not null check (status = 'completed'),
  operation_count integer not null,
  row_mutation_count integer not null,
  chunk_digest text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz not null,
  primary key (trial_id, work_id, chunk_index),
  foreign key (trial_id, work_id) references xrpl_catchup_v1.work(trial_id, work_id) on delete cascade
);

create table if not exists xrpl_catchup_v1.watermarks (
  trial_id text primary key references xrpl_catchup_v1.trials(trial_id) on delete cascade,
  profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  ledger_index bigint not null,
  ledger_hash text not null,
  work_id text not null,
  updated_at timestamptz not null
);

revoke all on schema xrpl_catchup_v1 from public, anon, authenticated;
revoke all on all tables in schema xrpl_catchup_v1 from public, anon, authenticated;

create or replace function public.xrpl_prepare_isolated_catchup_trial(
  p_trial_id text,
  p_source_count integer,
  p_prepared_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_catchup_v1, extensions, pg_temp
as $$
declare
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_count integer;
  v_first xrpl_catchup_v1.source_works%rowtype;
  v_last xrpl_catchup_v1.source_works%rowtype;
  v_scan_id text;
begin
  if p_trial_id !~ '^[a-z0-9][a-z0-9-]{7,99}$' then
    raise exception 'invalid catch-up trial id';
  end if;
  if p_source_count <> 64 then
    raise exception 'catch-up source count must be exactly 64';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-catchup-throughput', 0));

  if exists (select 1 from xrpl_catchup_v1.trials where trial_id = p_trial_id) then
    raise exception 'catch-up trial already exists';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = 'supabase-devnet';
  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> 'devnet'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'active Supabase Devnet source stream is unavailable';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found then
    raise exception 'active Supabase Devnet source watermark is unavailable';
  end if;

  insert into xrpl_catchup_v1.trials (
    trial_id, source_profile_id, target_profile_id, network, epoch_id, status,
    source_count, source_start_ledger_index, source_end_ledger_index,
    source_start_parent_hash, source_end_ledger_hash,
    active_before_ledger_index, active_before_ledger_hash, active_before_work_id,
    prepared_at
  ) values (
    p_trial_id, 'supabase-devnet', 'supabase-devnet-catchup-qualification',
    'devnet', 'supabase-r4c2c-v1', 'prepared', p_source_count,
    1, 1, repeat('0', 64), repeat('0', 64),
    v_watermark.ledger_index, v_watermark.ledger_hash, v_watermark.work_id,
    p_prepared_at
  );

  with latest as (
    select work.*
    from public.xrpl_phase_work as work
    where work.profile_id = 'supabase-devnet'
      and work.epoch_id = 'supabase-r4c2c-v1'
      and work.status = 'committed'
      and work.start_ledger_index <= v_watermark.ledger_index
    order by work.start_ledger_index desc, work.work_id desc
    limit p_source_count
  ), ordered as (
    select
      row_number() over (order by latest.start_ledger_index, latest.work_id)::integer as ordinal,
      latest.*
    from latest
  )
  insert into xrpl_catchup_v1.source_works (
    trial_id, ordinal, work_id, previous_ledger_index, start_ledger_index,
    expected_parent_hash, scanned_end_ledger_index, final_ledger_hash,
    plan_json, semantic_counts_json, payload_digest,
    expected_payload_chunks, expected_commit_chunks, source_committed_at
  )
  select
    p_trial_id, ordered.ordinal, ordered.work_id, ordered.previous_ledger_index,
    ordered.start_ledger_index, ordered.expected_parent_hash,
    ordered.scanned_end_ledger_index, ordered.final_ledger_hash,
    ordered.plan_json, ordered.semantic_counts_json, ordered.payload_digest,
    ordered.expected_payload_chunks, ordered.expected_commit_chunks,
    ordered.committed_at
  from ordered;

  select count(*) into v_count
  from xrpl_catchup_v1.source_works
  where trial_id = p_trial_id;
  if v_count <> p_source_count then
    raise exception 'catch-up source window is incomplete';
  end if;

  if exists (
    select 1
    from xrpl_catchup_v1.source_works as current_work
    left join xrpl_catchup_v1.source_works as previous_work
      on previous_work.trial_id = current_work.trial_id
      and previous_work.ordinal = current_work.ordinal - 1
    where current_work.trial_id = p_trial_id
      and (
        current_work.start_ledger_index <> current_work.previous_ledger_index + 1
        or current_work.scanned_end_ledger_index <> current_work.start_ledger_index
        or (
          current_work.ordinal > 1
          and (
            current_work.previous_ledger_index <> previous_work.scanned_end_ledger_index
            or current_work.start_ledger_index <> previous_work.start_ledger_index + 1
            or current_work.expected_parent_hash <> previous_work.final_ledger_hash
          )
        )
      )
  ) then
    raise exception 'catch-up source window is not contiguous';
  end if;

  select * into v_first
  from xrpl_catchup_v1.source_works
  where trial_id = p_trial_id and ordinal = 1;
  select * into v_last
  from xrpl_catchup_v1.source_works
  where trial_id = p_trial_id and ordinal = p_source_count;

  if v_last.work_id <> v_watermark.work_id
    or v_last.scanned_end_ledger_index <> v_watermark.ledger_index
    or v_last.final_ledger_hash <> v_watermark.ledger_hash then
    raise exception 'catch-up source window is not bound to the captured watermark';
  end if;

  update xrpl_catchup_v1.trials
  set
    source_start_ledger_index = v_first.start_ledger_index,
    source_end_ledger_index = v_last.scanned_end_ledger_index,
    source_start_parent_hash = v_first.expected_parent_hash,
    source_end_ledger_hash = v_last.final_ledger_hash
  where trial_id = p_trial_id;

  insert into xrpl_catchup_v1.streams (
    trial_id, profile_id, network, epoch_id, base_identity,
    immutable_base_ledger_index, immutable_base_ledger_hash,
    status, created_at, updated_at
  ) values (
    p_trial_id, 'supabase-devnet-catchup-qualification', 'devnet',
    'supabase-r4c2c-v1', concat('catchup-', p_trial_id),
    v_first.previous_ledger_index, v_first.expected_parent_hash,
    'active', p_prepared_at, p_prepared_at
  );

  v_scan_id := concat('catchup:v1:', p_trial_id, ':scan:1');
  insert into xrpl_catchup_v1.messages (
    trial_id, message_id, ordinal, phase, payload, status, available_at,
    created_at, updated_at
  ) values (
    p_trial_id, v_scan_id, 1, 'scan',
    jsonb_build_object(
      'schemaVersion', 1,
      'phase', 'scan',
      'messageId', v_scan_id,
      'ordinal', 1,
      'expectedPreviousLedgerIndex', v_first.previous_ledger_index,
      'expectedPreviousLedgerHash', v_first.expected_parent_hash
    ),
    'pending', p_prepared_at, p_prepared_at, p_prepared_at
  );

  return jsonb_build_object(
    'prepared', true,
    'trialId', p_trial_id,
    'sourceCount', p_source_count,
    'sourceStartLedgerIndex', v_first.start_ledger_index,
    'sourceEndLedgerIndex', v_last.scanned_end_ledger_index,
    'activeBefore', jsonb_build_object(
      'ledgerIndex', v_watermark.ledger_index,
      'ledgerHash', v_watermark.ledger_hash,
      'workId', v_watermark.work_id,
      'epochId', v_watermark.epoch_id,
      'baseIdentity', v_watermark.base_identity
    )
  );
end;
$$;

create or replace function public.xrpl_execute_isolated_catchup_trial(
  p_trial_id text,
  p_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_catchup_v1, extensions, pg_temp
as $$
declare
  v_trial xrpl_catchup_v1.trials%rowtype;
  v_source xrpl_catchup_v1.source_works%rowtype;
  v_active_after public.xrpl_phase_watermarks%rowtype;
  v_started_clock timestamptz;
  v_step_at timestamptz;
  v_owner text;
  v_scan_id text;
  v_commit_id text;
  v_finalize_id text;
  v_next_scan_id text;
  v_source_rows integer;
  v_target_rows integer;
  v_source_digest text;
  v_target_digest text;
  v_message_count integer;
  v_completed_count integer;
  v_pending_count integer;
  v_successor_count integer;
  v_elapsed numeric;
begin
  if p_trial_id !~ '^[a-z0-9][a-z0-9-]{7,99}$' then
    raise exception 'invalid catch-up trial id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r4c2d-catchup-throughput', 0));

  select * into v_trial
  from xrpl_catchup_v1.trials
  where trial_id = p_trial_id
  for update;
  if not found or v_trial.status <> 'prepared' or v_trial.source_count <> 64 then
    raise exception 'catch-up trial is not prepared';
  end if;

  v_started_clock := clock_timestamp();
  v_owner := concat('catchup-owner-', p_trial_id);
  update xrpl_catchup_v1.trials
  set status = 'running', started_at = p_started_at
  where trial_id = p_trial_id;

  for v_source in
    select *
    from xrpl_catchup_v1.source_works
    where trial_id = p_trial_id
    order by ordinal
  loop
    v_step_at := clock_timestamp();
    v_scan_id := concat('catchup:v1:', p_trial_id, ':scan:', v_source.ordinal);
    v_commit_id := concat('catchup:v1:', p_trial_id, ':commit:', v_source.ordinal);
    v_finalize_id := concat('catchup:v1:', p_trial_id, ':finalize:', v_source.ordinal);
    v_next_scan_id := concat('catchup:v1:', p_trial_id, ':scan:', v_source.ordinal + 1);

    update xrpl_catchup_v1.messages
    set
      status = 'leased',
      attempt_count = attempt_count + 1,
      lease_owner = v_owner,
      lease_expires_at = v_step_at + interval '55 seconds',
      updated_at = v_step_at
    where trial_id = p_trial_id
      and message_id = v_scan_id
      and status = 'pending';
    if not found then raise exception 'catch-up scan claim failed at ordinal %', v_source.ordinal; end if;

    insert into xrpl_catchup_v1.work (
      trial_id, ordinal, work_id, previous_ledger_index, start_ledger_index,
      expected_parent_hash, scanned_end_ledger_index, final_ledger_hash,
      status, plan_json, semantic_counts_json, payload_digest,
      expected_payload_chunks, expected_commit_chunks,
      created_at, updated_at
    ) values (
      p_trial_id, v_source.ordinal, v_source.work_id,
      v_source.previous_ledger_index, v_source.start_ledger_index,
      v_source.expected_parent_hash, v_source.scanned_end_ledger_index,
      v_source.final_ledger_hash, 'staged', v_source.plan_json,
      v_source.semantic_counts_json, v_source.payload_digest,
      v_source.expected_payload_chunks, v_source.expected_commit_chunks,
      v_step_at, v_step_at
    );

    insert into xrpl_catchup_v1.payload_chunks (
      trial_id, work_id, chunk_index, encoding, payload_json, payload_digest,
      encoded_digest, byte_count, record_count, created_at
    )
    select
      p_trial_id, chunks.work_id, chunks.chunk_index, chunks.encoding,
      chunks.payload_json, chunks.payload_digest, chunks.encoded_digest,
      chunks.byte_count, chunks.record_count, chunks.created_at
    from public.xrpl_phase_payload_chunks as chunks
    where chunks.work_id = v_source.work_id;
    if (select count(*) from xrpl_catchup_v1.payload_chunks where trial_id = p_trial_id and work_id = v_source.work_id)
      <> v_source.expected_payload_chunks then
      raise exception 'catch-up payload chunk parity failed at ordinal %', v_source.ordinal;
    end if;

    insert into xrpl_catchup_v1.messages (
      trial_id, message_id, ordinal, phase, payload, status, available_at,
      created_at, updated_at
    ) values (
      p_trial_id, v_commit_id, v_source.ordinal, 'commit',
      jsonb_build_object('schemaVersion', 1, 'phase', 'commit', 'messageId', v_commit_id,
        'ordinal', v_source.ordinal, 'workId', v_source.work_id),
      'pending', v_step_at, v_step_at, v_step_at
    );
    insert into xrpl_catchup_v1.successors values (
      p_trial_id, v_scan_id, v_commit_id, v_step_at
    );
    update xrpl_catchup_v1.messages
    set
      status = 'completed', lease_owner = null, lease_expires_at = null,
      successor_message_id = v_commit_id,
      result = jsonb_build_object('status', 'staged', 'workId', v_source.work_id),
      completed_at = v_step_at, updated_at = v_step_at
    where trial_id = p_trial_id and message_id = v_scan_id;

    v_step_at := clock_timestamp();
    update xrpl_catchup_v1.messages
    set
      status = 'leased', attempt_count = attempt_count + 1,
      lease_owner = v_owner, lease_expires_at = v_step_at + interval '55 seconds',
      updated_at = v_step_at
    where trial_id = p_trial_id and message_id = v_commit_id and status = 'pending';
    if not found then raise exception 'catch-up commit claim failed at ordinal %', v_source.ordinal; end if;

    update xrpl_catchup_v1.work
    set status = 'committing', updated_at = v_step_at
    where trial_id = p_trial_id and work_id = v_source.work_id and status = 'staged';

    insert into xrpl_catchup_v1.reference_rows (
      trial_id, work_id, semantic_class, canonical_key,
      source_ledger_index, source_ledger_hash, source_transaction_hash,
      object_id, relationship_ids, value_json, is_tombstone, created_at
    )
    select
      p_trial_id, rows.work_id, rows.semantic_class, rows.canonical_key,
      rows.source_ledger_index, rows.source_ledger_hash, rows.source_transaction_hash,
      rows.object_id, rows.relationship_ids, rows.value_json, rows.is_tombstone,
      rows.created_at
    from public.xrpl_phase_reference_rows as rows
    where rows.work_id = v_source.work_id;

    insert into xrpl_catchup_v1.commit_chunks (
      trial_id, work_id, chunk_index, status, operation_count,
      row_mutation_count, chunk_digest, created_at, updated_at, completed_at
    )
    select
      p_trial_id, chunks.work_id, chunks.chunk_index, 'completed',
      chunks.operation_count, chunks.row_mutation_count, chunks.chunk_digest,
      chunks.created_at, chunks.updated_at, chunks.completed_at
    from public.xrpl_phase_commit_chunks as chunks
    where chunks.work_id = v_source.work_id and chunks.status = 'completed';
    if (select count(*) from xrpl_catchup_v1.commit_chunks where trial_id = p_trial_id and work_id = v_source.work_id)
      <> v_source.expected_commit_chunks then
      raise exception 'catch-up commit chunk parity failed at ordinal %', v_source.ordinal;
    end if;

    update xrpl_catchup_v1.work
    set status = 'finalizing', updated_at = v_step_at
    where trial_id = p_trial_id and work_id = v_source.work_id;
    insert into xrpl_catchup_v1.messages (
      trial_id, message_id, ordinal, phase, payload, status, available_at,
      created_at, updated_at
    ) values (
      p_trial_id, v_finalize_id, v_source.ordinal, 'finalize',
      jsonb_build_object('schemaVersion', 1, 'phase', 'finalize', 'messageId', v_finalize_id,
        'ordinal', v_source.ordinal, 'workId', v_source.work_id),
      'pending', v_step_at, v_step_at, v_step_at
    );
    insert into xrpl_catchup_v1.successors values (
      p_trial_id, v_commit_id, v_finalize_id, v_step_at
    );
    update xrpl_catchup_v1.messages
    set
      status = 'completed', lease_owner = null, lease_expires_at = null,
      successor_message_id = v_finalize_id,
      result = jsonb_build_object('status', 'committed-chunks', 'workId', v_source.work_id),
      completed_at = v_step_at, updated_at = v_step_at
    where trial_id = p_trial_id and message_id = v_commit_id;

    v_step_at := clock_timestamp();
    update xrpl_catchup_v1.messages
    set
      status = 'leased', attempt_count = attempt_count + 1,
      lease_owner = v_owner, lease_expires_at = v_step_at + interval '55 seconds',
      updated_at = v_step_at
    where trial_id = p_trial_id and message_id = v_finalize_id and status = 'pending';
    if not found then raise exception 'catch-up finalize claim failed at ordinal %', v_source.ordinal; end if;

    if (select count(*) from xrpl_catchup_v1.payload_chunks where trial_id = p_trial_id and work_id = v_source.work_id)
        <> v_source.expected_payload_chunks
      or (select count(*) from xrpl_catchup_v1.commit_chunks where trial_id = p_trial_id and work_id = v_source.work_id)
        <> v_source.expected_commit_chunks then
      raise exception 'catch-up finalize parity failed at ordinal %', v_source.ordinal;
    end if;

    update xrpl_catchup_v1.work
    set status = 'committed', committed_at = v_step_at, updated_at = v_step_at
    where trial_id = p_trial_id and work_id = v_source.work_id and status = 'finalizing';

    insert into xrpl_catchup_v1.watermarks (
      trial_id, profile_id, network, epoch_id, base_identity,
      ledger_index, ledger_hash, work_id, updated_at
    ) values (
      p_trial_id, 'supabase-devnet-catchup-qualification', 'devnet',
      'supabase-r4c2c-v1', concat('catchup-', p_trial_id),
      v_source.scanned_end_ledger_index, v_source.final_ledger_hash,
      v_source.work_id, v_step_at
    )
    on conflict (trial_id) do update set
      ledger_index = excluded.ledger_index,
      ledger_hash = excluded.ledger_hash,
      work_id = excluded.work_id,
      updated_at = excluded.updated_at;

    insert into xrpl_catchup_v1.messages (
      trial_id, message_id, ordinal, phase, payload, status, available_at,
      created_at, updated_at
    ) values (
      p_trial_id, v_next_scan_id, v_source.ordinal + 1, 'scan',
      jsonb_build_object('schemaVersion', 1, 'phase', 'scan', 'messageId', v_next_scan_id,
        'ordinal', v_source.ordinal + 1,
        'expectedPreviousLedgerIndex', v_source.scanned_end_ledger_index,
        'expectedPreviousLedgerHash', v_source.final_ledger_hash),
      'pending', v_step_at, v_step_at, v_step_at
    );
    insert into xrpl_catchup_v1.successors values (
      p_trial_id, v_finalize_id, v_next_scan_id, v_step_at
    );
    update xrpl_catchup_v1.messages
    set
      status = 'completed', lease_owner = null, lease_expires_at = null,
      successor_message_id = v_next_scan_id,
      result = jsonb_build_object('status', 'committed', 'workId', v_source.work_id,
        'ledgerIndex', v_source.scanned_end_ledger_index),
      completed_at = v_step_at, updated_at = v_step_at
    where trial_id = p_trial_id and message_id = v_finalize_id;
  end loop;

  select count(*) into v_source_rows
  from public.xrpl_phase_reference_rows as rows
  inner join xrpl_catchup_v1.source_works as source
    on source.trial_id = p_trial_id and source.work_id = rows.work_id;
  select count(*) into v_target_rows
  from xrpl_catchup_v1.reference_rows
  where trial_id = p_trial_id;

  select encode(digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
    'ordinal', source.ordinal,
    'workId', rows.work_id,
    'semanticClass', rows.semantic_class,
    'canonicalKey', rows.canonical_key,
    'sourceLedgerIndex', rows.source_ledger_index,
    'sourceLedgerHash', rows.source_ledger_hash,
    'sourceTransactionHash', rows.source_transaction_hash,
    'objectId', rows.object_id,
    'relationshipIds', rows.relationship_ids,
    'valueJson', rows.value_json,
    'isTombstone', rows.is_tombstone,
    'createdAt', rows.created_at
  ) order by source.ordinal, rows.semantic_class, rows.canonical_key), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  into v_source_digest
  from public.xrpl_phase_reference_rows as rows
  inner join xrpl_catchup_v1.source_works as source
    on source.trial_id = p_trial_id and source.work_id = rows.work_id;

  select encode(digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
    'ordinal', source.ordinal,
    'workId', rows.work_id,
    'semanticClass', rows.semantic_class,
    'canonicalKey', rows.canonical_key,
    'sourceLedgerIndex', rows.source_ledger_index,
    'sourceLedgerHash', rows.source_ledger_hash,
    'sourceTransactionHash', rows.source_transaction_hash,
    'objectId', rows.object_id,
    'relationshipIds', rows.relationship_ids,
    'valueJson', rows.value_json,
    'isTombstone', rows.is_tombstone,
    'createdAt', rows.created_at
  ) order by source.ordinal, rows.semantic_class, rows.canonical_key), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  into v_target_digest
  from xrpl_catchup_v1.reference_rows as rows
  inner join xrpl_catchup_v1.source_works as source
    on source.trial_id = p_trial_id and source.work_id = rows.work_id
  where rows.trial_id = p_trial_id;

  select count(*), count(*) filter (where status = 'completed'), count(*) filter (where status = 'pending')
  into v_message_count, v_completed_count, v_pending_count
  from xrpl_catchup_v1.messages
  where trial_id = p_trial_id;
  select count(*) into v_successor_count
  from xrpl_catchup_v1.successors
  where trial_id = p_trial_id;

  if v_source_rows <> v_target_rows or v_source_digest <> v_target_digest then
    raise exception 'catch-up committed-row parity failed';
  end if;
  if (select count(*) from xrpl_catchup_v1.work where trial_id = p_trial_id and status = 'committed') <> 64
    or v_message_count <> 193
    or v_completed_count <> 192
    or v_pending_count <> 1
    or v_successor_count <> 192
    or exists (
      select 1 from xrpl_catchup_v1.messages
      where trial_id = p_trial_id and status = 'completed' and attempt_count <> 1
    )
    or exists (
      select 1 from xrpl_catchup_v1.messages
      where trial_id = p_trial_id and status = 'pending' and attempt_count <> 0
    ) then
    raise exception 'catch-up scheduler parity failed';
  end if;

  select * into v_active_after
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet';
  if not found
    or v_active_after.ledger_index < v_trial.active_before_ledger_index
    or v_active_after.epoch_id <> 'supabase-r4c2c-v1'
    or v_active_after.base_identity is distinct from (
      select base_identity from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet'
    ) then
    raise exception 'active profile changed incompatibly during catch-up qualification';
  end if;

  if not exists (
    select 1
    from xrpl_catchup_v1.watermarks as watermark
    where watermark.trial_id = p_trial_id
      and watermark.ledger_index = v_trial.source_end_ledger_index
      and watermark.ledger_hash = v_trial.source_end_ledger_hash
  ) then
    raise exception 'catch-up target watermark does not match the source window';
  end if;

  v_elapsed := extract(epoch from (clock_timestamp() - v_started_clock)) * 1000;

  update xrpl_catchup_v1.trials
  set
    status = 'completed',
    active_after_ledger_index = v_active_after.ledger_index,
    active_after_ledger_hash = v_active_after.ledger_hash,
    active_after_work_id = v_active_after.work_id,
    source_row_count = v_source_rows,
    target_row_count = v_target_rows,
    source_rows_digest = v_source_digest,
    target_rows_digest = v_target_digest,
    message_count = v_message_count,
    completed_message_count = v_completed_count,
    pending_message_count = v_pending_count,
    successor_count = v_successor_count,
    db_elapsed_milliseconds = v_elapsed,
    completed_at = clock_timestamp(),
    result = jsonb_build_object(
      'committedWorks', 64,
      'messages', v_message_count,
      'completedMessages', v_completed_count,
      'pendingMessages', v_pending_count,
      'successors', v_successor_count,
      'sourceRows', v_source_rows,
      'targetRows', v_target_rows,
      'rowDigestParity', v_source_digest = v_target_digest
    )
  where trial_id = p_trial_id;

  return public.xrpl_read_isolated_catchup_trial(p_trial_id);
end;
$$;

create or replace function public.xrpl_read_isolated_catchup_trial(p_trial_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_catchup_v1, pg_temp
as $$
declare
  v_trial xrpl_catchup_v1.trials%rowtype;
  v_watermark xrpl_catchup_v1.watermarks%rowtype;
  v_committed integer;
  v_message_count integer;
  v_completed_count integer;
  v_pending_count integer;
  v_attempt_one_count integer;
  v_successor_count integer;
begin
  select * into v_trial from xrpl_catchup_v1.trials where trial_id = p_trial_id;
  if not found then raise exception 'catch-up trial not found'; end if;
  select * into v_watermark from xrpl_catchup_v1.watermarks where trial_id = p_trial_id;
  select count(*) into v_committed from xrpl_catchup_v1.work where trial_id = p_trial_id and status = 'committed';
  select
    count(*),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'completed' and attempt_count = 1)
  into v_message_count, v_completed_count, v_pending_count, v_attempt_one_count
  from xrpl_catchup_v1.messages where trial_id = p_trial_id;
  select count(*) into v_successor_count from xrpl_catchup_v1.successors where trial_id = p_trial_id;

  return jsonb_build_object(
    'trialId', v_trial.trial_id,
    'status', v_trial.status,
    'sourceCount', v_trial.source_count,
    'sourceStartLedgerIndex', v_trial.source_start_ledger_index,
    'sourceEndLedgerIndex', v_trial.source_end_ledger_index,
    'sourceEndLedgerHash', v_trial.source_end_ledger_hash,
    'dbElapsedMilliseconds', v_trial.db_elapsed_milliseconds,
    'committedWorks', v_committed,
    'sourceRowCount', v_trial.source_row_count,
    'targetRowCount', v_trial.target_row_count,
    'sourceRowsDigest', v_trial.source_rows_digest,
    'targetRowsDigest', v_trial.target_rows_digest,
    'messages', jsonb_build_object(
      'total', v_message_count,
      'completed', v_completed_count,
      'pending', v_pending_count,
      'completedAttemptOne', v_attempt_one_count
    ),
    'successors', v_successor_count,
    'targetWatermark', case when v_watermark.trial_id is null then null else jsonb_build_object(
      'ledgerIndex', v_watermark.ledger_index,
      'ledgerHash', v_watermark.ledger_hash,
      'workId', v_watermark.work_id
    ) end,
    'activeBefore', jsonb_build_object(
      'ledgerIndex', v_trial.active_before_ledger_index,
      'ledgerHash', v_trial.active_before_ledger_hash,
      'workId', v_trial.active_before_work_id
    ),
    'activeAfter', jsonb_build_object(
      'ledgerIndex', v_trial.active_after_ledger_index,
      'ledgerHash', v_trial.active_after_ledger_hash,
      'workId', v_trial.active_after_work_id
    ),
    'checks', jsonb_build_object(
      'fullPhaseSequence', v_committed = 64 and v_completed_count = 192 and v_pending_count = 1,
      'allCompletedAttemptsOne', v_attempt_one_count = 192,
      'successorParity', v_successor_count = 192,
      'rowCountParity', v_trial.source_row_count = v_trial.target_row_count,
      'rowDigestParity', v_trial.source_rows_digest = v_trial.target_rows_digest,
      'targetWatermarkMatchesSource', v_watermark.ledger_index = v_trial.source_end_ledger_index
        and v_watermark.ledger_hash = v_trial.source_end_ledger_hash,
      'activeProfileNonRegressing', v_trial.active_after_ledger_index >= v_trial.active_before_ledger_index
    )
  );
end;
$$;

revoke all on function public.xrpl_prepare_isolated_catchup_trial(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_execute_isolated_catchup_trial(text, timestamptz) from public, anon, authenticated;
revoke all on function public.xrpl_read_isolated_catchup_trial(text) from public, anon, authenticated;
grant execute on function public.xrpl_prepare_isolated_catchup_trial(text, integer, timestamptz) to service_role;
grant execute on function public.xrpl_execute_isolated_catchup_trial(text, timestamptz) to service_role;
grant execute on function public.xrpl_read_isolated_catchup_trial(text) to service_role;
