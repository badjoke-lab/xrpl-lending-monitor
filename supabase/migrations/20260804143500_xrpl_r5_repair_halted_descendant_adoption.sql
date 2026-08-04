alter table xrpl_r5_v1.recovery_batches
  add column if not exists failure_reservation_retained boolean not null default false;

alter table xrpl_r5_v1.recovery_batches
  drop constraint if exists recovery_batches_finalized_egress_upper_bound_bytes_check;

alter table xrpl_r5_v1.recovery_batches
  drop constraint if exists xrpl_r5_recovery_batch_finalized_egress;

alter table xrpl_r5_v1.recovery_batches
  add constraint xrpl_r5_recovery_batch_finalized_egress check (
    (
      failure_reservation_retained is false
      and (
        finalized_egress_upper_bound_bytes is null
        or finalized_egress_upper_bound_bytes between 0 and 33554431
      )
    )
    or (
      failure_reservation_retained is true
      and status = 'completed'
      and origin = 'adopted_active_descendant'
      and finalized_egress_upper_bound_bytes
        = reserved_egress_upper_bound_bytes
      and finalized_egress_upper_bound_bytes = 134217728
    )
  );

create table if not exists xrpl_r5_v1.halted_descendant_repairs (
  run_id text not null references xrpl_r5_v1.recovery_runs(run_id) on delete cascade,
  batch_id text not null,
  schema_version integer not null default 2 check (schema_version = 2),
  source_diagnostic_run_id bigint not null check (source_diagnostic_run_id > 0),
  source_failed_deploy_run_id bigint not null check (source_failed_deploy_run_id > 0),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  prior_batch jsonb not null,
  boundary jsonb not null,
  recovery_watermark_ledger_index bigint not null,
  recovery_watermark_ledger_hash text not null check (
    recovery_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  diagnostic_physical_watermark_ledger_index bigint not null,
  diagnostic_physical_watermark_ledger_hash text not null check (
    diagnostic_physical_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  repaired_physical_watermark_ledger_index bigint not null,
  repaired_physical_watermark_ledger_hash text not null check (
    repaired_physical_watermark_ledger_hash ~ '^[A-F0-9]{64}$'
  ),
  repaired_physical_watermark_work_id text not null,
  boundary_step_count integer not null check (boundary_step_count between 0 and 256),
  repaired_executor_ledger_count integer not null check (
    repaired_executor_ledger_count = 24
  ),
  adopted_descendant_ledger_count bigint not null check (
    adopted_descendant_ledger_count > 0
  ),
  repaired_works_digest text not null check (
    repaired_works_digest ~ '^[a-f0-9]{64}$'
  ),
  repaired_rows_digest text not null check (
    repaired_rows_digest ~ '^[a-f0-9]{64}$'
  ),
  remaining_adoption jsonb not null,
  repaired_at timestamptz not null,
  primary key (run_id, batch_id)
);

revoke all on table xrpl_r5_v1.halted_descendant_repairs
  from public, anon, authenticated;
