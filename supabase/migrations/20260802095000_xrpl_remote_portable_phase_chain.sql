create extension if not exists pgcrypto with schema extensions;

create table if not exists public.xrpl_phase_streams (
  profile_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  network text not null check (network = 'devnet'),
  epoch_id text not null,
  base_identity text not null,
  immutable_base_ledger_index bigint not null check (immutable_base_ledger_index > 0),
  immutable_base_ledger_hash text not null check (immutable_base_ledger_hash ~ '^[A-F0-9]{64}$'),
  status text not null default 'active' check (status in ('active', 'halted')),
  last_error_classification text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.xrpl_phase_messages (
  message_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null references public.xrpl_phase_streams(profile_id),
  phase text not null check (phase in ('scan', 'commit', 'finalize')),
  payload jsonb not null,
  status text not null check (status in ('pending', 'leased', 'retry', 'completed', 'error')),
  available_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  result jsonb,
  successor_message_id text,
  error_classification text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  constraint xrpl_phase_messages_lease_pair_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint xrpl_phase_messages_completed_check check (
    (status = 'completed' and completed_at is not null)
    or status <> 'completed'
  ),
  constraint xrpl_phase_messages_error_check check (
    (status = 'error' and error_classification is not null and error_message is not null)
    or status <> 'error'
  )
);

create index if not exists xrpl_phase_messages_ready_idx
  on public.xrpl_phase_messages(profile_id, status, available_at, created_at, message_id);

create table if not exists public.xrpl_phase_successors (
  current_message_id text primary key references public.xrpl_phase_messages(message_id),
  successor_message_id text not null unique references public.xrpl_phase_messages(message_id),
  reserved_at timestamptz not null
);

create table if not exists public.xrpl_phase_work (
  work_id text primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null references public.xrpl_phase_streams(profile_id),
  network text not null check (network = 'devnet'),
  epoch_id text not null,
  base_identity text not null,
  previous_ledger_index bigint not null check (previous_ledger_index >= 0),
  start_ledger_index bigint not null check (start_ledger_index = previous_ledger_index + 1),
  expected_parent_hash text not null check (expected_parent_hash ~ '^[A-F0-9]{64}$'),
  planned_end_ledger_index bigint not null check (planned_end_ledger_index >= start_ledger_index),
  scanned_end_ledger_index bigint,
  final_ledger_hash text,
  status text not null check (status in ('planned', 'staged', 'committing', 'finalizing', 'committed', 'error')),
  plan_json text not null,
  semantic_counts_json text,
  payload_digest text,
  expected_payload_chunks integer not null default 0 check (expected_payload_chunks >= 0),
  expected_commit_chunks integer not null default 0 check (expected_commit_chunks >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  committed_at timestamptz,
  unique (profile_id, start_ledger_index, expected_parent_hash),
  constraint xrpl_phase_work_hash_check check (
    final_ledger_hash is null or final_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  constraint xrpl_phase_work_committed_check check (
    (status = 'committed' and committed_at is not null and final_ledger_hash is not null)
    or status <> 'committed'
  )
);

create index if not exists xrpl_phase_work_status_idx
  on public.xrpl_phase_work(profile_id, status, updated_at, work_id);

create table if not exists public.xrpl_phase_payload_chunks (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  encoding text not null,
  payload_json text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  byte_count integer not null check (byte_count >= 0),
  record_count integer not null check (record_count >= 0),
  created_at timestamptz not null,
  primary key (work_id, chunk_index)
);

create table if not exists public.xrpl_phase_reference_rows (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  semantic_class text not null check (semantic_class = 'validated-ledger'),
  canonical_key text not null,
  source_ledger_index bigint not null check (source_ledger_index > 0),
  source_ledger_hash text not null check (source_ledger_hash ~ '^[A-F0-9]{64}$'),
  source_transaction_hash text,
  object_id text,
  relationship_ids jsonb not null default '[]'::jsonb,
  value_json text,
  is_tombstone boolean not null default false,
  created_at timestamptz not null,
  primary key (work_id, semantic_class, canonical_key),
  constraint xrpl_phase_reference_tx_hash_check check (
    source_transaction_hash is null or source_transaction_hash ~ '^[A-F0-9]{64}$'
  ),
  constraint xrpl_phase_reference_relationships_check check (jsonb_typeof(relationship_ids) = 'array')
);

create index if not exists xrpl_phase_reference_lookup_idx
  on public.xrpl_phase_reference_rows(semantic_class, canonical_key, source_ledger_index);

create table if not exists public.xrpl_phase_commit_chunks (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  status text not null check (status in ('completed', 'error')),
  operation_count integer not null check (operation_count >= 0),
  row_mutation_count integer not null check (row_mutation_count >= 0),
  chunk_digest text not null check (chunk_digest ~ '^[a-f0-9]{64}$'),
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key (work_id, chunk_index),
  constraint xrpl_phase_commit_completed_check check (
    (status = 'completed' and completed_at is not null)
    or status <> 'completed'
  )
);

create table if not exists public.xrpl_phase_watermarks (
  profile_id text primary key references public.xrpl_phase_streams(profile_id),
  network text not null check (network = 'devnet'),
  epoch_id text not null,
  base_identity text not null,
  ledger_index bigint not null check (ledger_index > 0),
  ledger_hash text not null check (ledger_hash ~ '^[A-F0-9]{64}$'),
  work_id text not null references public.xrpl_phase_work(work_id),
  updated_at timestamptz not null
);

create or replace view public.xrpl_phase_committed_reference_rows as
select
  rows.work_id,
  rows.semantic_class,
  rows.canonical_key,
  rows.source_ledger_index,
  rows.source_ledger_hash,
  rows.source_transaction_hash,
  rows.object_id,
  rows.relationship_ids,
  rows.value_json,
  rows.is_tombstone,
  rows.created_at
from public.xrpl_phase_reference_rows as rows
inner join public.xrpl_phase_work as work on work.work_id = rows.work_id
where work.status = 'committed';

alter table public.xrpl_phase_streams enable row level security;
alter table public.xrpl_phase_messages enable row level security;
alter table public.xrpl_phase_successors enable row level security;
alter table public.xrpl_phase_work enable row level security;
alter table public.xrpl_phase_payload_chunks enable row level security;
alter table public.xrpl_phase_reference_rows enable row level security;
alter table public.xrpl_phase_commit_chunks enable row level security;
alter table public.xrpl_phase_watermarks enable row level security;

revoke all on public.xrpl_phase_streams from anon, authenticated;
revoke all on public.xrpl_phase_messages from anon, authenticated;
revoke all on public.xrpl_phase_successors from anon, authenticated;
revoke all on public.xrpl_phase_work from anon, authenticated;
revoke all on public.xrpl_phase_payload_chunks from anon, authenticated;
revoke all on public.xrpl_phase_reference_rows from anon, authenticated;
revoke all on public.xrpl_phase_commit_chunks from anon, authenticated;
revoke all on public.xrpl_phase_watermarks from anon, authenticated;
revoke all on public.xrpl_phase_committed_reference_rows from anon, authenticated;

grant select, insert, update on public.xrpl_phase_streams to service_role;
grant select, insert, update on public.xrpl_phase_messages to service_role;
grant select, insert on public.xrpl_phase_successors to service_role;
grant select, insert, update on public.xrpl_phase_work to service_role;
grant select, insert on public.xrpl_phase_payload_chunks to service_role;
grant select, insert on public.xrpl_phase_reference_rows to service_role;
grant select, insert on public.xrpl_phase_commit_chunks to service_role;
grant select, insert, update on public.xrpl_phase_watermarks to service_role;
grant select on public.xrpl_phase_committed_reference_rows to service_role;

create or replace function public.xrpl_phase_scan_message_id(
  p_network text,
  p_epoch_id text,
  p_base_identity text,
  p_previous_ledger_index bigint,
  p_previous_ledger_hash text,
  p_scan_sequence integer
)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select concat(
    'scan:v1:', p_network, ':', p_epoch_id, ':', p_base_identity, ':',
    p_previous_ledger_index::text, ':', upper(p_previous_ledger_hash), ':',
    p_scan_sequence::text
  )
$$;

create or replace function public.xrpl_phase_work_id(
  p_network text,
  p_epoch_id text,
  p_base_identity text,
  p_previous_ledger_index bigint,
  p_expected_parent_hash text
)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select concat(
    'collector-work-v1:', p_network, ':', p_epoch_id, ':', p_base_identity, ':',
    (p_previous_ledger_index + 1)::text, ':', upper(p_expected_parent_hash)
  )
$$;

create or replace function public.xrpl_phase_commit_message_id(p_work_id text, p_chunk_index integer)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select concat('commit:v1:', p_work_id, ':', p_chunk_index::text)
$$;

create or replace function public.xrpl_phase_finalize_message_id(p_work_id text)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select concat('finalize:v1:', p_work_id)
$$;

create or replace function public.xrpl_phase_insert_message(
  p_profile_id text,
  p_phase text,
  p_message_id text,
  p_payload jsonb,
  p_available_at timestamptz,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.xrpl_phase_messages%rowtype;
begin
  insert into public.xrpl_phase_messages (
    message_id, profile_id, phase, payload, status, available_at,
    created_at, updated_at
  ) values (
    p_message_id, p_profile_id, p_phase, p_payload, 'pending', p_available_at,
    p_created_at, p_created_at
  )
  on conflict (message_id) do nothing;

  select * into v_existing
  from public.xrpl_phase_messages
  where message_id = p_message_id;

  if v_existing.profile_id <> p_profile_id
    or v_existing.phase <> p_phase
    or v_existing.payload <> p_payload then
    raise exception 'phase message identity conflict: %', p_message_id;
  end if;
end;
$$;

create or replace function public.xrpl_phase_reserve_successor(
  p_current_message_id text,
  p_successor_message_id text,
  p_reserved_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.xrpl_phase_successors(
    current_message_id, successor_message_id, reserved_at
  ) values (
    p_current_message_id, p_successor_message_id, p_reserved_at
  )
  on conflict (current_message_id) do nothing;

  if not exists (
    select 1
    from public.xrpl_phase_successors
    where current_message_id = p_current_message_id
      and successor_message_id = p_successor_message_id
  ) then
    raise exception 'phase successor identity conflict: %', p_current_message_id;
  end if;
end;
$$;

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
    return jsonb_build_object('claimed', false, 'reason', 'no_ready_message');
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
    'lease_expires_at', v_message.lease_expires_at
  );
end;
$$;

create or replace function public.xrpl_complete_caught_up_scan(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
  v_successor_id text;
  v_successor_payload jsonb;
begin
  select * into v_message
  from public.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.phase <> 'scan' then
    raise exception 'scan message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'successor_message_id', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased' or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  v_successor_id := public.xrpl_phase_scan_message_id(
    v_message.payload->>'network',
    v_message.payload->>'epochId',
    v_message.payload->>'baseIdentity',
    (v_message.payload->>'expectedPreviousLedgerIndex')::bigint,
    v_message.payload->>'expectedPreviousLedgerHash',
    (v_message.payload->>'scanSequence')::integer + 1
  );
  v_successor_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'scan',
    'messageId', v_successor_id,
    'network', v_message.payload->>'network',
    'epochId', v_message.payload->>'epochId',
    'baseIdentity', v_message.payload->>'baseIdentity',
    'expectedPreviousLedgerIndex', (v_message.payload->>'expectedPreviousLedgerIndex')::bigint,
    'expectedPreviousLedgerHash', upper(v_message.payload->>'expectedPreviousLedgerHash'),
    'scanSequence', (v_message.payload->>'scanSequence')::integer + 1
  );

  perform public.xrpl_phase_insert_message(
    v_message.profile_id, 'scan', v_successor_id, v_successor_payload,
    p_completed_at + interval '1 second', p_completed_at
  );
  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_successor_id, p_completed_at
  );

  update public.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'caught_up',
      'ledgerIndex', (v_message.payload->>'expectedPreviousLedgerIndex')::bigint,
      'scanSequence', (v_message.payload->>'scanSequence')::integer,
      'successorScanSequence', (v_message.payload->>'scanSequence')::integer + 1
    ),
    successor_message_id = v_successor_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'successor_message_id', v_successor_id
  );
end;
$$;

create or replace function public.xrpl_complete_scan_phase(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz,
  p_ledger_index bigint,
  p_ledger_hash text,
  p_parent_hash text,
  p_close_time bigint,
  p_payload_json text,
  p_payload_digest text,
  p_byte_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_previous_index bigint;
  v_previous_hash text;
  v_work_id text;
  v_commit_id text;
  v_commit_payload jsonb;
  v_plan_json text;
  v_value_json text;
  v_actual_payload_digest text;
begin
  if p_ledger_index <= 0 or p_ledger_hash !~ '^[A-F0-9]{64}$'
    or p_parent_hash !~ '^[A-F0-9]{64}$' then
    raise exception 'invalid ledger identity';
  end if;
  if p_payload_digest !~ '^[a-f0-9]{64}$' or p_byte_count < 1 then
    raise exception 'invalid payload identity';
  end if;
  perform p_payload_json::jsonb;
  v_actual_payload_digest := encode(
    extensions.digest(convert_to(p_payload_json, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_actual_payload_digest <> p_payload_digest
    or octet_length(p_payload_json) <> p_byte_count then
    raise exception 'payload digest or byte count mismatch';
  end if;

  select * into v_message
  from public.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.phase <> 'scan' then
    raise exception 'scan message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'successor_message_id', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased' or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = v_message.profile_id
  for update;
  if not found or v_stream.status <> 'active' then
    raise exception 'phase stream is unavailable';
  end if;

  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_message.profile_id
  for update;

  if found then
    v_previous_index := v_watermark.ledger_index;
    v_previous_hash := v_watermark.ledger_hash;
  else
    v_previous_index := v_stream.immutable_base_ledger_index;
    v_previous_hash := v_stream.immutable_base_ledger_hash;
  end if;

  if (v_message.payload->>'expectedPreviousLedgerIndex')::bigint <> v_previous_index
    or upper(v_message.payload->>'expectedPreviousLedgerHash') <> v_previous_hash then
    raise exception 'stale scan boundary';
  end if;
  if p_ledger_index <> v_previous_index + 1 or upper(p_parent_hash) <> v_previous_hash then
    raise exception 'parent hash mismatch';
  end if;

  v_work_id := public.xrpl_phase_work_id(
    v_stream.network, v_stream.epoch_id, v_stream.base_identity,
    v_previous_index, v_previous_hash
  );
  v_plan_json := jsonb_build_object(
    'schemaVersion', 1,
    'workId', v_work_id,
    'network', v_stream.network,
    'epochId', v_stream.epoch_id,
    'baseIdentity', v_stream.base_identity,
    'previousLedgerIndex', v_previous_index,
    'expectedParentHash', v_previous_hash,
    'startLedgerIndex', p_ledger_index,
    'endLedgerIndex', p_ledger_index,
    'selectedLedgerCount', 1
  )::text;
  v_value_json := jsonb_build_object(
    'closeTime', p_close_time,
    'ledgerHash', upper(p_ledger_hash),
    'ledgerIndex', p_ledger_index,
    'parentHash', upper(p_parent_hash)
  )::text;

  insert into public.xrpl_phase_work (
    work_id, profile_id, network, epoch_id, base_identity,
    previous_ledger_index, start_ledger_index, expected_parent_hash,
    planned_end_ledger_index, scanned_end_ledger_index, final_ledger_hash,
    status, plan_json, semantic_counts_json, payload_digest,
    expected_payload_chunks, expected_commit_chunks, created_at, updated_at
  ) values (
    v_work_id, v_stream.profile_id, v_stream.network, v_stream.epoch_id,
    v_stream.base_identity, v_previous_index, p_ledger_index, v_previous_hash,
    p_ledger_index, p_ledger_index, upper(p_ledger_hash), 'staged', v_plan_json,
    '{"archivedObjects":0,"balanceHistory":0,"currentProjectionMutations":0,"ledgers":1,"loanLifecycleEvents":0,"objectChanges":0,"protocolEvents":0,"totalRecords":1}',
    p_payload_digest, 1, 1, p_completed_at, p_completed_at
  )
  on conflict (work_id) do nothing;

  if not exists (
    select 1 from public.xrpl_phase_work
    where work_id = v_work_id
      and profile_id = v_stream.profile_id
      and previous_ledger_index = v_previous_index
      and expected_parent_hash = v_previous_hash
      and scanned_end_ledger_index = p_ledger_index
      and final_ledger_hash = upper(p_ledger_hash)
      and payload_digest = p_payload_digest
      and status in ('staged', 'committing', 'finalizing', 'committed')
  ) then
    raise exception 'work identity conflict';
  end if;

  insert into public.xrpl_phase_payload_chunks (
    work_id, chunk_index, encoding, payload_json, payload_digest,
    byte_count, record_count, created_at
  ) values (
    v_work_id, 0, 'normalized-payload-chunk-json-v1', p_payload_json,
    p_payload_digest, p_byte_count, 1, p_completed_at
  )
  on conflict (work_id, chunk_index) do nothing;
  if not exists (
    select 1 from public.xrpl_phase_payload_chunks
    where work_id = v_work_id and chunk_index = 0
      and payload_json = p_payload_json
      and payload_digest = p_payload_digest
      and byte_count = p_byte_count
      and record_count = 1
  ) then
    raise exception 'payload chunk identity conflict';
  end if;

  insert into public.xrpl_phase_reference_rows (
    work_id, semantic_class, canonical_key, source_ledger_index,
    source_ledger_hash, source_transaction_hash, object_id,
    relationship_ids, value_json, is_tombstone, created_at
  ) values (
    v_work_id, 'validated-ledger', concat('ledger:', p_ledger_index::text),
    p_ledger_index, upper(p_ledger_hash), null, null, '[]'::jsonb,
    v_value_json, false, p_completed_at
  )
  on conflict (work_id, semantic_class, canonical_key) do nothing;
  if not exists (
    select 1 from public.xrpl_phase_reference_rows
    where work_id = v_work_id
      and semantic_class = 'validated-ledger'
      and canonical_key = concat('ledger:', p_ledger_index::text)
      and source_ledger_index = p_ledger_index
      and source_ledger_hash = upper(p_ledger_hash)
      and value_json = v_value_json
      and is_tombstone = false
  ) then
    raise exception 'reference row identity conflict';
  end if;

  v_commit_id := public.xrpl_phase_commit_message_id(v_work_id, 0);
  v_commit_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'commit',
    'messageId', v_commit_id,
    'workId', v_work_id,
    'chunkIndex', 0
  );
  perform public.xrpl_phase_insert_message(
    v_stream.profile_id, 'commit', v_commit_id, v_commit_payload,
    p_completed_at, p_completed_at
  );
  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_commit_id, p_completed_at
  );

  update public.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'staged',
      'workId', v_work_id,
      'startLedgerIndex', p_ledger_index,
      'endLedgerIndex', p_ledger_index,
      'payloadDigest', p_payload_digest,
      'payloadChunks', 1,
      'semanticCounts', jsonb_build_object('ledgers', 1, 'totalRecords', 1)
    ),
    successor_message_id = v_commit_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'work_id', v_work_id,
    'successor_message_id', v_commit_id
  );
end;
$$;

create or replace function public.xrpl_complete_commit_phase(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
  v_work public.xrpl_phase_work%rowtype;
  v_finalize_id text;
  v_finalize_payload jsonb;
  v_chunk_digest text;
begin
  select * into v_message
  from public.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.phase <> 'commit' then
    raise exception 'commit message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'successor_message_id', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased' or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  select * into v_work
  from public.xrpl_phase_work
  where work_id = v_message.payload->>'workId'
  for update;
  if not found or v_work.status not in ('staged', 'committing') then
    raise exception 'work is not commit-ready';
  end if;
  if (v_message.payload->>'chunkIndex')::integer <> 0 then
    raise exception 'unexpected commit chunk';
  end if;
  if not exists (
    select 1 from public.xrpl_phase_payload_chunks
    where work_id = v_work.work_id and chunk_index = 0
  ) or not exists (
    select 1 from public.xrpl_phase_reference_rows
    where work_id = v_work.work_id
  ) then
    raise exception 'staged payload is incomplete';
  end if;

  v_chunk_digest := encode(
    extensions.digest(convert_to(concat(v_work.work_id, ':0:', v_work.payload_digest), 'UTF8'), 'sha256'),
    'hex'
  );
  insert into public.xrpl_phase_commit_chunks (
    work_id, chunk_index, status, operation_count, row_mutation_count,
    chunk_digest, created_at, updated_at, completed_at
  ) values (
    v_work.work_id, 0, 'completed', 1, 1, v_chunk_digest,
    p_completed_at, p_completed_at, p_completed_at
  )
  on conflict (work_id, chunk_index) do nothing;
  if not exists (
    select 1 from public.xrpl_phase_commit_chunks
    where work_id = v_work.work_id and chunk_index = 0
      and status = 'completed'
      and operation_count = 1
      and row_mutation_count = 1
      and chunk_digest = v_chunk_digest
  ) then
    raise exception 'commit chunk identity conflict';
  end if;

  update public.xrpl_phase_work
  set status = 'committing', updated_at = p_completed_at
  where work_id = v_work.work_id and status <> 'committed';

  v_finalize_id := public.xrpl_phase_finalize_message_id(v_work.work_id);
  v_finalize_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'finalize',
    'messageId', v_finalize_id,
    'workId', v_work.work_id
  );
  perform public.xrpl_phase_insert_message(
    v_work.profile_id, 'finalize', v_finalize_id, v_finalize_payload,
    p_completed_at, p_completed_at
  );
  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_finalize_id, p_completed_at
  );

  update public.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'committing',
      'workId', v_work.work_id,
      'chunkIndex', 0,
      'operationCount', 1,
      'rowMutationCount', 1,
      'chunkDigest', v_chunk_digest
    ),
    successor_message_id = v_finalize_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'work_id', v_work.work_id,
    'successor_message_id', v_finalize_id
  );
end;
$$;

create or replace function public.xrpl_complete_finalize_phase(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
  v_work public.xrpl_phase_work%rowtype;
  v_stream public.xrpl_phase_streams%rowtype;
  v_current_watermark public.xrpl_phase_watermarks%rowtype;
  v_next_scan_id text;
  v_next_scan_payload jsonb;
begin
  select * into v_message
  from public.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found or v_message.phase <> 'finalize' then
    raise exception 'finalize message not found';
  end if;
  if v_message.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'duplicate', true,
      'successor_message_id', v_message.successor_message_id
    );
  end if;
  if v_message.status <> 'leased' or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  select * into v_work
  from public.xrpl_phase_work
  where work_id = v_message.payload->>'workId'
  for update;
  if not found or v_work.status not in ('committing', 'finalizing') then
    raise exception 'work is not finalize-ready';
  end if;
  if not exists (
    select 1 from public.xrpl_phase_commit_chunks
    where work_id = v_work.work_id and chunk_index = 0 and status = 'completed'
  ) then
    raise exception 'commit evidence is incomplete';
  end if;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = v_work.profile_id
  for update;
  if not found or v_stream.status <> 'active' then
    raise exception 'phase stream is unavailable';
  end if;

  select * into v_current_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_work.profile_id
  for update;

  if found then
    if v_current_watermark.ledger_index = v_work.scanned_end_ledger_index
      and v_current_watermark.ledger_hash = v_work.final_ledger_hash
      and v_current_watermark.work_id = v_work.work_id then
      null;
    elsif v_current_watermark.ledger_index <> v_work.previous_ledger_index
      or v_current_watermark.ledger_hash <> v_work.expected_parent_hash then
      raise exception 'finalize watermark conflict';
    end if;
  elsif v_stream.immutable_base_ledger_index <> v_work.previous_ledger_index
    or v_stream.immutable_base_ledger_hash <> v_work.expected_parent_hash then
    raise exception 'finalize base conflict';
  end if;

  update public.xrpl_phase_work
  set status = 'finalizing', updated_at = p_completed_at
  where work_id = v_work.work_id and status <> 'committed';

  insert into public.xrpl_phase_watermarks (
    profile_id, network, epoch_id, base_identity, ledger_index,
    ledger_hash, work_id, updated_at
  ) values (
    v_work.profile_id, v_work.network, v_work.epoch_id, v_work.base_identity,
    v_work.scanned_end_ledger_index, v_work.final_ledger_hash,
    v_work.work_id, p_completed_at
  )
  on conflict (profile_id) do update set
    network = excluded.network,
    epoch_id = excluded.epoch_id,
    base_identity = excluded.base_identity,
    ledger_index = excluded.ledger_index,
    ledger_hash = excluded.ledger_hash,
    work_id = excluded.work_id,
    updated_at = excluded.updated_at;

  update public.xrpl_phase_work
  set status = 'committed', committed_at = coalesce(committed_at, p_completed_at),
      updated_at = p_completed_at
  where work_id = v_work.work_id;

  v_next_scan_id := public.xrpl_phase_scan_message_id(
    v_work.network, v_work.epoch_id, v_work.base_identity,
    v_work.scanned_end_ledger_index, v_work.final_ledger_hash, 0
  );
  v_next_scan_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'scan',
    'messageId', v_next_scan_id,
    'network', v_work.network,
    'epochId', v_work.epoch_id,
    'baseIdentity', v_work.base_identity,
    'expectedPreviousLedgerIndex', v_work.scanned_end_ledger_index,
    'expectedPreviousLedgerHash', v_work.final_ledger_hash,
    'scanSequence', 0
  );
  perform public.xrpl_phase_insert_message(
    v_work.profile_id, 'scan', v_next_scan_id, v_next_scan_payload,
    p_completed_at, p_completed_at
  );
  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_next_scan_id, p_completed_at
  );

  update public.xrpl_phase_messages
  set
    status = 'completed',
    lease_owner = null,
    lease_expires_at = null,
    result = jsonb_build_object(
      'status', 'committed',
      'workId', v_work.work_id,
      'ledgerIndex', v_work.scanned_end_ledger_index,
      'ledgerHash', v_work.final_ledger_hash
    ),
    successor_message_id = v_next_scan_id,
    completed_at = p_completed_at,
    updated_at = p_completed_at
  where message_id = p_message_id;

  return jsonb_build_object(
    'completed', true,
    'duplicate', false,
    'work_id', v_work.work_id,
    'ledger_index', v_work.scanned_end_ledger_index,
    'ledger_hash', v_work.final_ledger_hash,
    'successor_message_id', v_next_scan_id
  );
end;
$$;

create or replace function public.xrpl_retry_phase_message(
  p_owner text,
  p_message_id text,
  p_now timestamptz,
  p_available_at timestamptz,
  p_classification text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
begin
  if p_classification not in ('retryable_transport', 'retryable_storage') then
    raise exception 'invalid retry classification';
  end if;
  if p_available_at <= p_now then
    raise exception 'retry must be scheduled in the future';
  end if;

  update public.xrpl_phase_messages
  set
    status = 'retry',
    available_at = p_available_at,
    lease_owner = null,
    lease_expires_at = null,
    error_classification = p_classification,
    error_message = left(coalesce(p_error, 'unknown failure'), 1000),
    updated_at = p_now
  where message_id = p_message_id
    and status = 'leased'
    and lease_owner = p_owner
  returning * into v_message;

  if not found then
    return jsonb_build_object('scheduled', false, 'reason', 'lease_lost');
  end if;
  return jsonb_build_object('scheduled', true, 'available_at', v_message.available_at);
end;
$$;

create or replace function public.xrpl_fail_phase_terminal(
  p_owner text,
  p_message_id text,
  p_now timestamptz,
  p_classification text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.xrpl_phase_messages%rowtype;
begin
  if p_classification not in (
    'invalid_message', 'base_mismatch', 'epoch_mismatch', 'stale_boundary',
    'parent_hash_mismatch', 'reset_detected', 'digest_mismatch',
    'resource_halt', 'terminal_internal'
  ) then
    raise exception 'invalid terminal classification';
  end if;

  update public.xrpl_phase_messages
  set
    status = 'error',
    lease_owner = null,
    lease_expires_at = null,
    error_classification = p_classification,
    error_message = left(coalesce(p_error, 'unknown failure'), 1000),
    updated_at = p_now
  where message_id = p_message_id
    and status = 'leased'
    and lease_owner = p_owner
  returning * into v_message;

  if not found then
    return jsonb_build_object('failed', false, 'reason', 'lease_lost');
  end if;

  update public.xrpl_phase_streams
  set
    status = 'halted',
    last_error_classification = p_classification,
    last_error_message = left(coalesce(p_error, 'unknown failure'), 1000),
    updated_at = p_now
  where profile_id = v_message.profile_id;

  return jsonb_build_object('failed', true, 'classification', p_classification);
end;
$$;

revoke all on function public.xrpl_phase_scan_message_id(text, text, text, bigint, text, integer) from public;
revoke all on function public.xrpl_phase_work_id(text, text, text, bigint, text) from public;
revoke all on function public.xrpl_phase_commit_message_id(text, integer) from public;
revoke all on function public.xrpl_phase_finalize_message_id(text) from public;
revoke all on function public.xrpl_phase_insert_message(text, text, text, jsonb, timestamptz, timestamptz) from public;
revoke all on function public.xrpl_phase_reserve_successor(text, text, timestamptz) from public;
revoke all on function public.xrpl_claim_next_phase(text, timestamptz, integer) from public;
revoke all on function public.xrpl_complete_caught_up_scan(text, text, timestamptz) from public;
revoke all on function public.xrpl_complete_scan_phase(text, text, timestamptz, bigint, text, text, bigint, text, text, integer) from public;
revoke all on function public.xrpl_complete_commit_phase(text, text, timestamptz) from public;
revoke all on function public.xrpl_complete_finalize_phase(text, text, timestamptz) from public;
revoke all on function public.xrpl_retry_phase_message(text, text, timestamptz, timestamptz, text, text) from public;
revoke all on function public.xrpl_fail_phase_terminal(text, text, timestamptz, text, text) from public;

grant execute on function public.xrpl_phase_scan_message_id(text, text, text, bigint, text, integer) to service_role;
grant execute on function public.xrpl_phase_work_id(text, text, text, bigint, text) to service_role;
grant execute on function public.xrpl_phase_commit_message_id(text, integer) to service_role;
grant execute on function public.xrpl_phase_finalize_message_id(text) to service_role;
grant execute on function public.xrpl_phase_insert_message(text, text, text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.xrpl_phase_reserve_successor(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_claim_next_phase(text, timestamptz, integer) to service_role;
grant execute on function public.xrpl_complete_caught_up_scan(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_complete_scan_phase(text, text, timestamptz, bigint, text, text, bigint, text, text, integer) to service_role;
grant execute on function public.xrpl_complete_commit_phase(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_complete_finalize_phase(text, text, timestamptz) to service_role;
grant execute on function public.xrpl_retry_phase_message(text, text, timestamptz, timestamptz, text, text) to service_role;
grant execute on function public.xrpl_fail_phase_terminal(text, text, timestamptz, text, text) to service_role;

do $$
declare
  v_runtime public.xrpl_collector_runtime%rowtype;
  v_base_identity text;
  v_message_id text;
  v_payload jsonb;
begin
  select * into v_runtime
  from public.xrpl_collector_runtime
  where profile_id = 'supabase-devnet';

  if not found or v_runtime.last_validated_ledger_index is null
    or v_runtime.last_validated_ledger_hash is null then
    raise exception 'remote probe must have a validated ledger before phase bootstrap';
  end if;

  v_base_identity := concat(
    'probe-base-', v_runtime.last_validated_ledger_index::text, '-',
    v_runtime.last_validated_ledger_hash
  );

  insert into public.xrpl_phase_streams (
    profile_id, network, epoch_id, base_identity,
    immutable_base_ledger_index, immutable_base_ledger_hash,
    status, created_at, updated_at
  ) values (
    'supabase-devnet', 'devnet', 'supabase-r4c2b-v1', v_base_identity,
    v_runtime.last_validated_ledger_index, v_runtime.last_validated_ledger_hash,
    'active', now(), now()
  )
  on conflict (profile_id) do nothing;

  select public.xrpl_phase_scan_message_id(
    'devnet', 'supabase-r4c2b-v1', v_base_identity,
    v_runtime.last_validated_ledger_index, v_runtime.last_validated_ledger_hash, 0
  ) into v_message_id;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'scan',
    'messageId', v_message_id,
    'network', 'devnet',
    'epochId', 'supabase-r4c2b-v1',
    'baseIdentity', v_base_identity,
    'expectedPreviousLedgerIndex', v_runtime.last_validated_ledger_index,
    'expectedPreviousLedgerHash', v_runtime.last_validated_ledger_hash,
    'scanSequence', 0
  );
  perform public.xrpl_phase_insert_message(
    'supabase-devnet', 'scan', v_message_id, v_payload, now(), now()
  );
end;
$$;
