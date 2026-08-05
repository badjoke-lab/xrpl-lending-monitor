create table if not exists xrpl_r5_v1.finalization_initial_gap_policy_changes (
  policy_id text primary key check (
    policy_id = 'r5-finalization-initial-gap-256-v1'
  ),
  schema_version integer not null default 1 check (schema_version = 1),
  prior_initial_gap_bound integer not null check (
    prior_initial_gap_bound = 24
  ),
  initial_gap_bound integer not null check (initial_gap_bound = 256),
  drain_advance_bound integer not null check (drain_advance_bound = 24),
  source_recovery_run_id text not null check (
    source_recovery_run_id = 'r5-recovery-selected-revision3-entry'
  ),
  source_recovery_watermark_ledger_index bigint not null check (
    source_recovery_watermark_ledger_index = 4138491
  ),
  source_finalization_failure_run_id bigint not null check (
    source_finalization_failure_run_id = 31018077125
  ),
  source_claim_cap_verification_run_id bigint not null check (
    source_claim_cap_verification_run_id = 31012179441
  ),
  source_commit text not null check (
    source_commit = '2e6e7ca71784c9402cced7f0d21eecd86d5e99ef'
  ),
  observed_production_gap bigint check (
    observed_production_gap is null
    or observed_production_gap between 25 and 256
  ),
  prior_definition_sha256 text not null check (
    prior_definition_sha256 ~ '^[a-f0-9]{64}$'
  ),
  patched_definition_sha256 text not null check (
    patched_definition_sha256 ~ '^[a-f0-9]{64}$'
  ),
  public_reader_unchanged boolean not null check (public_reader_unchanged),
  mainnet_disabled boolean not null check (mainnet_disabled),
  stabilization_authorized boolean not null check (not stabilization_authorized),
  soak_authorized boolean not null check (not soak_authorized),
  applied_at timestamptz not null
);

revoke all on table xrpl_r5_v1.finalization_initial_gap_policy_changes
  from public, anon, authenticated;

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_finalize_r5_recovery_burst_boundary(text,bigint,text,timestamptz)'
  );
  v_definition text;
  v_patched_definition text;
  v_prior_sha256 text;
  v_patched_sha256 text;
  v_old_count integer;
  v_new_count integer;
  v_active_batch_count bigint;
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_observed_gap bigint;
  v_old constant text :=
    E'or v_watermark_before.ledger_index\n      > v_run_before.current_watermark_ledger_index + 24 then';
  v_new constant text :=
    E'or v_watermark_before.ledger_index\n      > v_run_before.current_watermark_ledger_index + 256 then';
  v_retained_drain_bound constant text :=
    E'or (v_boundary->''watermarkAfter''->>''ledgerIndex'')::bigint\n      > v_watermark_before.ledger_index + 24 then';
  v_retained_final_bound constant text :=
    'or v_watermark_after.ledger_index > v_watermark_before.ledger_index + 24';
begin
  if v_signature is null then
    raise exception 'r5_finalization_initial_gap_function_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('xrpl-r5-active-recovery', 0)
  );

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = 'r5-recovery-selected-revision3-entry'
  for update;

  if found then
    select * into v_watermark
    from public.xrpl_phase_watermarks
    where profile_id = 'supabase-devnet';

    if not found
      or v_run.status <> 'running'
      or v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
      or v_run.profile_revision <> 3
      or v_run.source_profile_id <> 'supabase-devnet'
      or v_run.network <> 'devnet'
      or v_run.epoch_id <> 'supabase-r4c2c-v1'
      or v_run.current_watermark_ledger_index <> 4138491
      or v_run.last_error is not null
      or v_run.completed_at is not null
      or v_watermark.network <> v_run.network
      or v_watermark.epoch_id <> v_run.epoch_id
      or v_watermark.base_identity <> v_run.base_identity then
      raise exception 'r5_finalization_initial_gap_production_state_invalid';
    end if;

    v_observed_gap :=
      v_watermark.ledger_index - v_run.current_watermark_ledger_index;

    if v_observed_gap < 25 or v_observed_gap > 256 then
      raise exception 'r5_finalization_initial_gap_outside_bounded_repair';
    end if;

    select count(*)::bigint
    into v_active_batch_count
    from xrpl_r5_v1.recovery_batches
    where run_id = v_run.run_id
      and status in ('leased', 'halted');

    if v_active_batch_count <> 0 then
      raise exception 'r5_finalization_initial_gap_active_batch_present';
    end if;
  else
    v_observed_gap := null;
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  v_old_count := (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old);
  v_new_count := (
    length(v_definition) - length(replace(v_definition, v_new, ''))
  ) / length(v_new);

  if v_old_count <> 1
    or v_new_count <> 0
    or position(v_retained_drain_bound in v_definition) = 0
    or position(v_retained_final_bound in v_definition) = 0 then
    raise exception 'r5_finalization_initial_gap_source_definition_drift';
  end if;

  v_prior_sha256 := encode(
    extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  );
  v_patched_definition := replace(v_definition, v_old, v_new);
  execute v_patched_definition;

  select pg_get_functiondef(v_signature) into v_patched_definition;
  v_old_count := (
    length(v_patched_definition)
      - length(replace(v_patched_definition, v_old, ''))
  ) / length(v_old);
  v_new_count := (
    length(v_patched_definition)
      - length(replace(v_patched_definition, v_new, ''))
  ) / length(v_new);

  if v_old_count <> 0
    or v_new_count <> 1
    or position(v_retained_drain_bound in v_patched_definition) = 0
    or position(v_retained_final_bound in v_patched_definition) = 0 then
    raise exception 'r5_finalization_initial_gap_patch_verification_failed';
  end if;

  v_patched_sha256 := encode(
    extensions.digest(convert_to(v_patched_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into xrpl_r5_v1.finalization_initial_gap_policy_changes (
    policy_id,
    prior_initial_gap_bound,
    initial_gap_bound,
    drain_advance_bound,
    source_recovery_run_id,
    source_recovery_watermark_ledger_index,
    source_finalization_failure_run_id,
    source_claim_cap_verification_run_id,
    source_commit,
    observed_production_gap,
    prior_definition_sha256,
    patched_definition_sha256,
    public_reader_unchanged,
    mainnet_disabled,
    stabilization_authorized,
    soak_authorized,
    applied_at
  ) values (
    'r5-finalization-initial-gap-256-v1',
    24,
    256,
    24,
    'r5-recovery-selected-revision3-entry',
    4138491,
    31018077125,
    31012179441,
    '2e6e7ca71784c9402cced7f0d21eecd86d5e99ef',
    v_observed_gap,
    v_prior_sha256,
    v_patched_sha256,
    true,
    true,
    false,
    false,
    clock_timestamp()
  );
end;
$migration$;

do $assertion$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_finalize_r5_recovery_burst_boundary(text,bigint,text,timestamptz)'
  );
  v_definition text;
  v_policy xrpl_r5_v1.finalization_initial_gap_policy_changes%rowtype;
  v_new constant text :=
    E'or v_watermark_before.ledger_index\n      > v_run_before.current_watermark_ledger_index + 256 then';
  v_retained_drain_bound constant text :=
    E'or (v_boundary->''watermarkAfter''->>''ledgerIndex'')::bigint\n      > v_watermark_before.ledger_index + 24 then';
  v_retained_final_bound constant text :=
    'or v_watermark_after.ledger_index > v_watermark_before.ledger_index + 24';
begin
  if v_signature is null then
    raise exception 'r5_finalization_initial_gap_assertion_function_missing';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  select * into v_policy
  from xrpl_r5_v1.finalization_initial_gap_policy_changes
  where policy_id = 'r5-finalization-initial-gap-256-v1';

  if not found
    or position(v_new in v_definition) = 0
    or position(v_retained_drain_bound in v_definition) = 0
    or position(v_retained_final_bound in v_definition) = 0
    or v_policy.prior_initial_gap_bound <> 24
    or v_policy.initial_gap_bound <> 256
    or v_policy.drain_advance_bound <> 24
    or v_policy.public_reader_unchanged is not true
    or v_policy.mainnet_disabled is not true
    or v_policy.stabilization_authorized is not false
    or v_policy.soak_authorized is not false then
    raise exception 'r5_finalization_initial_gap_post_state_invalid';
  end if;
end;
$assertion$;
