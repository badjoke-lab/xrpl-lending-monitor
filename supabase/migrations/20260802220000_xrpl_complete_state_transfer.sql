create extension if not exists pgcrypto with schema extensions;

create table if not exists public.xrpl_transfer_publication_candidates (
  profile_id text not null,
  publication_id text primary key,
  work_id text not null,
  previous_publication_id text,
  asset_json text not null,
  asset_digest text not null check (asset_digest ~ '^[a-f0-9]{64}$'),
  manifest_json text not null,
  manifest_digest text not null check (manifest_digest ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null,
  verified_at timestamptz,
  failure_reason text,
  unique (profile_id, work_id)
);

create table if not exists public.xrpl_transfer_publication_works (
  profile_id text not null,
  publication_id text not null references public.xrpl_transfer_publication_candidates(publication_id) on delete cascade,
  work_id text not null,
  work_position integer not null check (work_position >= 0),
  previous_ledger_index bigint not null check (previous_ledger_index >= 0),
  start_ledger_index bigint not null check (start_ledger_index >= 0),
  scanned_end_ledger_index bigint not null check (scanned_end_ledger_index >= start_ledger_index),
  final_ledger_hash text not null check (final_ledger_hash ~ '^[A-F0-9]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  semantic_counts_json text not null,
  expected_payload_chunks integer not null check (expected_payload_chunks >= 1),
  expected_commit_chunks integer not null check (expected_commit_chunks >= 1),
  primary key (publication_id, work_position),
  unique (profile_id, work_id)
);

create table if not exists public.xrpl_transfer_publication_watermarks (
  profile_id text not null,
  stream_id text primary key,
  publication_id text not null references public.xrpl_transfer_publication_candidates(publication_id),
  work_id text not null,
  ledger_index bigint not null check (ledger_index >= 0),
  ledger_hash text not null check (ledger_hash ~ '^[A-F0-9]{64}$'),
  updated_at timestamptz not null
);

create table if not exists public.xrpl_transfer_maintenance_plans (
  profile_id text not null,
  plan_id text primary key,
  publication_id text not null references public.xrpl_transfer_publication_candidates(publication_id),
  plan_json text not null,
  plan_digest text not null check (plan_digest ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('pending', 'applied', 'failed')),
  created_at timestamptz not null,
  applied_at timestamptz,
  failure_reason text,
  unique (profile_id, publication_id)
);

create table if not exists public.xrpl_transfer_maintenance_mutations (
  profile_id text not null,
  plan_id text not null references public.xrpl_transfer_maintenance_plans(plan_id) on delete cascade,
  mutation_index integer not null check (mutation_index >= 0),
  table_name text not null,
  operation text not null,
  criteria_json text not null,
  status text not null check (status in ('pending', 'applied', 'failed')),
  applied_at timestamptz,
  failure_reason text,
  primary key (plan_id, mutation_index)
);

create table if not exists public.xrpl_transfer_exports (
  export_id text primary key,
  source_profile_id text not null,
  schema_version integer not null check (schema_version = 1),
  state_digest text not null check (state_digest ~ '^[a-f0-9]{64}$'),
  row_counts jsonb not null,
  created_at timestamptz not null
);

create schema if not exists xrpl_restore_v1;

create table if not exists xrpl_restore_v1.xrpl_phase_streams
  (like public.xrpl_phase_streams including all);
create table if not exists xrpl_restore_v1.xrpl_phase_messages
  (like public.xrpl_phase_messages including all);
create table if not exists xrpl_restore_v1.xrpl_phase_successors
  (like public.xrpl_phase_successors including all);
create table if not exists xrpl_restore_v1.xrpl_phase_work
  (like public.xrpl_phase_work including all);
create table if not exists xrpl_restore_v1.xrpl_phase_payload_chunks
  (like public.xrpl_phase_payload_chunks including all);
create table if not exists xrpl_restore_v1.xrpl_phase_reference_rows
  (like public.xrpl_phase_reference_rows including all);
create table if not exists xrpl_restore_v1.xrpl_phase_commit_chunks
  (like public.xrpl_phase_commit_chunks including all);
create table if not exists xrpl_restore_v1.xrpl_phase_watermarks
  (like public.xrpl_phase_watermarks including all);
create table if not exists xrpl_restore_v1.xrpl_transfer_publication_candidates
  (like public.xrpl_transfer_publication_candidates including all);
create table if not exists xrpl_restore_v1.xrpl_transfer_publication_works
  (like public.xrpl_transfer_publication_works including all);
create table if not exists xrpl_restore_v1.xrpl_transfer_publication_watermarks
  (like public.xrpl_transfer_publication_watermarks including all);
create table if not exists xrpl_restore_v1.xrpl_transfer_maintenance_plans
  (like public.xrpl_transfer_maintenance_plans including all);
create table if not exists xrpl_restore_v1.xrpl_transfer_maintenance_mutations
  (like public.xrpl_transfer_maintenance_mutations including all);

create table if not exists xrpl_restore_v1.restore_metadata (
  target_id text primary key,
  schema_version integer not null check (schema_version = 1),
  source_profile_id text not null,
  source_export_id text not null,
  state_digest text not null check (state_digest ~ '^[a-f0-9]{64}$'),
  row_counts jsonb not null,
  restored_at timestamptz not null
);

create or replace function public.xrpl_transfer_json_digest(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = public, extensions, pg_temp
as $$
  select encode(extensions.digest(convert_to(p_value::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.xrpl_seed_multichunk_transfer_state(
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet-multichunk-witness';
  v_work public.xrpl_phase_work%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_publication_id text;
  v_plan_id text;
  v_asset jsonb;
  v_manifest jsonb;
  v_plan jsonb;
  v_asset_text text;
  v_manifest_text text;
  v_plan_text text;
begin
  select * into v_watermark
  from public.xrpl_phase_watermarks
  where profile_id = v_profile_id
  for share;

  if not found
    or v_watermark.network <> 'devnet'
    or v_watermark.epoch_id <> 'supabase-r4c2c-v1'
    or v_watermark.base_identity <> 'multichunk-witness-2776760'
    or v_watermark.ledger_index <> 2776760
    or v_watermark.ledger_hash <> '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D' then
    raise exception 'transfer_source_unavailable: multi-chunk watermark is unavailable';
  end if;

  select * into v_work
  from public.xrpl_phase_work
  where work_id = v_watermark.work_id
  for share;

  if not found
    or v_work.profile_id <> v_profile_id
    or v_work.status <> 'committed'
    or v_work.committed_at is null
    or v_work.expected_payload_chunks <> 3
    or v_work.expected_commit_chunks <> 3
    or v_work.scanned_end_ledger_index <> v_watermark.ledger_index
    or v_work.final_ledger_hash <> v_watermark.ledger_hash then
    raise exception 'transfer_source_integrity: multi-chunk work is not committed';
  end if;

  if (select count(*) from public.xrpl_phase_payload_chunks where work_id = v_work.work_id) <> 3
    or (select count(*) from public.xrpl_phase_commit_chunks where work_id = v_work.work_id and status = 'completed') <> 3
    or (select count(*) from public.xrpl_phase_reference_rows where work_id = v_work.work_id) <> 116 then
    raise exception 'transfer_source_integrity: multi-chunk row envelope is incomplete';
  end if;

  v_publication_id := 'publication-v1:' || v_work.work_id;
  v_plan_id := 'maintenance-v1:' || v_work.work_id;

  v_asset := jsonb_build_object(
    'schemaVersion', 1,
    'profileId', v_profile_id,
    'workId', v_work.work_id,
    'ledgerIndex', v_work.scanned_end_ledger_index,
    'ledgerHash', v_work.final_ledger_hash,
    'payloadDigest', v_work.payload_digest
  );
  v_manifest := jsonb_build_object(
    'schemaVersion', 1,
    'publicationId', v_publication_id,
    'workIds', jsonb_build_array(v_work.work_id),
    'semanticCounts', v_work.semantic_counts_json::jsonb,
    'payloadChunks', v_work.expected_payload_chunks,
    'commitChunks', v_work.expected_commit_chunks
  );
  v_plan := jsonb_build_object(
    'schemaVersion', 1,
    'planId', v_plan_id,
    'publicationId', v_publication_id,
    'verifiedPublicationId', v_publication_id,
    'mutations', jsonb_build_array(
      jsonb_build_object(
        'mutationIndex', 0,
        'tableName', 'xrpl_phase_payload_chunks',
        'operation', 'retain_committed_work',
        'criteria', jsonb_build_object('workId', v_work.work_id)
      ),
      jsonb_build_object(
        'mutationIndex', 1,
        'tableName', 'xrpl_phase_commit_chunks',
        'operation', 'retain_committed_work',
        'criteria', jsonb_build_object('workId', v_work.work_id)
      )
    )
  );

  v_asset_text := v_asset::text;
  v_manifest_text := v_manifest::text;
  v_plan_text := v_plan::text;

  insert into public.xrpl_transfer_publication_candidates (
    profile_id,
    publication_id,
    work_id,
    previous_publication_id,
    asset_json,
    asset_digest,
    manifest_json,
    manifest_digest,
    status,
    created_at,
    verified_at,
    failure_reason
  ) values (
    v_profile_id,
    v_publication_id,
    v_work.work_id,
    null,
    v_asset_text,
    encode(extensions.digest(convert_to(v_asset_text, 'UTF8'), 'sha256'), 'hex'),
    v_manifest_text,
    encode(extensions.digest(convert_to(v_manifest_text, 'UTF8'), 'sha256'), 'hex'),
    'verified',
    coalesce(v_work.committed_at, p_now),
    p_now,
    null
  )
  on conflict (publication_id) do nothing;

  if not exists (
    select 1
    from public.xrpl_transfer_publication_candidates
    where publication_id = v_publication_id
      and profile_id = v_profile_id
      and work_id = v_work.work_id
      and asset_json = v_asset_text
      and manifest_json = v_manifest_text
      and status = 'verified'
      and failure_reason is null
  ) then
    raise exception 'transfer_source_conflict: publication candidate changed';
  end if;

  insert into public.xrpl_transfer_publication_works (
    profile_id,
    publication_id,
    work_id,
    work_position,
    previous_ledger_index,
    start_ledger_index,
    scanned_end_ledger_index,
    final_ledger_hash,
    payload_digest,
    semantic_counts_json,
    expected_payload_chunks,
    expected_commit_chunks
  ) values (
    v_profile_id,
    v_publication_id,
    v_work.work_id,
    0,
    v_work.previous_ledger_index,
    v_work.start_ledger_index,
    v_work.scanned_end_ledger_index,
    v_work.final_ledger_hash,
    v_work.payload_digest,
    v_work.semantic_counts_json,
    v_work.expected_payload_chunks,
    v_work.expected_commit_chunks
  )
  on conflict (publication_id, work_position) do nothing;

  if not exists (
    select 1
    from public.xrpl_transfer_publication_works
    where publication_id = v_publication_id
      and work_position = 0
      and profile_id = v_profile_id
      and work_id = v_work.work_id
      and payload_digest = v_work.payload_digest
  ) then
    raise exception 'transfer_source_conflict: publication work changed';
  end if;

  insert into public.xrpl_transfer_publication_watermarks (
    profile_id,
    stream_id,
    publication_id,
    work_id,
    ledger_index,
    ledger_hash,
    updated_at
  ) values (
    v_profile_id,
    v_profile_id,
    v_publication_id,
    v_work.work_id,
    v_work.scanned_end_ledger_index,
    v_work.final_ledger_hash,
    p_now
  )
  on conflict (stream_id) do nothing;

  if not exists (
    select 1
    from public.xrpl_transfer_publication_watermarks
    where stream_id = v_profile_id
      and profile_id = v_profile_id
      and publication_id = v_publication_id
      and work_id = v_work.work_id
      and ledger_index = v_work.scanned_end_ledger_index
      and ledger_hash = v_work.final_ledger_hash
  ) then
    raise exception 'transfer_source_conflict: publication watermark changed';
  end if;

  insert into public.xrpl_transfer_maintenance_plans (
    profile_id,
    plan_id,
    publication_id,
    plan_json,
    plan_digest,
    status,
    created_at,
    applied_at,
    failure_reason
  ) values (
    v_profile_id,
    v_plan_id,
    v_publication_id,
    v_plan_text,
    encode(extensions.digest(convert_to(v_plan_text, 'UTF8'), 'sha256'), 'hex'),
    'applied',
    p_now,
    p_now,
    null
  )
  on conflict (plan_id) do nothing;

  if not exists (
    select 1
    from public.xrpl_transfer_maintenance_plans
    where plan_id = v_plan_id
      and profile_id = v_profile_id
      and publication_id = v_publication_id
      and plan_json = v_plan_text
      and status = 'applied'
      and failure_reason is null
  ) then
    raise exception 'transfer_source_conflict: maintenance plan changed';
  end if;

  insert into public.xrpl_transfer_maintenance_mutations (
    profile_id,
    plan_id,
    mutation_index,
    table_name,
    operation,
    criteria_json,
    status,
    applied_at,
    failure_reason
  ) values
    (
      v_profile_id,
      v_plan_id,
      0,
      'xrpl_phase_payload_chunks',
      'retain_committed_work',
      jsonb_build_object('workId', v_work.work_id)::text,
      'applied',
      p_now,
      null
    ),
    (
      v_profile_id,
      v_plan_id,
      1,
      'xrpl_phase_commit_chunks',
      'retain_committed_work',
      jsonb_build_object('workId', v_work.work_id)::text,
      'applied',
      p_now,
      null
    )
  on conflict (plan_id, mutation_index) do nothing;

  if (
    select count(*)
    from public.xrpl_transfer_maintenance_mutations
    where plan_id = v_plan_id
      and profile_id = v_profile_id
      and status = 'applied'
      and failure_reason is null
  ) <> 2 then
    raise exception 'transfer_source_conflict: maintenance mutations changed';
  end if;

  return jsonb_build_object(
    'ready', true,
    'profileId', v_profile_id,
    'workId', v_work.work_id,
    'publicationId', v_publication_id,
    'maintenancePlanId', v_plan_id
  );
end;
$$;

create or replace function public.xrpl_build_source_complete_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id constant text := 'supabase-devnet-multichunk-witness';
  v_work_id text;
  v_state jsonb;
begin
  select work_id into v_work_id
  from public.xrpl_phase_watermarks
  where profile_id = v_profile_id;

  if v_work_id is null then
    raise exception 'transfer_source_unavailable: source watermark is unavailable';
  end if;

  v_state := jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'profileId', v_profile_id,
      'network', 'devnet',
      'epochId', 'supabase-r4c2c-v1',
      'baseIdentity', 'multichunk-witness-2776760',
      'watermarkWorkId', v_work_id,
      'watermarkLedgerIndex', 2776760,
      'watermarkLedgerHash', '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D'
    ),
    'collection', jsonb_build_object(
      'streams', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.profile_id)
        from public.xrpl_phase_streams as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb),
      'work', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.work_id)
        from public.xrpl_phase_work as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb),
      'payloadChunks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.work_id, rows.chunk_index)
        from public.xrpl_phase_payload_chunks as rows
        where rows.work_id = v_work_id
      ), '[]'::jsonb),
      'referenceRows', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.work_id, rows.source_ledger_index, rows.semantic_class, rows.canonical_key
        )
        from public.xrpl_phase_reference_rows as rows
        where rows.work_id = v_work_id
      ), '[]'::jsonb),
      'commitChunks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.work_id, rows.chunk_index)
        from public.xrpl_phase_commit_chunks as rows
        where rows.work_id = v_work_id
      ), '[]'::jsonb),
      'watermarks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.profile_id)
        from public.xrpl_phase_watermarks as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb)
    ),
    'scheduler', jsonb_build_object(
      'messages', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.available_at, rows.created_at, rows.message_id
        )
        from public.xrpl_phase_messages as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb),
      'successors', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.current_message_id, rows.next_message_id
        )
        from public.xrpl_phase_successors as rows
        where exists (
          select 1
          from public.xrpl_phase_messages as messages
          where messages.profile_id = v_profile_id
            and messages.message_id = rows.current_message_id
        )
      ), '[]'::jsonb)
    ),
    'publication', jsonb_build_object(
      'candidates', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.publication_id)
        from public.xrpl_transfer_publication_candidates as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb),
      'work', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.publication_id, rows.work_position)
        from public.xrpl_transfer_publication_works as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb),
      'watermarks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.stream_id)
        from public.xrpl_transfer_publication_watermarks as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb)
    ),
    'maintenance', jsonb_build_object(
      'plans', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.plan_id)
        from public.xrpl_transfer_maintenance_plans as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb),
      'mutations', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.plan_id, rows.mutation_index)
        from public.xrpl_transfer_maintenance_mutations as rows
        where rows.profile_id = v_profile_id
      ), '[]'::jsonb)
    )
  );

  return v_state;
end;
$$;

create or replace function public.xrpl_build_restored_complete_state()
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_v1, pg_temp
as $$
declare
  v_metadata xrpl_restore_v1.restore_metadata%rowtype;
  v_state jsonb;
begin
  select * into v_metadata
  from xrpl_restore_v1.restore_metadata
  where target_id = 'supabase-devnet-transfer-restore-v1';

  if not found then
    raise exception 'restore_unavailable: restore metadata is unavailable';
  end if;

  v_state := jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'profileId', 'supabase-devnet-multichunk-witness',
      'network', 'devnet',
      'epochId', 'supabase-r4c2c-v1',
      'baseIdentity', 'multichunk-witness-2776760',
      'watermarkWorkId', (
        select work_id from xrpl_restore_v1.xrpl_phase_watermarks limit 1
      ),
      'watermarkLedgerIndex', 2776760,
      'watermarkLedgerHash', '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D'
    ),
    'collection', jsonb_build_object(
      'streams', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.profile_id)
        from xrpl_restore_v1.xrpl_phase_streams as rows
      ), '[]'::jsonb),
      'work', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.work_id)
        from xrpl_restore_v1.xrpl_phase_work as rows
      ), '[]'::jsonb),
      'payloadChunks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.work_id, rows.chunk_index)
        from xrpl_restore_v1.xrpl_phase_payload_chunks as rows
      ), '[]'::jsonb),
      'referenceRows', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.work_id, rows.source_ledger_index, rows.semantic_class, rows.canonical_key
        )
        from xrpl_restore_v1.xrpl_phase_reference_rows as rows
      ), '[]'::jsonb),
      'commitChunks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.work_id, rows.chunk_index)
        from xrpl_restore_v1.xrpl_phase_commit_chunks as rows
      ), '[]'::jsonb),
      'watermarks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.profile_id)
        from xrpl_restore_v1.xrpl_phase_watermarks as rows
      ), '[]'::jsonb)
    ),
    'scheduler', jsonb_build_object(
      'messages', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.available_at, rows.created_at, rows.message_id
        )
        from xrpl_restore_v1.xrpl_phase_messages as rows
      ), '[]'::jsonb),
      'successors', coalesce((
        select jsonb_agg(
          to_jsonb(rows)
          order by rows.current_message_id, rows.next_message_id
        )
        from xrpl_restore_v1.xrpl_phase_successors as rows
      ), '[]'::jsonb)
    ),
    'publication', jsonb_build_object(
      'candidates', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.publication_id)
        from xrpl_restore_v1.xrpl_transfer_publication_candidates as rows
      ), '[]'::jsonb),
      'work', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.publication_id, rows.work_position)
        from xrpl_restore_v1.xrpl_transfer_publication_works as rows
      ), '[]'::jsonb),
      'watermarks', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.stream_id)
        from xrpl_restore_v1.xrpl_transfer_publication_watermarks as rows
      ), '[]'::jsonb)
    ),
    'maintenance', jsonb_build_object(
      'plans', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.plan_id)
        from xrpl_restore_v1.xrpl_transfer_maintenance_plans as rows
      ), '[]'::jsonb),
      'mutations', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.plan_id, rows.mutation_index)
        from xrpl_restore_v1.xrpl_transfer_maintenance_mutations as rows
      ), '[]'::jsonb)
    )
  );

  return v_state;
end;
$$;

create or replace function public.xrpl_export_multichunk_complete_state(
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_seed jsonb;
  v_state jsonb;
  v_digest text;
  v_export_id text := 'r4c2c-multichunk-complete-state-v1';
  v_counts jsonb;
begin
  v_seed := public.xrpl_seed_multichunk_transfer_state(p_now);
  v_state := public.xrpl_build_source_complete_state();
  v_digest := public.xrpl_transfer_json_digest(v_state);
  v_counts := jsonb_build_object(
    'streams', jsonb_array_length(v_state #> '{collection,streams}'),
    'work', jsonb_array_length(v_state #> '{collection,work}'),
    'payloadChunks', jsonb_array_length(v_state #> '{collection,payloadChunks}'),
    'referenceRows', jsonb_array_length(v_state #> '{collection,referenceRows}'),
    'commitChunks', jsonb_array_length(v_state #> '{collection,commitChunks}'),
    'watermarks', jsonb_array_length(v_state #> '{collection,watermarks}'),
    'messages', jsonb_array_length(v_state #> '{scheduler,messages}'),
    'successors', jsonb_array_length(v_state #> '{scheduler,successors}'),
    'publicationCandidates', jsonb_array_length(v_state #> '{publication,candidates}'),
    'publicationWork', jsonb_array_length(v_state #> '{publication,work}'),
    'publicationWatermarks', jsonb_array_length(v_state #> '{publication,watermarks}'),
    'maintenancePlans', jsonb_array_length(v_state #> '{maintenance,plans}'),
    'maintenanceMutations', jsonb_array_length(v_state #> '{maintenance,mutations}')
  );

  if v_counts <> jsonb_build_object(
    'streams', 1,
    'work', 1,
    'payloadChunks', 3,
    'referenceRows', 116,
    'commitChunks', 3,
    'watermarks', 1,
    'messages', 6,
    'successors', 5,
    'publicationCandidates', 1,
    'publicationWork', 1,
    'publicationWatermarks', 1,
    'maintenancePlans', 1,
    'maintenanceMutations', 2
  ) then
    raise exception 'transfer_source_integrity: complete-state row counts changed: %', v_counts::text;
  end if;

  insert into public.xrpl_transfer_exports (
    export_id,
    source_profile_id,
    schema_version,
    state_digest,
    row_counts,
    created_at
  ) values (
    v_export_id,
    'supabase-devnet-multichunk-witness',
    1,
    v_digest,
    v_counts,
    p_now
  )
  on conflict (export_id) do update
  set
    state_digest = excluded.state_digest,
    row_counts = excluded.row_counts,
    created_at = excluded.created_at
  where public.xrpl_transfer_exports.source_profile_id = excluded.source_profile_id
    and public.xrpl_transfer_exports.schema_version = excluded.schema_version;

  return jsonb_build_object(
    'schemaVersion', 1,
    'exportId', v_export_id,
    'sourceProfileId', 'supabase-devnet-multichunk-witness',
    'state', v_state,
    'stateCanonicalText', v_state::text,
    'stateDigest', v_digest,
    'rowCounts', v_counts,
    'seed', v_seed
  );
end;
$$;

create or replace function public.xrpl_restore_multichunk_complete_state(
  p_target_id text,
  p_source_export_id text,
  p_state jsonb,
  p_state_digest text,
  p_restored_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_v1, extensions, pg_temp
as $$
declare
  v_expected_target constant text := 'supabase-devnet-transfer-restore-v1';
  v_expected_export constant text := 'r4c2c-multichunk-complete-state-v1';
  v_digest text;
  v_counts jsonb;
  v_restored_state jsonb;
  v_restored_digest text;
  v_existing xrpl_restore_v1.restore_metadata%rowtype;
begin
  if p_target_id <> v_expected_target or p_source_export_id <> v_expected_export then
    raise exception 'restore_invalid_identity: target or export identity changed';
  end if;
  if p_state_digest is null or p_state_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'restore_invalid_digest: source digest is not canonical';
  end if;

  v_digest := public.xrpl_transfer_json_digest(p_state);
  if v_digest <> p_state_digest then
    raise exception 'restore_digest_mismatch: source state digest changed';
  end if;
  if (p_state->>'schemaVersion')::integer <> 1
    or p_state #>> '{source,profileId}' <> 'supabase-devnet-multichunk-witness'
    or p_state #>> '{source,network}' <> 'devnet'
    or p_state #>> '{source,epochId}' <> 'supabase-r4c2c-v1'
    or p_state #>> '{source,baseIdentity}' <> 'multichunk-witness-2776760'
    or (p_state #>> '{source,watermarkLedgerIndex}')::bigint <> 2776760
    or p_state #>> '{source,watermarkLedgerHash}' <> '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D' then
    raise exception 'restore_source_mismatch: source identity changed';
  end if;

  v_counts := jsonb_build_object(
    'streams', jsonb_array_length(p_state #> '{collection,streams}'),
    'work', jsonb_array_length(p_state #> '{collection,work}'),
    'payloadChunks', jsonb_array_length(p_state #> '{collection,payloadChunks}'),
    'referenceRows', jsonb_array_length(p_state #> '{collection,referenceRows}'),
    'commitChunks', jsonb_array_length(p_state #> '{collection,commitChunks}'),
    'watermarks', jsonb_array_length(p_state #> '{collection,watermarks}'),
    'messages', jsonb_array_length(p_state #> '{scheduler,messages}'),
    'successors', jsonb_array_length(p_state #> '{scheduler,successors}'),
    'publicationCandidates', jsonb_array_length(p_state #> '{publication,candidates}'),
    'publicationWork', jsonb_array_length(p_state #> '{publication,work}'),
    'publicationWatermarks', jsonb_array_length(p_state #> '{publication,watermarks}'),
    'maintenancePlans', jsonb_array_length(p_state #> '{maintenance,plans}'),
    'maintenanceMutations', jsonb_array_length(p_state #> '{maintenance,mutations}')
  );

  if v_counts <> jsonb_build_object(
    'streams', 1,
    'work', 1,
    'payloadChunks', 3,
    'referenceRows', 116,
    'commitChunks', 3,
    'watermarks', 1,
    'messages', 6,
    'successors', 5,
    'publicationCandidates', 1,
    'publicationWork', 1,
    'publicationWatermarks', 1,
    'maintenancePlans', 1,
    'maintenanceMutations', 2
  ) then
    raise exception 'restore_row_count_mismatch: source row counts changed: %', v_counts::text;
  end if;

  select * into v_existing
  from xrpl_restore_v1.restore_metadata
  where target_id = p_target_id
  for update;

  if found then
    v_restored_state := public.xrpl_build_restored_complete_state();
    v_restored_digest := public.xrpl_transfer_json_digest(v_restored_state);
    if v_existing.source_export_id <> p_source_export_id
      or v_existing.state_digest <> p_state_digest
      or v_existing.row_counts <> v_counts
      or v_restored_digest <> p_state_digest then
      raise exception 'restore_conflict: populated target does not match the requested export';
    end if;
    return jsonb_build_object(
      'restored', true,
      'duplicate', true,
      'targetId', p_target_id,
      'stateDigest', v_restored_digest,
      'rowCounts', v_counts,
      'restoredAt', v_existing.restored_at
    );
  end if;

  if exists (select 1 from xrpl_restore_v1.xrpl_phase_streams)
    or exists (select 1 from xrpl_restore_v1.xrpl_phase_messages)
    or exists (select 1 from xrpl_restore_v1.xrpl_phase_successors)
    or exists (select 1 from xrpl_restore_v1.xrpl_phase_work)
    or exists (select 1 from xrpl_restore_v1.xrpl_phase_payload_chunks)
    or exists (select 1 from xrpl_restore_v1.xrpl_phase_reference_rows)
    or exists (select 1 from xrpl_restore_v1.xrpl_phase_commit_chunks)
    or exists (select 1 from xrpl_restore_v1.xrpl_phase_watermarks)
    or exists (select 1 from xrpl_restore_v1.xrpl_transfer_publication_candidates)
    or exists (select 1 from xrpl_restore_v1.xrpl_transfer_publication_works)
    or exists (select 1 from xrpl_restore_v1.xrpl_transfer_publication_watermarks)
    or exists (select 1 from xrpl_restore_v1.xrpl_transfer_maintenance_plans)
    or exists (select 1 from xrpl_restore_v1.xrpl_transfer_maintenance_mutations) then
    raise exception 'restore_target_not_empty: restore namespace contains state without metadata';
  end if;

  insert into xrpl_restore_v1.xrpl_phase_streams
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_phase_streams,
      p_state #> '{collection,streams}'
    );
  insert into xrpl_restore_v1.xrpl_phase_messages
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_phase_messages,
      p_state #> '{scheduler,messages}'
    );
  insert into xrpl_restore_v1.xrpl_phase_successors
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_phase_successors,
      p_state #> '{scheduler,successors}'
    );
  insert into xrpl_restore_v1.xrpl_phase_work
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_phase_work,
      p_state #> '{collection,work}'
    );
  insert into xrpl_restore_v1.xrpl_phase_payload_chunks
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_phase_payload_chunks,
      p_state #> '{collection,payloadChunks}'
    );
  insert into xrpl_restore_v1.xrpl_phase_reference_rows
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_phase_reference_rows,
      p_state #> '{collection,referenceRows}'
    );
  insert into xrpl_restore_v1.xrpl_phase_commit_chunks
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_phase_commit_chunks,
      p_state #> '{collection,commitChunks}'
    );
  insert into xrpl_restore_v1.xrpl_phase_watermarks
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_phase_watermarks,
      p_state #> '{collection,watermarks}'
    );
  insert into xrpl_restore_v1.xrpl_transfer_publication_candidates
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_transfer_publication_candidates,
      p_state #> '{publication,candidates}'
    );
  insert into xrpl_restore_v1.xrpl_transfer_publication_works
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_transfer_publication_works,
      p_state #> '{publication,work}'
    );
  insert into xrpl_restore_v1.xrpl_transfer_publication_watermarks
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_transfer_publication_watermarks,
      p_state #> '{publication,watermarks}'
    );
  insert into xrpl_restore_v1.xrpl_transfer_maintenance_plans
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_transfer_maintenance_plans,
      p_state #> '{maintenance,plans}'
    );
  insert into xrpl_restore_v1.xrpl_transfer_maintenance_mutations
    select * from jsonb_populate_recordset(
      null::xrpl_restore_v1.xrpl_transfer_maintenance_mutations,
      p_state #> '{maintenance,mutations}'
    );

  insert into xrpl_restore_v1.restore_metadata (
    target_id,
    schema_version,
    source_profile_id,
    source_export_id,
    state_digest,
    row_counts,
    restored_at
  ) values (
    p_target_id,
    1,
    'supabase-devnet-multichunk-witness',
    p_source_export_id,
    p_state_digest,
    v_counts,
    p_restored_at
  );

  v_restored_state := public.xrpl_build_restored_complete_state();
  v_restored_digest := public.xrpl_transfer_json_digest(v_restored_state);
  if v_restored_digest <> p_state_digest or v_restored_state <> p_state then
    raise exception 'restore_parity_failure: restored canonical state does not match source';
  end if;

  return jsonb_build_object(
    'restored', true,
    'duplicate', false,
    'targetId', p_target_id,
    'stateDigest', v_restored_digest,
    'rowCounts', v_counts,
    'restoredAt', p_restored_at
  );
end;
$$;

create or replace function public.xrpl_read_restored_multichunk_complete_state()
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_restore_v1, extensions, pg_temp
as $$
declare
  v_metadata xrpl_restore_v1.restore_metadata%rowtype;
  v_state jsonb;
  v_digest text;
begin
  select * into v_metadata
  from xrpl_restore_v1.restore_metadata
  where target_id = 'supabase-devnet-transfer-restore-v1';

  if not found then
    raise exception 'restore_unavailable: restore metadata is unavailable';
  end if;

  v_state := public.xrpl_build_restored_complete_state();
  v_digest := public.xrpl_transfer_json_digest(v_state);
  if v_digest <> v_metadata.state_digest then
    raise exception 'restore_integrity_failure: restored state digest changed';
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'targetId', v_metadata.target_id,
    'sourceExportId', v_metadata.source_export_id,
    'state', v_state,
    'stateCanonicalText', v_state::text,
    'stateDigest', v_digest,
    'rowCounts', v_metadata.row_counts,
    'restoredAt', v_metadata.restored_at
  );
end;
$$;

revoke all on function public.xrpl_transfer_json_digest(jsonb)
  from public, anon, authenticated;
revoke all on function public.xrpl_seed_multichunk_transfer_state(timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_build_source_complete_state()
  from public, anon, authenticated;
revoke all on function public.xrpl_build_restored_complete_state()
  from public, anon, authenticated;
revoke all on function public.xrpl_export_multichunk_complete_state(timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_restore_multichunk_complete_state(text, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.xrpl_read_restored_multichunk_complete_state()
  from public, anon, authenticated;

grant execute on function public.xrpl_seed_multichunk_transfer_state(timestamptz)
  to service_role;
grant execute on function public.xrpl_export_multichunk_complete_state(timestamptz)
  to service_role;
grant execute on function public.xrpl_restore_multichunk_complete_state(text, text, jsonb, text, timestamptz)
  to service_role;
grant execute on function public.xrpl_read_restored_multichunk_complete_state()
  to service_role;
