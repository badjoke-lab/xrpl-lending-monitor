#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-archive-v3-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_TERMINAL_ARCHIVE_V3_OUTPUT:-r5-terminal-archive-v3-normalized-evidence}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory" && mkdir -p "$output_directory"

docker run --detach --rm --name "$container_name" --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres "$image" > "${output_directory}/container-id.txt"
stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable_ready=$((stable_ready+1)); [[ "$stable_ready" -ge 3 ]] && break
  else
    stable_ready=0
  fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/proof.log" <<'SQL'
create schema extensions;
create extension pgcrypto with schema extensions;
create schema proof;

create table proof.archive_v2 (
  schema_version integer not null default 2 check (schema_version=2),
  message_hash bytea primary key,
  successor_hash bytea not null unique,
  message_id text not null,
  profile_id text not null,
  phase text not null check (phase in ('scan','commit','finalize')),
  payload_digest bytea not null,
  finalize_work_id text,
  successor_message_id text not null,
  completed_at timestamptz not null,
  result_digest text,
  archived_at timestamptz not null,
  check (message_hash=extensions.digest(convert_to(message_id,'UTF8'),'sha256')),
  check (successor_hash=extensions.digest(convert_to(successor_message_id,'UTF8'),'sha256')),
  check (octet_length(payload_digest)=32),
  check ((phase='finalize') = (finalize_work_id is not null))
);

create table proof.archive_v3_streams (
  stream_key smallint primary key,
  profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  unique(profile_id,network,epoch_id,base_identity)
);

create table proof.archive_v3_works (
  stream_key smallint not null references proof.archive_v3_streams(stream_key),
  start_ledger_index bigint not null,
  expected_parent_hash bytea not null check (octet_length(expected_parent_hash)=32),
  scanned_end_ledger_index bigint not null,
  final_ledger_hash bytea not null check (octet_length(final_ledger_hash)=32),
  primary key(stream_key,start_ledger_index),
  check (scanned_end_ledger_index >= start_ledger_index)
);

create table proof.archive_v3_messages (
  schema_version smallint not null default 3 check (schema_version=3),
  message_hash bytea primary key,
  successor_hash bytea not null unique,
  stream_key smallint not null references proof.archive_v3_streams(stream_key),
  phase smallint not null check (phase between 1 and 3),
  successor_phase smallint not null check (successor_phase between 1 and 3),
  work_start_ledger_index bigint,
  scan_previous_ledger_index bigint,
  scan_previous_ledger_hash bytea,
  scan_sequence integer,
  commit_chunk_index smallint,
  payload_digest bytea not null check (octet_length(payload_digest)=32),
  completed_at timestamptz not null,
  result_digest bytea,
  archived_at timestamptz not null,
  check (result_digest is null or octet_length(result_digest)=32),
  check (
    (phase=1 and scan_previous_ledger_index is not null and octet_length(scan_previous_ledger_hash)=32 and scan_sequence is not null and commit_chunk_index is null)
    or (phase=2 and work_start_ledger_index is not null and scan_previous_ledger_index is null and scan_previous_ledger_hash is null and scan_sequence is null and commit_chunk_index is not null)
    or (phase=3 and work_start_ledger_index is not null and scan_previous_ledger_index is null and scan_previous_ledger_hash is null and scan_sequence is null and commit_chunk_index is null)
  )
);

create or replace function proof.work_id_v3(p_stream_key smallint,p_start_ledger_index bigint)
returns text language sql stable strict as $$
  select concat(
    'collector-work-v1:',s.network,':',s.epoch_id,':',s.base_identity,':',
    w.start_ledger_index::text,':',upper(encode(w.expected_parent_hash,'hex'))
  )
  from proof.archive_v3_works w
  join proof.archive_v3_streams s using(stream_key)
  where w.stream_key=p_stream_key and w.start_ledger_index=p_start_ledger_index
$$;

create or replace function proof.message_id_v3(p_hash bytea)
returns text language plpgsql stable strict as $$
declare m proof.archive_v3_messages%rowtype; s proof.archive_v3_streams%rowtype; work_id text;
begin
  select * into m from proof.archive_v3_messages where message_hash=p_hash;
  if not found then return null; end if;
  select * into s from proof.archive_v3_streams where stream_key=m.stream_key;
  if m.phase=1 then
    return concat('scan:v1:',s.network,':',s.epoch_id,':',s.base_identity,':',m.scan_previous_ledger_index::text,':',upper(encode(m.scan_previous_ledger_hash,'hex')),':',m.scan_sequence::text);
  end if;
  work_id:=proof.work_id_v3(m.stream_key,m.work_start_ledger_index);
  if m.phase=2 then
    return concat('commit:v1:',replace(work_id,':','%3A'),':',m.commit_chunk_index::text);
  end if;
  return concat('finalize:v1:',replace(work_id,':','%3A'));
end $$;

create or replace function proof.successor_id_v3(p_hash bytea)
returns text language plpgsql stable strict as $$
declare m proof.archive_v3_messages%rowtype; s proof.archive_v3_streams%rowtype; w proof.archive_v3_works%rowtype; work_id text;
begin
  select * into m from proof.archive_v3_messages where message_hash=p_hash;
  if not found then return null; end if;
  select * into s from proof.archive_v3_streams where stream_key=m.stream_key;
  if m.successor_phase=1 then
    if m.phase=1 and m.work_start_ledger_index is null then
      return concat('scan:v1:',s.network,':',s.epoch_id,':',s.base_identity,':',m.scan_previous_ledger_index::text,':',upper(encode(m.scan_previous_ledger_hash,'hex')),':',(m.scan_sequence+1)::text);
    end if;
    select * into w from proof.archive_v3_works where stream_key=m.stream_key and start_ledger_index=m.work_start_ledger_index;
    return concat('scan:v1:',s.network,':',s.epoch_id,':',s.base_identity,':',w.scanned_end_ledger_index::text,':',upper(encode(w.final_ledger_hash,'hex')),':0');
  end if;
  work_id:=proof.work_id_v3(m.stream_key,m.work_start_ledger_index);
  if m.successor_phase=2 then
    return concat('commit:v1:',replace(work_id,':','%3A'),':',case when m.phase=1 then 0 else m.commit_chunk_index+1 end::text);
  end if;
  return concat('finalize:v1:',replace(work_id,':','%3A'));
end $$;

create or replace function proof.assert_message_identity_v3(p_profile_id text,p_phase text,p_message_id text,p_payload jsonb)
returns boolean language plpgsql stable as $$
declare m proof.archive_v3_messages%rowtype; s proof.archive_v3_streams%rowtype; h bytea:=extensions.digest(convert_to(p_message_id,'UTF8'),'sha256'); reconstructed text; phase_code smallint; payload_h bytea:=extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256');
begin
  select * into m from proof.archive_v3_messages where message_hash=h;
  if not found then return false; end if;
  select * into s from proof.archive_v3_streams where stream_key=m.stream_key;
  reconstructed:=proof.message_id_v3(h);
  if reconstructed<>p_message_id then raise exception 'phase archive message hash collision'; end if;
  phase_code:=case p_phase when 'scan' then 1 when 'commit' then 2 when 'finalize' then 3 else 0 end;
  if s.profile_id<>p_profile_id or m.phase<>phase_code or m.payload_digest<>payload_h then raise exception 'phase message identity conflict: %',p_message_id; end if;
  return true;
end $$;

create or replace function proof.duplicate_completion_v3(p_message_id text,p_phase text)
returns jsonb language plpgsql stable as $$
declare m proof.archive_v3_messages%rowtype; h bytea:=extensions.digest(convert_to(p_message_id,'UTF8'),'sha256'); reconstructed text; phase_code smallint; successor_id text;
begin
  select * into m from proof.archive_v3_messages where message_hash=h;
  if not found then return null; end if;
  reconstructed:=proof.message_id_v3(h);
  if reconstructed<>p_message_id then raise exception 'phase archive message hash collision'; end if;
  phase_code:=case p_phase when 'scan' then 1 when 'commit' then 2 when 'finalize' then 3 else 0 end;
  if m.phase<>phase_code then raise exception 'message phase mismatch'; end if;
  successor_id:=proof.successor_id_v3(h);
  if extensions.digest(convert_to(successor_id,'UTF8'),'sha256')<>m.successor_hash then raise exception 'phase archive successor reconstruction mismatch'; end if;
  return jsonb_build_object('archived',true,'completed',true,'duplicate',true,'successor_message_id',successor_id,'completed_at',m.completed_at);
end $$;

create or replace function proof.revision4_archived_predecessor_ok_v3(p_pending_scan_id text,p_work_id text)
returns boolean language plpgsql stable as $$
declare m proof.archive_v3_messages%rowtype; reconstructed_successor text; reconstructed_work text;
begin
  select * into m from proof.archive_v3_messages where successor_hash=extensions.digest(convert_to(p_pending_scan_id,'UTF8'),'sha256');
  if not found then return false; end if;
  reconstructed_successor:=proof.successor_id_v3(m.message_hash);
  if reconstructed_successor<>p_pending_scan_id then raise exception 'phase archive successor hash collision'; end if;
  if m.phase<>3 then return false; end if;
  reconstructed_work:=proof.work_id_v3(m.stream_key,m.work_start_ledger_index);
  return reconstructed_work=p_work_id;
end $$;

insert into proof.archive_v3_streams(stream_key,profile_id,network,epoch_id,base_identity)
values(1,'supabase-devnet','devnet','supabase-r4c2c-v1','base:v1:devnet:'||repeat('b',64));

create temporary table generated_work as
select
  1::smallint as stream_key,
  k as work_number,
  (4100000+k)::bigint as start_ledger_index,
  decode(md5('parent-'||k::text)||md5('parent2-'||k::text),'hex') as expected_parent_hash,
  (4100000+k)::bigint as scanned_end_ledger_index,
  decode(md5('final-'||k::text)||md5('final2-'||k::text),'hex') as final_ledger_hash
from generate_series(1,11667) k;

insert into proof.archive_v3_works(stream_key,start_ledger_index,expected_parent_hash,scanned_end_ledger_index,final_ledger_hash)
select stream_key,start_ledger_index,expected_parent_hash,scanned_end_ledger_index,final_ledger_hash from generated_work;

create temporary table generated as
with rows as (
  select g,((g+2)/3)::integer as work_number,case when g%3=1 then 1 when g%3=2 then 2 else 3 end::smallint as phase
  from generate_series(1,35000) g
), shaped as (
  select
    r.g,
    r.work_number,
    r.phase,
    w.stream_key,
    w.start_ledger_index,
    w.expected_parent_hash,
    w.scanned_end_ledger_index,
    w.final_ledger_hash,
    concat('collector-work-v1:devnet:supabase-r4c2c-v1:base:v1:devnet:',repeat('b',64),':',w.start_ledger_index::text,':',upper(encode(w.expected_parent_hash,'hex'))) as work_id
  from rows r join generated_work w using(work_number)
), ids as (
  select *,
    case phase
      when 1 then concat('scan:v1:devnet:supabase-r4c2c-v1:base:v1:devnet:',repeat('b',64),':',(start_ledger_index-1)::text,':',upper(encode(expected_parent_hash,'hex')),':0')
      when 2 then concat('commit:v1:',replace(work_id,':','%3A'),':0')
      else concat('finalize:v1:',replace(work_id,':','%3A'))
    end as message_id,
    case phase
      when 1 then concat('commit:v1:',replace(work_id,':','%3A'),':0')
      when 2 then concat('finalize:v1:',replace(work_id,':','%3A'))
      else concat('scan:v1:devnet:supabase-r4c2c-v1:base:v1:devnet:',repeat('b',64),':',scanned_end_ledger_index::text,':',upper(encode(final_ledger_hash,'hex')),':0')
    end as successor_message_id
  from shaped
)
select *,
  case phase
    when 1 then jsonb_build_object('schemaVersion',1,'phase','scan','messageId',message_id,'network','devnet','epochId','supabase-r4c2c-v1','baseIdentity','base:v1:devnet:'||repeat('b',64),'expectedPreviousLedgerIndex',start_ledger_index-1,'expectedPreviousLedgerHash',upper(encode(expected_parent_hash,'hex')),'scanSequence',0,'blob',repeat(md5('payload-'||g::text),12))
    when 2 then jsonb_build_object('schemaVersion',1,'phase','commit','messageId',message_id,'workId',work_id,'chunkIndex',0,'blob',repeat(md5('payload-'||g::text),12))
    else jsonb_build_object('schemaVersion',1,'phase','finalize','messageId',message_id,'workId',work_id,'blob',repeat(md5('payload-'||g::text),12))
  end as payload,
  extensions.digest(convert_to(jsonb_build_object('status','completed','ordinal',g)::text,'UTF8'),'sha256') as result_digest,
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second' as completed_at
from ids;

insert into proof.archive_v2(message_hash,successor_hash,message_id,profile_id,phase,payload_digest,finalize_work_id,successor_message_id,completed_at,result_digest,archived_at)
select
  extensions.digest(convert_to(message_id,'UTF8'),'sha256'),
  extensions.digest(convert_to(successor_message_id,'UTF8'),'sha256'),
  message_id,'supabase-devnet',case phase when 1 then 'scan' when 2 then 'commit' else 'finalize' end,
  extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),
  case when phase=3 then work_id else null end,
  successor_message_id,completed_at,encode(result_digest,'hex'),'2026-08-17 00:00:00+00'
from generated order by g;

insert into proof.archive_v3_messages(
  message_hash,successor_hash,stream_key,phase,successor_phase,work_start_ledger_index,
  scan_previous_ledger_index,scan_previous_ledger_hash,scan_sequence,commit_chunk_index,
  payload_digest,completed_at,result_digest,archived_at
)
select
  extensions.digest(convert_to(message_id,'UTF8'),'sha256'),
  extensions.digest(convert_to(successor_message_id,'UTF8'),'sha256'),
  1,phase,case phase when 1 then 2 when 2 then 3 else 1 end,
  start_ledger_index,
  case when phase=1 then start_ledger_index-1 else null end,
  case when phase=1 then expected_parent_hash else null end,
  case when phase=1 then 0 else null end,
  case when phase=2 then 0 else null end,
  extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),completed_at,result_digest,'2026-08-17 00:00:00+00'
from generated order by g;

analyze proof.archive_v2; analyze proof.archive_v3_streams; analyze proof.archive_v3_works; analyze proof.archive_v3_messages;

select 'v2_total_bytes='||pg_total_relation_size('proof.archive_v2');
select 'v2_heap_bytes='||pg_relation_size('proof.archive_v2');
select 'v2_index_bytes='||pg_indexes_size('proof.archive_v2');
select 'v3_messages_total_bytes='||pg_total_relation_size('proof.archive_v3_messages');
select 'v3_messages_heap_bytes='||pg_relation_size('proof.archive_v3_messages');
select 'v3_messages_index_bytes='||pg_indexes_size('proof.archive_v3_messages');
select 'v3_works_total_bytes='||pg_total_relation_size('proof.archive_v3_works');
select 'v3_streams_total_bytes='||pg_total_relation_size('proof.archive_v3_streams');
select 'v3_total_bytes='||(pg_total_relation_size('proof.archive_v3_messages')+pg_total_relation_size('proof.archive_v3_works')+pg_total_relation_size('proof.archive_v3_streams'));
select 'v3_rows='||count(*) from proof.archive_v3_messages;
select 'v3_work_rows='||count(*) from proof.archive_v3_works;

do $$ declare r record; p text; begin
  for r in select * from generated where g in (1,2,3,34999,35000) order by g loop
    p:=proof.message_id_v3(extensions.digest(convert_to(r.message_id,'UTF8'),'sha256'));
    if p<>r.message_id then raise exception 'v3 message reconstruction mismatch at %',r.g; end if;
    p:=proof.successor_id_v3(extensions.digest(convert_to(r.message_id,'UTF8'),'sha256'));
    if p<>r.successor_message_id then raise exception 'v3 successor reconstruction mismatch at %',r.g; end if;
    if not proof.assert_message_identity_v3('supabase-devnet',case r.phase when 1 then 'scan' when 2 then 'commit' else 'finalize' end,r.message_id,r.payload) then raise exception 'v3 exact identity did not converge at %',r.g; end if;
  end loop;
end $$;

do $$ declare r record; failed boolean:=false; begin
  select * into r from generated where g=2;
  begin perform proof.assert_message_identity_v3('supabase-devnet','commit',r.message_id,r.payload||'{"changed":true}'::jsonb);
  exception when others then if sqlerrm like 'phase message identity conflict:%' then failed:=true; else raise; end if; end;
  if not failed then raise exception 'v3 payload digest drift was not rejected'; end if;
end $$;

do $$ declare r record; j jsonb; begin
  select * into r from generated where g=2;
  j:=proof.duplicate_completion_v3(r.message_id,'commit');
  if j->>'successor_message_id'<>r.successor_message_id or (j->>'duplicate')::boolean is not true then raise exception 'v3 duplicate completion identity mismatch'; end if;
end $$;

do $$ declare r record; begin
  select * into r from generated where phase=3 order by g limit 1;
  if not proof.revision4_archived_predecessor_ok_v3(r.successor_message_id,r.work_id) then raise exception 'v3 revision4 predecessor work identity missing'; end if;
  if proof.revision4_archived_predecessor_ok_v3(r.successor_message_id,r.work_id||'-drift') then raise exception 'v3 revision4 work drift was accepted'; end if;
end $$;
SQL

metric(){ sed -n "s/^$1=//p" "${output_directory}/proof.log" | tail -n1; }
v2_total="$(metric v2_total_bytes)"
v2_heap="$(metric v2_heap_bytes)"
v2_index="$(metric v2_index_bytes)"
v3_messages_total="$(metric v3_messages_total_bytes)"
v3_messages_heap="$(metric v3_messages_heap_bytes)"
v3_messages_index="$(metric v3_messages_index_bytes)"
v3_works_total="$(metric v3_works_total_bytes)"
v3_streams_total="$(metric v3_streams_total_bytes)"
v3_total="$(metric v3_total_bytes)"
v3_rows="$(metric v3_rows)"
v3_work_rows="$(metric v3_work_rows)"
for value in "$v2_total" "$v2_heap" "$v2_index" "$v3_messages_total" "$v3_messages_heap" "$v3_messages_index" "$v3_works_total" "$v3_streams_total" "$v3_total" "$v3_rows" "$v3_work_rows"; do [[ "$value" =~ ^[0-9]+$ ]]; done
[[ "$v3_rows" -eq 35000 && "$v3_work_rows" -eq 11667 && "$v3_total" -lt "$v2_total" ]]

saved=$((v2_total-v3_total))
saved_percent=$((saved*100/v2_total))
v2_per_row=$((v2_total/35000))
v3_per_row=$((v3_total/35000))
backlog_rows=50230
modeled_backlog_bytes=$(((v3_total*backlog_rows+34999)/35000))
current_headroom=4151149
restore_reclaim=6144000
headroom_after_restore=$((current_headroom+restore_reclaim))
fits_current=false; [[ "$modeled_backlog_bytes" -le "$current_headroom" ]] && fits_current=true
fits_after_restore=false; [[ "$modeled_backlog_bytes" -le "$headroom_after_restore" ]] && fits_after_restore=true

cat > "${output_directory}/metrics.json" <<EOF
{"schemaVersion":1,"productionDatabaseUsed":false,"productionMutationAuthorized":false,"rows":35000,"workRows":${v3_work_rows},"v2TotalBytes":${v2_total},"v2HeapBytes":${v2_heap},"v2IndexBytes":${v2_index},"v3MessagesTotalBytes":${v3_messages_total},"v3MessagesHeapBytes":${v3_messages_heap},"v3MessagesIndexBytes":${v3_messages_index},"v3WorksTotalBytes":${v3_works_total},"v3StreamsTotalBytes":${v3_streams_total},"v3TotalBytes":${v3_total},"savedBytesVsV2":${saved},"savedPercentVsV2":${saved_percent},"v2BytesPerMessage":${v2_per_row},"v3BytesPerMessageIncludingDimensions":${v3_per_row},"referenceBacklogRows":${backlog_rows},"modeledBacklogBytes":${modeled_backlog_bytes},"referenceCurrentHeadroomBytes":${current_headroom},"referenceRestoreReclaimCandidateBytes":${restore_reclaim},"referenceHeadroomAfterRestoreBytes":${headroom_after_restore},"fitsReferenceCurrentHeadroom":${fits_current},"fitsReferenceHeadroomAfterRestore":${fits_after_restore},"exactMessageIdReconstructionVerified":true,"exactSuccessorIdReconstructionVerified":true,"payloadDigestIdentityVerified":true,"payloadDriftRejected":true,"duplicateCompletionExactSuccessorVerified":true,"revision4FinalizeWorkIdentityVerified":true,"sha256CollisionFailClosePreservedByRawIdReconstruction":true}
EOF
sha256sum "${output_directory}/metrics.json" | cut -d' ' -f1 > "${output_directory}/metrics.sha256"
cat "${output_directory}/metrics.json"
