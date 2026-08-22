#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r5-scan-fast-default-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
output_directory="${R5_SCAN_FAST_DEFAULT_OUTPUT:-r5-terminal-scan-certificate-fast-default-evidence}"

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
create table public.xrpl_phase_work_model (
  work_id text primary key,
  profile_id text not null,
  previous_ledger_index bigint not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

insert into public.xrpl_phase_work_model
select
  'work-' || lpad(g::text, 8, '0'),
  'supabase-devnet',
  4140000 + g,
  'committed',
  '2026-08-21 00:00:00+00'::timestamptz + g * interval '1 second',
  '2026-08-21 00:00:01+00'::timestamptz + g * interval '1 second'
from generate_series(1,17063) g;

create table public.xrpl_phase_streams_model (
  profile_id text primary key,
  network text not null,
  status text not null,
  updated_at timestamptz not null
);
insert into public.xrpl_phase_streams_model values (
  'supabase-devnet','devnet','active','2026-08-21 00:00:00+00'
);

vacuum analyze public.xrpl_phase_work_model;
vacuum analyze public.xrpl_phase_streams_model;
SQL

work_before_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_model'::regclass)")"
work_before_relfilenode="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select relfilenode from pg_class where oid='public.xrpl_phase_work_model'::regclass")"
work_before_ctid_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(work_id||':'||ctid::text,E'\\n' order by work_id)) from public.xrpl_phase_work_model")"
stream_before_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_streams_model'::regclass)")"
stream_before_relfilenode="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select relfilenode from pg_class where oid='public.xrpl_phase_streams_model'::regclass")"
stream_before_ctid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select ctid::text from public.xrpl_phase_streams_model where profile_id='supabase-devnet'")"

# Candidate DDL is executed only inside this disposable PostgreSQL container.
# No production migration is created or applied by this proof.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/fast-default-ddl.log" <<'SQL'
alter table public.xrpl_phase_work_model
  add column source_scan_sequence integer not null default 0
  check (source_scan_sequence >= 0);
alter table public.xrpl_phase_streams_model
  add column next_scan_sequence integer not null default 0
  check (next_scan_sequence >= 0);
SQL

work_after_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_work_model'::regclass)")"
work_after_relfilenode="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select relfilenode from pg_class where oid='public.xrpl_phase_work_model'::regclass")"
work_after_ctid_digest="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select md5(string_agg(work_id||':'||ctid::text,E'\\n' order by work_id)) from public.xrpl_phase_work_model")"
stream_after_bytes="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select pg_relation_size('public.xrpl_phase_streams_model'::regclass)")"
stream_after_relfilenode="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select relfilenode from pg_class where oid='public.xrpl_phase_streams_model'::regclass")"
stream_after_ctid="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select ctid::text from public.xrpl_phase_streams_model where profile_id='supabase-devnet'")"

work_missing="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select atthasmissing::text||':'||attmissingval::text from pg_attribute where attrelid='public.xrpl_phase_work_model'::regclass and attname='source_scan_sequence'")"
stream_missing="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select atthasmissing::text||':'||attmissingval::text from pg_attribute where attrelid='public.xrpl_phase_streams_model'::regclass and attname='next_scan_sequence'")"
work_zero_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_work_model where source_scan_sequence=0")"
work_nonzero_rows="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from public.xrpl_phase_work_model where source_scan_sequence<>0")"
stream_initial="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select next_scan_sequence from public.xrpl_phase_streams_model where profile_id='supabase-devnet'")"

[[ "$work_before_bytes" == "$work_after_bytes" ]]
[[ "$work_before_relfilenode" == "$work_after_relfilenode" ]]
[[ "$work_before_ctid_digest" == "$work_after_ctid_digest" ]]
[[ "$stream_before_bytes" == "$stream_after_bytes" ]]
[[ "$stream_before_relfilenode" == "$stream_after_relfilenode" ]]
[[ "$stream_before_ctid" == "$stream_after_ctid" ]]
[[ "$work_missing" == 'true:{0}' ]]
[[ "$stream_missing" == 'true:{0}' ]]
[[ "$work_zero_rows" == '17063' ]]
[[ "$work_nonzero_rows" == '0' ]]
[[ "$stream_initial" == '0' ]]

# Future productive work may store a proven nonzero sequence explicitly.
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "insert into public.xrpl_phase_work_model(work_id,profile_id,previous_ledger_index,status,created_at,updated_at,source_scan_sequence) values ('future-work','supabase-devnet',5000000,'committed',now(),now(),7)" \
  > "${output_directory}/future-nonzero.log"
future_value="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select source_scan_sequence from public.xrpl_phase_work_model where work_id='future-work'")"
[[ "$future_value" == '7' ]]

# Negative sequence values must fail the CHECK constraint for both certificate fields.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/negative-rejection.log" <<'SQL'
do $$
begin
  begin
    insert into public.xrpl_phase_work_model(
      work_id,profile_id,previous_ledger_index,status,created_at,updated_at,source_scan_sequence
    ) values ('negative-work','supabase-devnet',5000001,'committed',now(),now(),-1);
    raise exception 'negative work sequence unexpectedly accepted';
  exception when check_violation then
    null;
  end;

  begin
    update public.xrpl_phase_streams_model
    set next_scan_sequence=-1
    where profile_id='supabase-devnet';
    raise exception 'negative stream sequence unexpectedly accepted';
  exception when check_violation then
    null;
  end;
end $$;
SQL

stream_final="$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select next_scan_sequence from public.xrpl_phase_streams_model where profile_id='supabase-devnet'")"
[[ "$stream_final" == '0' ]]

cat > "${output_directory}/summary.md" <<EOF
## R5 scan-certificate constant fast-default PostgreSQL proof

- production database used: \`false\`
- production migration created/applied: \`false\`
- historical work rows modeled: \`17063\`
- proven historical default represented: \`0\`
- work heap bytes before / after: \`${work_before_bytes} / ${work_after_bytes}\`
- work relfilenode before / after: \`${work_before_relfilenode} / ${work_after_relfilenode}\`
- work CTID digest unchanged: \`$([[ "$work_before_ctid_digest" == "$work_after_ctid_digest" ]] && echo true || echo false)\`
- work pg_attribute missing value: \`${work_missing}\`
- historical work rows reading zero / nonzero: \`${work_zero_rows} / ${work_nonzero_rows}\`
- stream heap bytes before / after: \`${stream_before_bytes} / ${stream_after_bytes}\`
- stream relfilenode before / after: \`${stream_before_relfilenode} / ${stream_after_relfilenode}\`
- stream CTID unchanged: \`$([[ "$stream_before_ctid" == "$stream_after_ctid" ]] && echo true || echo false)\`
- stream pg_attribute missing value: \`${stream_missing}\`
- future explicit nonzero source sequence accepted: \`${future_value}\`
- negative work / stream sequence rejected: \`true / true\`
- append-only certificate rows required: \`false\`
- historical work UPDATE backfill required by this shape: \`false\`
- archive stop/delete authorized: \`false\`
- R5 rearm authorized: \`false\`
EOF

cat "${output_directory}/summary.md"
