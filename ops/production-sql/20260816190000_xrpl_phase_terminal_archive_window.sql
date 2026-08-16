create or replace function xrpl_phase_archive_v1.terminalize_completed_window(
  p_profile_id text,
  p_completed_at timestamptz,
  p_archived_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, xrpl_phase_archive_v1, extensions, pg_temp
as $function$
declare
  v_message_id text;
  v_archived_count integer := 0;
begin
  if p_profile_id is null or p_profile_id = ''
     or p_completed_at is null
     or p_archived_at is null then
    raise exception 'terminal archive window identity is invalid';
  end if;

  loop
    v_message_id := null;

    select messages.message_id
    into v_message_id
    from public.xrpl_phase_messages messages
    where messages.profile_id = p_profile_id
      and messages.status = 'completed'
      and messages.completed_at = p_completed_at
      and not exists (
        select 1
        from public.xrpl_phase_successors incoming
        where incoming.successor_message_id = messages.message_id
      )
    order by messages.created_at, messages.message_id
    limit 1
    for update of messages;

    exit when v_message_id is null;

    perform xrpl_phase_archive_v1.terminalize_message(
      v_message_id,
      p_archived_at
    );

    v_archived_count := v_archived_count + 1;
    if v_archived_count > 100000 then
      raise exception 'terminal archive window safety bound exceeded';
    end if;
  end loop;

  if exists (
    select 1
    from public.xrpl_phase_messages messages
    where messages.profile_id = p_profile_id
      and messages.status = 'completed'
      and messages.completed_at = p_completed_at
  ) then
    raise exception 'terminal archive window has unresolved predecessor chain';
  end if;

  return v_archived_count;
end;
$function$;

revoke all on function xrpl_phase_archive_v1.terminalize_completed_window(text, timestamptz, timestamptz) from public;
revoke all on function xrpl_phase_archive_v1.terminalize_completed_window(text, timestamptz, timestamptz) from anon, authenticated, service_role;
