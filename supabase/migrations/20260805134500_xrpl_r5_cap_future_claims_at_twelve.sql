create table if not exists xrpl_r5_v1.batch_claim_policy_changes (
  policy_id text primary key check (policy_id = 'r5-claim-cap-12-v1'),
  schema_version integer not null default 1 check (schema_version = 1),
  profile_id text not null check (
    profile_id = 'supabase_free_postgres_pgcron_edge'
  ),
  profile_revision integer not null check (profile_revision = 3),
  nominal_batch_size integer not null check (nominal_batch_size = 24),
  prior_claim_cap integer not null check (prior_claim_cap = 24),
  claim_cap integer not null check (claim_cap = 12),
  source_memory_halt_run_id bigint not null check (
    source_memory_halt_run_id = 30987685290
  ),
  source_watermark_drift_run_id bigint not null check (
    source_watermark_drift_run_id = 30991245747
  ),
  source_adoption_verification_run_id bigint not null check (
    source_adoption_verification_run_id = 30992583324
  ),
  source_commit text not null check (
    source_commit = '52ebc396f7c5217ae06e595aabe2053440f1076a'
  ),
  prior_assignment text not null,
  patched_assignment text not null,
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

revoke all on table xrpl_r5_v1.batch_claim_policy_changes
  from public, anon, authenticated;

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamptz,integer)'
  );
  v_definition text;
  v_patched_definition text;
  v_prior_sha256 text;
  v_patched_sha256 text;
  v_old_count integer;
  v_new_count integer;
  v_active_batch_count bigint;
  v_old constant text :=
    'v_count := least(24::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;';
  v_new constant text :=
    'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;';
begin
  if v_signature is null then
    raise exception 'r5_twelve_ledger_claim_cap_function_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('xrpl-r5-active-recovery', 0)
  );

  select count(*)::bigint
  into v_active_batch_count
  from xrpl_r5_v1.recovery_runs run
  join xrpl_r5_v1.recovery_batches batch on batch.run_id = run.run_id
  where run.status in ('prepared', 'running')
    and batch.status in ('leased', 'halted');

  if v_active_batch_count <> 0 then
    raise exception 'r5_twelve_ledger_claim_cap_active_batch_present';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  v_old_count := (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old);
  v_new_count := (
    length(v_definition) - length(replace(v_definition, v_new, ''))
  ) / length(v_new);

  if v_old_count <> 1 or v_new_count <> 0 then
    raise exception 'r5_twelve_ledger_claim_cap_source_definition_drift';
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

  if v_old_count <> 0 or v_new_count <> 1 then
    raise exception 'r5_twelve_ledger_claim_cap_patch_verification_failed';
  end if;

  v_patched_sha256 := encode(
    extensions.digest(convert_to(v_patched_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into xrpl_r5_v1.batch_claim_policy_changes (
    policy_id,
    profile_id,
    profile_revision,
    nominal_batch_size,
    prior_claim_cap,
    claim_cap,
    source_memory_halt_run_id,
    source_watermark_drift_run_id,
    source_adoption_verification_run_id,
    source_commit,
    prior_assignment,
    patched_assignment,
    prior_definition_sha256,
    patched_definition_sha256,
    public_reader_unchanged,
    mainnet_disabled,
    stabilization_authorized,
    soak_authorized,
    applied_at
  ) values (
    'r5-claim-cap-12-v1',
    'supabase_free_postgres_pgcron_edge',
    3,
    24,
    24,
    12,
    30987685290,
    30991245747,
    30992583324,
    '52ebc396f7c5217ae06e595aabe2053440f1076a',
    v_old,
    v_new,
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
    'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamptz,integer)'
  );
  v_definition text;
  v_policy xrpl_r5_v1.batch_claim_policy_changes%rowtype;
  v_old constant text :=
    'v_count := least(24::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;';
  v_new constant text :=
    'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;';
begin
  if v_signature is null then
    raise exception 'r5_twelve_ledger_claim_cap_assertion_function_missing';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  select * into v_policy
  from xrpl_r5_v1.batch_claim_policy_changes
  where policy_id = 'r5-claim-cap-12-v1';

  if not found
    or position(v_old in v_definition) <> 0
    or position(v_new in v_definition) = 0
    or v_policy.nominal_batch_size <> 24
    or v_policy.prior_claim_cap <> 24
    or v_policy.claim_cap <> 12
    or v_policy.prior_assignment <> v_old
    or v_policy.patched_assignment <> v_new
    or v_policy.public_reader_unchanged is not true
    or v_policy.mainnet_disabled is not true
    or v_policy.stabilization_authorized is not false
    or v_policy.soak_authorized is not false then
    raise exception 'r5_twelve_ledger_claim_cap_post_state_invalid';
  end if;
end;
$assertion$;
