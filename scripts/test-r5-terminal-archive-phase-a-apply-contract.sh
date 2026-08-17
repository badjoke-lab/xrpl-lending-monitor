#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-terminal-archive-phase-a-apply.yml'
manager='scripts/manage-r5-terminal-archive-production-apply.mjs'
policy='scripts/extend-actions-policy-r5-terminal-archive-phase-a-apply.py'

required_paths=(
  "$workflow"
  "$manager"
  "$policy"
  'ops/production-sql/20260816183000_xrpl_phase_terminal_archive_contract.sql'
  'ops/production-sql/20260816190000_xrpl_phase_terminal_archive_window.sql'
  'ops/production-sql/20260816193000_xrpl_r5_revision4_terminal_archive_completion_patch.sql'
  'ops/production-sql/20260816200000_xrpl_phase_terminal_archive_core_compat_patch.sql'
  'ops/production-sql/20260816201000_xrpl_r5_revision4_archive_prepare_compat_patch.sql'
)
for path in "${required_paths[@]}"; do
  test -f "$path" || { echo "missing required Phase A file: $path" >&2; exit 1; }
done

node --check "$manager"
python -m py_compile "$policy"

required_workflow=(
  "github.event.issue.number == 1261"
  "github.event.comment.user.login == 'badjoke-lab'"
  "github.event.comment.body == '/r5-terminal-archive-phase-a-prepare'"
  "startsWith(github.event.comment.body, '/r5-terminal-archive-phase-a-authorize ')"
  "MANAGER_PATH: scripts/manage-r5-terminal-archive-production-apply.mjs"
  'node "$MANAGER_PATH" prepare'
  'Exact five-file plan digest'
  'Current production migration head'
  'terminal transport backfill'
  'physical rewrite/compaction'
  'R5 rearm'
  'archiveRowsAfter'
  'canonicalHistoryRowMutationPerformed'
  'terminalTransportBackfillPerformed'
  'terminalTransportDeletionPerformed'
  'physicalCompactionPerformed'
  'schedulerMutationPerformed'
  'publicReaderMutationPerformed'
)
for fragment in "${required_workflow[@]}"; do
  grep -Fq -- "$fragment" "$workflow" || { echo "workflow missing Phase A contract fragment: $fragment" >&2; exit 1; }
done

required_manager=(
  "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'"
  "const INTERNAL_DB_HALT = 400_000_000"
  "20260816183000_xrpl_phase_terminal_archive_contract.sql"
  "20260816190000_xrpl_phase_terminal_archive_window.sql"
  "20260816193000_xrpl_r5_revision4_terminal_archive_completion_patch.sql"
  "20260816200000_xrpl_phase_terminal_archive_core_compat_patch.sql"
  "20260816201000_xrpl_r5_revision4_archive_prepare_compat_patch.sql"
  'read_only: readOnly'
  'planDigestSha256'
  'structuralStateSha256'
  'unapplied_expected'
  'applied_consistent'
  'R5 successor is not database-guard halted'
  'database_claim_allowed'
  'r5_recovery_database_halt'
  'lock table public.xrpl_phase_messages in share mode;'
  'lock table public.xrpl_phase_successors in share mode;'
  'lock table public.xrpl_phase_work in share mode;'
  'lock table public.xrpl_phase_reference_rows in share mode;'
  'canonical transport/history row counts changed during Phase A'
  'R5 halted run state changed during Phase A'
  'scheduler state changed during Phase A'
  'production migration head changed during Phase A'
  'archiveSecurity.rows'
  'canonicalHistoryRowMutationPerformed: false'
  'terminalTransportBackfillPerformed: false'
  'terminalTransportDeletionPerformed: false'
  'physicalCompactionPerformed: false'
  'vacuumPerformed: false'
  'schedulerMutationPerformed: false'
  'deploymentPerformed: false'
  'publicReaderMutationPerformed: false'
  'mainnetDisabled: true'
  'stabilizationAuthorized: false'
  'soakAuthorized: false'
  'r5RearmAuthorized: false'
  "command === 'prepare'"
  "command === 'apply'"
)
for fragment in "${required_manager[@]}"; do
  grep -Fq -- "$fragment" "$manager" || { echo "manager missing Phase A contract fragment: $fragment" >&2; exit 1; }
done

for forbidden in \
  '  push:' \
  '  schedule:' \
  'workflow_dispatch' \
  'pull_request_target' \
  'contents: write' \
  'supabase functions deploy' \
  'supabase db push' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy' \
  "MAINNET_ENABLED: 'true'"; do
  if grep -Fq -- "$forbidden" "$workflow"; then
    echo "workflow contains forbidden Phase A capability: $forbidden" >&2
    exit 1
  fi
done

for forbidden in \
  'supabase functions deploy' \
  'supabase db push' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy'; do
  if grep -Fq -- "$forbidden" "$manager"; then
    echo "manager contains forbidden Phase A capability: $forbidden" >&2
    exit 1
  fi
done

prepare_count="$(grep -Fc "github.event.comment.body == '/r5-terminal-archive-phase-a-prepare'" "$workflow")"
authorize_count="$(grep -Fc "startsWith(github.event.comment.body, '/r5-terminal-archive-phase-a-authorize ')" "$workflow")"
test "$prepare_count" = 1
test "$authorize_count" = 1

echo 'R5 terminal archive Phase A formal apply contract: PASS'
