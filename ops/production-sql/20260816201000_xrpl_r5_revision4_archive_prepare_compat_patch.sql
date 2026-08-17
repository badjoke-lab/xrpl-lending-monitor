do $patch$
declare
  v_signature constant text := 'public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone)';
  v_expected_before constant text := 'aaf2014c2553813458bec1b14fc06edc3901364cd0cfc9b2370a056b9432f494';
  v_expected_after constant text := '2795e4abe98f2dea95adb8a937446e824e85b3708b6aaeca2d2047a16dff3d5c';
  v_declare_marker constant text := E'  v_predecessor public.xrpl_phase_messages%rowtype;\n  v_current_work public.xrpl_phase_work%rowtype;';
  v_declare_replacement constant text := E'  v_predecessor public.xrpl_phase_messages%rowtype;\n  v_archived_predecessor xrpl_phase_archive_v1.terminal_messages%rowtype;\n  v_current_work public.xrpl_phase_work%rowtype;';
  v_chain_marker constant text := E'  select messages.* into v_predecessor\n  from public.xrpl_phase_successors successors\n  join public.xrpl_phase_messages messages\n    on messages.message_id = successors.current_message_id\n  where successors.successor_message_id = v_pending_scan.message_id;\n  if not found\n    or v_predecessor.profile_id <> ''supabase-devnet''\n    or v_predecessor.phase <> ''finalize''\n    or v_predecessor.status <> ''completed''\n    or v_predecessor.result->>''status'' <> ''committed''\n    or v_predecessor.result->>''workId'' <> v_watermark.work_id\n    or (v_predecessor.result->>''ledgerIndex'')::bigint <> v_watermark.ledger_index\n    or upper(v_predecessor.result->>''ledgerHash'') <> v_watermark.ledger_hash then\n    raise exception ''r5_recovery_prepare_successor_chain_invalid'';\n  end if;\n';
  v_chain_replacement constant text := E'  select messages.* into v_predecessor\n  from public.xrpl_phase_successors successors\n  join public.xrpl_phase_messages messages\n    on messages.message_id = successors.current_message_id\n  where successors.successor_message_id = v_pending_scan.message_id;\n  if found then\n    if v_predecessor.profile_id <> ''supabase-devnet''\n      or v_predecessor.phase <> ''finalize''\n      or v_predecessor.status <> ''completed''\n      or v_predecessor.result->>''status'' <> ''committed''\n      or v_predecessor.result->>''workId'' <> v_watermark.work_id\n      or (v_predecessor.result->>''ledgerIndex'')::bigint <> v_watermark.ledger_index\n      or upper(v_predecessor.result->>''ledgerHash'') <> v_watermark.ledger_hash then\n      raise exception ''r5_recovery_prepare_successor_chain_invalid'';\n    end if;\n  else\n    select * into v_archived_predecessor\n    from xrpl_phase_archive_v1.terminal_messages\n    where successor_hash = extensions.digest(\n      convert_to(v_pending_scan.message_id, ''UTF8''), ''sha256''\n    );\n    if not found\n      or v_archived_predecessor.successor_message_id <> v_pending_scan.message_id\n      or v_archived_predecessor.profile_id <> ''supabase-devnet''\n      or v_archived_predecessor.phase <> ''finalize''\n      or v_archived_predecessor.payload->>''workId'' <> v_watermark.work_id then\n      raise exception ''r5_recovery_prepare_successor_chain_invalid'';\n    end if;\n  end if;\n';
  v_definition text;
  v_sha text;
  v_count integer;
begin
  if to_regclass('xrpl_phase_archive_v1.terminal_messages') is null then
    raise exception 'terminal archive table missing';
  end if;

  select pg_get_functiondef(v_signature::regprocedure) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');

  if v_sha = v_expected_after then
    if v_definition not like '%v_archived_predecessor xrpl_phase_archive_v1.terminal_messages%'
       or v_definition not like '%where successor_hash = extensions.digest(%' then
      raise exception 'revision4 archive prepare already-patched shape drift';
    end if;
    return;
  end if;
  if v_sha <> v_expected_before then
    raise exception 'revision4 archive prepare source drift: %', v_sha;
  end if;

  v_count := (length(v_definition)-length(replace(v_definition,v_declare_marker,'')))/length(v_declare_marker);
  if v_count <> 1 then raise exception 'revision4 archive prepare declaration marker count: %', v_count; end if;
  v_definition := replace(v_definition,v_declare_marker,v_declare_replacement);

  v_count := (length(v_definition)-length(replace(v_definition,v_chain_marker,'')))/length(v_chain_marker);
  if v_count <> 1 then raise exception 'revision4 archive prepare chain marker count: %', v_count; end if;
  v_definition := replace(v_definition,v_chain_marker,v_chain_replacement);

  if encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex') <> v_expected_after then
    raise exception 'revision4 archive prepare patched digest mismatch';
  end if;
  execute v_definition;
  select pg_get_functiondef(v_signature::regprocedure) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> v_expected_after then
    raise exception 'revision4 archive prepare post-apply digest mismatch: %', v_sha;
  end if;
end;
$patch$;
