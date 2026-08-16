#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-terminal-archive-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_TERMINAL_ARCHIVE_OUTPUT:-r5-terminal-transport-archive-evidence}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory" && mkdir -p "$output_directory"

docker run --detach --rm --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres \
  "$image" > "${output_directory}/container-id.txt"

stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable_ready=$((stable_ready + 1)); [[ "$stable_ready" -ge 3 ]] && break
  else stable_ready=0; fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/setup.log" <<'SQL'
create schema extensions;
create extension pgcrypto with schema extensions;
create schema proof;

create table proof.messages (
  message_id text primary key,
  profile_id text not null,
  phase text not null check (phase in ('scan','commit','finalize')),
  payload jsonb not null,
  status text not null check (status in ('pending','leased','retry','completed','error')),
  result jsonb,
  successor_message_id text,
  completed_at timestamptz
);
create table proof.successors (
  current_message_id text primary key references proof.messages(message_id),
  successor_message_id text not null unique references proof.messages(message_id),
  reserved_at timestamptz not null
);
create table proof.terminal_archive (
  message_hash bytea primary key,
  successor_hash bytea not null unique,
  message_id text not null,
  profile_id text not null,
  phase text not null check (phase in ('scan','commit','finalize')),
  payload jsonb not null,
  successor_message_id text not null,
  completed_at timestamptz not null,
  check (message_hash=extensions.digest(convert_to(message_id,'UTF8'),'sha256')),
  check (successor_hash=extensions.digest(convert_to(successor_message_id,'UTF8'),'sha256'))
);

create or replace function proof.insert_message(
  p_profile_id text,p_phase text,p_message_id text,p_payload jsonb
) returns void language plpgsql as $$
declare
  a proof.terminal_archive%rowtype;
  m proof.messages%rowtype;
  v_hash bytea:=extensions.digest(convert_to(p_message_id,'UTF8'),'sha256');
begin
  select * into a from proof.terminal_archive where message_hash=v_hash;
  if found then
    if a.message_id<>p_message_id then raise exception 'archive message hash collision'; end if;
    if a.profile_id<>p_profile_id or a.phase<>p_phase or a.payload<>p_payload then
      raise exception 'phase message identity conflict: %',p_message_id;
    end if;
    return;
  end if;
  insert into proof.messages(message_id,profile_id,phase,payload,status)
  values(p_message_id,p_profile_id,p_phase,p_payload,'pending')
  on conflict(message_id) do nothing;
  select * into m from proof.messages where message_id=p_message_id;
  if m.profile_id<>p_profile_id or m.phase<>p_phase or m.payload<>p_payload then
    raise exception 'phase message identity conflict: %',p_message_id;
  end if;
end $$;

create or replace function proof.reserve_successor(
  p_current text,p_successor text,p_reserved_at timestamptz
) returns void language plpgsql as $$
declare
  a proof.terminal_archive%rowtype;
  collision proof.terminal_archive%rowtype;
  v_current_hash bytea:=extensions.digest(convert_to(p_current,'UTF8'),'sha256');
  v_successor_hash bytea:=extensions.digest(convert_to(p_successor,'UTF8'),'sha256');
begin
  select * into a from proof.terminal_archive where message_hash=v_current_hash;
  if found then
    if a.message_id<>p_current then raise exception 'archive message hash collision'; end if;
    if a.successor_message_id<>p_successor then raise exception 'phase successor identity conflict: %',p_current; end if;
    return;
  end if;
  select * into collision from proof.terminal_archive where successor_hash=v_successor_hash;
  if found and (collision.successor_message_id<>p_successor or collision.message_id<>p_current) then
    raise exception 'phase successor identity conflict: %',p_current;
  end if;
  insert into proof.successors(current_message_id,successor_message_id,reserved_at)
  values(p_current,p_successor,p_reserved_at)
  on conflict(current_message_id) do nothing;
  if not exists(select 1 from proof.successors where current_message_id=p_current and successor_message_id=p_successor) then
    raise exception 'phase successor identity conflict: %',p_current;
  end if;
end $$;

create or replace function proof.duplicate_completion(p_message_id text,p_phase text)
returns jsonb language plpgsql as $$
declare
  m proof.messages%rowtype;
  a proof.terminal_archive%rowtype;
  v_hash bytea:=extensions.digest(convert_to(p_message_id,'UTF8'),'sha256');
begin
  select * into m from proof.messages where message_id=p_message_id;
  if found then
    if m.phase<>p_phase then raise exception 'message phase mismatch'; end if;
    if m.status='completed' then
      return jsonb_build_object('completed',true,'duplicate',true,'successor_message_id',m.successor_message_id);
    end if;
    return jsonb_build_object('completed',false,'duplicate',false);
  end if;
  select * into a from proof.terminal_archive where message_hash=v_hash;
  if not found or a.message_id<>p_message_id or a.phase<>p_phase then raise exception 'message not found'; end if;
  return jsonb_build_object('completed',true,'duplicate',true,'successor_message_id',a.successor_message_id);
end $$;

with generated as (
  select g,
    'scan:v1:devnet:epoch:'||g::text||':'||repeat(md5(g::text),6) as id,
    'scan:v1:devnet:epoch:'||(g+1)::text||':'||repeat(md5((g+1)::text),6) as successor_id,
    jsonb_build_object('schemaVersion',1,'phase','scan','messageId','scan:v1:devnet:epoch:'||g::text||':'||repeat(md5(g::text),6),'blob',repeat(md5('p'||g::text),18)) as payload,
    jsonb_build_object('status','committed','blob',repeat(md5('r'||g::text),18)) as result
  from generate_series(1,8001) g
)
insert into proof.messages(message_id,profile_id,phase,payload,status,result,successor_message_id,completed_at)
select id,'supabase-devnet','scan',payload,
  case when g<=6000 then 'completed' when g=8001 then 'pending' else 'completed' end,
  case when g<=8000 then result else null end,
  case when g<=8000 then successor_id else null end,
  case when g<=6000 then '2026-08-14 00:00:00+00'::timestamptz+g*interval '1 second'
       when g<=8000 then '2026-08-16 12:00:00+00'::timestamptz+g*interval '1 second' else null end
from generated;

insert into proof.successors(current_message_id,successor_message_id,reserved_at)
select message_id,successor_message_id,coalesce(completed_at,'2026-08-16 12:00:00+00')
from proof.messages where successor_message_id is not null;
analyze proof.messages; analyze proof.successors;
SQL

before_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.messages')+pg_total_relation_size('proof.successors')")"
before_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from proof.messages")"
old_id="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select message_id from proof.messages where message_id like 'scan:v1:devnet:epoch:100:%'")"
old_successor="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select successor_message_id from proof.messages where message_id='$old_id'")"
old_payload="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select payload::text from proof.messages where message_id='$old_id'")"
cutoff_id="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select message_id from proof.messages where message_id like 'scan:v1:devnet:epoch:6000:%'")"
cutoff_successor="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select successor_message_id from proof.messages where message_id='$cutoff_id'")"
retained_id="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select message_id from proof.messages where message_id like 'scan:v1:devnet:epoch:7000:%'")"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/compact.log" <<'SQL'
insert into proof.terminal_archive(message_hash,successor_hash,message_id,profile_id,phase,payload,successor_message_id,completed_at)
select
  extensions.digest(convert_to(message_id,'UTF8'),'sha256'),
  extensions.digest(convert_to(successor_message_id,'UTF8'),'sha256'),
  message_id,profile_id,phase,payload,successor_message_id,completed_at
from proof.messages
where status='completed' and completed_at<'2026-08-15 00:00:00+00';

delete from proof.successors s using proof.terminal_archive a where s.current_message_id=a.message_id;
do $$ begin
  if exists(select 1 from proof.successors s join proof.terminal_archive a on a.message_id=s.successor_message_id) then
    raise exception 'retained current points to archived successor';
  end if;
end $$;
delete from proof.messages m using proof.terminal_archive a where m.message_id=a.message_id;

vacuum full proof.successors;
vacuum full proof.messages;
vacuum full proof.terminal_archive;
analyze proof.messages; analyze proof.successors; analyze proof.terminal_archive;
SQL

after_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.messages')+pg_total_relation_size('proof.successors')+pg_total_relation_size('proof.terminal_archive')")"
after_live_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from proof.messages")"
archive_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from proof.terminal_archive")"
archive_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_total_relation_size('proof.terminal_archive')")"
reclaimed_bytes=$((before_bytes-after_bytes))
reclaimed_percent=$((reclaimed_bytes*100/before_bytes))

[[ "$before_rows" == 8001 ]]
[[ "$archive_rows" == 6000 ]]
[[ "$after_live_rows" == 2001 ]]
[[ "$reclaimed_bytes" -gt 0 ]]
[[ "$reclaimed_percent" -ge 25 ]]

docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc \
  "select proof.insert_message('supabase-devnet','scan','$old_id',\$json\$$old_payload\$json\$::jsonb);"
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from proof.messages where message_id='$old_id'")" == 0 ]]

set +e
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc \
  "select proof.insert_message('supabase-devnet','scan','$old_id','{\"changed\":true}'::jsonb);" \
  > "${output_directory}/payload-conflict.stdout" 2> "${output_directory}/payload-conflict.stderr"
payload_conflict_rc=$?
set -e
[[ "$payload_conflict_rc" -ne 0 ]]; grep -q 'phase message identity conflict' "${output_directory}/payload-conflict.stderr"

docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc \
  "select proof.reserve_successor('$old_id','$old_successor','2026-08-17 00:00:00+00');"
set +e
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc \
  "select proof.reserve_successor('$old_id','$cutoff_successor','2026-08-17 00:00:00+00');" \
  > "${output_directory}/successor-conflict.stdout" 2> "${output_directory}/successor-conflict.stderr"
successor_conflict_rc=$?
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc \
  "select proof.reserve_successor('$retained_id','$old_successor','2026-08-17 00:00:00+00');" \
  > "${output_directory}/successor-reuse.stdout" 2> "${output_directory}/successor-reuse.stderr"
successor_reuse_rc=$?
set -e
[[ "$successor_conflict_rc" -ne 0 ]]; grep -q 'phase successor identity conflict' "${output_directory}/successor-conflict.stderr"
[[ "$successor_reuse_rc" -ne 0 ]]; grep -q 'phase successor identity conflict' "${output_directory}/successor-reuse.stderr"

duplicate_json="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select proof.duplicate_completion('$old_id','scan')::text")"
[[ "$(printf '%s' "$duplicate_json" | jq -r '.completed')" == true ]]
[[ "$(printf '%s' "$duplicate_json" | jq -r '.duplicate')" == true ]]
[[ "$(printf '%s' "$duplicate_json" | jq -r '.successor_message_id')" == "$old_successor" ]]
cutoff_json="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select proof.duplicate_completion('$cutoff_id','scan')::text")"
[[ "$(printf '%s' "$cutoff_json" | jq -r '.successor_message_id')" == "$cutoff_successor" ]]
[[ "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from proof.messages where message_id='$cutoff_successor'")" == 1 ]]

cat > "${output_directory}/summary.md" <<EOF
## R5 terminal transport compact-archive local PostgreSQL proof

- PostgreSQL: \`15-alpine\`
- synthetic messages before: \`${before_rows}\`
- archived completed messages: \`${archive_rows}\`
- retained live/recent messages: \`${after_live_rows}\`
- messages+successors bytes before: \`${before_bytes}\`
- live+archive bytes after local rewrite: \`${after_bytes}\`
- archive bytes after local rewrite: \`${archive_bytes}\`
- reclaimed bytes / percent: \`${reclaimed_bytes} / ${reclaimed_percent}%\`
- full message ID / profile / phase / payload retained: \`true\`
- exact successor ID retained: \`true\`
- terminal result JSON retained: \`false\`
- identical archived insert converges: \`true\`
- archived payload drift rejected: \`true\`
- identical archived successor reservation converges: \`true\`
- archived successor mapping drift rejected: \`true\`
- archived successor reuse by another current rejected: \`true\`
- archived duplicate completion returns exact successor: \`true\`
- old-current -> retained-successor cutoff edge preserved: \`true\`
- production database used: \`false\`
- production compaction authorized: \`false\`

This proves only compact terminal identity semantics and local physical-shrink direction. Compatibility with every historical recovery/qualification consumer remains a separate gate. Production DELETE, table rewrite, VACUUM FULL, reindex, and R5 rearm remain unauthorized.
EOF
cat "${output_directory}/summary.md"
