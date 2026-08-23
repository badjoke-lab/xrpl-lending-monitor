begin;

-- Staged production SQL only. Merge does not apply this file.
-- Requires the terminal scan-certificate runtime and generic certificate closure to be applied first.
-- Any production apply still requires Issue #1261 prepare -> exact OWNER authorization -> bounded apply -> independent read-only verify.
-- Exact current production source fingerprints were captured read-only by run 32618515092 from main c22c72753212eba91aab4e85c9b3ad5b2858e5a8.

do $archive_scan_fallback_preflight$
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
  where attrelid = 'public.xrpl_phase_work'::regclass
    and attname = 'source_scan_sequence'
    and not attisdropped;
  select atttypid, attnotnull into v_stream_type, v_stream_not_null
  from pg_attribute
  where attrelid = 'public.xrpl_phase_streams'::regclass
    and attname = 'next_scan_sequence'
    and not attisdropped;
  if v_work_type is distinct from 'integer'::regtype
    or v_stream_type is distinct from 'integer'::regtype
    or v_work_not_null is distinct from true
    or v_stream_not_null is distinct from true then
    raise exception 'archive_scan_fallback_requires_terminal_scan_certificate_columns';
  end if;

  v_signature := 'xrpl_phase_archive_v1.duplicate_completion(text,text)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> '170c7ff6069ae9dd9a272a04dd839a2d575c9e9b4055b121149a13dda6467044' then
    raise exception 'archive_scan_fallback_source_drift:duplicate_completion:%', v_sha;
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid = v_signature)) <> 'postgres'
    or not (select prosecdef from pg_proc where oid = v_signature)
    or has_function_privilege('service_role', v_signature, 'EXECUTE') then
    raise exception 'archive_scan_fallback_privilege_drift:duplicate_completion';
  end if;

  v_signature := 'public.xrpl_phase_scan_message_id(text,text,text,bigint,text,integer)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> 'cd79dde7fc5fd160acecda28b0f1355245765cbd041cb70423b5b3119748a0a4' then
    raise exception 'archive_scan_fallback_source_drift:scan_id:%', v_sha;
  end if;

  v_signature := 'public.xrpl_phase_work_id(text,text,text,bigint,text)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> '6650d4e5e70bceafc035fe467d1ae7b0e1c40e487ad9b92108aa1ebba02a0308' then
    raise exception 'archive_scan_fallback_source_drift:work_id:%', v_sha;
  end if;

  v_signature := 'public.xrpl_phase_commit_message_id(text,integer)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> 'c3d965bd154c933a355c68097e4ca2f52c75a0a83b121ccd3d2eee366a3c3b79' then
    raise exception 'archive_scan_fallback_source_drift:commit_id:%', v_sha;
  end if;

  v_signature := 'public.xrpl_complete_caught_up_scan(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> '0a37e55b8881847a61cf95f78746039fd6967571721aa50b5a0f1baff62fd1c6' then
    raise exception 'archive_scan_fallback_certificate_dependency_drift:caught_up:%', v_sha;
  end if;

  v_signature := 'public.xrpl_complete_portable_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,text)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> '5e9cb3bfea6126c1d436ffb15fee5e8aaf6f2da3e0f83bf048d9cbdcf35040b0' then
    raise exception 'archive_scan_fallback_certificate_dependency_drift:portable_scan:%', v_sha;
  end if;

  v_signature := 'public.xrpl_complete_portable_finalize_phase(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> 'daf97c6858300a2ec4a00eb24f60b53936dc4aa56200accc16e098c64e8f37b7' then
    raise exception 'archive_scan_fallback_certificate_dependency_drift:portable_finalize:%', v_sha;
  end if;

  v_signature := 'public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,bigint,text,text,integer)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> '907e4c741ba065ffcb2ddd0a7358f83737c737673ca1fa6d371710f96e5a62ff' then
    raise exception 'archive_scan_fallback_certificate_dependency_drift:generic_scan:%', v_sha;
  end if;

  v_signature := 'public.xrpl_complete_finalize_phase(text,text,timestamp with time zone)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> 'cfbc2dde88dc7026621193d2b970a1fdd35b7f9f7a248a7ef0035f1f87cae446' then
    raise exception 'archive_scan_fallback_certificate_dependency_drift:generic_finalize:%', v_sha;
  end if;

  v_signature := 'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'::regprocedure;
  select pg_get_functiondef(v_signature) into v_definition;
  v_sha := encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> '8c810628d2bf0be9aa25e8aab2a60a23912563e7524f177c35a4f261ca7c0eec' then
    raise exception 'archive_scan_fallback_certificate_dependency_drift:r5:%', v_sha;
  end if;
end;
$archive_scan_fallback_preflight$;

create or replace function xrpl_phase_archive_v1.duplicate_completion(
  p_message_id text,
  p_phase text
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_phase_archive_v1, extensions, pg_temp
as $function$
declare
  v_hash bytea := extensions.digest(convert_to(p_message_id, 'UTF8'), 'sha256');
  v_archived xrpl_phase_archive_v1.terminal_messages%rowtype;
  v_match text[];
  v_previous_index bigint;
  v_parent_hash text;
  v_scan_sequence integer;
  v_candidate_work_ids text[];
  v_work public.xrpl_phase_work%rowtype;
  v_successor_id text;
begin
  select * into v_archived
  from xrpl_phase_archive_v1.terminal_messages
  where message_hash = v_hash;

  if found then
    if v_archived.message_id <> p_message_id then
      raise exception 'phase archive message hash collision';
    end if;
    if v_archived.phase <> p_phase then
      raise exception 'message phase mismatch';
    end if;

    return jsonb_build_object(
      'archived', true,
      'completed', true,
      'duplicate', true,
      'successor_message_id', v_archived.successor_message_id,
      'completed_at', v_archived.completed_at
    );
  end if;

  if exists (
    select 1 from public.xrpl_phase_messages where message_id = p_message_id
  ) then
    return null;
  end if;

  if p_phase <> 'scan' then
    return null;
  end if;

  v_match := regexp_match(
    p_message_id,
    ':([0-9]+):([A-F0-9]{64}):([0-9]+)$'
  );
  if v_match is null then
    return null;
  end if;

  begin
    v_previous_index := v_match[1]::bigint;
    v_parent_hash := v_match[2];
    v_scan_sequence := v_match[3]::integer;
  exception
    when numeric_value_out_of_range then
      return null;
  end;

  select array_agg(candidate.work_id order by candidate.work_id)
  into v_candidate_work_ids
  from (
    select work.work_id
    from public.xrpl_phase_work as work
    where work.previous_ledger_index = v_previous_index
      and work.expected_parent_hash = v_parent_hash
      and work.source_scan_sequence = v_scan_sequence
      and work.start_ledger_index = work.previous_ledger_index + 1
      and work.scanned_end_ledger_index is not null
      and work.scanned_end_ledger_index >= work.start_ledger_index
      and work.final_ledger_hash ~ '^[A-F0-9]{64}$'
      and work.payload_digest ~ '^[a-f0-9]{64}$'
      and work.expected_payload_chunks >= 1
      and work.expected_commit_chunks >= 1
      and work.status in ('staged', 'committing', 'finalizing', 'committed', 'error')
      and work.work_id = public.xrpl_phase_work_id(
        work.network,
        work.epoch_id,
        work.base_identity,
        work.previous_ledger_index,
        work.expected_parent_hash
      )
      and p_message_id = public.xrpl_phase_scan_message_id(
        work.network,
        work.epoch_id,
        work.base_identity,
        work.previous_ledger_index,
        work.expected_parent_hash,
        work.source_scan_sequence
      )
    order by work.work_id
    limit 2
  ) as candidate;

  if v_candidate_work_ids is null then
    return null;
  end if;
  if cardinality(v_candidate_work_ids) <> 1 then
    raise exception 'durable scan duplicate identity is ambiguous: %', p_message_id;
  end if;

  select * into v_work
  from public.xrpl_phase_work
  where work_id = v_candidate_work_ids[1];
  if not found then
    raise exception 'durable scan duplicate work disappeared: %', p_message_id;
  end if;

  v_successor_id := public.xrpl_phase_commit_message_id(v_work.work_id, 0);

  return jsonb_build_object(
    'completed', true,
    'duplicate', true,
    'derived', true,
    'successor_message_id', v_successor_id,
    'completed_at', v_work.created_at
  );
end;
$function$;

do $archive_scan_fallback_postflight$
declare
  v_signature regprocedure := 'xrpl_phase_archive_v1.duplicate_completion(text,text)'::regprocedure;
  v_source text;
  v_sha text;
begin
  select prosrc into v_source from pg_proc where oid = v_signature;
  v_sha := encode(extensions.digest(convert_to(v_source, 'UTF8'), 'sha256'), 'hex');
  if v_sha <> '5ca60025c49a205de120c352ecef9d48ac18db566515b6595fe93909958098b4' then
    raise exception 'archive_scan_fallback_post_apply_source_drift:%', v_sha;
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid = v_signature)) <> 'postgres'
    or not (select prosecdef from pg_proc where oid = v_signature)
    or has_function_privilege('service_role', v_signature, 'EXECUTE') then
    raise exception 'archive_scan_fallback_post_apply_privilege_drift';
  end if;
  if not (
    select coalesce(
      'search_path=public, xrpl_phase_archive_v1, extensions, pg_temp' = any(proconfig),
      false
    )
    from pg_proc
    where oid = v_signature
  ) then
    raise exception 'archive_scan_fallback_post_apply_search_path_drift';
  end if;
end;
$archive_scan_fallback_postflight$;

commit;
