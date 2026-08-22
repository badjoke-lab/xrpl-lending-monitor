#!/usr/bin/env bash
set -euo pipefail
container_name="xrpl-r5-scan-runtime-${GITHUB_RUN_ID:-local}-$$"
image='postgres:15-alpine'
out="${R5_SCAN_RUNTIME_OUTPUT:-r5-terminal-scan-certificate-runtime-evidence}"
cleanup(){ docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$out"; mkdir -p "$out"
docker run -d --rm --name "$container_name" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres "$image" > "$out/container-id.txt"
for _ in $(seq 1 60); do docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break; sleep 1; done

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres > "$out/proof.log" <<'SQL'
create table streams(profile_id text primary key,next_scan_sequence integer not null default 0 check(next_scan_sequence>=0));
create table works(work_id text primary key,profile_id text not null,source_scan_sequence integer not null default 0 check(source_scan_sequence>=0));
create table messages(message_id text primary key,profile_id text not null,phase text not null,status text not null,scan_sequence integer,successor_id text);

create function complete_caught_up(p_profile text,p_message text,p_fail_after_stream boolean default false) returns void language plpgsql as $$
declare m messages%rowtype; s streams%rowtype; n integer; successor text;
begin
 select * into m from messages where message_id=p_message for update;
 if not found or m.phase<>'scan' or m.status<>'leased' or m.scan_sequence is null then raise exception 'message invalid'; end if;
 select * into s from streams where profile_id=p_profile for update;
 if not found or s.next_scan_sequence<>m.scan_sequence then raise exception 'scan sequence certificate conflict'; end if;
 n:=m.scan_sequence+1; successor:=p_message||'-next-'||n;
 insert into messages values(successor,p_profile,'scan','leased',n,null);
 update streams set next_scan_sequence=n where profile_id=p_profile and next_scan_sequence=m.scan_sequence;
 if not found then raise exception 'advance conflict'; end if;
 if p_fail_after_stream then raise exception 'injected rollback'; end if;
 update messages set status='completed',successor_id=successor where message_id=p_message;
end $$;

create function complete_productive(p_profile text,p_message text,p_work text) returns void language plpgsql as $$
declare m messages%rowtype; s streams%rowtype;
begin
 select * into m from messages where message_id=p_message for update;
 if not found or m.phase<>'scan' or m.status<>'leased' or m.scan_sequence is null then raise exception 'message invalid'; end if;
 select * into s from streams where profile_id=p_profile for update;
 if not found or s.next_scan_sequence<>m.scan_sequence then raise exception 'productive sequence certificate conflict'; end if;
 insert into works(work_id,profile_id,source_scan_sequence) values(p_work,p_profile,s.next_scan_sequence);
 update messages set status='completed',successor_id='commit:'||p_work where message_id=p_message;
end $$;

create function complete_finalize(p_profile text,p_work text) returns void language plpgsql as $$
declare s streams%rowtype; w works%rowtype;
begin
 select * into w from works where work_id=p_work for update;
 if not found then raise exception 'work missing'; end if;
 select * into s from streams where profile_id=p_profile for update;
 if not found or s.next_scan_sequence<>w.source_scan_sequence then raise exception 'finalize sequence certificate conflict'; end if;
 if s.next_scan_sequence<>0 then update streams set next_scan_sequence=0 where profile_id=p_profile and next_scan_sequence=w.source_scan_sequence; if not found then raise exception 'reset conflict'; end if; end if;
 insert into messages values('next-after-'||p_work,p_profile,'scan','leased',0,null);
end $$;

create function complete_r5(p_profile text,p_message text,p_work text) returns void language plpgsql as $$
declare m messages%rowtype; s streams%rowtype;
begin
 select * into m from messages where message_id=p_message for update;
 select * into s from streams where profile_id=p_profile for update;
 if not found or m.phase<>'scan' or m.status<>'leased' or m.scan_sequence<>0 or s.next_scan_sequence<>0 then raise exception 'r5 scan certificate boundary invalid'; end if;
 insert into works(work_id,profile_id,source_scan_sequence) values(p_work,p_profile,0);
 update messages set status='completed',successor_id='r5-next-'||p_work where message_id=p_message;
 insert into messages values('r5-next-'||p_work,p_profile,'scan','leased',0,null);
end $$;

insert into streams values('p',0);
insert into messages values('scan0','p','scan','leased',0,null);
select complete_caught_up('p','scan0');
do $$begin
 if (select next_scan_sequence from streams where profile_id='p')<>1 then raise exception 'caught-up increment failed'; end if;
 if (select scan_sequence from messages where message_id='scan0-next-1')<>1 then raise exception 'caught-up successor sequence failed'; end if;
end$$;

insert into messages values('stale0','p','scan','leased',0,null);
do $$begin begin perform complete_caught_up('p','stale0'); raise exception 'stale accepted'; exception when others then if sqlerrm='stale accepted' then raise; end if; end; end$$;
do $$begin if (select next_scan_sequence from streams where profile_id='p')<>1 or (select status from messages where message_id='stale0')<>'leased' then raise exception 'stale mutation leaked'; end if; end$$;

insert into messages values('rollback1','p','scan','leased',1,null);
do $$begin begin perform complete_caught_up('p','rollback1',true); raise exception 'injected failure missing'; exception when others then if sqlerrm='injected failure missing' then raise; end if; end; end$$;
do $$begin if (select next_scan_sequence from streams where profile_id='p')<>1 or exists(select 1 from messages where message_id='rollback1-next-2') or (select status from messages where message_id='rollback1')<>'leased' then raise exception 'caught-up rollback failed'; end if; end$$;

select complete_productive('p','rollback1','work1');
do $$begin if (select source_scan_sequence from works where work_id='work1')<>1 or (select next_scan_sequence from streams where profile_id='p')<>1 then raise exception 'productive certificate failed'; end if; end$$;
select complete_finalize('p','work1');
do $$begin if (select next_scan_sequence from streams where profile_id='p')<>0 or (select scan_sequence from messages where message_id='next-after-work1')<>0 then raise exception 'finalize reset failed'; end if; end$$;

insert into messages values('r5scan0','p','scan','leased',0,null);
select complete_r5('p','r5scan0','r5work0');
do $$begin if (select source_scan_sequence from works where work_id='r5work0')<>0 or (select next_scan_sequence from streams where profile_id='p')<>0 then raise exception 'r5 zero certificate failed'; end if; end$$;

update streams set next_scan_sequence=2 where profile_id='p';
insert into messages values('r5scan2','p','scan','leased',2,null);
do $$begin begin perform complete_r5('p','r5scan2','bad-r5-work'); raise exception 'nonzero r5 accepted'; exception when others then if sqlerrm='nonzero r5 accepted' then raise; end if; end; end$$;
do $$begin if exists(select 1 from works where work_id='bad-r5-work') or (select next_scan_sequence from streams where profile_id='p')<>2 then raise exception 'r5 rejection mutation leaked'; end if; end$$;

select 'PASS';
SQL

grep -q 'PASS' "$out/proof.log"
cat > "$out/summary.md" <<'EOF'
## Terminal scan certificate runtime local PostgreSQL proof

- production database used: `false`
- caught-up consumes exact active sequence and increments: `true`
- stale sequence fails without mutation: `true`
- injected failure rolls stream/message/successor changes back: `true`
- productive scan stores source sequence and does not reset active sequence: `true`
- finalize verifies work certificate and resets active sequence to zero: `true`
- R5 sequence-zero completion stores source zero and keeps stream zero: `true`
- nonzero R5 boundary fails without work mutation: `true`
- production SQL applied: `false`
- R5 rearm authorized: `false`
EOF
cat "$out/summary.md"
