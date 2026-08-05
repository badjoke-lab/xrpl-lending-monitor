create table if not exists xrpl_r5_v1.active_phase_claim_guard_changes (
  policy_id text primary key check (
    policy_id = 'r5-active-phase-claim-guard-v1'
  ),
  schema_version integer not null default 1 check (schema_version = 1),
  recovery_run_id text not null check (
    recovery_run_id = 'r5-recovery-selected-revision3-entry'
  ),
  source_claim_cap_verification_run_id bigint not null check (
    source_claim_cap_verification_run_id = 31012179441
  ),
  source_first_drift_run_id bigint not null check (
    source_first_drift_run_id = 31014360049
  ),
  source_second_drift_run_id bigint not null check (
    source_second_drift_run_id = 31015285563
  ),
  source_commit text not null check (
    source_commit = '328395146157988d438295a6777d235d34ea9726'
  ),
  existing_recovery_found boolean not null,
  recovery_status text check (
    recovery_status is null
    or recovery_status in ('prepared', 'running', 'caught_up', 'halted')
  ),
  recovery_watermark_ledger_index bigint,
  physical_watermark_ledger_index bigint,
  watermark_delta bigint,
  boundary jsonb,
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
  applied_at timestamptz not null,
  constraint xrpl_r5_active_phase_claim_guard_existing_state check (
    (
      existing_recovery_found
      and recovery_status is not null
      and recovery_watermark_ledger_index is not null
      and physical_watermark_ledger_index is not null
      and watermark_delta is not null
      and watermark_delta >= 0
      and boundary is not null
    )
    or (
      not existing_recovery_found
      and recovery_status is null
      and recovery_watermark_ledger_index is null
      and physical_watermark_ledger_index is null
      and watermark_delta is null
      and boundary is null
    )
  )
);

revoke all on table xrpl_r5_v1.active_phase_claim_guard_changes
  from public, anon, authenticated;

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_next_phase(text,timestamptz,integer)'
  );
  v_definition text;
  v_patched_definition text;
  v_prior_sha256 text;
  v_patched_sha256 text;
  v_declaration_old_count integer;
  v_declaration_new_count integer;
  v_guard_old_count integer;
  v_guard_new_count integer;
  v_run xrpl_r5_v1.recovery_runs%rowtype;
  v_watermark public.xrpl_phase_watermarks%rowtype;
  v_boundary jsonb;
  v_existing_recovery_found boolean := false;
  v_recovery_status text;
  v_recovery_watermark bigint;
  v_physical_watermark bigint;
  v_delta bigint;
  v_declaration_old constant text := $declaration_old$  v_previous_expiry timestamptz;
begin$declaration_old$;
  v_declaration_new constant text := $declaration_new$  v_previous_expiry timestamptz;
  v_r5 xrpl_r5_v1.recovery_runs%rowtype;
begin$declaration_new$;
  v_guard_old constant text := $guard_old$  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid phase lease duration';
  end if;

  v_epoch := public.xrpl_ensure_remote_seven_class_epoch(p_now);$guard_old$;
  v_guard_new constant text := $guard_new$  if p_lease_seconds < 10 or p_lease_seconds > 55 then
    raise exception 'invalid phase lease duration';
  end if;

  select * into v_r5
  from xrpl_r5_v1.recovery_runs
  where run_id = 'r5-recovery-selected-revision3-entry';

  if found then
    if v_r5.profile_id <> 'supabase_free_postgres_pgcron_edge'
      or v_r5.profile_revision <> 3
      or v_r5.profile_identity_digest
        <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
      or v_r5.selection_digest
        <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
      or v_r5.source_profile_id <> 'supabase-devnet'
      or v_r5.network <> 'devnet'
      or v_r5.epoch_id <> 'supabase-r4c2c-v1'
      or v_r5.status not in ('prepared', 'running', 'caught_up', 'halted') then
      raise exception 'r5_active_recovery_phase_claim_identity_invalid';
    end if;

    return jsonb_build_object(
      'claimed', false,
      'reason', 'r5_active_recovery_owned',
      'r5RunId', v_r5.run_id,
      'r5Status', v_r5.status,
      'r5WatermarkLedgerIndex', v_r5.current_watermark_ledger_index,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'stabilizationAuthorized', false,
      'soakAuthorized', false
    );
  end if;

  v_epoch := public.xrpl_ensure_remote_seven_class_epoch(p_now);$guard_new$;
begin
  if v_signature is null then
    raise exception 'r5_active_phase_claim_guard_function_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('xrpl-r5-active-recovery', 0)
  );

  select * into v_run
  from xrpl_r5_v1.recovery_runs
  where run_id = 'r5-recovery-selected-revision3-entry'
  for update;

  if found then
    v_existing_recovery_found := true;
    if v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'
      or v_run.profile_revision <> 3
      or v_run.profile_identity_digest
        <> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
      or v_run.selection_digest
        <> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
      or v_run.source_profile_id <> 'supabase-devnet'
      or v_run.network <> 'devnet'
      or v_run.epoch_id <> 'supabase-r4c2c-v1'
      or v_run.status <> 'running'
      or v_run.last_error is not null then
      raise exception 'r5_active_phase_claim_guard_recovery_invalid';
    end if;

    lock table public.xrpl_collector_runtime in share row exclusive mode;
    lock table public.xrpl_phase_streams in share row exclusive mode;
    lock table public.xrpl_phase_messages in share row exclusive mode;
    lock table public.xrpl_phase_successors in share row exclusive mode;
    lock table public.xrpl_phase_work in share row exclusive mode;
    lock table public.xrpl_phase_payload_chunks in share row exclusive mode;
    lock table public.xrpl_phase_reference_rows in share row exclusive mode;
    lock table public.xrpl_phase_commit_chunks in share row exclusive mode;
    lock table public.xrpl_phase_watermarks in share row exclusive mode;

    v_boundary := public.xrpl_drain_r5_checkpoint_boundary(
      'r5-install-active-phase-claim-guard',
      clock_timestamp()
    );

    if coalesce((v_boundary->>'drained')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'collectorQuiescent')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'activeStreamHealthy')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'noScanExecuted')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'onePendingScan')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'pendingScanBoundToWatermark')::boolean, false) is not true
      or coalesce((v_boundary->'checks'->>'noInflightWork')::boolean, false) is not true
      or v_boundary->>'sourceProfileId' <> 'supabase-devnet'
      or v_boundary->>'network' <> v_run.network
      or v_boundary->>'epochId' <> v_run.epoch_id
      or v_boundary->>'baseIdentity' <> v_run.base_identity then
      raise exception 'r5_active_phase_claim_guard_boundary_invalid';
    end if;

    select * into v_watermark
    from public.xrpl_phase_watermarks
    where profile_id = 'supabase-devnet';

    if not found
      or v_watermark.network <> v_run.network
      or v_watermark.epoch_id <> v_run.epoch_id
      or v_watermark.base_identity <> v_run.base_identity
      or v_watermark.ledger_index < v_run.current_watermark_ledger_index
      or (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint
        <> v_watermark.ledger_index
      or upper(v_boundary->'watermarkAfter'->>'ledgerHash')
        <> v_watermark.ledger_hash
      or v_boundary->'watermarkAfter'->>'workId' <> v_watermark.work_id then
      raise exception 'r5_active_phase_claim_guard_watermark_invalid';
    end if;

    v_recovery_status := v_run.status;
    v_recovery_watermark := v_run.current_watermark_ledger_index;
    v_physical_watermark := v_watermark.ledger_index;
    v_delta := v_physical_watermark - v_recovery_watermark;
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  v_declaration_old_count := (
    length(v_definition)
      - length(replace(v_definition, v_declaration_old, ''))
  ) / length(v_declaration_old);
  v_declaration_new_count := (
    length(v_definition)
      - length(replace(v_definition, v_declaration_new, ''))
  ) / length(v_declaration_new);
  v_guard_old_count := (
    length(v_definition) - length(replace(v_definition, v_guard_old, ''))
  ) / length(v_guard_old);
  v_guard_new_count := (
    length(v_definition) - length(replace(v_definition, v_guard_new, ''))
  ) / length(v_guard_new);

  if v_declaration_old_count <> 1
    or v_declaration_new_count <> 0
    or v_guard_old_count <> 1
    or v_guard_new_count <> 0 then
    raise exception 'r5_active_phase_claim_guard_source_definition_drift';
  end if;

  v_prior_sha256 := encode(
    extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  );
  v_patched_definition := replace(
    replace(v_definition, v_declaration_old, v_declaration_new),
    v_guard_old,
    v_guard_new
  );

  execute v_patched_definition;

  select pg_get_functiondef(v_signature) into v_patched_definition;

  if position(v_declaration_old in v_patched_definition) <> 0
    or position(v_guard_old in v_patched_definition) <> 0
    or position(v_declaration_new in v_patched_definition) = 0
    or position(v_guard_new in v_patched_definition) = 0 then
    raise exception 'r5_active_phase_claim_guard_patch_verification_failed';
  end if;

  v_patched_sha256 := encode(
    extensions.digest(convert_to(v_patched_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into xrpl_r5_v1.active_phase_claim_guard_changes (
    policy_id,
    recovery_run_id,
    source_claim_cap_verification_run_id,
    source_first_drift_run_id,
    source_second_drift_run_id,
    source_commit,
    existing_recovery_found,
    recovery_status,
    recovery_watermark_ledger_index,
    physical_watermark_ledger_index,
    watermark_delta,
    boundary,
    prior_definition_sha256,
    patched_definition_sha256,
    public_reader_unchanged,
    mainnet_disabled,
    stabilization_authorized,
    soak_authorized,
    applied_at
  ) values (
    'r5-active-phase-claim-guard-v1',
    'r5-recovery-selected-revision3-entry',
    31012179441,
    31014360049,
    31015285563,
    '328395146157988d438295a6777d235d34ea9726',
    v_existing_recovery_found,
    v_recovery_status,
    v_recovery_watermark,
    v_physical_watermark,
    v_delta,
    v_boundary,
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
    'public.xrpl_claim_next_phase(text,timestamptz,integer)'
  );
  v_definition text;
  v_policy xrpl_r5_v1.active_phase_claim_guard_changes%rowtype;
begin
  if v_signature is null then
    raise exception 'r5_active_phase_claim_guard_assertion_function_missing';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  select * into v_policy
  from xrpl_r5_v1.active_phase_claim_guard_changes
  where policy_id = 'r5-active-phase-claim-guard-v1';

  if not found
    or position('r5_active_recovery_owned' in v_definition) = 0
    or position('r5_active_recovery_phase_claim_identity_invalid' in v_definition) = 0
    or position($status_guard$v_r5.status not in ('prepared', 'running', 'caught_up', 'halted')$status_guard$ in v_definition) = 0
    or v_policy.source_first_drift_run_id <> 31014360049
    or v_policy.source_second_drift_run_id <> 31015285563
    or v_policy.public_reader_unchanged is not true
    or v_policy.mainnet_disabled is not true
    or v_policy.stabilization_authorized is not false
    or v_policy.soak_authorized is not false then
    raise exception 'r5_active_phase_claim_guard_post_state_invalid';
  end if;
end;
$assertion$;
