create table if not exists xrpl_r5_v1.atomic_running_preclaim_policy_changes (
  policy_id text primary key check (
    policy_id = 'r5-atomic-running-preclaim-boundary-v1'
  ),
  schema_version integer not null default 1 check (schema_version = 1),
  source_recovery_run_id text not null check (
    source_recovery_run_id = 'r5-recovery-selected-revision3-entry'
  ),
  source_failed_burst_run_id bigint not null check (
    source_failed_burst_run_id = 31021223140
  ),
  source_diagnostic_run_id bigint not null check (
    source_diagnostic_run_id = 31027674759
  ),
  source_failed_migration_run_id bigint not null check (
    source_failed_migration_run_id = 31029262492
  ),
  source_commit text not null check (
    source_commit = '08e8a35656e9870bfa7aee6eb9dad3d1668b7ad2'
  ),
  source_production_definition_sha256 text not null check (
    source_production_definition_sha256 =
      '4bc44edfecfa5575f11c6821662c74a464237a3f554bc7516e684cc5eb1a7311'
  ),
  minimum_observed_recovery_watermark bigint not null check (
    minimum_observed_recovery_watermark = 4138667
  ),
  observed_recovery_watermark bigint check (
    observed_recovery_watermark is null
    or observed_recovery_watermark >= minimum_observed_recovery_watermark
  ),
  observed_physical_watermark bigint check (
    observed_physical_watermark is null
    or observed_physical_watermark >= minimum_observed_recovery_watermark
  ),
  observed_physical_gap bigint check (
    observed_physical_gap is null
    or observed_physical_gap between 0 and 256
  ),
  prior_definition_sha256 text not null check (
    prior_definition_sha256 ~ '^[a-f0-9]{64}$'
  ),
  patched_definition_sha256 text not null check (
    patched_definition_sha256 ~ '^[a-f0-9]{64}$'
  ),
  stable_claim_anchor_insertion boolean not null check (
    stable_claim_anchor_insertion
  ),
  atomic_drain_adoption_before_claim boolean not null check (
    atomic_drain_adoption_before_claim
  ),
  pending_scan_lock_held_through_claim boolean not null check (
    pending_scan_lock_held_through_claim
  ),
  twelve_ledger_claim_cap_retained boolean not null check (
    twelve_ledger_claim_cap_retained
  ),
  database_halt_bytes bigint not null check (
    database_halt_bytes = 400000000
  ),
  public_reader_unchanged boolean not null check (public_reader_unchanged),
  mainnet_disabled boolean not null check (mainnet_disabled),
  stabilization_authorized boolean not null check (not stabilization_authorized),
  soak_authorized boolean not null check (not soak_authorized),
  applied_at timestamptz not null
);

revoke all on table xrpl_r5_v1.atomic_running_preclaim_policy_changes
  from public, anon, authenticated;

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'
  );
  v_base_claim_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
  );
  v_definition text;
  v_patched_definition text;
  v_base_claim_definition text;
  v_prior_sha256 text;
  v_patched_sha256 text;
  v_old_declaration_count integer;
  v_new_declaration_count integer;
  v_claim_anchor_count integer;
  v_atomic_marker_count integer;
  v_active_batch_count bigint;
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_observed_recovery_watermark bigint;
  v_observed_physical_watermark bigint;
  v_observed_physical_gap bigint;
  v_old_declaration constant text :=
    E'  v_rebind jsonb;\n  v_claim jsonb;';
  v_new_declaration constant text :=
    E'  v_rebind jsonb;\n  v_preclaim_adoption jsonb;\n  v_claim jsonb;';
  v_claim_anchor constant text :=
    E'  v_claim := public.xrpl_claim_r5_active_recovery_batch(\n';
  v_atomic_marker constant text := 'atomicBoundaryHeldThroughClaim';
  v_atomic_block constant text := E'  if v_run.status = ''running'' then\n    v_preclaim_adoption := public.xrpl_adopt_r5_committed_active_descendants(\n      p_run_id,\n      p_now\n    );\n\n    if coalesce((v_preclaim_adoption->>''adopted'')::boolean, false) is not true\n      and v_preclaim_adoption->>''reason'' <> ''active_boundary_already_equal'' then\n      raise exception ''r5_recovery_atomic_preclaim_adoption_invalid'';\n    end if;\n\n    select * into v_run\n    from xrpl_r5_v1.recovery_runs\n    where run_id = p_run_id\n    for update;\n\n    if not found\n      or v_run.status <> ''running''\n      or v_run.completed_batches < 1\n      or v_run.committed_ledgers < 1\n      or v_run.last_accounting_digest is null\n      or v_run.last_error is not null\n      or v_run.started_at is null\n      or v_run.completed_at is not null then\n      raise exception ''r5_recovery_atomic_preclaim_run_invalid'';\n    end if;\n\n    v_rebind := jsonb_build_object(\n      ''rebound'', false,\n      ''reason'', ''atomic_running_preclaim_boundary'',\n      ''runId'', v_run.run_id,\n      ''completedBatches'', v_run.completed_batches,\n      ''committedLedgers'', v_run.committed_ledgers,\n      ''watermarkLedgerIndex'', v_run.current_watermark_ledger_index,\n      ''watermarkLedgerHash'', v_run.current_watermark_ledger_hash,\n      ''watermarkWorkId'', v_run.current_watermark_work_id,\n      ''preclaimAdoption'', v_preclaim_adoption,\n      ''atomicBoundaryHeldThroughClaim'', true,\n      ''pendingScanLockHeldThroughClaim'', true,\n      ''noScanExecutedBeforeClaim'', true\n    );\n  end if;\n\n';
begin
  if v_signature is null or v_base_claim_signature is null then
    raise exception 'r5_atomic_preclaim_function_missing';
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
      or v_run.profile_identity_digest
        <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
      or v_run.selection_digest
        <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
      or v_run.source_profile_id <> 'supabase-devnet'
      or v_run.network <> 'devnet'
      or v_run.epoch_id <> 'supabase-r4c2c-v1'
      or v_run.batch_size <> 24
      or v_run.current_watermark_ledger_index < 4138667
      or v_run.completed_batches < 1
      or v_run.committed_ledgers < 1
      or v_run.last_accounting_digest is null
      or v_run.last_error is not null
      or v_run.started_at is null
      or v_run.completed_at is not null
      or v_watermark.network <> v_run.network
      or v_watermark.epoch_id <> v_run.epoch_id
      or v_watermark.base_identity <> v_run.base_identity then
      raise exception 'r5_atomic_preclaim_production_state_invalid';
    end if;

    v_observed_recovery_watermark := v_run.current_watermark_ledger_index;
    v_observed_physical_watermark := v_watermark.ledger_index;
    v_observed_physical_gap :=
      v_watermark.ledger_index - v_run.current_watermark_ledger_index;

    if v_observed_physical_gap < 0 or v_observed_physical_gap > 256 then
      raise exception 'r5_atomic_preclaim_physical_gap_invalid';
    end if;

    select count(*)::bigint
    into v_active_batch_count
    from xrpl_r5_v1.recovery_batches
    where run_id = v_run.run_id
      and status in ('leased', 'halted');

    if v_active_batch_count <> 0 then
      raise exception 'r5_atomic_preclaim_active_batch_present';
    end if;
  else
    v_observed_recovery_watermark := null;
    v_observed_physical_watermark := null;
    v_observed_physical_gap := null;
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  select pg_get_functiondef(v_base_claim_signature)
  into v_base_claim_definition;

  v_prior_sha256 := encode(
    extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_observed_recovery_watermark is not null
    and v_prior_sha256 <>
      '4bc44edfecfa5575f11c6821662c74a464237a3f554bc7516e684cc5eb1a7311' then
    raise exception 'r5_atomic_preclaim_production_definition_digest_drift';
  end if;

  v_old_declaration_count := (
    length(v_definition)
      - length(replace(v_definition, v_old_declaration, ''))
  ) / length(v_old_declaration);
  v_new_declaration_count := (
    length(v_definition)
      - length(replace(v_definition, v_new_declaration, ''))
  ) / length(v_new_declaration);
  v_claim_anchor_count := (
    length(v_definition)
      - length(replace(v_definition, v_claim_anchor, ''))
  ) / length(v_claim_anchor);
  v_atomic_marker_count := (
    length(v_definition)
      - length(replace(v_definition, v_atomic_marker, ''))
  ) / length(v_atomic_marker);

  if v_old_declaration_count <> 1
    or v_new_declaration_count <> 0
    or v_claim_anchor_count <> 1
    or v_atomic_marker_count <> 0
    or position(
      'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;'
      in v_base_claim_definition
    ) = 0 then
    raise exception 'r5_atomic_preclaim_source_definition_drift';
  end if;

  v_patched_definition := replace(
    replace(v_definition, v_old_declaration, v_new_declaration),
    v_claim_anchor,
    v_atomic_block || v_claim_anchor
  );

  if position(v_old_declaration in v_patched_definition) <> 0
    or position(v_new_declaration in v_patched_definition) = 0
    or position(v_atomic_marker in v_patched_definition) = 0
    or position(
      'v_preclaim_adoption := public.xrpl_adopt_r5_committed_active_descendants('
      in v_patched_definition
    ) = 0
    or position(
      'v_preclaim_adoption := public.xrpl_adopt_r5_committed_active_descendants('
      in v_patched_definition
    ) > position(v_claim_anchor in v_patched_definition) then
    raise exception 'r5_atomic_preclaim_patch_order_invalid';
  end if;

  execute v_patched_definition;

  select pg_get_functiondef(v_signature) into v_patched_definition;
  v_old_declaration_count := (
    length(v_patched_definition)
      - length(replace(v_patched_definition, v_old_declaration, ''))
  ) / length(v_old_declaration);
  v_new_declaration_count := (
    length(v_patched_definition)
      - length(replace(v_patched_definition, v_new_declaration, ''))
  ) / length(v_new_declaration);
  v_claim_anchor_count := (
    length(v_patched_definition)
      - length(replace(v_patched_definition, v_claim_anchor, ''))
  ) / length(v_claim_anchor);
  v_atomic_marker_count := (
    length(v_patched_definition)
      - length(replace(v_patched_definition, v_atomic_marker, ''))
  ) / length(v_atomic_marker);

  if v_old_declaration_count <> 0
    or v_new_declaration_count <> 1
    or v_claim_anchor_count <> 1
    or v_atomic_marker_count <> 1
    or position(
      'v_preclaim_adoption := public.xrpl_adopt_r5_committed_active_descendants('
      in v_patched_definition
    ) > position(v_claim_anchor in v_patched_definition)
    or position('pendingScanLockHeldThroughClaim' in v_patched_definition) = 0
    or position('noScanExecutedBeforeClaim' in v_patched_definition) = 0 then
    raise exception 'r5_atomic_preclaim_patch_verification_failed';
  end if;

  v_patched_sha256 := encode(
    extensions.digest(convert_to(v_patched_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into xrpl_r5_v1.atomic_running_preclaim_policy_changes (
    policy_id,
    source_recovery_run_id,
    source_failed_burst_run_id,
    source_diagnostic_run_id,
    source_failed_migration_run_id,
    source_commit,
    source_production_definition_sha256,
    minimum_observed_recovery_watermark,
    observed_recovery_watermark,
    observed_physical_watermark,
    observed_physical_gap,
    prior_definition_sha256,
    patched_definition_sha256,
    stable_claim_anchor_insertion,
    atomic_drain_adoption_before_claim,
    pending_scan_lock_held_through_claim,
    twelve_ledger_claim_cap_retained,
    database_halt_bytes,
    public_reader_unchanged,
    mainnet_disabled,
    stabilization_authorized,
    soak_authorized,
    applied_at
  ) values (
    'r5-atomic-running-preclaim-boundary-v1',
    'r5-recovery-selected-revision3-entry',
    31021223140,
    31027674759,
    31029262492,
    '08e8a35656e9870bfa7aee6eb9dad3d1668b7ad2',
    '4bc44edfecfa5575f11c6821662c74a464237a3f554bc7516e684cc5eb1a7311',
    4138667,
    v_observed_recovery_watermark,
    v_observed_physical_watermark,
    v_observed_physical_gap,
    v_prior_sha256,
    v_patched_sha256,
    true,
    true,
    true,
    true,
    400000000,
    true,
    true,
    false,
    false,
    clock_timestamp()
  );
end;
$migration$;

revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) from public, anon, authenticated;

grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text, text, timestamptz, integer
) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text, text, timestamptz, integer) to supabase_admin';
  end if;
end;
$$;

do $assertion$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'
  );
  v_base_claim_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
  );
  v_definition text;
  v_base_claim_definition text;
  v_policy xrpl_r5_v1.atomic_running_preclaim_policy_changes%rowtype;
  v_adoption_position integer;
  v_claim_position integer;
begin
  if v_signature is null or v_base_claim_signature is null then
    raise exception 'r5_atomic_preclaim_assertion_function_missing';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  select pg_get_functiondef(v_base_claim_signature)
  into v_base_claim_definition;
  select * into v_policy
  from xrpl_r5_v1.atomic_running_preclaim_policy_changes
  where policy_id = 'r5-atomic-running-preclaim-boundary-v1';

  v_adoption_position := position(
    'v_preclaim_adoption := public.xrpl_adopt_r5_committed_active_descendants('
    in v_definition
  );
  v_claim_position := position(
    'v_claim := public.xrpl_claim_r5_active_recovery_batch('
    in v_definition
  );

  if not found
    or v_adoption_position = 0
    or v_claim_position = 0
    or v_adoption_position >= v_claim_position
    or position('atomicBoundaryHeldThroughClaim' in v_definition) = 0
    or position('pendingScanLockHeldThroughClaim' in v_definition) = 0
    or position('noScanExecutedBeforeClaim' in v_definition) = 0
    or position(
      'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;'
      in v_base_claim_definition
    ) = 0
    or v_policy.stable_claim_anchor_insertion is not true
    or v_policy.atomic_drain_adoption_before_claim is not true
    or v_policy.pending_scan_lock_held_through_claim is not true
    or v_policy.twelve_ledger_claim_cap_retained is not true
    or v_policy.database_halt_bytes <> 400000000
    or v_policy.public_reader_unchanged is not true
    or v_policy.mainnet_disabled is not true
    or v_policy.stabilization_authorized is not false
    or v_policy.soak_authorized is not false then
    raise exception 'r5_atomic_preclaim_post_state_invalid';
  end if;
end;
$assertion$;
