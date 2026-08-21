#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-scan-certificate-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_SCAN_CERTIFICATE_OUTPUT:-r5-terminal-scan-certificate-storage-evidence}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
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
    if [[ "$stable_ready" -ge 3 ]]; then
      break
    fi
  else
    stable_ready=0
  fi
  sleep 1
done
[[ "$stable_ready" -ge 3 ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/setup.log" <<'SQL'
create table public.work_base (
  work_id text primary key,
  profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  expected_parent_hash text not null,
  planned_end_ledger_index bigint not null,
  scanned_end_ledger_index bigint,
  final_ledger_hash text,
  status text not null,
  plan_json text not null,
  semantic_counts_json text,
  payload_digest text,
  expected_payload_chunks integer not null,
  expected_commit_chunks integer not null,
  error_code text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  committed_at timestamptz
);

create table public.work_certificate (like public.work_base including all);
alter table public.work_certificate
  add column source_scan_sequence integer not null check (source_scan_sequence >= 0);

insert into public.work_base
select
  'work-' || g::text,
  'supabase-devnet',
  'devnet',
  'supabase-r4c2c-v1',
  'storage-proof-base',
  4000000 + g,
  4000001 + g,
  repeat('A',64),
  4000001 + g,
  4000001 + g,
  repeat('B',64),
  'committed',
  '{"schemaVersion":1,"network":"devnet"}',
  '{"validatedLedgers":1,"totalRecords":1}',
  repeat('c',64),
  1,
  1,
  null,
  null,
  '2026-08-21 00:00:00+00'::timestamptz + g * interval '1 second',
  '2026-08-21 00:00:01+00'::timestamptz + g * interval '1 second',
  '2026-08-21 00:00:01+00'::timestamptz + g * interval '1 second'
from generate_series(1,200000) g;

insert into public.work_certificate
select b.*, (b.previous_ledger_index % 4)::integer
from public.work_base b;

vacuum analyze public.work_base;
vacuum analyze public.work_certificate;

create table public.xrpl_phase_work_model (
  work_id text primary key,
  profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  previous_ledger_index bigint not null,
  start_ledger_index bigint not null,
  expected_parent_hash text not null,
  planned_end_ledger_index bigint not null,
  scanned_end_ledger_index bigint,
  final_ledger_hash text,
  status text not null,
  plan_json text not null,
  semantic_counts_json text,
  payload_digest text,
  expected_payload_chunks integer not null,
  expected_commit_chunks integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  committed_at timestamptz
);

insert into public.xrpl_phase_work_model
select
  'current-work-' || g::text,
  'supabase-devnet',
  'devnet',
  'supabase-r4c2c-v1',
  'storage-proof-base',
  4100000 + g,
  4100001 + g,
  repeat('A',64),
  4100001 + g,
  4100001 + g,
  repeat('B',64),
  'committed',
  '{"schemaVersion":1,"network":"devnet"}',
  '{"validatedLedgers":1,"totalRecords":1}',
  repeat('c',64),
  1,
  1,
  '2026-08-21 00:00:00+00'::timestamptz + g * interval '1 second',
  '2026-08-21 00:00:01+00'::timestamptz + g * interval '1 second',
  '2026-08-21 00:00:01+00'::timestamptz + g * interval '1 second'
from generate_series(1,500) g;

create table public.xrpl_phase_streams_model (
  profile_id text primary key,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  immutable_base_ledger_index bigint not null,
  immutable_base_ledger_hash text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

insert into public.xrpl_phase_streams_model values (
  'supabase-devnet','devnet','supabase-r4c2c-v1','storage-proof-base',
  4100000,repeat('A',64),'active','2026-08-21 00:00:00+00','2026-08-21 00:00:00+00'
);

vacuum analyze public.xrpl_phase_work_model;
vacuum analyze public.xrpl_phase_streams_model;
SQL

large_base_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.work_base'::regclass)")"
large_certificate_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.work_certificate'::regclass)")"
large_delta_bytes=$((large_certificate_bytes - large_base_bytes))
large_rows=200000
large_delta_per_row_milli=$((large_delta_bytes * 1000 / large_rows))

[[ "$large_delta_bytes" -ge 0 ]]
[[ "$large_delta_bytes" -le 2400000 ]]

work_before_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_model'::regclass)")"
stream_before_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_streams_model'::regclass)")"
work_before_relfilenode="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select relfilenode from pg_class where oid='public.xrpl_phase_work_model'::regclass")"
stream_before_relfilenode="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select relfilenode from pg_class where oid='public.xrpl_phase_streams_model'::regclass")"

# Candidate DDL only in this disposable local PostgreSQL instance. No production migration file exists.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/candidate-ddl.log" <<'SQL'
alter table public.xrpl_phase_work_model
  add column source_scan_sequence integer check (source_scan_sequence >= 0);
alter table public.xrpl_phase_streams_model
  add column next_scan_sequence integer check (next_scan_sequence >= 0);
SQL

work_after_add_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_model'::regclass)")"
stream_after_add_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_streams_model'::regclass)")"
work_after_add_relfilenode="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select relfilenode from pg_class where oid='public.xrpl_phase_work_model'::regclass")"
stream_after_add_relfilenode="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select relfilenode from pg_class where oid='public.xrpl_phase_streams_model'::regclass")"

[[ "$work_after_add_bytes" == "$work_before_bytes" ]]
[[ "$stream_after_add_bytes" == "$stream_before_bytes" ]]
[[ "$work_after_add_relfilenode" == "$work_before_relfilenode" ]]
[[ "$stream_after_add_relfilenode" == "$stream_before_relfilenode" ]]

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/backfill.log" <<'SQL'
update public.xrpl_phase_work_model
set source_scan_sequence = (previous_ledger_index % 4)::integer;
update public.xrpl_phase_streams_model
set next_scan_sequence = 0;
alter table public.xrpl_phase_work_model alter column source_scan_sequence set not null;
alter table public.xrpl_phase_streams_model alter column next_scan_sequence set not null;
SQL

work_after_backfill_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_model'::regclass)")"
stream_after_backfill_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_streams_model'::regclass)")"
work_backfill_growth=$((work_after_backfill_bytes - work_before_bytes))
stream_backfill_growth=$((stream_after_backfill_bytes - stream_before_bytes))

[[ "$work_backfill_growth" -ge 0 ]]
[[ "$work_backfill_growth" -le 524288 ]]
[[ "$stream_backfill_growth" -ge 0 ]]
[[ "$stream_backfill_growth" -le 65536 ]]

work_nulls="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_work_model where source_scan_sequence is null")"
stream_value="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select next_scan_sequence from public.xrpl_phase_streams_model where profile_id='supabase-devnet'")"
[[ "$work_nulls" == '0' ]]
[[ "$stream_value" == '0' ]]

# Exercise repeated caught-up updates. The first cycle may allocate MVCC pages; ordinary VACUUM marks them reusable.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/stream-cycle-1.log" <<'SQL'
do $$
begin
  for i in 1..5000 loop
    update public.xrpl_phase_streams_model
    set next_scan_sequence = next_scan_sequence + 1,
        updated_at = updated_at + interval '1 millisecond'
    where profile_id='supabase-devnet';
  end loop;
end $$;
SQL

stream_after_cycle1_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_streams_model'::regclass)")"
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'vacuum public.xrpl_phase_streams_model' > "${output_directory}/stream-vacuum.log"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/stream-cycle-2.log" <<'SQL'
do $$
begin
  for i in 1..5000 loop
    update public.xrpl_phase_streams_model
    set next_scan_sequence = next_scan_sequence + 1,
        updated_at = updated_at + interval '1 millisecond'
    where profile_id='supabase-devnet';
  end loop;
end $$;
SQL

stream_after_cycle2_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_streams_model'::regclass)")"
stream_final_value="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select next_scan_sequence from public.xrpl_phase_streams_model where profile_id='supabase-devnet'")"

[[ "$stream_final_value" == '10000' ]]
# After a normal VACUUM, the second equal update cycle must reuse the first cycle's pages rather than append another full cycle.
[[ "$stream_after_cycle2_bytes" -le $((stream_after_cycle1_bytes + 16384)) ]]

cat > "${output_directory}/summary.md" <<EOF
## R5 bounded scan-certificate local PostgreSQL storage proof

- production database used: \`false\`
- production migration created/applied: \`false\`
- candidate fields: \`xrpl_phase_work.source_scan_sequence integer\`, \`xrpl_phase_streams.next_scan_sequence integer\`
- append-only certificate table required: \`false\`
- large comparison rows: \`${large_rows}\`
- base heap bytes: \`${large_base_bytes}\`
- certificate heap bytes: \`${large_certificate_bytes}\`
- steady extra bytes total: \`${large_delta_bytes}\`
- steady extra bytes per work ×1000: \`${large_delta_per_row_milli}\`
- current-shape work rows modeled: \`500\`
- nullable ADD COLUMN rewrote work heap: \`false\`
- nullable ADD COLUMN rewrote stream heap: \`false\`
- exact-500 one-time work backfill heap growth: \`${work_backfill_growth}\`
- one-row stream backfill heap growth: \`${stream_backfill_growth}\`
- repeated stream updates cycle 1 heap bytes: \`${stream_after_cycle1_bytes}\`
- repeated stream updates cycle 2 heap bytes after ordinary VACUUM reuse: \`${stream_after_cycle2_bytes}\`
- repeated stream final next sequence: \`${stream_final_value}\`
- VACUUM FULL required for reuse proof: \`false\`
- archive deletion/stop-append authorized: \`false\`
- R5 rearm authorized: \`false\`
EOF

cat "${output_directory}/summary.md"
