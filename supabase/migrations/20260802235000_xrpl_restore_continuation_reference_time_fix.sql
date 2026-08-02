create or replace function xrpl_restore_continuation_v1.preserve_source_reference_created_at()
returns trigger
language plpgsql
security definer
set search_path = public, xrpl_restore_continuation_v1, pg_temp
as $$
declare
  v_source_created_at timestamptz;
begin
  select rows.created_at
  into v_source_created_at
  from public.xrpl_phase_reference_rows as rows
  where rows.work_id = new.work_id
    and rows.semantic_class = new.semantic_class
    and rows.canonical_key = new.canonical_key;

  if not found then
    raise exception 'restore continuation source reference row is unavailable: % / % / %',
      new.work_id,
      new.semantic_class,
      new.canonical_key;
  end if;

  new.created_at := v_source_created_at;
  return new;
end;
$$;

drop trigger if exists xrpl_restore_continuation_preserve_reference_created_at
  on xrpl_restore_continuation_v1.xrpl_phase_reference_rows;

create trigger xrpl_restore_continuation_preserve_reference_created_at
before insert or update of work_id, semantic_class, canonical_key
on xrpl_restore_continuation_v1.xrpl_phase_reference_rows
for each row
execute function xrpl_restore_continuation_v1.preserve_source_reference_created_at();

do $$
declare
  v_fixture_exists boolean;
  v_mismatch_count integer;
begin
  select exists (
    select 1
    from xrpl_restore_continuation_v1.restore_metadata
    where fixture_id = 'r4c2c-post-restore-continuation-v1'
  ) into v_fixture_exists;

  if not v_fixture_exists then
    return;
  end if;

  update xrpl_restore_continuation_v1.xrpl_phase_reference_rows as target
  set created_at = source.created_at
  from public.xrpl_phase_reference_rows as source
  where source.work_id = target.work_id
    and source.semantic_class = target.semantic_class
    and source.canonical_key = target.canonical_key
    and target.created_at is distinct from source.created_at;

  select count(*)
  into v_mismatch_count
  from xrpl_restore_continuation_v1.xrpl_phase_reference_rows as target
  left join public.xrpl_phase_reference_rows as source
    on source.work_id = target.work_id
   and source.semantic_class = target.semantic_class
   and source.canonical_key = target.canonical_key
  where source.work_id is null
     or target.created_at is distinct from source.created_at;

  if v_mismatch_count <> 0 then
    raise exception 'restore continuation reference timestamp parity remains incomplete: %',
      v_mismatch_count;
  end if;
end;
$$;

revoke all on function xrpl_restore_continuation_v1.preserve_source_reference_created_at()
  from public, anon, authenticated;
