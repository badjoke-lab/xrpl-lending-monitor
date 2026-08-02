create or replace function xrpl_steady_v1.replace_pending_scan_before_insert()
returns trigger
language plpgsql
set search_path = xrpl_steady_v1, pg_temp
as $$
begin
  if new.phase = 'scan' and new.status = 'completed' then
    delete from xrpl_steady_v1.messages
    where session_id = new.session_id
      and message_id = new.message_id
      and status = 'pending'
      and attempt_count = 0;
  end if;
  return new;
end;
$$;

drop trigger if exists xrpl_steady_replace_pending_scan on xrpl_steady_v1.messages;
create trigger xrpl_steady_replace_pending_scan
before insert on xrpl_steady_v1.messages
for each row
execute function xrpl_steady_v1.replace_pending_scan_before_insert();

revoke all on function xrpl_steady_v1.replace_pending_scan_before_insert() from public, anon, authenticated;
