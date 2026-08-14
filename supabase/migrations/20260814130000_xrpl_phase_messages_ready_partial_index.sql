-- R5 storage headroom: retain every scheduler message row while removing
-- completed/error rows from the claim-ready index.  The runtime claim query
-- only considers pending, retry, and expired leased messages.
--
-- This migration is index-only and does not mutate historical data.

do $$
declare
  v_old_predicate text;
begin
  select pg_get_expr(i.indpred, i.indrelid)
    into v_old_predicate
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'xrpl_phase_messages_ready_idx'
    and i.indrelid = 'public.xrpl_phase_messages'::regclass;

  if not found then
    raise exception 'expected xrpl_phase_messages_ready_idx is missing';
  end if;
  if v_old_predicate is not null then
    raise exception 'expected full xrpl_phase_messages_ready_idx before replacement, found predicate: %', v_old_predicate;
  end if;
  if to_regclass('public.xrpl_phase_messages_ready_claimable_idx') is not null then
    raise exception 'temporary claimable ready index already exists';
  end if;
end;
$$;

create index xrpl_phase_messages_ready_claimable_idx
  on public.xrpl_phase_messages(profile_id, status, available_at, created_at, message_id)
  where status in ('pending', 'retry', 'leased');

drop index public.xrpl_phase_messages_ready_idx;

alter index public.xrpl_phase_messages_ready_claimable_idx
  rename to xrpl_phase_messages_ready_idx;

do $$
declare
  v_predicate text;
  v_definition text;
begin
  select
    pg_get_expr(i.indpred, i.indrelid),
    pg_get_indexdef(i.indexrelid)
    into v_predicate, v_definition
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'xrpl_phase_messages_ready_idx'
    and i.indrelid = 'public.xrpl_phase_messages'::regclass
    and i.indisvalid
    and i.indisready;

  if not found then
    raise exception 'replacement xrpl_phase_messages_ready_idx is not valid and ready';
  end if;
  if v_predicate is null
    or position('pending' in v_predicate) = 0
    or position('retry' in v_predicate) = 0
    or position('leased' in v_predicate) = 0
    or position('completed' in v_predicate) > 0
    or position('error' in v_predicate) > 0 then
    raise exception 'unexpected replacement ready-index predicate: %', v_predicate;
  end if;
  if position('(profile_id, status, available_at, created_at, message_id)' in v_definition) = 0 then
    raise exception 'unexpected replacement ready-index definition: %', v_definition;
  end if;
end;
$$;
