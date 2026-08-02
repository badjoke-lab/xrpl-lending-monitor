create or replace function public.xrpl_phase_commit_message_id(
  p_work_id text,
  p_chunk_index integer
)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select concat(
    'commit:v1:',
    replace(p_work_id, ':', '%3A'),
    ':',
    p_chunk_index::text
  )
$$;

create or replace function public.xrpl_phase_finalize_message_id(p_work_id text)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select concat('finalize:v1:', replace(p_work_id, ':', '%3A'))
$$;

revoke all on function public.xrpl_phase_commit_message_id(text, integer) from public;
revoke all on function public.xrpl_phase_finalize_message_id(text) from public;
grant execute on function public.xrpl_phase_commit_message_id(text, integer) to service_role;
grant execute on function public.xrpl_phase_finalize_message_id(text) to service_role;
