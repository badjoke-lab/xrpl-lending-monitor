#!/usr/bin/env bash
set -euo pipefail

container="xrpl-generic-scan-certificate-${RANDOM}-${RANDOM}"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$container" -e POSTGRES_PASSWORD=postgres postgres:15-alpine >/dev/null
ready=false
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'postgres did not become ready' >&2
  exit 1
fi

sql=$(cat <<'SQL'
\set ON_ERROR_STOP on
create table streams (
  profile_id text primary key,
  next_scan_sequence integer not null check (next_scan_sequence >= 0)
);
create table work (
  work_id text primary key,
  profile_id text not null references streams(profile_id),
  source_scan_sequence integer not null check (source_scan_sequence >= 0),
  status text not null,
  committed_at timestamptz
);

insert into streams values ('p', 3);

create or replace function generic_scan(p_work_id text, p_scan_sequence integer)
returns void language plpgsql as $$
declare v_stream streams%rowtype;
begin
  select * into v_stream from streams where profile_id='p' for update;
  if p_scan_sequence <> v_stream.next_scan_sequence then
    raise exception 'scan sequence certificate conflict';
  end if;
  insert into work(work_id,profile_id,source_scan_sequence,status)
  values(p_work_id,'p',v_stream.next_scan_sequence,'staged');
end;
$$;

create or replace function generic_finalize(p_work_id text)
returns void language plpgsql as $$
declare v_stream streams%rowtype; v_work work%rowtype;
begin
  select * into v_work from work where work_id=p_work_id for update;
  select * into v_stream from streams where profile_id=v_work.profile_id for update;
  if v_stream.next_scan_sequence <> v_work.source_scan_sequence then
    raise exception 'finalize scan sequence certificate conflict';
  end if;
  update work set status='committed', committed_at=now() where work_id=p_work_id;
  if v_stream.next_scan_sequence <> 0 then
    update streams set next_scan_sequence=0
    where profile_id=v_work.profile_id and next_scan_sequence=v_work.source_scan_sequence;
    if not found then raise exception 'finalize scan sequence reset conflict'; end if;
  end if;
end;
$$;

select generic_scan('w-seq3',3);
do $$ begin
  if (select source_scan_sequence from work where work_id='w-seq3') <> 3 then
    raise exception 'generic scan did not persist source sequence';
  end if;
  if (select next_scan_sequence from streams where profile_id='p') <> 3 then
    raise exception 'generic scan changed active sequence';
  end if;
end $$;

begin;
do $$ begin
  begin
    perform generic_scan('w-stale',2);
    raise exception 'expected stale scan failure';
  exception when others then
    if sqlerrm = 'expected stale scan failure' then raise; end if;
  end;
end $$;
commit;
do $$ begin
  if exists(select 1 from work where work_id='w-stale') then
    raise exception 'stale scan mutated work';
  end if;
  if (select next_scan_sequence from streams where profile_id='p') <> 3 then
    raise exception 'stale scan mutated stream';
  end if;
end $$;

select generic_finalize('w-seq3');
do $$ begin
  if (select status from work where work_id='w-seq3') <> 'committed' then
    raise exception 'generic finalize did not commit work';
  end if;
  if (select next_scan_sequence from streams where profile_id='p') <> 0 then
    raise exception 'generic finalize did not reset sequence';
  end if;
end $$;

update streams set next_scan_sequence=4 where profile_id='p';
insert into work values ('w-mismatch','p',5,'staged',null);
begin;
do $$ begin
  begin
    perform generic_finalize('w-mismatch');
    raise exception 'expected finalize mismatch failure';
  exception when others then
    if sqlerrm = 'expected finalize mismatch failure' then raise; end if;
  end;
end $$;
commit;
do $$ begin
  if (select status from work where work_id='w-mismatch') <> 'staged' then
    raise exception 'mismatched finalize mutated work';
  end if;
  if (select next_scan_sequence from streams where profile_id='p') <> 4 then
    raise exception 'mismatched finalize mutated stream';
  end if;
end $$;

\echo PASS
SQL
)

echo "$sql" | docker exec -i "$container" psql -U postgres -d postgres >/tmp/r5-generic-scan-certificate-proof.log

grep -q '^PASS$' /tmp/r5-generic-scan-certificate-proof.log
cat <<'OUT'
## Generic terminal scan-certificate local PostgreSQL proof

- production database used: `false`
- exact active scan sequence persisted into generic work: `true`
- generic productive scan leaves active sequence unchanged: `true`
- stale generic scan rejects without work/stream mutation: `true`
- generic finalize verifies work certificate and resets sequence to zero: `true`
- mismatched generic finalize rejects without work/stream mutation: `true`
- production SQL applied: `false`
- R5 rearm authorized: `false`
OUT
