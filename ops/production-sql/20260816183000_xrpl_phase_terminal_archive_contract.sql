create schema if not exists xrpl_phase_archive_v1;

revoke all on schema xrpl_phase_archive_v1 from public;
revoke all on schema xrpl_phase_archive_v1 from anon, authenticated, service_role;

create table if not exists xrpl_phase_archive_v1.terminal_messages (
  schema_version integer not null default 1 check (schema_version = 1),
  message_hash bytea primary key,
  successor_hash bytea not null unique,
  message_id text not null,
  profile_id text not null,
  phase text not null check (phase in ('scan', 'commit', 'finalize')),
  payload jsonb not null,
  successor_message_id text not null,
  completed_at timestamptz not null,
  result_digest text,
  archived_at timestamptz not null,
  constraint terminal_messages_message_hash_check check (
    message_hash = extensions.digest(convert_to(message_id, 'UTF8'), 'sha256')
  ),
  constraint terminal_messages_successor_hash_check check (
    successor_hash = extensions.digest(convert_to(successor_message_id, 'UTF8'), 'sha256')
  ),
  constraint terminal_messages_result_digest_check check (
    result_digest is null or result_digest ~ '^[a-f0-9]{64}$'
  )
);

alter table xrpl_phase_archive_v1.terminal_messages enable row level security;
revoke all on table xrpl_phase_archive_v1.terminal_messages from public;
revoke all on table xrpl_phase_archive_v1.terminal_messages from anon, authenticated, service_role;

create or replace function xrpl_phase_archive_v1.assert_message_identity(
  p_profile_id text,
  p_phase text,
  p_message_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_phase_archive_v1, extensions, pg_temp
as $function$
declare
  v_hash bytea := extensions.digest(convert_to(p_message_id, 'UTF8'), 'sha256');
  v_archived xrpl_phase_archive_v1.terminal_messages%rowtype;
begin
  select * into v_archived
  from xrpl_phase_archive_v1.terminal_messages
  where message_hash = v_hash;

  if not found then
    return null;
  end if;

  if v_archived.message_id <> p_message_id then
    raise exception 'phase archive message hash collision';
  end if;

  if v_archived.profile_id <> p_profile_id
     or v_archived.phase <> p_phase
     or v_archived.payload <> p_payload then
    raise exception 'phase message identity conflict: %', p_message_id;
  end if;

  return jsonb_build_object(
    'archived', true,
    'message_id', v_archived.message_id,
    'successor_message_id', v_archived.successor_message_id,
    'completed_at', v_archived.completed_at
  );
end;
$function$;

create or replace function xrpl_phase_archive_v1.assert_successor_identity(
  p_current_message_id text,
  p_successor_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, xrpl_phase_archive_v1, extensions, pg_temp
as $function$
declare
  v_current_hash bytea := extensions.digest(convert_to(p_current_message_id, 'UTF8'), 'sha256');
  v_successor_hash bytea := extensions.digest(convert_to(p_successor_message_id, 'UTF8'), 'sha256');
  v_archived xrpl_phase_archive_v1.terminal_messages%rowtype;
begin
  select * into v_archived
  from xrpl_phase_archive_v1.terminal_messages
  where message_hash = v_current_hash;

  if found then
    if v_archived.message_id <> p_current_message_id then
      raise exception 'phase archive message hash collision';
    end if;
    if v_archived.successor_message_id <> p_successor_message_id then
      raise exception 'phase successor identity conflict: %', p_current_message_id;
    end if;
    return true;
  end if;

  select * into v_archived
  from xrpl_phase_archive_v1.terminal_messages
  where successor_hash = v_successor_hash;

  if found then
    if v_archived.successor_message_id <> p_successor_message_id then
      raise exception 'phase archive successor hash collision';
    end if;
    raise exception 'phase successor identity conflict: %', p_current_message_id;
  end if;

  return false;
end;
$function$;

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
begin
  select * into v_archived
  from xrpl_phase_archive_v1.terminal_messages
  where message_hash = v_hash;

  if not found then
    return null;
  end if;

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
end;
$function$;

create or replace function xrpl_phase_archive_v1.terminalize_message(
  p_message_id text,
  p_archived_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, xrpl_phase_archive_v1, extensions, pg_temp
as $function$
declare
  v_message public.xrpl_phase_messages%rowtype;
  v_mapping public.xrpl_phase_successors%rowtype;
  v_existing xrpl_phase_archive_v1.terminal_messages%rowtype;
  v_message_hash bytea := extensions.digest(convert_to(p_message_id, 'UTF8'), 'sha256');
  v_successor_hash bytea;
  v_result_digest text;
  v_deleted integer;
begin
  if p_archived_at is null then
    raise exception 'archived_at is required';
  end if;

  select * into v_message
  from public.xrpl_phase_messages
  where message_id = p_message_id
  for update;

  if not found then
    select * into v_existing
    from xrpl_phase_archive_v1.terminal_messages
    where message_hash = v_message_hash;

    if not found then
      raise exception 'phase message not found: %', p_message_id;
    end if;
    if v_existing.message_id <> p_message_id then
      raise exception 'phase archive message hash collision';
    end if;

    return jsonb_build_object(
      'archived', true,
      'duplicate', true,
      'message_id', v_existing.message_id,
      'successor_message_id', v_existing.successor_message_id
    );
  end if;

  if v_message.status <> 'completed' or v_message.completed_at is null then
    raise exception 'only completed phase messages may be archived: %', p_message_id;
  end if;
  if v_message.successor_message_id is null then
    raise exception 'completed phase message has no successor: %', p_message_id;
  end if;

  select * into v_mapping
  from public.xrpl_phase_successors
  where current_message_id = p_message_id
  for update;

  if not found or v_mapping.successor_message_id <> v_message.successor_message_id then
    raise exception 'phase successor mapping missing or mismatched: %', p_message_id;
  end if;

  perform 1
  from public.xrpl_phase_messages
  where message_id = v_message.successor_message_id;
  if not found then
    raise exception 'phase successor message is not live: %', v_message.successor_message_id;
  end if;

  if exists (
    select 1
    from public.xrpl_phase_successors
    where successor_message_id = p_message_id
  ) then
    raise exception 'phase archive predecessor edge is still live: %', p_message_id;
  end if;

  v_successor_hash := extensions.digest(convert_to(v_message.successor_message_id, 'UTF8'), 'sha256');
  v_result_digest := case
    when v_message.result is null then null
    else encode(extensions.digest(convert_to(v_message.result::text, 'UTF8'), 'sha256'), 'hex')
  end;

  select * into v_existing
  from xrpl_phase_archive_v1.terminal_messages
  where message_hash = v_message_hash
  for update;

  if found then
    if v_existing.message_id <> v_message.message_id then
      raise exception 'phase archive message hash collision';
    end if;
    if v_existing.profile_id <> v_message.profile_id
       or v_existing.phase <> v_message.phase
       or v_existing.payload <> v_message.payload
       or v_existing.successor_message_id <> v_message.successor_message_id
       or v_existing.completed_at <> v_message.completed_at
       or v_existing.result_digest is distinct from v_result_digest then
      raise exception 'phase archive identity conflict: %', p_message_id;
    end if;
  else
    select * into v_existing
    from xrpl_phase_archive_v1.terminal_messages
    where successor_hash = v_successor_hash
    for update;

    if found then
      if v_existing.successor_message_id <> v_message.successor_message_id then
        raise exception 'phase archive successor hash collision';
      end if;
      raise exception 'phase successor identity conflict: %', p_message_id;
    end if;

    insert into xrpl_phase_archive_v1.terminal_messages (
      message_hash,
      successor_hash,
      message_id,
      profile_id,
      phase,
      payload,
      successor_message_id,
      completed_at,
      result_digest,
      archived_at
    ) values (
      v_message_hash,
      v_successor_hash,
      v_message.message_id,
      v_message.profile_id,
      v_message.phase,
      v_message.payload,
      v_message.successor_message_id,
      v_message.completed_at,
      v_result_digest,
      p_archived_at
    );
  end if;

  delete from public.xrpl_phase_successors
  where current_message_id = p_message_id
    and successor_message_id = v_message.successor_message_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'phase successor delete count mismatch: %', v_deleted;
  end if;

  delete from public.xrpl_phase_messages
  where message_id = p_message_id
    and status = 'completed'
    and completed_at = v_message.completed_at;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'phase message delete count mismatch: %', v_deleted;
  end if;

  return jsonb_build_object(
    'archived', true,
    'duplicate', false,
    'message_id', v_message.message_id,
    'successor_message_id', v_message.successor_message_id,
    'result_digest', v_result_digest
  );
end;
$function$;

revoke all on function xrpl_phase_archive_v1.assert_message_identity(text, text, text, jsonb) from public;
revoke all on function xrpl_phase_archive_v1.assert_message_identity(text, text, text, jsonb) from anon, authenticated, service_role;
revoke all on function xrpl_phase_archive_v1.assert_successor_identity(text, text) from public;
revoke all on function xrpl_phase_archive_v1.assert_successor_identity(text, text) from anon, authenticated, service_role;
revoke all on function xrpl_phase_archive_v1.duplicate_completion(text, text) from public;
revoke all on function xrpl_phase_archive_v1.duplicate_completion(text, text) from anon, authenticated, service_role;
revoke all on function xrpl_phase_archive_v1.terminalize_message(text, timestamptz) from public;
revoke all on function xrpl_phase_archive_v1.terminalize_message(text, timestamptz) from anon, authenticated, service_role;
