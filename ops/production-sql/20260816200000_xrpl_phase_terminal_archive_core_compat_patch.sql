do $patch$
declare
  v record;
  v_oid oid;
  v_definition text;
  v_sha text;
  v_position integer;
  v_marker text;
  v_replacement text;
begin
  if to_regprocedure('xrpl_phase_archive_v1.assert_message_identity(text,text,text,jsonb)') is null
     or to_regprocedure('xrpl_phase_archive_v1.assert_successor_identity(text,text)') is null
     or to_regprocedure('xrpl_phase_archive_v1.duplicate_completion(text,text)') is null then
    raise exception 'terminal archive core helpers are not installed';
  end if;

  for v in
    select * from (values
    ('xrpl_phase_insert_message', 'p_profile_id text, p_phase text, p_message_id text, p_payload jsonb, p_available_at timestamp with time zone, p_created_at timestamp with time zone', '39f4bbe6c9e15e1f03549e7a389a30b30bf343c3bdf9e840468ebe58cd6f96ce', '1da5932584f944509782eb2dba50ad68b7e2c832e82463984975d5c08f44879a', 'insert', ''),
    ('xrpl_phase_reserve_successor', 'p_current_message_id text, p_successor_message_id text, p_reserved_at timestamp with time zone', 'c6a2bc130386d9e5c6001e005ba299fc1cc874124e7a70b557208441377a4df9', 'e07a1d323e24d80909861a5379e0ee57a029648f92bdf5ed21c7d98155a1714f', 'reserve', ''),
    ('xrpl_complete_caught_up_scan', 'p_owner text, p_message_id text, p_completed_at timestamp with time zone', 'e1541a3c93835662a8f0f255eb12e4726b26c00f125b4d6048fa983dfa2a3a0c', '3d7f4c7d7ed7cbd91b54f268dad5bdead09ef4eba278085e3146f45c07ebc899', 'complete', 'scan'),
    ('xrpl_complete_scan_phase', 'p_owner text, p_message_id text, p_completed_at timestamp with time zone, p_ledger_index bigint, p_ledger_hash text, p_parent_hash text, p_close_time bigint, p_payload_json text, p_payload_digest text, p_byte_count integer', '583f7c6acbad42430c9b7c18c159667b01c4384bfdbb69900644d193d01e57f6', 'cd6b05ccd95eb29bfa046d29cfd01236371301865ceef7bb8db3fd2afadd6bff', 'complete', 'scan'),
    ('xrpl_complete_commit_phase', 'p_owner text, p_message_id text, p_completed_at timestamp with time zone', '5dfe3d3f2b5ea079b6efbd89ffb8794cc50fa7a2b25abd1525f8ee5c6dd38ad8', 'ab452bea0f967427122a89628cd9274621773700d9e06c5ddef628ac02bf75f4', 'complete', 'commit'),
    ('xrpl_complete_finalize_phase', 'p_owner text, p_message_id text, p_completed_at timestamp with time zone', 'f66e1276e0f35ee16e5d91462fa8004acbe4174a76db1246d98c6749b4d38cf2', 'd3051c3b654274f7e6fa222be829b42829c6695c39a09c697065093364a6ff35', 'complete', 'finalize'),
    ('xrpl_complete_portable_scan_phase', 'p_owner text, p_message_id text, p_completed_at timestamp with time zone, p_ledger_index bigint, p_ledger_hash text, p_parent_hash text, p_payload_digest text, p_semantic_counts_json text, p_chunks_json text', '74cf2ff52d821515a93cfaa40386fb88a3ea16aea550c8f8346189104e78fab7', '6f65875ec781135434326c53ed159c61154dc7f24728e02a9f578778dfea717d', 'complete', 'scan'),
    ('xrpl_complete_portable_commit_phase_strict', 'p_owner text, p_message_id text, p_completed_at timestamp with time zone, p_reference_rows_json text, p_reference_rows_digest text', 'd3fe3b081fd25299bfa27bce53d2d8d1a5065690eccd0aaf2c1f1d27356d1fe5', '524a48ab154d650f0a37ada2386d52172163ab51acbfeed795b5bcbd224fbcfb', 'complete', 'commit'),
    ('xrpl_complete_portable_finalize_phase', 'p_owner text, p_message_id text, p_completed_at timestamp with time zone', '6b6b5fabc8ce71e4d1985b2a4af917ccf9de3615fcbd5ec467cb8928f70bf898', '8d761a2bf69ea4228f18f482ab620e294354644f60eea6e8101a4efd55766a0a', 'complete', 'finalize')
    ) as patches(function_name, identity_arguments, expected_before, expected_after, patch_mode, phase)
  loop
    select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v.function_name
      and pg_get_function_identity_arguments(p.oid)=v.identity_arguments;
    if v_oid is null then raise exception 'terminal archive core target missing: %', v.function_name; end if;
    select pg_get_functiondef(v_oid) into v_definition;
    v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');

    if v_sha = v.expected_after then
      if v.patch_mode = 'insert' and v_definition not like '%xrpl_phase_archive_v1.assert_message_identity%' then
        raise exception 'archive-aware insert post-state drift: %', v.function_name;
      elsif v.patch_mode = 'reserve' and v_definition not like '%xrpl_phase_archive_v1.assert_successor_identity%' then
        raise exception 'archive-aware successor post-state drift: %', v.function_name;
      elsif v.patch_mode = 'complete' and v_definition not like '%xrpl_phase_archive_v1.duplicate_completion%' then
        raise exception 'archive-aware completion post-state drift: %', v.function_name;
      end if;
      continue;
    end if;
    if v_sha <> v.expected_before then
      raise exception 'terminal archive core source drift for %: %', v.function_name, v_sha;
    end if;

    if v.patch_mode = 'insert' then
      v_marker := E'declare\n  v_existing public.xrpl_phase_messages%rowtype;\nbegin\n';
      v_replacement := E'declare\n  v_existing public.xrpl_phase_messages%rowtype;\n  v_archived jsonb;\nbegin\n  v_archived := xrpl_phase_archive_v1.assert_message_identity(\n    p_profile_id, p_phase, p_message_id, p_payload\n  );\n  if v_archived is not null then\n    return;\n  end if;\n\n';
    elsif v.patch_mode = 'reserve' then
      v_marker := E'AS $function$\nbegin\n';
      v_replacement := E'AS $function$\nbegin\n  if xrpl_phase_archive_v1.assert_successor_identity(\n    p_current_message_id, p_successor_message_id\n  ) then\n    return;\n  end if;\n\n';
    else
      v_marker := E'\nbegin\n';
      v_replacement := E'\n  v_archived_duplicate jsonb;\nbegin\n';
    end if;
    v_position := strpos(v_definition, v_marker);
    if v_position = 0 then raise exception 'terminal archive core primary patch marker missing: %', v.function_name; end if;
    v_definition := overlay(v_definition placing v_replacement from v_position for length(v_marker));

    if v.patch_mode = 'complete' then
      v_marker := E'  select * into v_message\n  from public.xrpl_phase_messages\n';
      v_replacement := format(E'  v_archived_duplicate := xrpl_phase_archive_v1.duplicate_completion(\n    p_message_id, %L\n  );\n  if v_archived_duplicate is not null then\n    return v_archived_duplicate;\n  end if;\n\n%s', v.phase, v_marker);
      v_position := strpos(v_definition, v_marker);
      if v_position = 0 then raise exception 'completion message lookup marker missing: %', v.function_name; end if;
      v_definition := overlay(v_definition placing v_replacement from v_position for length(v_marker));
    end if;

    if encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex') <> v.expected_after then
      raise exception 'terminal archive core patched digest mismatch for %', v.function_name;
    end if;
    execute v_definition;
    select pg_get_functiondef(v_oid) into v_definition;
    v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
    if v_sha <> v.expected_after then
      raise exception 'terminal archive core post-apply digest mismatch for %: %', v.function_name, v_sha;
    end if;
  end loop;
end;
$patch$;
