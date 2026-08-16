-- Production-staged repair for the revision-4 minute-run completion wrapper.
--
-- The formal 12-ledger qualification evidence is intentionally a singleton
-- bound to r5-recovery-selected-revision4-entry. The existing wrapper captures
-- every 12-ledger revision-4 completion into that singleton, so a later minute
-- run reaches the table's strict run-id CHECK and fails closed. Broadening that
-- CHECK would allow the formal qualification evidence to be overwritten.
--
-- Keep the table constraint and existing evidence row unchanged. Patch only the
-- wrapper's capture predicate so the formal qualification run continues to be
-- eligible for evidence capture while all other revision-4 runs use the proven
-- atomic completion path without touching qualification evidence.
--
-- This file is under ops/production-sql and is never auto-applied by merge.

do $minute_completion_capture_guard$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
  );
  v_inner_signature regprocedure := to_regprocedure(
    'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
  );
  v_definition text;
  v_patched text;
  v_constraint_definition text;
  v_constraint_count bigint;
  v_evidence_count bigint;
  v_evidence_run_id text;
  v_old_capture constant text := E'  if v_batch.ledger_count = 12 then\n';
  v_new_capture constant text := E'  if v_batch.ledger_count = 12\n    and p_run_id = ''r5-recovery-selected-revision4-entry'' then\n';
  v_old_occurrences integer;
  v_new_occurrences integer;
begin
  if v_signature is null or v_inner_signature is null then
    raise exception 'r5_minute_completion_capture_required_function_missing';
  end if;

  select count(*)::bigint, max(pg_get_constraintdef(c.oid))
    into v_constraint_count, v_constraint_definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'xrpl_r5_v1'
    and t.relname = 'revision4_accounting_qualification_evidence'
    and c.conname = 'xrpl_r5_revision4_accounting_qualification_run_check'
    and c.contype = 'c';

  if v_constraint_count <> 1
    or position('r5-recovery-selected-revision4-entry' in coalesce(v_constraint_definition, '')) = 0
    or position('r5-recovery-selected-revision4-minute-entry' in coalesce(v_constraint_definition, '')) <> 0 then
    raise exception 'r5_minute_completion_capture_qualification_constraint_drift:%',
      coalesce(v_constraint_definition, '<missing>');
  end if;

  select count(*)::bigint, max(run_id)
    into v_evidence_count, v_evidence_run_id
  from xrpl_r5_v1.revision4_accounting_qualification_evidence
  where qualification_key = 'r4f-revision4-r5-12-ledger-accounting-v1';

  if v_evidence_count <> 1
    or v_evidence_run_id <> 'r5-recovery-selected-revision4-entry' then
    raise exception 'r5_minute_completion_capture_formal_evidence_drift:%/%',
      v_evidence_count, coalesce(v_evidence_run_id, '<missing>');
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  if position('xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture' in v_definition) = 0
    or position('revision4_accounting_qualification_evidence' in v_definition) = 0
    or position('r4f-revision4-r5-12-ledger-accounting-v1' in v_definition) = 0 then
    raise exception 'r5_minute_completion_capture_wrapper_contract_drift';
  end if;

  v_old_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old_capture, ''))) / length(v_old_capture);
  v_new_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_new_capture, ''))) / length(v_new_capture);

  if v_old_occurrences <> 1 or v_new_occurrences <> 0 then
    raise exception 'r5_minute_completion_capture_source_shape_unexpected:%/%',
      v_old_occurrences, v_new_occurrences;
  end if;

  v_patched := replace(v_definition, v_old_capture, v_new_capture);
  execute v_patched;

  select pg_get_functiondef(v_signature) into v_patched;
  v_old_occurrences :=
    (length(v_patched) - length(replace(v_patched, v_old_capture, ''))) / length(v_old_capture);
  v_new_occurrences :=
    (length(v_patched) - length(replace(v_patched, v_new_capture, ''))) / length(v_new_capture);

  if v_old_occurrences <> 0
    or v_new_occurrences <> 1
    or position('xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture' in v_patched) = 0
    or position('revision4_accounting_qualification_evidence' in v_patched) = 0 then
    raise exception 'r5_minute_completion_capture_patch_verification_failed:%/%',
      v_old_occurrences, v_new_occurrences;
  end if;

  select count(*)::bigint, max(run_id)
    into v_evidence_count, v_evidence_run_id
  from xrpl_r5_v1.revision4_accounting_qualification_evidence
  where qualification_key = 'r4f-revision4-r5-12-ledger-accounting-v1';

  if v_evidence_count <> 1
    or v_evidence_run_id <> 'r5-recovery-selected-revision4-entry' then
    raise exception 'r5_minute_completion_capture_formal_evidence_changed:%/%',
      v_evidence_count, coalesce(v_evidence_run_id, '<missing>');
  end if;
end;
$minute_completion_capture_guard$;
