create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.xrpl_collector_runtime (
  profile_id text primary key,
  network text not null,
  status text not null default 'stopped',
  lease_owner text,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_failed_at timestamptz,
  last_validated_ledger_index bigint,
  last_validated_ledger_hash text,
  last_error text,
  tick_count bigint not null default 0,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint xrpl_collector_runtime_network_check check (network in ('devnet')),
  constraint xrpl_collector_runtime_status_check check (status in ('stopped', 'running', 'halted')),
  constraint xrpl_collector_runtime_lease_pair_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint xrpl_collector_runtime_ledger_hash_check check (
    last_validated_ledger_hash is null
    or last_validated_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  constraint xrpl_collector_runtime_nonnegative_check check (
    tick_count >= 0 and consecutive_failures >= 0
  )
);

create table if not exists public.xrpl_collector_runs (
  id bigint generated always as identity primary key,
  profile_id text not null references public.xrpl_collector_runtime(profile_id),
  invocation_id text not null,
  lease_owner text not null,
  source text not null,
  status text not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  validated_ledger_index bigint,
  validated_ledger_hash text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint xrpl_collector_runs_status_check check (status in ('completed', 'failed', 'skipped')),
  constraint xrpl_collector_runs_hash_check check (
    validated_ledger_hash is null
    or validated_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  constraint xrpl_collector_runs_time_check check (completed_at >= started_at)
);

create index if not exists xrpl_collector_runs_profile_completed_idx
  on public.xrpl_collector_runs(profile_id, completed_at desc, id desc);

insert into public.xrpl_collector_runtime (profile_id, network)
values ('supabase-devnet', 'devnet')
on conflict (profile_id) do nothing;

alter table public.xrpl_collector_runtime enable row level security;
alter table public.xrpl_collector_runs enable row level security;

revoke all on public.xrpl_collector_runtime from anon, authenticated;
revoke all on public.xrpl_collector_runs from anon, authenticated;
grant select, insert, update on public.xrpl_collector_runtime to service_role;
grant select, insert on public.xrpl_collector_runs to service_role;
grant usage, select on sequence public.xrpl_collector_runs_id_seq to service_role;

create or replace function public.xrpl_claim_collector_tick(
  p_owner text,
  p_now timestamptz,
  p_lease_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runtime public.xrpl_collector_runtime%rowtype;
begin
  if p_owner is null or length(p_owner) < 8 or length(p_owner) > 200 then
    raise exception 'invalid owner';
  end if;
  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid lease duration';
  end if;

  update public.xrpl_collector_runtime
  set
    status = 'running',
    lease_owner = p_owner,
    lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
    last_started_at = p_now,
    updated_at = p_now
  where profile_id = 'supabase-devnet'
    and status <> 'halted'
    and (
      status <> 'running'
      or lease_expires_at is null
      or lease_expires_at <= p_now
    )
  returning * into v_runtime;

  if not found then
    select *
    into v_runtime
    from public.xrpl_collector_runtime
    where profile_id = 'supabase-devnet';

    return jsonb_build_object(
      'claimed', false,
      'reason', case when v_runtime.status = 'halted' then 'halted' else 'lease_active' end,
      'lease_owner', v_runtime.lease_owner,
      'lease_expires_at', v_runtime.lease_expires_at,
      'status', v_runtime.status
    );
  end if;

  return jsonb_build_object(
    'claimed', true,
    'profile_id', v_runtime.profile_id,
    'lease_owner', v_runtime.lease_owner,
    'lease_expires_at', v_runtime.lease_expires_at,
    'tick_count', v_runtime.tick_count
  );
end;
$$;

create or replace function public.xrpl_complete_collector_tick(
  p_owner text,
  p_invocation_id text,
  p_source text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_ledger_index bigint,
  p_ledger_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runtime public.xrpl_collector_runtime%rowtype;
begin
  if p_completed_at < p_started_at then
    raise exception 'completion precedes start';
  end if;
  if p_ledger_index <= 0 then
    raise exception 'invalid ledger index';
  end if;
  if p_ledger_hash !~ '^[A-F0-9]{64}$' then
    raise exception 'invalid ledger hash';
  end if;

  update public.xrpl_collector_runtime
  set
    status = 'stopped',
    lease_owner = null,
    lease_expires_at = null,
    last_completed_at = p_completed_at,
    last_validated_ledger_index = p_ledger_index,
    last_validated_ledger_hash = p_ledger_hash,
    last_error = null,
    tick_count = tick_count + 1,
    consecutive_failures = 0,
    updated_at = p_completed_at
  where profile_id = 'supabase-devnet'
    and status = 'running'
    and lease_owner = p_owner
    and lease_expires_at > p_completed_at
  returning * into v_runtime;

  if not found then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;

  insert into public.xrpl_collector_runs (
    profile_id,
    invocation_id,
    lease_owner,
    source,
    status,
    started_at,
    completed_at,
    validated_ledger_index,
    validated_ledger_hash
  ) values (
    'supabase-devnet',
    p_invocation_id,
    p_owner,
    p_source,
    'completed',
    p_started_at,
    p_completed_at,
    p_ledger_index,
    p_ledger_hash
  );

  return jsonb_build_object(
    'completed', true,
    'tick_count', v_runtime.tick_count,
    'ledger_index', v_runtime.last_validated_ledger_index,
    'ledger_hash', v_runtime.last_validated_ledger_hash
  );
end;
$$;

create or replace function public.xrpl_fail_collector_tick(
  p_owner text,
  p_invocation_id text,
  p_source text,
  p_started_at timestamptz,
  p_failed_at timestamptz,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runtime public.xrpl_collector_runtime%rowtype;
begin
  update public.xrpl_collector_runtime
  set
    status = 'stopped',
    lease_owner = null,
    lease_expires_at = null,
    last_failed_at = p_failed_at,
    last_error = left(coalesce(p_error, 'unknown failure'), 1000),
    consecutive_failures = consecutive_failures + 1,
    updated_at = p_failed_at
  where profile_id = 'supabase-devnet'
    and status = 'running'
    and lease_owner = p_owner
  returning * into v_runtime;

  if not found then
    return jsonb_build_object('recorded', false, 'reason', 'lease_lost');
  end if;

  insert into public.xrpl_collector_runs (
    profile_id,
    invocation_id,
    lease_owner,
    source,
    status,
    started_at,
    completed_at,
    error_message
  ) values (
    'supabase-devnet',
    p_invocation_id,
    p_owner,
    p_source,
    'failed',
    p_started_at,
    p_failed_at,
    left(coalesce(p_error, 'unknown failure'), 1000)
  );

  return jsonb_build_object(
    'recorded', true,
    'consecutive_failures', v_runtime.consecutive_failures
  );
end;
$$;

revoke all on function public.xrpl_claim_collector_tick(text, timestamptz, integer) from public;
revoke all on function public.xrpl_complete_collector_tick(text, text, text, timestamptz, timestamptz, bigint, text) from public;
revoke all on function public.xrpl_fail_collector_tick(text, text, text, timestamptz, timestamptz, text) from public;
grant execute on function public.xrpl_claim_collector_tick(text, timestamptz, integer) to service_role;
grant execute on function public.xrpl_complete_collector_tick(text, text, text, timestamptz, timestamptz, bigint, text) to service_role;
grant execute on function public.xrpl_fail_collector_tick(text, text, text, timestamptz, timestamptz, text) to service_role;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'xrpl_project_url'
  ) then
    raise exception 'Vault secret xrpl_project_url must exist before migration';
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'xrpl_secret_key'
  ) then
    raise exception 'Vault secret xrpl_secret_key must exist before migration';
  end if;

  perform cron.schedule(
    'xrpl-lending-monitor-minute',
    '* * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'xrpl_project_url'
        ) || '/functions/v1/xrpl-collector-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'xrpl_secret_key'
          )
        ),
        body := jsonb_build_object(
          'source', 'pg_cron',
          'scheduled_at', now()
        ),
        timeout_milliseconds := 10000
      );
    $cron$
  );
end;
$$;
