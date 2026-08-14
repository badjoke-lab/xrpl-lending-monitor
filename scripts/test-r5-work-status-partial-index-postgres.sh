#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-work-status-index-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_WORK_STATUS_INDEX_OUTPUT:-r5-work-status-partial-index-evidence}"

cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$output_directory"
mkdir -p "$output_directory"

docker run --detach --rm \
  --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=postgres \
  "$image" > "${output_directory}/container-id.txt"

stable_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
    stable_ready=$((stable_ready + 1))
    if [[ "$stable_ready" -ge 3 ]]; then break; fi
  else
    stable_ready=0
  fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/setup.log" <<'SQL'
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
  status text not null check (status in ('planned','staged','committing','finalizing','committed','error')),
  updated_at timestamptz not null,
  committed_at timestamptz,
  unique(profile_id,start_ledger_index,expected_parent_hash)
);
create index xrpl_phase_work_status_idx
  on public.xrpl_phase_work(profile_id,status,updated_at,work_id);
create index xrpl_phase_work_committed_reader_idx
  on public.xrpl_phase_work(profile_id,network,epoch_id,base_identity,status,scanned_end_ledger_index,work_id);

insert into public.xrpl_phase_work(
  work_id,profile_id,network,epoch_id,base_identity,
  previous_ledger_index,start_ledger_index,expected_parent_hash,
  scanned_end_ledger_index,status,updated_at,committed_at
)
select
  'committed-' || lpad(g::text,5,'0'), 'supabase-devnet','devnet','epoch-v1','base-v1',
  g-1,g,repeat('A',64),g,'committed',
  '2026-08-13 00:00:00+00'::timestamptz + g*interval '1 second',
  '2026-08-13 00:00:01+00'::timestamptz + g*interval '1 second'
from generate_series(1,20000) g;

insert into public.xrpl_phase_work(
  work_id,profile_id,network,epoch_id,base_identity,
  previous_ledger_index,start_ledger_index,expected_parent_hash,
  scanned_end_ledger_index,status,updated_at,committed_at
)
select
  s.status || '-' || lpad(g::text,3,'0'), 'supabase-devnet','devnet','epoch-v1','base-v1',
  30000 + s.ordinal*1000 + g - 1, 30000 + s.ordinal*1000 + g,
  repeat(substr(md5(s.status),1,1),64), 30000 + s.ordinal*1000 + g,
  s.status,
  '2026-08-14 00:00:00+00'::timestamptz + (s.ordinal*1000+g)*interval '1 second',
  null
from (values
  ('planned',1),('staged',2),('committing',3),('finalizing',4),('error',5)
) as s(status,ordinal)
cross join generate_series(1,20) g;
analyze public.xrpl_phase_work;
SQL

before_count="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from public.xrpl_phase_work')"
before_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(work_id || ':' || status || ':' || updated_at::text, ',' order by work_id)) from public.xrpl_phase_work")"
before_index_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_status_idx'::regclass)")"
before_db_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"

before_profile_plan="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "explain (costs off) select work_id,status,updated_at from public.xrpl_phase_work where profile_id='supabase-devnet' order by updated_at desc,work_id desc limit 50")"
printf '%s\n' "$before_profile_plan" > "${output_directory}/profile-list-before.txt"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/replacement.log" <<'SQL'
set lock_timeout = '5s';
set statement_timeout = '45s';
create index xrpl_phase_work_status_partial_candidate
  on public.xrpl_phase_work(profile_id,status,updated_at,work_id)
  where status <> 'committed';
analyze public.xrpl_phase_work;

do $$
declare
  v_predicate text;
  v_indexdef text;
begin
  select pg_get_expr(i.indpred,i.indrelid), pg_get_indexdef(i.indexrelid)
  into v_predicate,v_indexdef
  from pg_index i
  where i.indexrelid='public.xrpl_phase_work_status_partial_candidate'::regclass;
  if v_predicate is null or position('committed' in v_predicate)=0 then
    raise exception 'partial predicate missing';
  end if;
  if position('(profile_id, status, updated_at, work_id)' in v_indexdef)=0 then
    raise exception 'partial index key drift';
  end if;
end $$;

drop index public.xrpl_phase_work_status_idx;
alter index public.xrpl_phase_work_status_partial_candidate rename to xrpl_phase_work_status_idx;
analyze public.xrpl_phase_work;
SQL

after_count="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from public.xrpl_phase_work')"
after_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(work_id || ':' || status || ':' || updated_at::text, ',' order by work_id)) from public.xrpl_phase_work")"
after_index_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_status_idx'::regclass)")"
after_db_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select pg_database_size(current_database())')"
predicate="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_get_expr(i.indpred,i.indrelid) from pg_index i where i.indexrelid='public.xrpl_phase_work_status_idx'::regclass")"

[[ "$before_count" == "$after_count" ]]
[[ "$before_digest" == "$after_digest" ]]
[[ "$after_index_bytes" -lt $((before_index_bytes / 10)) ]]
[[ "$after_db_bytes" -lt "$before_db_bytes" ]]

assert_plan_uses() {
  local name="$1" expected="$2" query="$3"
  local plan
  plan="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "set enable_seqscan=off; explain (costs off) $query")"
  printf '%s\n' "$plan" > "${output_directory}/${name}.txt"
  grep -q "$expected" <<< "$plan"
}

for status in planned staged committing finalizing error; do
  assert_plan_uses "plan-${status}" 'xrpl_phase_work_status_idx' \
    "select work_id,status,updated_at from public.xrpl_phase_work where profile_id='supabase-devnet' and status='${status}' order by updated_at,work_id limit 20"
done

assert_plan_uses 'plan-inflight-count' 'xrpl_phase_work_status_idx' \
  "select count(*) from public.xrpl_phase_work where profile_id='supabase-devnet' and status in ('planned','staged','committing','finalizing')"
assert_plan_uses 'plan-committed-reader' 'xrpl_phase_work_committed_reader_idx' \
  "select work_id,scanned_end_ledger_index from public.xrpl_phase_work where profile_id='supabase-devnet' and network='devnet' and epoch_id='epoch-v1' and base_identity='base-v1' and status='committed' order by scanned_end_ledger_index desc,work_id desc limit 20"
assert_plan_uses 'plan-work-id' 'xrpl_phase_work_pkey' \
  "select * from public.xrpl_phase_work where work_id='committed-20000'"

committed_count_plan="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "explain (costs off) select count(*) from public.xrpl_phase_work where profile_id='supabase-devnet' and status='committed'")"
printf '%s\n' "$committed_count_plan" > "${output_directory}/plan-committed-count.txt"
! grep -q 'xrpl_phase_work_status_idx' <<< "$committed_count_plan"

after_profile_plan="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "explain (costs off) select work_id,status,updated_at from public.xrpl_phase_work where profile_id='supabase-devnet' order by updated_at desc,work_id desc limit 50")"
printf '%s\n' "$after_profile_plan" > "${output_directory}/profile-list-after.txt"
! grep -q 'xrpl_phase_work_status_idx' <<< "$after_profile_plan"

cat > "${output_directory}/summary.md" <<EOF
## R5 work-status partial-index PostgreSQL contract

- rows before/after: \`${before_count}\` / \`${after_count}\`
- row identity/status digest preserved: \`true\`
- full status index bytes before: \`${before_index_bytes}\`
- partial status index bytes after: \`${after_index_bytes}\`
- synthetic database bytes before: \`${before_db_bytes}\`
- synthetic database bytes after: \`${after_db_bytes}\`
- replacement predicate: \`${predicate}\`
- planned/staged/committing/finalizing/error equality queries use partial index: \`true\`
- inflight status-IN count uses partial index: \`true\`
- committed reader uses dedicated committed-reader index: \`true\`
- work-id lookup uses primary key: \`true\`
- committed count does not use partial status index: \`true\`
- profile-only updated-at list does not use partial status index: \`true\`
- production database used: \`false\`
- production index mutation authorized: \`false\`
EOF
cat "${output_directory}/summary.md"
