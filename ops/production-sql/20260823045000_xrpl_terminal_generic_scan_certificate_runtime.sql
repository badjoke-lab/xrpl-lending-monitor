begin;

-- Staged production SQL only. Merge does not apply this file.
-- Requires the earlier terminal scan-certificate runtime patch to have been applied first.
-- Any production apply still requires Issue #1261 prepare -> exact OWNER authorization -> bounded apply -> independent read-only verify.
-- Exact current generic definitions were captured read-only by run 32618515092 from main c22c72753212eba91aab4e85c9b3ad5b2858e5a8.

do $generic_scan_certificate_preflight$
declare
  v_signature regprocedure;
  v_definition text;
  v_sha text;
  v_work_type oid;
  v_stream_type oid;
  v_work_not_null boolean;
  v_stream_not_null boolean;
begin
  select atttypid, attnotnull into v_work_type, v_work_not_null
  from pg_attribute
  where attrelid='public.xrpl_phase_work'::regclass
    and attname='source_scan_sequence'
    and not attisdropped;
  select atttypid, attnotnull into v_stream_type, v_stream_not_null
  from pg_attribute
  where attrelid='public.xrpl_phase_streams'::regclass
    and attname='next_scan_sequence'
    and not attisdropped;
  if v_work_type is distinct from 'integer'::regtype
    or v_stream_type is distinct from 'integer'::regtype
    or v_work_not_null is distinct from true
    or v_stream_not_null is distinct from true then
    raise exception 'generic_scan_certificate_requires_terminal_certificate_columns';
  end if;

  -- Fail closed unless the earlier portable certificate runtime is already installed.
  v_signature := 'public.xrpl_complete_portable_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,text)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '5e9cb3bfea6126c1d436ffb15fee5e8aaf6f2da3e0f83bf048d9cbdcf35040b0' then
    raise exception 'generic_scan_certificate_portable_scan_dependency_drift:%',v_sha;
  end if;
  v_signature := 'public.xrpl_complete_portable_finalize_phase(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'daf97c6858300a2ec4a00eb24f60b53936dc4aa56200accc16e098c64e8f37b7' then
    raise exception 'generic_scan_certificate_portable_finalize_dependency_drift:%',v_sha;
  end if;

  v_signature := 'public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,integer,text,text)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'cd6b05ccd95eb29bfa046d29cfd01236371301865ceef7bb8db3fd2afadd6bff' then
    raise exception 'generic_scan_certificate_source_drift:scan:%',v_sha;
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres'
    or not has_function_privilege('service_role',v_signature,'EXECUTE') then
    raise exception 'generic_scan_certificate_privilege_drift:scan';
  end if;

  v_signature := 'public.xrpl_complete_finalize_phase(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'd3051c3b654274f7e6fa222be829b42829c6695c39a09c697065093364a6ff35' then
    raise exception 'generic_scan_certificate_source_drift:finalize:%',v_sha;
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres'
    or not has_function_privilege('service_role',v_signature,'EXECUTE') then
    raise exception 'generic_scan_certificate_privilege_drift:finalize';
  end if;
end;
$generic_scan_certificate_preflight$;

do $generic_scan_certificate_functions$
declare
  v_signature regprocedure;
  v_definition text;
  v_sha text;
begin
  v_signature := 'public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,integer,text,text)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'cd6b05ccd95eb29bfa046d29cfd01236371301865ceef7bb8db3fd2afadd6bff' then
    raise exception 'generic_scan_certificate_source_drift:scan:%',v_sha;
  end if;
  v_definition := replace(v_definition, $m$  if not found or v_stream.status <> 'active' then
    raise exception 'phase stream is unavailable';
  end if;

  select * into v_watermark$m$, $m$  if not found or v_stream.status <> 'active' then
    raise exception 'phase stream is unavailable';
  end if;
  if v_message.payload->>'scanSequence' !~ '^(0|[1-9][0-9]*)$'
    or (v_message.payload->>'scanSequence')::integer <> v_stream.next_scan_sequence then
    raise exception 'scan sequence certificate conflict';
  end if;

  select * into v_watermark$m$);
  v_definition := replace(v_definition, $m$    expected_payload_chunks, expected_commit_chunks, created_at, updated_at
  ) values ($m$, $m$    expected_payload_chunks, expected_commit_chunks, source_scan_sequence,
    created_at, updated_at
  ) values ($m$);
  v_definition := replace(v_definition, $m$    p_payload_digest, 1, 1, p_completed_at, p_completed_at
  )$m$, $m$    p_payload_digest, 1, 1, v_stream.next_scan_sequence,
    p_completed_at, p_completed_at
  )$m$);
  v_definition := replace(v_definition, $m$      and payload_digest = p_payload_digest
      and status in ('staged', 'committing', 'finalizing', 'committed')$m$, $m$      and payload_digest = p_payload_digest
      and source_scan_sequence = v_stream.next_scan_sequence
      and status in ('staged', 'committing', 'finalizing', 'committed')$m$);
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '907e4c741ba065ffcb2ddd0a7358f83737c737673ca1fa6d371710f96e5a62ff' then
    raise exception 'generic_scan_certificate_transform_drift:scan:%',v_sha;
  end if;
  execute v_definition;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> '907e4c741ba065ffcb2ddd0a7358f83737c737673ca1fa6d371710f96e5a62ff' then
    raise exception 'generic_scan_certificate_post_apply_drift:scan:%',v_sha;
  end if;

  v_signature := 'public.xrpl_complete_finalize_phase(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'd3051c3b654274f7e6fa222be829b42829c6695c39a09c697065093364a6ff35' then
    raise exception 'generic_scan_certificate_source_drift:finalize:%',v_sha;
  end if;
  v_definition := replace(v_definition, $m$  if not found or v_stream.status <> 'active' then
    raise exception 'phase stream is unavailable';
  end if;

  select * into v_current_watermark$m$, $m$  if not found or v_stream.status <> 'active' then
    raise exception 'phase stream is unavailable';
  end if;
  if v_stream.next_scan_sequence <> v_work.source_scan_sequence then
    raise exception 'finalize scan sequence certificate conflict';
  end if;

  select * into v_current_watermark$m$);
  v_definition := replace(v_definition, $m$  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_next_scan_id, p_completed_at
  );

  update public.xrpl_phase_messages$m$, $m$  perform public.xrpl_phase_reserve_successor(
    p_message_id, v_next_scan_id, p_completed_at
  );

  if v_stream.next_scan_sequence <> 0 then
    update public.xrpl_phase_streams
    set next_scan_sequence = 0,
        updated_at = p_completed_at
    where profile_id = v_work.profile_id
      and next_scan_sequence = v_work.source_scan_sequence;
    if not found then
      raise exception 'finalize scan sequence reset conflict';
    end if;
  end if;

  update public.xrpl_phase_messages$m$);
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'cfbc2dde88dc7026621193d2b970a1fdd35b7f9f7a248a7ef0035f1f87cae446' then
    raise exception 'generic_scan_certificate_transform_drift:finalize:%',v_sha;
  end if;
  execute v_definition;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex');
  if v_sha <> 'cfbc2dde88dc7026621193d2b970a1fdd35b7f9f7a248a7ef0035f1f87cae446' then
    raise exception 'generic_scan_certificate_post_apply_drift:finalize:%',v_sha;
  end if;

  if pg_get_userbyid((select proowner from pg_proc where oid='public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,integer,text,text)'::regprocedure)) <> 'postgres'
    or not has_function_privilege('service_role','public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,integer,text,text)'::regprocedure,'EXECUTE')
    or pg_get_userbyid((select proowner from pg_proc where oid='public.xrpl_complete_finalize_phase(text,text,timestamp with time zone)'::regprocedure)) <> 'postgres'
    or not has_function_privilege('service_role','public.xrpl_complete_finalize_phase(text,text,timestamp with time zone)'::regprocedure,'EXECUTE') then
    raise exception 'generic_scan_certificate_post_apply_privilege_drift';
  end if;
end;
$generic_scan_certificate_functions$;

commit;
