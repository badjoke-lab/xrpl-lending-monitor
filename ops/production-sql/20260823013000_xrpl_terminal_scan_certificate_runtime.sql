begin;

-- Staged production SQL only. Merge does not apply this file.
-- Requires separate Issue #1261 prepare -> exact OWNER authorization -> bounded apply -> independent read-only verify.
-- Exact production sources captured read-only by run 32586238190 from main e05253f1aebd502b89764b60dbeb8cabf2a3bb74.

do $scan_certificate_patch$
declare
  v_signature regprocedure;
  v_definition text;
  v_sha text;
begin
  if exists (select 1 from pg_attribute where attrelid='public.xrpl_phase_work'::regclass and attname='source_scan_sequence' and not attisdropped)
     or exists (select 1 from pg_attribute where attrelid='public.xrpl_phase_streams'::regclass and attname='next_scan_sequence' and not attisdropped) then
    raise exception 'terminal_scan_certificate_columns_already_present_or_partial';
  end if;
  v_signature := 'public.xrpl_complete_caught_up_scan(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '3d7f4c7d7ed7cbd91b54f268dad5bdead09ef4eba278085e3146f45c07ebc899' then raise exception 'terminal_scan_certificate_source_drift:caught:%',v_sha; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres' or not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'terminal_scan_certificate_privilege_drift:caught'; end if;
  v_signature := 'public.xrpl_complete_portable_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,text)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '6f65875ec781135434326c53ed159c61154dc7f24728e02a9f578778dfea717d' then raise exception 'terminal_scan_certificate_source_drift:portable:%',v_sha; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres' or not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'terminal_scan_certificate_privilege_drift:portable'; end if;
  v_signature := 'public.xrpl_complete_portable_finalize_phase(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '8d761a2bf69ea4228f18f482ab620e294354644f60eea6e8101a4efd55766a0a' then raise exception 'terminal_scan_certificate_source_drift:finalize:%',v_sha; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres' or not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'terminal_scan_certificate_privilege_drift:finalize'; end if;
  v_signature := 'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'a7114afea201a32bd90c3f6ee08ae666e033e83bcc99384eb2a5b4a415f814b7' then raise exception 'terminal_scan_certificate_source_drift:r5:%',v_sha; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres' or not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'terminal_scan_certificate_privilege_drift:r5'; end if;
end;
$scan_certificate_patch$;

alter table public.xrpl_phase_work
  add column source_scan_sequence integer not null default 0
  constraint xrpl_phase_work_source_scan_sequence_check check (source_scan_sequence >= 0);
alter table public.xrpl_phase_streams
  add column next_scan_sequence integer not null default 0
  constraint xrpl_phase_streams_next_scan_sequence_check check (next_scan_sequence >= 0);

do $scan_certificate_functions$
declare
  v_signature regprocedure;
  v_definition text;
  v_sha text;
begin
  v_signature := 'public.xrpl_complete_caught_up_scan(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '3d7f4c7d7ed7cbd91b54f268dad5bdead09ef4eba278085e3146f45c07ebc899' then raise exception 'terminal_scan_certificate_source_drift:caught:%',v_sha; end if;
  v_definition := replace(v_definition, $m$  v_successor_payload jsonb;
  v_archived_duplicate jsonb;$m$, $m$  v_successor_payload jsonb;
  v_archived_duplicate jsonb;
  v_stream public.xrpl_phase_streams%rowtype;
  v_scan_sequence integer;
  v_successor_sequence integer;$m$);
  v_definition := replace(v_definition, $m$  if v_message.status <> 'leased' or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  v_successor_id := public.xrpl_phase_scan_message_id($m$, $m$  if v_message.status <> 'leased' or v_message.lease_owner <> p_owner
    or v_message.lease_expires_at <= p_completed_at then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;
  if v_message.payload->>'scanSequence' !~ '^(0|[1-9][0-9]*)$' then
    raise exception 'scan sequence certificate payload invalid';
  end if;
  v_scan_sequence := (v_message.payload->>'scanSequence')::integer;

  select * into v_stream
  from public.xrpl_phase_streams
  where profile_id = v_message.profile_id
  for update;
  if not found
    or v_stream.status <> 'active'
    or v_stream.network <> v_message.payload->>'network'
    or v_stream.epoch_id <> v_message.payload->>'epochId'
    or v_stream.base_identity <> v_message.payload->>'baseIdentity' then
    raise exception 'scan sequence certificate stream invalid';
  end if;
  if v_stream.next_scan_sequence <> v_scan_sequence then
    raise exception 'scan sequence certificate conflict';
  end if;
  v_successor_sequence := v_scan_sequence + 1;

  v_successor_id := public.xrpl_phase_scan_message_id($m$);
  v_definition := replace(v_definition, $m$(v_message.payload->>'scanSequence')::integer + 1$m$, $m$v_successor_sequence$m$);
  v_definition := replace(v_definition, $m$'scanSequence', (v_message.payload->>'scanSequence')::integer,$m$, $m$'scanSequence', v_scan_sequence,$m$);
  v_definition := replace(v_definition, $m$  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_successor_id, p_completed_at
  );

  update public.xrpl_phase_messages$m$, $m$  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_successor_id, p_completed_at
  );

  update public.xrpl_phase_streams
  set next_scan_sequence = v_successor_sequence,
      updated_at = p_completed_at
  where profile_id = v_message.profile_id
    and next_scan_sequence = v_scan_sequence;
  if not found then
    raise exception 'scan sequence certificate advance conflict';
  end if;

  update public.xrpl_phase_messages$m$);
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '0a37e55b8881847a61cf95f78746039fd6967571721aa50b5a0f1baff62fd1c6' then raise exception 'terminal_scan_certificate_transform_drift:caught:%',v_sha; end if;
  execute v_definition;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '0a37e55b8881847a61cf95f78746039fd6967571721aa50b5a0f1baff62fd1c6' then raise exception 'terminal_scan_certificate_post_apply_drift:caught:%',v_sha; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres' or not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'terminal_scan_certificate_privilege_drift:caught'; end if;

  v_signature := 'public.xrpl_complete_portable_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,text)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '6f65875ec781135434326c53ed159c61154dc7f24728e02a9f578778dfea717d' then raise exception 'terminal_scan_certificate_source_drift:portable:%',v_sha; end if;
  v_definition := replace(v_definition, $m$  if not found or v_stream.status <> 'active'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'portable phase stream is unavailable';
  end if;

  select * into v_watermark$m$, $m$  if not found or v_stream.status <> 'active'
    or v_stream.epoch_id <> 'supabase-r4c2c-v1' then
    raise exception 'portable phase stream is unavailable';
  end if;
  if v_message.payload->>'scanSequence' !~ '^(0|[1-9][0-9]*)$'
    or (v_message.payload->>'scanSequence')::integer <> v_stream.next_scan_sequence then
    raise exception 'portable scan sequence certificate conflict';
  end if;

  select * into v_watermark$m$);
  v_definition := replace(v_definition, $m$    expected_payload_chunks, expected_commit_chunks, created_at, updated_at
  ) values ($m$, $m$    expected_payload_chunks, expected_commit_chunks, source_scan_sequence,
    created_at, updated_at
  ) values ($m$);
  v_definition := replace(v_definition, $m$    p_semantic_counts_json, p_payload_digest, v_total_chunks, v_total_chunks,
    p_completed_at, p_completed_at
  )$m$, $m$    p_semantic_counts_json, p_payload_digest, v_total_chunks, v_total_chunks,
    v_stream.next_scan_sequence, p_completed_at, p_completed_at
  )$m$);
  v_definition := replace(v_definition, $m$      and expected_commit_chunks = v_total_chunks
      and status in ('staged', 'committing', 'finalizing', 'committed')$m$, $m$      and expected_commit_chunks = v_total_chunks
      and source_scan_sequence = v_stream.next_scan_sequence
      and status in ('staged', 'committing', 'finalizing', 'committed')$m$);
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '5e9cb3bfea6126c1d436ffb15fee5e8aaf6f2da3e0f83bf048d9cbdcf35040b0' then raise exception 'terminal_scan_certificate_transform_drift:portable:%',v_sha; end if;
  execute v_definition;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '5e9cb3bfea6126c1d436ffb15fee5e8aaf6f2da3e0f83bf048d9cbdcf35040b0' then raise exception 'terminal_scan_certificate_post_apply_drift:portable:%',v_sha; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres' or not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'terminal_scan_certificate_privilege_drift:portable'; end if;

  v_signature := 'public.xrpl_complete_portable_finalize_phase(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '8d761a2bf69ea4228f18f482ab620e294354644f60eea6e8101a4efd55766a0a' then raise exception 'terminal_scan_certificate_source_drift:finalize:%',v_sha; end if;
  v_definition := replace(v_definition, $m$  if not found or v_stream.status <> 'active'
    or v_stream.epoch_id <> v_work.epoch_id
    or v_stream.base_identity <> v_work.base_identity then
    raise exception 'portable phase stream is unavailable';
  end if;

  select * into v_current_watermark$m$, $m$  if not found or v_stream.status <> 'active'
    or v_stream.epoch_id <> v_work.epoch_id
    or v_stream.base_identity <> v_work.base_identity then
    raise exception 'portable phase stream is unavailable';
  end if;
  if v_stream.next_scan_sequence <> v_work.source_scan_sequence then
    raise exception 'portable finalize scan sequence certificate conflict';
  end if;

  select * into v_current_watermark$m$);
  v_definition := replace(v_definition, $m$  perform public.xrpl_phase_reserve_successor(
    p_message_id,
    v_next_scan_id,
    p_completed_at
  );

  update public.xrpl_phase_messages$m$, $m$  perform public.xrpl_phase_reserve_successor(
    p_message_id,
    v_next_scan_id,
    p_completed_at
  );

  if v_stream.next_scan_sequence <> 0 then
    update public.xrpl_phase_streams
    set next_scan_sequence = 0,
        updated_at = p_completed_at
    where profile_id = v_work.profile_id
      and next_scan_sequence = v_work.source_scan_sequence;
    if not found then
      raise exception 'portable finalize scan sequence reset conflict';
    end if;
  end if;

  update public.xrpl_phase_messages$m$);
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'daf97c6858300a2ec4a00eb24f60b53936dc4aa56200accc16e098c64e8f37b7' then raise exception 'terminal_scan_certificate_transform_drift:finalize:%',v_sha; end if;
  execute v_definition;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'daf97c6858300a2ec4a00eb24f60b53936dc4aa56200accc16e098c64e8f37b7' then raise exception 'terminal_scan_certificate_post_apply_drift:finalize:%',v_sha; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres' or not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'terminal_scan_certificate_privilege_drift:finalize'; end if;

  v_signature := 'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'a7114afea201a32bd90c3f6ee08ae666e033e83bcc99384eb2a5b4a415f814b7' then raise exception 'terminal_scan_certificate_source_drift:r5:%',v_sha; end if;
  v_definition := replace(v_definition, $m$    or v_pending_scan.payload->>'epochId' <> v_run.epoch_id
    or v_pending_scan.payload->>'baseIdentity' <> v_run.base_identity then
    raise exception 'r5_recovery_batch_completion_pending_scan_invalid';
  end if;$m$, $m$    or v_pending_scan.payload->>'epochId' <> v_run.epoch_id
    or v_pending_scan.payload->>'baseIdentity' <> v_run.base_identity
    or v_pending_scan.payload->>'scanSequence' !~ '^(0|[1-9][0-9]*)$'
    or (v_pending_scan.payload->>'scanSequence')::integer <> 0
    or v_stream.next_scan_sequence <> 0 then
    raise exception 'r5_recovery_batch_completion_pending_scan_invalid';
  end if;$m$);
  v_definition := replace(v_definition, $m$      expected_payload_chunks, expected_commit_chunks,
      created_at, updated_at, committed_at
    ) values ($m$, $m$      expected_payload_chunks, expected_commit_chunks, source_scan_sequence,
      created_at, updated_at, committed_at
    ) values ($m$);
  v_definition := replace(v_definition, $m$      v_chunk_count, v_chunk_count,
      p_completed_at, p_completed_at, p_completed_at
    );$m$, $m$      v_chunk_count, v_chunk_count, 0,
      p_completed_at, p_completed_at, p_completed_at
    );$m$);
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '8c810628d2bf0be9aa25e8aab2a60a23912563e7524f177c35a4f261ca7c0eec' then raise exception 'terminal_scan_certificate_transform_drift:r5:%',v_sha; end if;
  execute v_definition;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '8c810628d2bf0be9aa25e8aab2a60a23912563e7524f177c35a4f261ca7c0eec' then raise exception 'terminal_scan_certificate_post_apply_drift:r5:%',v_sha; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres' or not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'terminal_scan_certificate_privilege_drift:r5'; end if;
end;
$scan_certificate_functions$;

do $scan_certificate_verify$
declare v_bad bigint;
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='xrpl_phase_work' and column_name='source_scan_sequence' and data_type='integer' and is_nullable='NO' and column_default='0') then raise exception 'terminal_scan_certificate_work_column_invalid'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='xrpl_phase_streams' and column_name='next_scan_sequence' and data_type='integer' and is_nullable='NO' and column_default='0') then raise exception 'terminal_scan_certificate_stream_column_invalid'; end if;
  select count(*) into v_bad from public.xrpl_phase_work where source_scan_sequence<>0;
  if v_bad<>0 then raise exception 'terminal_scan_certificate_historical_work_nonzero:%',v_bad; end if;
  select count(*) into v_bad from public.xrpl_phase_streams where next_scan_sequence<>0;
  if v_bad<>0 then raise exception 'terminal_scan_certificate_initial_stream_nonzero:%',v_bad; end if;
end;
$scan_certificate_verify$;

commit;
