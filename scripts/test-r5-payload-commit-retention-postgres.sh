#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-raw-retention-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_RAW_RETENTION_OUTPUT:-r5-payload-commit-retention-evidence}"
base_schema='supabase/migrations/20260802095000_xrpl_remote_portable_phase_chain.sql'
checkpoint_sql='supabase/migrations/20260803120000_xrpl_r5_active_checkpoint.sql'
recovery_prepare_sql='supabase/migrations/20260803121000_xrpl_r5_recovery_prepare.sql'
revision4_sql='supabase/migrations/20260809151000_xrpl_r5_revision4_runtime_rpcs.sql'

cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory"
mkdir -p "$output_directory"

for path in "$base_schema" "$checkpoint_sql" "$recovery_prepare_sql" "$revision4_sql"; do test -f "$path"; done

python - "$base_schema" "$checkpoint_sql" "$recovery_prepare_sql" "$revision4_sql" <<'PY'
from pathlib import Path
import re, sys
base, checkpoint, prepare, revision4 = [Path(p).read_text() for p in sys.argv[1:]]

def fn(source, name):
    start = source.find(f"create or replace function public.{name}(")
    if start < 0: raise SystemExit(f"missing function: {name}")
    body = source.find("as $$", start)
    end = source.find("$$;", body + 5)
    if body < 0 or end < 0: raise SystemExit(f"invalid function body: {name}")
    return source[start:end + 3]

for table in ("payload", "commit"):
    pattern = rf"create table if not exists public\.xrpl_phase_{table}_chunks[\s\S]*?references public\.xrpl_phase_work\(work_id\) on delete cascade"
    if not re.search(pattern, base, re.I): raise SystemExit(f"{table} chunk FK contract drift")
view_start = base.find("create or replace view public.xrpl_phase_committed_reference_rows as")
view_end = base.find(";", view_start)
view = base[view_start:view_end]
if view_start < 0 or "xrpl_phase_reference_rows" not in view or "xrpl_phase_work" not in view:
    raise SystemExit("canonical committed-reference view contract drift")
if "xrpl_phase_payload_chunks" in view or "xrpl_phase_commit_chunks" in view:
    raise SystemExit("canonical committed-reference view unexpectedly depends on raw chunks")
checkpoint_body = fn(checkpoint, "xrpl_create_r5_active_checkpoint")
for token in ("xrpl_phase_payload_chunks", "xrpl_phase_commit_chunks", "where work.profile_id = 'supabase-devnet'"):
    if token not in checkpoint_body: raise SystemExit(f"active checkpoint capture contract drift: {token}")
prepare_body = fn(prepare, "xrpl_prepare_r5_active_recovery")
for forbidden in ("xrpl_phase_payload_chunks", "xrpl_phase_commit_chunks"):
    if forbidden in prepare_body: raise SystemExit(f"recovery prepare raw-chunk dependency drift: {forbidden}")
for required in ("xrpl_phase_work", "xrpl_phase_messages", "xrpl_phase_successors", "xrpl_phase_watermarks"):
    if required not in prepare_body: raise SystemExit(f"recovery prepare chain contract drift: {required}")
if "public.xrpl_create_r5_active_checkpoint(" not in fn(revision4, "xrpl_create_r5_revision4_active_checkpoint"):
    raise SystemExit("revision-4 checkpoint delegation drift")
print("static retention compatibility contract: pass")
PY

docker run --detach --rm --name "$container_name" --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres "$image" > "${output_directory}/container-id.txt"
ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "${output_directory}/postgres.log" <<'SQL'
create table public.xrpl_phase_work (
  work_id text primary key, profile_id text not null, status text not null,
  previous_ledger_index bigint not null, start_ledger_index bigint not null,
  scanned_end_ledger_index bigint not null, expected_parent_hash text not null,
  final_ledger_hash text not null, expected_payload_chunks integer not null,
  expected_commit_chunks integer not null, committed_at timestamptz not null
);
create table public.xrpl_phase_payload_chunks (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  chunk_index integer not null, payload_json text not null, primary key(work_id, chunk_index)
);
create table public.xrpl_phase_commit_chunks (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  chunk_index integer not null, status text not null, primary key(work_id, chunk_index)
);
create table public.xrpl_phase_reference_rows (
  work_id text not null references public.xrpl_phase_work(work_id) on delete cascade,
  canonical_key text not null, value_json text not null, primary key(work_id, canonical_key)
);
create table public.xrpl_phase_watermarks (
  profile_id text primary key, ledger_index bigint not null, ledger_hash text not null,
  work_id text not null references public.xrpl_phase_work(work_id)
);
create table public.synthetic_checkpoints (
  checkpoint_id text primary key, watermark_ledger_index bigint not null,
  watermark_ledger_hash text not null, watermark_work_id text not null, state jsonb not null
);

insert into public.xrpl_phase_work values
 ('old','supabase-devnet','committed',99,100,100,'H099','H100',1,1,'2026-08-12 00:00:00+00'),
 ('predecessor','supabase-devnet','committed',100,101,101,'H100','H101',1,1,'2026-08-13 23:58:00+00'),
 ('current','supabase-devnet','committed',101,102,102,'H101','H102',1,1,'2026-08-13 23:59:00+00');
insert into public.xrpl_phase_payload_chunks values ('old',0,'p100'),('predecessor',0,'p101'),('current',0,'p102');
insert into public.xrpl_phase_commit_chunks values ('old',0,'completed'),('predecessor',0,'completed'),('current',0,'completed');
insert into public.xrpl_phase_reference_rows values ('old','k100','v100'),('predecessor','k101','v101'),('current','k102','v102');
insert into public.xrpl_phase_watermarks values ('supabase-devnet',102,'H102','current');
insert into public.synthetic_checkpoints values ('checkpoint-at-old',100,'H100','old',jsonb_build_object('workIds',jsonb_build_array('old','predecessor','current'),'payloadWorkIds',jsonb_build_array('old','predecessor','current'),'commitWorkIds',jsonb_build_array('old','predecessor','current')));

create temp table before_digests as
select
 (select md5(string_agg(row_to_json(w)::text, ',' order by work_id)) from public.xrpl_phase_work w) work_digest,
 (select md5(string_agg(row_to_json(r)::text, ',' order by work_id,canonical_key)) from public.xrpl_phase_reference_rows r) reference_digest,
 (select md5(state::text) from public.synthetic_checkpoints where checkpoint_id='checkpoint-at-old') checkpoint_digest;
create temp table candidate_work_ids as
with current_work as (
 select w.* from public.xrpl_phase_work w join public.xrpl_phase_watermarks wm on wm.work_id=w.work_id where wm.profile_id='supabase-devnet'
), predecessor_work as (
 select p.* from current_work c join public.xrpl_phase_work p on p.profile_id=c.profile_id and p.status='committed' and p.scanned_end_ledger_index=c.previous_ledger_index and p.final_ledger_hash=c.expected_parent_hash
)
select w.work_id from public.xrpl_phase_work w
where w.profile_id='supabase-devnet' and w.status='committed'
 and w.committed_at < '2026-08-14 00:00:00+00'::timestamptz - interval '24 hours'
 and not exists(select 1 from current_work c where c.work_id=w.work_id)
 and not exists(select 1 from predecessor_work p where p.work_id=w.work_id);
create temp table deletion_counts(kind text primary key,n bigint not null);
with gone as (delete from public.xrpl_phase_payload_chunks p using candidate_work_ids c where p.work_id=c.work_id returning 1)
insert into deletion_counts select 'payload',count(*) from gone;
with gone as (delete from public.xrpl_phase_commit_chunks c using candidate_work_ids x where c.work_id=x.work_id returning 1)
insert into deletion_counts select 'commit',count(*) from gone;

do $$
declare
 b before_digests%rowtype;
 chain_ok boolean;
begin
 select * into b from before_digests;
 if (select n from deletion_counts where kind='payload') <> 1 or (select n from deletion_counts where kind='commit') <> 1 then raise exception 'unexpected deletion count'; end if;
 if b.work_digest <> (select md5(string_agg(row_to_json(w)::text, ',' order by work_id)) from public.xrpl_phase_work w) then raise exception 'work history changed'; end if;
 if b.reference_digest <> (select md5(string_agg(row_to_json(r)::text, ',' order by work_id,canonical_key)) from public.xrpl_phase_reference_rows r) then raise exception 'canonical history changed'; end if;
 if b.checkpoint_digest <> (select md5(state::text) from public.synthetic_checkpoints where checkpoint_id='checkpoint-at-old') then raise exception 'materialized checkpoint changed'; end if;
 if exists (
   select 1 from public.xrpl_phase_work w where w.work_id in ('predecessor','current') and
   ((select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=w.work_id) <> w.expected_payload_chunks or
    (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id and c.status='completed') <> w.expected_commit_chunks)
 ) then raise exception 'protected raw evidence incomplete'; end if;
 with checkpoint as (select * from public.synthetic_checkpoints where checkpoint_id='checkpoint-at-old'),
 watermark as (select * from public.xrpl_phase_watermarks where profile_id='supabase-devnet'),
 chain as (
   select row_number() over(order by w.start_ledger_index,w.work_id) ordinal,w.*,
    lag(w.scanned_end_ledger_index) over(order by w.start_ledger_index,w.work_id) prior_end,
    lag(w.final_ledger_hash) over(order by w.start_ledger_index,w.work_id) prior_hash
   from public.xrpl_phase_work w,checkpoint c,watermark wm
   where w.profile_id='supabase-devnet' and w.status='committed' and w.start_ledger_index>c.watermark_ledger_index and w.scanned_end_ledger_index<=wm.ledger_index
 )
 select count(*)=2 and bool_and(start_ledger_index=previous_ledger_index+1 and scanned_end_ledger_index=start_ledger_index)
  and bool_and(case when ordinal=1 then previous_ledger_index=100 and expected_parent_hash='H100' else previous_ledger_index=prior_end and expected_parent_hash=prior_hash end)
  and max(scanned_end_ledger_index)=102 into chain_ok from chain;
 if chain_ok is not true then raise exception 'recovery work/hash chain invalid'; end if;
 if exists(select 1 from public.xrpl_phase_payload_chunks where work_id='old') or exists(select 1 from public.xrpl_phase_commit_chunks where work_id='old') then raise exception 'old raw evidence remains'; end if;
end $$;
SQL

cat > "${output_directory}/summary.md" <<'EOF'
## R5 payload / commit retention compatibility PostgreSQL contract

- bounded raw-evidence cutoff: `24h`
- historical payload/commit prune exercised: `true`
- committed work rows retained: `true`
- canonical reference rows retained: `true`
- current + predecessor raw evidence complete: `true`
- existing materialized checkpoint unchanged: `true`
- checkpoint→current work/hash recovery chain remains valid: `true`
- production recovery prepare directly references payload/commit chunks: `false`
- revision-4 checkpoint delegates to active checkpoint capture: `true`
- production database used: `false`
- production deletion authorized: `false`
EOF
cat "${output_directory}/summary.md"
