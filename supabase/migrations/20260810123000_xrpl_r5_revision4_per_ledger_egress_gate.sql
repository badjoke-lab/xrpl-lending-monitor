-- Revision-4 R5 Free-tier egress gate.
--
-- The directional accounting qualification permits at most 4,581 billable
-- bytes per recovered ledger at the required 21 ledgers/minute steady demand.
-- Completion currently rejects a measured upper bound when it is >= the batch
-- reservation, so the reservation is deliberately an EXCLUSIVE threshold:
--
--   inclusive billable budget = ledger_count * 4,581
--   exclusive reservation     = inclusive budget + 1
--
-- For the selected 12-ledger maximum this is 54,972 bytes inclusive and a
-- 54,973-byte exclusive reservation. This migration is repository-only until
-- a separately authorized Supabase deployment.

create table if not exists xrpl_r5_v1.revision4_egress_budget_policy (
  policy_id text primary key check (policy_id = 'r5-revision4-egress-4581-v1'),
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null check (profile_id = 'supabase_free_postgres_pgcron_edge'),
  profile_revision integer not null check (profile_revision = 4),
  profile_identity_digest text not null check (
    profile_identity_digest =
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
  ),
  maximum_ledgers_per_claim integer not null check (maximum_ledgers_per_claim = 12),
  maximum_billable_egress_bytes_per_ledger bigint not null check (
    maximum_billable_egress_bytes_per_ledger = 4581
  ),
  maximum_claim_billable_egress_bytes bigint not null check (
    maximum_claim_billable_egress_bytes = 54972
  ),
  exclusive_reservation_slack_bytes bigint not null check (
    exclusive_reservation_slack_bytes = 1
  ),
  maximum_claim_exclusive_reservation_bytes bigint not null check (
    maximum_claim_exclusive_reservation_bytes = 54973
  ),
  project_egress_halt_31d_bytes bigint not null check (
    project_egress_halt_31d_bytes = 4294967296
  ),
  required_steady_ledgers_per_minute integer not null check (
    required_steady_ledgers_per_minute = 21
  ),
  source_issue_number integer not null check (source_issue_number = 1261),
  public_reader_unchanged boolean not null check (public_reader_unchanged),
  mainnet_disabled boolean not null check (mainnet_disabled),
  stabilization_authorized boolean not null check (not stabilization_authorized),
  soak_authorized boolean not null check (not soak_authorized),
  applied_at timestamptz not null
);

revoke all on table xrpl_r5_v1.revision4_egress_budget_policy
  from public, anon, authenticated;

create or replace function xrpl_r5_v1.revision4_billable_egress_budget_bytes(
  p_ledger_count integer
)
returns bigint
language sql
immutable
strict
set search_path = pg_temp
as $$
  select p_ledger_count::bigint * 4581
$$;

create or replace function xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(
  p_ledger_count integer
)
returns bigint
language sql
immutable
strict
set search_path = xrpl_r5_v1, pg_temp
as $$
  select xrpl_r5_v1.revision4_billable_egress_budget_bytes(p_ledger_count) + 1
$$;

revoke all on function xrpl_r5_v1.revision4_billable_egress_budget_bytes(integer)
  from public, anon, authenticated;
revoke all on function xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(integer)
  from public, anon, authenticated;

do $patch_claim$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
  );
  v_definition text;
  v_patched_definition text;
  v_old_declaration constant text := 'v_reserved constant bigint := 16777216;';
  v_new_declaration constant text := 'v_reserved bigint := 0;';
  v_count_assignment constant text :=
    'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;';
  v_monthly_guard constant text :=
    'if v_prior_egress + v_reserved >= v_egress_halt';
  v_budget_preamble constant text :=
    'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;' || E'\n  ' ||
    'v_reserved := xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(v_count);' || E'\n\n  ';
  v_late_count_block constant text :=
    'v_start := v_watermark.ledger_index + 1;' || E'\n  ' ||
    'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;' || E'\n  ' ||
    'v_end := v_start + v_count - 1;';
  v_late_count_replacement constant text :=
    'v_start := v_watermark.ledger_index + 1;' || E'\n  ' ||
    'v_end := v_start + v_count - 1;';
  v_old_declaration_count integer;
  v_count_assignment_count integer;
  v_monthly_guard_count integer;
  v_late_count_block_count integer;
  v_active_revision4_batch_count bigint;
begin
  if v_signature is null then
    raise exception 'r5_revision4_egress_gate_claim_function_missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0));

  select count(*)::bigint
  into v_active_revision4_batch_count
  from xrpl_r5_v1.recovery_batches
  where profile_revision = 4 and status = 'leased';

  if v_active_revision4_batch_count <> 0 then
    raise exception 'r5_revision4_egress_gate_active_batch_present';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  v_old_declaration_count := (
    length(v_definition) - length(replace(v_definition, v_old_declaration, ''))
  ) / length(v_old_declaration);
  v_count_assignment_count := (
    length(v_definition) - length(replace(v_definition, v_count_assignment, ''))
  ) / length(v_count_assignment);
  v_monthly_guard_count := (
    length(v_definition) - length(replace(v_definition, v_monthly_guard, ''))
  ) / length(v_monthly_guard);
  v_late_count_block_count := (
    length(v_definition) - length(replace(v_definition, v_late_count_block, ''))
  ) / length(v_late_count_block);

  if v_old_declaration_count <> 1
    or v_count_assignment_count <> 1
    or v_monthly_guard_count <> 1
    or v_late_count_block_count <> 1
    or position('v_reserved := xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(v_count);' in v_definition) <> 0 then
    raise exception 'r5_revision4_egress_gate_source_definition_drift';
  end if;

  v_patched_definition := replace(
    v_definition,
    v_old_declaration,
    v_new_declaration
  );
  v_patched_definition := replace(
    v_patched_definition,
    v_late_count_block,
    v_late_count_replacement
  );
  v_patched_definition := replace(
    v_patched_definition,
    v_monthly_guard,
    v_budget_preamble || v_monthly_guard
  );

  execute v_patched_definition;

  select pg_get_functiondef(v_signature) into v_patched_definition;

  if position(v_old_declaration in v_patched_definition) <> 0
    or position(v_new_declaration in v_patched_definition) = 0
    or position(
      'v_reserved := xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(v_count);'
      in v_patched_definition
    ) = 0
    or position(v_late_count_block in v_patched_definition) <> 0
    or position(v_late_count_replacement in v_patched_definition) = 0
    or position(v_budget_preamble || v_monthly_guard in v_patched_definition) = 0 then
    raise exception 'r5_revision4_egress_gate_patch_verification_failed';
  end if;
end;
$patch_claim$;

-- Old revision-4 qualification rows may retain the earlier 16 MiB reservation,
-- so do not rewrite or delete history. NOT VALID skips the historical scan but
-- still enforces the exact exclusive threshold for every future/updated row.
alter table xrpl_r5_v1.recovery_batches
  drop constraint if exists xrpl_r5_revision4_future_egress_budget_check;
alter table xrpl_r5_v1.recovery_batches
  add constraint xrpl_r5_revision4_future_egress_budget_check check (
    profile_revision <> 4
    or (
      ledger_count between 1 and 12
      and reserved_egress_upper_bound_bytes =
        xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(ledger_count)
    )
  ) not valid;

insert into xrpl_r5_v1.revision4_egress_budget_policy (
  policy_id,
  profile_id,
  profile_revision,
  profile_identity_digest,
  maximum_ledgers_per_claim,
  maximum_billable_egress_bytes_per_ledger,
  maximum_claim_billable_egress_bytes,
  exclusive_reservation_slack_bytes,
  maximum_claim_exclusive_reservation_bytes,
  project_egress_halt_31d_bytes,
  required_steady_ledgers_per_minute,
  source_issue_number,
  public_reader_unchanged,
  mainnet_disabled,
  stabilization_authorized,
  soak_authorized,
  applied_at
) values (
  'r5-revision4-egress-4581-v1',
  'supabase_free_postgres_pgcron_edge',
  4,
  '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
  12,
  4581,
  54972,
  1,
  54973,
  4294967296,
  21,
  1261,
  true,
  true,
  false,
  false,
  clock_timestamp()
);

do $assertion$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
  );
  v_definition text;
  v_policy xrpl_r5_v1.revision4_egress_budget_policy%rowtype;
  v_policy_found boolean := false;
  v_constraint_validated boolean;
  v_constraint_found boolean := false;
begin
  if xrpl_r5_v1.revision4_billable_egress_budget_bytes(1) <> 4581
    or xrpl_r5_v1.revision4_billable_egress_budget_bytes(12) <> 54972
    or xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(1) <> 4582
    or xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(12) <> 54973 then
    raise exception 'r5_revision4_egress_gate_budget_math_invalid';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  select * into v_policy
  from xrpl_r5_v1.revision4_egress_budget_policy
  where policy_id = 'r5-revision4-egress-4581-v1';
  v_policy_found := found;

  select convalidated into v_constraint_validated
  from pg_constraint
  where conrelid = 'xrpl_r5_v1.recovery_batches'::regclass
    and conname = 'xrpl_r5_revision4_future_egress_budget_check';
  v_constraint_found := found;

  if not v_policy_found
    or not v_constraint_found
    or v_policy.maximum_ledgers_per_claim <> 12
    or v_policy.maximum_billable_egress_bytes_per_ledger <> 4581
    or v_policy.maximum_claim_billable_egress_bytes <> 54972
    or v_policy.maximum_claim_exclusive_reservation_bytes <> 54973
    or v_policy.public_reader_unchanged is not true
    or v_policy.mainnet_disabled is not true
    or v_policy.stabilization_authorized is not false
    or v_policy.soak_authorized is not false
    or position('v_reserved constant bigint := 16777216;' in v_definition) <> 0
    or position('v_reserved bigint := 0;' in v_definition) = 0
    or position(
      'v_reserved := xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(v_count);'
      in v_definition
    ) = 0
    or position(
      'v_reserved := xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(v_count);' || E'\n\n  if v_prior_egress + v_reserved >= v_egress_halt'
      in v_definition
    ) = 0
    or v_constraint_validated is distinct from false then
    raise exception 'r5_revision4_egress_gate_post_state_invalid';
  end if;
end;
$assertion$;
