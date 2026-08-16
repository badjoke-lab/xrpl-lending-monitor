do $patch$
declare
  v_signature constant text := 'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)';
  v_expected_before constant text := 'd759dfef8b11de9379af3d72cf28caba2f109e28f7aa83b36ece32e230a2b150';
  v_expected_after constant text := 'a7114afea201a32bd90c3f6ee08ae666e033e83bcc99384eb2a5b4a415f814b7';
  v_marker constant text := E'  where run_id = p_run_id;\n\n  return jsonb_build_object(';
  v_replacement constant text := E'  where run_id = p_run_id;\n\n  perform xrpl_phase_archive_v1.terminalize_completed_window(\n    ''supabase-devnet'', p_completed_at, p_completed_at\n  );\n\n  return jsonb_build_object(';
  v_definition text;
  v_sha text;
  v_marker_count integer;
begin
  if to_regprocedure('xrpl_phase_archive_v1.terminalize_completed_window(text,timestamp with time zone,timestamp with time zone)') is null then
    raise exception 'revision4 terminal archive completion helper missing';
  end if;

  select pg_get_functiondef(v_signature::regprocedure)
  into v_definition;

  v_sha := encode(
    extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_sha = v_expected_after then
    if (length(v_definition) - length(replace(
      v_definition,
      'xrpl_phase_archive_v1.terminalize_completed_window',
      ''
    ))) / length('xrpl_phase_archive_v1.terminalize_completed_window') <> 1 then
      raise exception 'revision4 terminal archive completion already-patched shape drift';
    end if;
    return;
  end if;

  if v_sha <> v_expected_before then
    raise exception 'revision4 terminal archive completion source drift: %', v_sha;
  end if;

  v_marker_count := (
    length(v_definition) - length(replace(v_definition, v_marker, ''))
  ) / length(v_marker);

  if v_marker_count <> 1 then
    raise exception 'revision4 terminal archive completion marker count: %', v_marker_count;
  end if;

  v_definition := replace(v_definition, v_marker, v_replacement);

  if encode(
    extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  ) <> v_expected_after then
    raise exception 'revision4 terminal archive completion patched digest mismatch';
  end if;

  execute v_definition;

  select pg_get_functiondef(v_signature::regprocedure)
  into v_definition;

  v_sha := encode(
    extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_sha <> v_expected_after then
    raise exception 'revision4 terminal archive completion post-apply digest mismatch: %', v_sha;
  end if;
end;
$patch$;
