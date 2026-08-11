-- Follow-up repair for the already-applied bounded steady qualification reclaim.
--
-- Production run 31466232756 failed closed because
-- xrpl_resource_guard_v2.tick_accounting references xrpl_steady_v1.ticks.
-- The original eight-table deletion therefore could not commit. The retained
-- revision-3 accounting evidence is explicitly outside the reclaim scope and
-- the original reclaim evidence already declares revision3AccountingUntouched.
--
-- This repair keeps the formal session row, six completed tick rows, and the
-- cross-schema accounting evidence intact. It reclaims only the six data-heavy
-- child tables inside xrpl_steady_v1. It does not request cascading truncation
-- and never mutates xrpl_resource_guard_v2.
--
-- Cross-schema foreign keys that involve retained identity tables do not make
-- the six-table reclaim unsafe. The required boundary is narrower and exact:
-- none of the six tables being truncated may participate in a cross-schema FK.
--
-- If the retained accounting identity does not match the formal steady session,
-- fail before function mutation and emit a bounded diagnostic describing only
-- relation names, counts, session ids, and formal tick ids/statuses.

do $repair$
declare
  v_tables text[];
  v_target_cross_schema_fk_count bigint;
  v_expected_accounting_fk_count bigint;
  v_retained_accounting_count bigint;
  v_retained_accounting_join_count bigint;
  v_accounting_total bigint;
  v_accounting_sessions jsonb;
  v_formal_ticks jsonb;
  v_cross_schema_fks jsonb;
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

  select count(*)::bigint
  into v_expected_accounting_fk_count
  from pg_catalog.pg_constraint fk
  join pg_catalog.pg_class child on child.oid = fk.conrelid
  join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
  join pg_catalog.pg_class parent on parent.oid = fk.confrelid
  join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
  where fk.contype = 'f'
    and child_ns.nspname = 'xrpl_resource_guard_v2'
    and child.relname = 'tick_accounting'
    and parent_ns.nspname = 'xrpl_steady_v1'
    and parent.relname = 'ticks';

  if v_expected_accounting_fk_count <> 1 then
    raise exception 'r4f_steady_reclaim_accounting_fk_unexpected:%',
      v_expected_accounting_fk_count;
  end if;

  select count(*)::bigint
  into v_retained_accounting_count
  from xrpl_resource_guard_v2.tick_accounting
  where session_id = 'r4c2d-steady-msflb8fo-5ebc5adc';

  select count(*)::bigint
  into v_retained_accounting_join_count
  from xrpl_resource_guard_v2.tick_accounting a
  join xrpl_steady_v1.ticks t
    on t.session_id = a.session_id and t.tick_id = a.tick_id
  where a.session_id = 'r4c2d-steady-msflb8fo-5ebc5adc'
    and t.status = 'completed';

  if v_retained_accounting_count <> 6 or v_retained_accounting_join_count <> 6 then
    select count(*)::bigint
    into v_accounting_total
    from xrpl_resource_guard_v2.tick_accounting;

    select coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.accounting_count desc, grouped.session_id), '[]'::jsonb)
    into v_accounting_sessions
    from (
      select session_id, count(*)::bigint as accounting_count
      from xrpl_resource_guard_v2.tick_accounting
      group by session_id
      order by count(*) desc, session_id
      limit 20
    ) grouped;

    select coalesce(jsonb_agg(jsonb_build_object(
      'tickId', tick_id,
      'status', status,
      'committedLedgers', committed_ledgers
    ) order by tick_id), '[]'::jsonb)
    into v_formal_ticks
    from xrpl_steady_v1.ticks
    where session_id = 'r4c2d-steady-msflb8fo-5ebc5adc';

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

    raise exception 'r4f_steady_reclaim_retained_accounting_evidence_unexpected:%/% total=% sessions=% formalTicks=% crossSchemaFks=%',
      v_retained_accounting_count,
      v_retained_accounting_join_count,
      v_accounting_total,
      v_accounting_sessions,
      v_formal_ticks,
      v_cross_schema_fks;
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
