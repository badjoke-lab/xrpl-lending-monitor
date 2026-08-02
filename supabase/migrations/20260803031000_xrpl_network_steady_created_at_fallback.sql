create or replace function xrpl_steady_v1.fill_reference_row_created_at()
returns trigger
language plpgsql
set search_path = xrpl_steady_v1, pg_temp
as $$
begin
  if new.created_at is null then
    new.created_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists xrpl_steady_fill_reference_row_created_at
  on xrpl_steady_v1.reference_rows;
create trigger xrpl_steady_fill_reference_row_created_at
before insert on xrpl_steady_v1.reference_rows
for each row
execute function xrpl_steady_v1.fill_reference_row_created_at();

revoke all on function xrpl_steady_v1.fill_reference_row_created_at()
  from public, anon, authenticated;

comment on function xrpl_steady_v1.fill_reference_row_created_at() is
  'Qualification-only fallback for normalized reference rows whose provider-neutral createdAt field is absent.';
