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
          order by rows.current_message_id, rows.successor_message_id
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
          order by rows.current_message_id, rows.successor_message_id
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

revoke all on function public.xrpl_build_source_complete_state()
  from public, anon, authenticated;
revoke all on function public.xrpl_build_restored_complete_state()
  from public, anon, authenticated;
