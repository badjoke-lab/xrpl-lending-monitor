do $patch$
declare
  v_oid oid;
  v_definition text;
  v_definition_sha text;
  v_source_sha text;
  v_marker text := E'  perform pg_advisory_xact_lock(hashtextextended(''xrpl-r5-active-checkpoint'', 0));\n';
  v_replacement text := E'  if exists (select 1 from xrpl_phase_archive_v1.terminal_messages) then\n    raise exception ''r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint'';\n  end if;\n\n  perform pg_advisory_xact_lock(hashtextextended(''xrpl-r5-active-checkpoint'', 0));\n';
  v_before constant text := 'bc135435e0d729526aff6940c96b3ef78530b4612586f82ef73a7b99e145da10';
  v_before_source constant text := 'd17d392292b4ca38c9b1f85fb0d8f2bebe3cd6db978ca42a70cfd3bc3deb133c';
  v_after constant text := 'e170166e6c73bf4e7a112ad3daf94873935d0b2b248abf55f7bb42059575c733';
begin
  if to_regclass('xrpl_phase_archive_v1.terminal_messages') is null then
    raise exception 'terminal archive table is not installed';
  end if;

  select p.oid,
         pg_get_functiondef(p.oid),
         encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
  into v_oid, v_definition, v_source_sha
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'xrpl_create_r5_active_checkpoint_strict'
    and pg_get_function_identity_arguments(p.oid) =
      'p_checkpoint_id text, p_observed_at timestamp with time zone';

  if v_oid is null then
    raise exception 'R5 strict checkpoint target is missing';
  end if;

  v_definition_sha := encode(
    extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_definition_sha = v_after then
    if v_definition not like '%r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint%'
       or v_definition not like '%xrpl_phase_archive_v1.terminal_messages%' then
      raise exception 'R5 checkpoint archive fail-close post-state drift';
    end if;
    return;
  end if;

  if v_definition_sha <> v_before or v_source_sha <> v_before_source then
    raise exception 'R5 strict checkpoint source drift: definition %, source %',
      v_definition_sha, v_source_sha;
  end if;

  if strpos(v_definition, v_marker) = 0 then
    raise exception 'R5 strict checkpoint fail-close patch marker is missing';
  end if;
  if strpos(substr(v_definition, strpos(v_definition, v_marker) + length(v_marker)), v_marker) <> 0 then
    raise exception 'R5 strict checkpoint fail-close patch marker is not unique';
  end if;

  v_definition := replace(v_definition, v_marker, v_replacement);
  if encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex') <> v_after then
    raise exception 'R5 strict checkpoint fail-close patched digest mismatch';
  end if;

  execute v_definition;

  select pg_get_functiondef(v_oid) into v_definition;
  v_definition_sha := encode(
    extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_definition_sha <> v_after
     or v_definition not like '%r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint%'
     or v_definition not like '%xrpl_phase_archive_v1.terminal_messages%' then
    raise exception 'R5 strict checkpoint fail-close post-apply verification failed: %',
      v_definition_sha;
  end if;
end;
$patch$;
