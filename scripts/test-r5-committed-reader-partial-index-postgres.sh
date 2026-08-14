#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-committed-reader-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_COMMITTED_READER_OUTPUT:-r5-committed-reader-partial-index-evidence}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory"; mkdir -p "$output_directory"

docker run --detach --rm --name "$container_name" --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres "$image" > "$output_directory/container-id.txt"
stable=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable=$((stable+1)); [[ "$stable" -ge 3 ]] && break
  else
    stable=0
  fi
  sleep 1
done
[[ "$stable" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "$output_directory/setup.log" <<'SQL'
create table public.xrpl_phase_work (
  work_id text primary key,
  profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  expected_parent_hash text not null,
  scanned_end_ledger_index bigint,
  final_ledger_hash text,
  status text not null check (status in ('planned','staged','committing','finalizing','committed','error')),
  updated_at timestamptz not null,
  committed_at timestamptz
);
create index xrpl_phase_work_committed_reader_idx on public.xrpl_phase_work(
  profile_id,network,epoch_id,base_identity,status,scanned_end_ledger_index,work_id
);
insert into public.xrpl_phase_work(
  work_id,profile_id,network,epoch_id,base_identity,previous_ledger_index,start_ledger_index,
  expected_parent_hash,scanned_end_ledger_index,final_ledger_hash,status,updated_at,committed_at
)
select
  'committed-'||lpad(g::text,5,'0'),'supabase-devnet','devnet','supabase-r4c2c-v1',
  'seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77',
  4132416+g,4132417+g,repeat('A',64),4132417+g,repeat('B',64),'committed',
  '2026-08-13 00:00:00+00'::timestamptz+g*interval '1 second',
  '2026-08-13 00:00:01+00'::timestamptz+g*interval '1 second'
from generate_series(1,20000) g;
insert into public.xrpl_phase_work(
  work_id,profile_id,network,epoch_id,base_identity,previous_ledger_index,start_ledger_index,
  expected_parent_hash,scanned_end_ledger_index,final_ledger_hash,status,updated_at,committed_at
)
select
  'staged-'||lpad(g::text,3,'0'),'supabase-devnet','devnet','supabase-r4c2c-v1',
  'seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77',
  5000000+g,5000001+g,repeat('C',64),5000001+g,null,'staged',
  '2026-08-14 00:00:00+00'::timestamptz+g*interval '1 second',null
from generate_series(1,100) g;
analyze public.xrpl_phase_work;
SQL

before_count="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from public.xrpl_phase_work')"
before_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(work_id||':'||status||':'||coalesce(scanned_end_ledger_index::text,''),',' order by work_id)) from public.xrpl_phase_work")"
before_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_committed_reader_idx'::regclass)")"
before_db="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "$output_directory/replacement.log" <<'SQL'
set lock_timeout='5s';
set statement_timeout='45s';
create index xrpl_phase_work_committed_reader_partial_candidate on public.xrpl_phase_work(
  profile_id,network,epoch_id,base_identity,scanned_end_ledger_index,work_id
) where status='committed';
analyze public.xrpl_phase_work;
drop index public.xrpl_phase_work_committed_reader_idx;
alter index public.xrpl_phase_work_committed_reader_partial_candidate rename to xrpl_phase_work_committed_reader_idx;
analyze public.xrpl_phase_work;
SQL

after_count="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from public.xrpl_phase_work')"
after_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(work_id||':'||status||':'||coalesce(scanned_end_ledger_index::text,''),',' order by work_id)) from public.xrpl_phase_work")"
after_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_committed_reader_idx'::regclass)")"
after_db="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"
predicate="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_get_expr(indpred,indrelid) from pg_index where indexrelid='public.xrpl_phase_work_committed_reader_idx'::regclass")"
definition="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_get_indexdef(indexrelid) from pg_index where indexrelid='public.xrpl_phase_work_committed_reader_idx'::regclass")"

[[ "$before_count" == "$after_count" ]]
[[ "$before_digest" == "$after_digest" ]]
[[ "$after_bytes" -lt "$before_bytes" ]]
[[ "$after_db" -lt "$before_db" ]]
grep -q "status = 'committed'" <<< "$predicate"
! grep -q 'base_identity, status, scanned_end_ledger_index' <<< "$definition"
grep -q 'base_identity, scanned_end_ledger_index, work_id' <<< "$definition"

assert_plan() {
  local name="$1" query="$2" expected="$3"
  local plan
  plan="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "set enable_seqscan=off; explain (costs off) $query")"
  printf '%s\n' "$plan" > "$output_directory/$name.txt"
  grep -q "$expected" <<< "$plan"
}
assert_plan committed-desc \
  "select work_id,scanned_end_ledger_index from public.xrpl_phase_work where profile_id='supabase-devnet' and network='devnet' and epoch_id='supabase-r4c2c-v1' and base_identity='seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77' and status='committed' order by scanned_end_ledger_index desc,work_id desc limit 20" \
  'xrpl_phase_work_committed_reader_idx'
assert_plan committed-forward \
  "select work_id,scanned_end_ledger_index from public.xrpl_phase_work where profile_id='supabase-devnet' and network='devnet' and epoch_id='supabase-r4c2c-v1' and base_identity='seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77' and status='committed' and scanned_end_ledger_index>0 order by scanned_end_ledger_index,work_id limit 20" \
  'xrpl_phase_work_committed_reader_idx'
noncommitted_plan="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "set enable_seqscan=off; explain (costs off) select work_id from public.xrpl_phase_work where profile_id='supabase-devnet' and status='staged' order by updated_at,work_id limit 20")"
printf '%s\n' "$noncommitted_plan" > "$output_directory/noncommitted-plan.txt"
! grep -q 'xrpl_phase_work_committed_reader_idx' <<< "$noncommitted_plan"

reclaimed=$((before_bytes-after_bytes))
cat > "$output_directory/summary.md" <<EOF
## R5 committed-reader partial-index PostgreSQL proof

- rows before/after: \`${before_count} / ${after_count}\`
- row digest preserved: \`true\`
- full committed-reader index bytes: \`${before_bytes}\`
- partial committed-reader index bytes: \`${after_bytes}\`
- index bytes reclaimed: \`${reclaimed}\`
- synthetic database bytes before/after: \`${before_db} / ${after_db}\`
- predicate: \`${predicate}\`
- committed descending/forward plans use replacement index: \`true\`
- non-committed plan cannot use replacement index: \`true\`
- production database used: \`false\`
- production DDL authorized: \`false\`
EOF
cat "$output_directory/summary.md"
