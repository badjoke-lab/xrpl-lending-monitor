#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-archive-v2-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_TERMINAL_ARCHIVE_V2_OUTPUT:-r5-terminal-archive-v2-compact-evidence}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory" && mkdir -p "$output_directory"

docker run --detach --rm --name "$container_name" --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres "$image" > "${output_directory}/container-id.txt"
stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then stable_ready=$((stable_ready+1)); [[ "$stable_ready" -ge 3 ]] && break; else stable_ready=0; fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/proof.log" <<'SQL'
create schema extensions;
create extension pgcrypto with schema extensions;
create schema proof;

create table proof.archive_v1 (
  schema_version integer not null default 1 check (schema_version=1),
  message_hash bytea primary key,
  successor_hash bytea not null unique,
  message_id text not null,
  profile_id text not null,
  phase text not null check (phase in ('scan','commit','finalize')),
  payload jsonb not null,
  successor_message_id text not null,
  completed_at timestamptz not null,
  result_digest text,
  archived_at timestamptz not null,
  check (message_hash=extensions.digest(convert_to(message_id,'UTF8'),'sha256')),
  check (successor_hash=extensions.digest(convert_to(successor_message_id,'UTF8'),'sha256'))
);

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

create or replace function proof.assert_message_identity_v2(p_profile_id text,p_phase text,p_message_id text,p_payload jsonb)
returns boolean language plpgsql as $$
declare a proof.archive_v2%rowtype; h bytea:=extensions.digest(convert_to(p_message_id,'UTF8'),'sha256'); payload_h bytea:=extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256');
begin
  select * into a from proof.archive_v2 where message_hash=h;
  if not found then return false; end if;
  if a.message_id<>p_message_id then raise exception 'phase archive message hash collision'; end if;
  if a.profile_id<>p_profile_id or a.phase<>p_phase or a.payload_digest<>payload_h then raise exception 'phase message identity conflict: %',p_message_id; end if;
  return true;
end $$;

create or replace function proof.duplicate_completion_v2(p_message_id text,p_phase text)
returns jsonb language plpgsql as $$
declare a proof.archive_v2%rowtype; h bytea:=extensions.digest(convert_to(p_message_id,'UTF8'),'sha256');
begin
  select * into a from proof.archive_v2 where message_hash=h;
  if not found then return null; end if;
  if a.message_id<>p_message_id then raise exception 'phase archive message hash collision'; end if;
  if a.phase<>p_phase then raise exception 'message phase mismatch'; end if;
  return jsonb_build_object('archived',true,'completed',true,'duplicate',true,'successor_message_id',a.successor_message_id,'completed_at',a.completed_at);
end $$;

create or replace function proof.revision4_archived_predecessor_ok_v2(p_pending_scan_id text,p_work_id text)
returns boolean language plpgsql as $$
declare a proof.archive_v2%rowtype;
begin
  select * into a from proof.archive_v2 where successor_hash=extensions.digest(convert_to(p_pending_scan_id,'UTF8'),'sha256');
  if not found then return false; end if;
  return a.successor_message_id=p_pending_scan_id and a.profile_id='supabase-devnet' and a.phase='finalize' and a.finalize_work_id=p_work_id;
end $$;

create temporary table generated as
with base as (
  select g,
    case when g%3=1 then 'scan' when g%3=2 then 'commit' else 'finalize' end as phase,
    'work:v1:devnet:supabase-r4c2c-v1:'||lpad(((g+2)/3)::text,8,'0')||':'||repeat(md5(((g+2)/3)::text),5) as work_id
  from generate_series(1,35000) g
)
select g,phase,work_id,
  'phase:v1:devnet:'||lpad(g::text,6,'0')||':'||repeat(md5(g::text),4) as message_id,
  'phase:v1:devnet:'||lpad((g+1)::text,6,'0')||':'||repeat(md5((g+1)::text),4) as successor_message_id,
  case when phase='scan' then jsonb_build_object(
    'schemaVersion',1,'phase','scan','messageId','phase:v1:devnet:'||lpad(g::text,6,'0')||':'||repeat(md5(g::text),4),
    'network','devnet','epochId','supabase-r4c2c-v1','baseIdentity',repeat(md5('base-'||g::text),3),
    'expectedPreviousLedgerIndex',4100000+g,'expectedPreviousLedgerHash',upper(md5('prev-'||g::text)||md5('parent-'||g::text)),
    'scanSequence',g,'blob',repeat(md5('payload-'||g::text),12)
  ) else jsonb_build_object(
    'schemaVersion',1,'phase',phase,'messageId','phase:v1:devnet:'||lpad(g::text,6,'0')||':'||repeat(md5(g::text),4),
    'workId',work_id,'chunkIndex',0,'totalChunks',1,'ledgerIndex',4100000+g,'blob',repeat(md5('payload-'||g::text),12)
  ) end as payload,
  encode(extensions.digest(convert_to(jsonb_build_object('status','committed','ordinal',g)::text,'UTF8'),'sha256'),'hex') as result_digest,
  '2026-08-15 00:00:00+00'::timestamptz+g*interval '1 second' as completed_at
from base;

create or replace procedure proof.load_range(p_from integer,p_to integer) language plpgsql as $$
begin
  insert into proof.archive_v1(message_hash,successor_hash,message_id,profile_id,phase,payload,successor_message_id,completed_at,result_digest,archived_at)
  select extensions.digest(convert_to(message_id,'UTF8'),'sha256'),extensions.digest(convert_to(successor_message_id,'UTF8'),'sha256'),message_id,'supabase-devnet',phase,payload,successor_message_id,completed_at,result_digest,'2026-08-17 00:00:00+00'::timestamptz from generated where g between p_from and p_to order by g;
  insert into proof.archive_v2(message_hash,successor_hash,message_id,profile_id,phase,payload_digest,finalize_work_id,successor_message_id,completed_at,result_digest,archived_at)
  select extensions.digest(convert_to(message_id,'UTF8'),'sha256'),extensions.digest(convert_to(successor_message_id,'UTF8'),'sha256'),message_id,'supabase-devnet',phase,extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),case when phase='finalize' then work_id else null end,successor_message_id,completed_at,result_digest,'2026-08-17 00:00:00+00'::timestamptz from generated where g between p_from and p_to order by g;
end $$;

call proof.load_range(1,1500); analyze proof.archive_v1; analyze proof.archive_v2;
select 'v1_bytes_1500='||pg_total_relation_size('proof.archive_v1');
select 'v2_bytes_1500='||pg_total_relation_size('proof.archive_v2');
select 'scan_rows_1500='||count(*) from proof.archive_v2 where phase='scan';
select 'commit_rows_1500='||count(*) from proof.archive_v2 where phase='commit';
select 'finalize_rows_1500='||count(*) from proof.archive_v2 where phase='finalize';
select 'finalize_work_id_rows_1500='||count(*) from proof.archive_v2 where finalize_work_id is not null;
select 'finalize_work_id_min_bytes='||min(octet_length(finalize_work_id)) from proof.archive_v2 where finalize_work_id is not null;
select 'finalize_work_id_max_bytes='||max(octet_length(finalize_work_id)) from proof.archive_v2 where finalize_work_id is not null;

call proof.load_range(1501,35000); analyze proof.archive_v1; analyze proof.archive_v2;
select 'v1_bytes_35000='||pg_total_relation_size('proof.archive_v1');
select 'v2_bytes_35000='||pg_total_relation_size('proof.archive_v2');
select 'v1_heap_35000='||pg_relation_size('proof.archive_v1');
select 'v2_heap_35000='||pg_relation_size('proof.archive_v2');
select 'v1_index_35000='||pg_indexes_size('proof.archive_v1');
select 'v2_index_35000='||pg_indexes_size('proof.archive_v2');
select 'v2_rows='||count(*) from proof.archive_v2;

do $$ declare r record; begin
  for r in select * from generated where g in (100,101,102) order by g loop
    if not proof.assert_message_identity_v2('supabase-devnet',r.phase,r.message_id,r.payload) then raise exception 'v2 exact identity did not converge for phase %',r.phase; end if;
  end loop;
end $$;

do $$ declare r record; failed boolean:=false; begin
  select * into r from generated where g=100;
  begin perform proof.assert_message_identity_v2('supabase-devnet',r.phase,r.message_id,r.payload||'{"changed":true}'::jsonb);
  exception when others then if sqlerrm like 'phase message identity conflict:%' then failed:=true; else raise; end if; end;
  if not failed then raise exception 'payload digest drift was not rejected'; end if;
end $$;

do $$ declare r record; j jsonb; begin
  select * into r from generated where g=101; j:=proof.duplicate_completion_v2(r.message_id,r.phase);
  if j->>'successor_message_id'<>r.successor_message_id or (j->>'duplicate')::boolean is not true then raise exception 'duplicate completion identity mismatch'; end if;
end $$;

do $$ declare r record; begin
  select * into r from generated where phase='finalize' order by g limit 1;
  if not proof.revision4_archived_predecessor_ok_v2(r.successor_message_id,r.work_id) then raise exception 'revision4 predecessor work identity missing'; end if;
  if proof.revision4_archived_predecessor_ok_v2(r.successor_message_id,r.work_id||'-drift') then raise exception 'revision4 predecessor work drift was accepted'; end if;
  if exists(select 1 from proof.archive_v2 where phase in ('scan','commit') and finalize_work_id is not null) then raise exception 'non-finalize rows retained unnecessary work identity'; end if;
end $$;

do $$ declare r record; failed boolean:=false; begin
  select * into r from generated where phase='commit' order by g limit 1;
  begin insert into proof.archive_v2(message_hash,successor_hash,message_id,profile_id,phase,payload_digest,finalize_work_id,successor_message_id,completed_at,result_digest,archived_at)
    values(extensions.digest(convert_to('invalid-commit-id','UTF8'),'sha256'),extensions.digest(convert_to('invalid-successor-id','UTF8'),'sha256'),'invalid-commit-id','supabase-devnet','commit',extensions.digest(convert_to(r.payload::text,'UTF8'),'sha256'),r.work_id,'invalid-successor-id',r.completed_at,r.result_digest,'2026-08-17 00:00:00+00');
  exception when check_violation then failed:=true; end;
  if not failed then raise exception 'non-finalize work identity was accepted'; end if;
end $$;
SQL

metric(){ sed -n "s/^$1=//p" "${output_directory}/proof.log" | tail -n1; }
v1_1500="$(metric v1_bytes_1500)"; v2_1500="$(metric v2_bytes_1500)"; scan_1500="$(metric scan_rows_1500)"; commit_1500="$(metric commit_rows_1500)"; finalize_1500="$(metric finalize_rows_1500)"; finalize_work_1500="$(metric finalize_work_id_rows_1500)"; work_min="$(metric finalize_work_id_min_bytes)"; work_max="$(metric finalize_work_id_max_bytes)"; v1_35000="$(metric v1_bytes_35000)"; v2_35000="$(metric v2_bytes_35000)"; v1_heap="$(metric v1_heap_35000)"; v2_heap="$(metric v2_heap_35000)"; v1_index="$(metric v1_index_35000)"; v2_index="$(metric v2_index_35000)"; v2_rows="$(metric v2_rows)"
for value in "$v1_1500" "$v2_1500" "$scan_1500" "$commit_1500" "$finalize_1500" "$finalize_work_1500" "$work_min" "$work_max" "$v1_35000" "$v2_35000" "$v1_heap" "$v2_heap" "$v1_index" "$v2_index" "$v2_rows"; do [[ "$value" =~ ^[0-9]+$ ]]; done
[[ "$scan_1500" -eq 500 && "$commit_1500" -eq 500 && "$finalize_1500" -eq 500 && "$finalize_work_1500" -eq 500 ]]
[[ "$work_min" -ge 190 && "$work_max" -le 220 && "$v2_rows" -eq 35000 && "$v2_1500" -lt "$v1_1500" && "$v2_35000" -lt "$v1_35000" ]]
saved_1500=$((v1_1500-v2_1500)); saved_35000=$((v1_35000-v2_35000)); saved_percent=$((saved_35000*100/v1_35000)); v1_per_row=$((v1_35000/35000)); v2_per_row=$((v2_35000/35000)); [[ "$saved_percent" -ge 35 ]]
cat > "${output_directory}/metrics.json" <<EOF
{"schemaVersion":2,"productionDatabaseUsed":false,"productionArchiveMutationAuthorized":false,"rows":35000,"productionShape1500":{"scan":${scan_1500},"commit":${commit_1500},"finalize":${finalize_1500},"finalizeWorkIdRows":${finalize_work_1500}},"finalizeWorkIdMinBytes":${work_min},"finalizeWorkIdMaxBytes":${work_max},"v1Bytes1500":${v1_1500},"v2Bytes1500":${v2_1500},"savedBytes1500":${saved_1500},"v1Bytes35000":${v1_35000},"v2Bytes35000":${v2_35000},"savedBytes35000":${saved_35000},"savedPercent35000":${saved_percent},"v1BytesPerRow35000":${v1_per_row},"v2BytesPerRow35000":${v2_per_row},"v1HeapBytes35000":${v1_heap},"v2HeapBytes35000":${v2_heap},"v1IndexBytes35000":${v1_index},"v2IndexBytes35000":${v2_index},"payloadIdentityDigestVerifiedAllPhases":true,"payloadDriftRejected":true,"duplicateCompletionVerified":true,"revision4FinalizeWorkIdVerified":true,"nonFinalizeWorkIdOmitted":true,"nonFinalizeWorkIdRejectedByConstraint":true}
EOF
cat > "${output_directory}/summary.md" <<EOF
## R5 terminal archive v2 production-shaped local PostgreSQL proof

- PostgreSQL: \`15-alpine\`
- production database used: \`false\`
- production archive mutation authorized: \`false\`
- modeled production 1,500 rows scan / commit / finalize: \`${scan_1500} / ${commit_1500} / ${finalize_1500}\`
- v2 retained work ID rows at 1,500: \`${finalize_work_1500}\` (finalize only)
- modeled finalize work ID bytes min / max: \`${work_min} / ${work_max}\`
- v1 / v2 bytes at 1,500 rows: \`${v1_1500} / ${v2_1500}\`
- saved bytes at 1,500 rows: \`${saved_1500}\`
- v1 / v2 bytes at 35,000 rows: \`${v1_35000} / ${v2_35000}\`
- saved bytes / percent at 35,000 rows: \`${saved_35000} / ${saved_percent}%\`
- v1 / v2 bytes per row at 35,000: \`${v1_per_row} / ${v2_per_row}\`
- exact payload identity via SHA-256 digest for scan/commit/finalize: \`true\`
- duplicate completion exact successor preserved without full payload: \`true\`
- revision4 archived predecessor workId preserved for finalize only: \`true\`
- scan/commit archive workId omitted: \`true\`
- non-finalize workId rejected by v2 constraint: \`true\`

This proves the compact v2 semantic/storage shape against the production-observed phase/workId pattern: payload digest on every archive row and full work identity only on finalize rows. Production schema/function changes, archive rewrite, further Phase B movement, physical compaction, and R5 rearm remain separately unauthorized.
EOF
cat "${output_directory}/summary.md"
