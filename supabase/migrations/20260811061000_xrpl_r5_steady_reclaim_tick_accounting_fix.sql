-- Follow-up repair for the already-applied bounded steady qualification reclaim.
--
-- Production run 31466232756 failed closed because
-- xrpl_resource_guard_v2.tick_accounting references xrpl_steady_v1.ticks.
-- The original eight-table deletion therefore could not commit.
--
-- Production diagnostic run 31499605533 established the actual retained
-- cross-schema boundary. The formal R4C2D steady qualification session has no
-- revision-3 tick_accounting rows; those rows belong to later r4c3-accounting
-- sessions. The exact retained cross-schema dependencies are attempts ->
-- sessions and tick_accounting -> ticks. Both parent identity tables are kept.
--
-- This repair keeps the formal session row and its six completed tick rows.
-- It reclaims only the six data-heavy child tables inside xrpl_steady_v1.
-- It does not request cascading truncation and never mutates
-- xrpl_resource_guard_v2.
--
-- Fail closed before function mutation unless the formal qualification identity,
-- destructive-table FK boundary, and complete retained cross-schema FK set match
-- the production evidence exactly.

do $repair$
declare
  v_tables text[];
  v_target_cross_schema_fk_count bigint;
  v_cross_schema_fks jsonb;
  v_formal_session_count bigint;
  v_formal_tick_count bigint;
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_execute_steady_qualification_reclaim(text)'
  );
  v_definition text;
  v_patched text;
  v_old_truncate constant text :=
    'truncate table xrpl_steady_v1.payload_chunks, xrpl_steady_v1.reference_rows, xrpl_steady_v1.commit_chunks,' || E'\n    ' ||
    'xrpl_steady_v1.messages, xrpl_steady_v1.successors, xrpl_steady_v1.works, xrpl_steady_v1.ticks, xrpl_steady_v1.sessions;';
  v_new_truncate constant text :=
    'truncate table xrpl_steady_v1.payload_chunks, xrpl_steady_v1.reference_rows, xrpl_steady_v1.commit_chunks,' || E'\n    ' ||
    'xrpl_steady_v1.messages, xrpl_steady_v1.successors, xrpl_steady_v1.works;';
  v_old_rows_after constant text :=
    'select' || E'\n    ' ||
    '(select count(*) from xrpl_steady_v1.sessions) + (select count(*) from xrpl_steady_v1.ticks) +' || E'\n    ' ||
    '(select count(*) from xrpl_steady_v1.works) + (select count(*) from xrpl_steady_v1.messages) +' || E'\n    ' ||
    '(select count(*) from xrpl_steady_v1.successors) + (select count(*) from xrpl_steady_v1.payload_chunks) +' || E'\n    ' ||
    '(select count(*) from xrpl_steady_v1.reference_rows) + (select count(*) from xrpl_steady_v1.commit_chunks)' || E'\n  ' ||
    'into v_rows_after;';
  v_new_rows_after constant text :=
    'select' || E'\n    ' ||
    '(select count(*) from xrpl_steady_v1.works) + (select count(*) from xrpl_steady_v1.messages) +' || E'\n    ' ||
    '(select count(*) from xrpl_steady_v1.successors) + (select count(*) from xrpl_steady_v1.payload_chunks) +' || E'\n    ' ||
    '(select count(*) from xrpl_steady_v1.reference_rows) + (select count(*) from xrpl_steady_v1.commit_chunks)' || E'\n  ' ||
    'into v_rows_after;';
  v_old_truncate_occurrences integer;
  v_old_rows_after_occurrences integer;
begin
  select array_agg(c.relname::text order by c.relname)
  into v_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'xrpl_steady_v1'
    and c.relkind in ('r', 'p');

  if v_tables is distinct from array[
    'commit_chunks',
    'messages',
    'payload_chunks',
    'reference_rows',
    'sessions',
    'successors',
    'ticks',
    'works'
  ]::text[] then
    raise exception 'r4f_steady_reclaim_unexpected_isolated_table_set:%', v_tables;
  end if;

  select count(*)::bigint
  into v_target_cross_schema_fk_count
  from pg_catalog.pg_constraint fk
  join pg_catalog.pg_class child on child.oid = fk.conrelid
  join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
  join pg_catalog.pg_class parent on parent.oid = fk.confrelid
  join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
  where fk.contype = 'f'
    and child_ns.nspname is distinct from parent_ns.nspname
    and (
      (
        child_ns.nspname = 'xrpl_steady_v1'
        and child.relname = any(array[
          'payload_chunks', 'reference_rows', 'commit_chunks',
          'messages', 'successors', 'works'
        ]::text[])
      )
      or (
        parent_ns.nspname = 'xrpl_steady_v1'
        and parent.relname = any(array[
          'payload_chunks', 'reference_rows', 'commit_chunks',
          'messages', 'successors', 'works'
        ]::text[])
      )
    );

  if v_target_cross_schema_fk_count <> 0 then
    raise exception 'r4f_steady_reclaim_target_cross_schema_fk_present:%',
      v_target_cross_schema_fk_count;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'constraint', fk.conname,
    'child', child_ns.nspname || '.' || child.relname,
    'parent', parent_ns.nspname || '.' || parent.relname
  ) order by child_ns.nspname, child.relname, fk.conname), '[]'::jsonb)
  into v_cross_schema_fks
  from pg_catalog.pg_constraint fk
  join pg_catalog.pg_class child on child.oid = fk.conrelid
  join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
  join pg_catalog.pg_class parent on parent.oid = fk.confrelid
  join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
  where fk.contype = 'f'
    and child_ns.nspname is distinct from parent_ns.nspname
    and (
      child_ns.nspname = 'xrpl_steady_v1'
      or parent_ns.nspname = 'xrpl_steady_v1'
    );

  if v_cross_schema_fks is distinct from jsonb_build_array(
    jsonb_build_object(
      'constraint', 'attempts_session_id_fkey',
      'child', 'xrpl_resource_guard_v2.attempts',
      'parent', 'xrpl_steady_v1.sessions'
    ),
    jsonb_build_object(
      'constraint', 'tick_accounting_session_id_tick_id_fkey',
      'child', 'xrpl_resource_guard_v2.tick_accounting',
      'parent', 'xrpl_steady_v1.ticks'
    )
  ) then
    raise exception 'r4f_steady_reclaim_retained_cross_schema_fk_drift:%',
      v_cross_schema_fks;
  end if;

  select count(*)::bigint
  into v_formal_session_count
  from xrpl_steady_v1.sessions
  where session_id = 'r4c2d-steady-msflb8fo-5ebc5adc'
    and status = 'completed'
    and target_ticks = 6
    and batch_size = 24
    and completed_ticks = 6
    and committed_ledgers = 144;

  if v_formal_session_count <> 1 then
    raise exception 'r4f_steady_reclaim_formal_session_identity_unexpected:%',
      v_formal_session_count;
  end if;

  select count(*)::bigint
  into v_formal_tick_count
  from xrpl_steady_v1.ticks
  where session_id = 'r4c2d-steady-msflb8fo-5ebc5adc'
    and status = 'completed'
    and tick_sequence between 1 and 6
    and end_ledger_index - start_ledger_index + 1 = 24
    and work_count = 24
    and completed_at is not null
    and error_message is null;

  if v_formal_tick_count <> 6 then
    raise exception 'r4f_steady_reclaim_formal_tick_identity_unexpected:%',
      v_formal_tick_count;
  end if;

  if v_signature is null then
    raise exception 'r4f_steady_reclaim_function_missing';
  end if;

  select pg_catalog.pg_get_functiondef(v_signature) into v_definition;

  if position('truncate table xrpl_steady_v1.payload_chunks' in v_definition) = 0
    or position('xrpl_steady_v1.ticks, xrpl_steady_v1.sessions;' in v_definition) = 0
    or position('cascade' in lower(v_definition)) <> 0 then
    raise exception 'r4f_steady_reclaim_source_already_changed_or_unsafe';
  end if;

  v_old_truncate_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old_truncate, ''))) / length(v_old_truncate);
  v_old_rows_after_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old_rows_after, ''))) / length(v_old_rows_after);

  if v_old_truncate_occurrences <> 1 or v_old_rows_after_occurrences <> 1 then
    raise exception 'r4f_steady_reclaim_source_definition_drift:%/%',
      v_old_truncate_occurrences,
      v_old_rows_after_occurrences;
  end if;

  v_patched := replace(v_definition, v_old_truncate, v_new_truncate);
  v_patched := replace(v_patched, v_old_rows_after, v_new_rows_after);

  execute v_patched;

  select pg_catalog.pg_get_functiondef(v_signature) into v_patched;
  if position(v_new_truncate in v_patched) = 0
    or position(v_old_truncate in v_patched) <> 0
    or position(v_new_rows_after in v_patched) = 0
    or position(v_old_rows_after in v_patched) <> 0
    or position('xrpl_resource_guard_v2.tick_accounting' in v_patched) <> 0
    or position('cascade' in lower(v_patched)) <> 0 then
    raise exception 'r4f_steady_reclaim_partial_patch_verification_failed';
  end if;
end;
$repair$;

revoke all on function public.xrpl_execute_steady_qualification_reclaim(text)
  from public, anon, authenticated;
grant execute on function public.xrpl_execute_steady_qualification_reclaim(text)
  to service_role;
