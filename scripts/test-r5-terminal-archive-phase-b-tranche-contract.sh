#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-terminal-archive-phase-b-tranche.yml'
manager='scripts/manage-r5-terminal-archive-phase-b-tranche.mjs'
extender='scripts/extend-actions-policy-r5-terminal-archive-phase-b-tranche.py'
checkpoint='ops/production-sql/20260817110500_xrpl_r5_checkpoint_terminal_archive_fail_close.sql'
microsecond_test='scripts/test-r5-phase-b-microsecond-identity-postgres.sh'

for file in "$workflow" "$manager" "$extender" "$checkpoint" "$microsecond_test"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
done

node --check "$manager"
python -m py_compile "$extender"
bash -n "$microsecond_test"

for required in \
  "github.event.comment.body == '/r5-terminal-archive-phase-b-prepare'" \
  "startsWith(github.event.comment.body, '/r5-terminal-archive-phase-b-authorize ')" \
  'Exact candidate tranche SHA-256' \
  'at most 250' \
  '2,000,000 logical bytes' \
  'legacy full-history checkpoint' \
  'This authorization is exhausted by this one tranche' \
  'physical compaction / VACUUM / REINDEX' \
  'r5Rearmed'; do
  grep -Fq "$required" "$workflow"
done

for forbidden in 'workflow_dispatch' 'pull_request_target' '  push:' '  schedule:' 'contents: write' 'wrangler deploy' 'supabase db push' "MAINNET_ENABLED: 'true'"; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "Phase B workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

for required in \
  "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'" \
  "const PROFILE_ID = 'supabase-devnet'" \
  'const MINIMUM_AGE_HOURS = 24' \
  'const TRANCHE_LIMIT = 250' \
  'const TRANCHE_LOGICAL_BYTE_LIMIT = 2_000_000' \
  'PG_IDENTITY_TIMESTAMP_PATTERN' \
  "to_char(created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" \
  "to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" \
  "normalizeIdentityTimestamp(raw.createdAt, 'createdAt')" \
  "normalizeIdentityTimestamp(raw.completedAt, 'completedAt')" \
  "normalizeIdentityTimestamp(raw.completedAt, 'archived completedAt')" \
  'candidateDigestSha256' \
  'structuralStateSha256' \
  'selectedLogicalBytes' \
  "pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b', 0))" \
  "pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0))" \
  'authorized Phase B candidate identity drifted' \
  'terminalize_message' \
  'terminalTransportArchiveDeletePerformed: true' \
  'canonicalWorkReferenceHistoryMutationPerformed: false' \
  'physicalCompactionPerformed: false' \
  'vacuumPerformed: false' \
  'reindexPerformed: false' \
  'schedulerMutationPerformed: false' \
  'deploymentPerformed: false' \
  'publicReaderMutationPerformed: false' \
  'mainnetDisabled: true' \
  'stabilizationPerformed: false' \
  'soakPerformed: false' \
  'r5Rearmed: false'; do
  grep -Fq "$required" "$manager"
done

if grep -Fq 'createdAt: new Date(raw.createdAt).toISOString()' "$manager" || \
   grep -Fq 'completedAt: new Date(raw.completedAt).toISOString()' "$manager"; then
  echo 'Phase B manager still truncates PostgreSQL candidate identity timestamps through JavaScript Date' >&2
  exit 1
fi

# The only direct row-deletion capability must remain encapsulated in the already-installed
# private terminalizer. The Phase B manager itself must never emit raw DELETE/TRUNCATE/VACUUM/
# REINDEX statements or scheduler/deployment commands.
if grep -Eiq '\b(delete[[:space:]]+from|truncate|vacuum[[:space:]]|reindex[[:space:]]|cron\.schedule|cron\.unschedule|wrangler[[:space:]]+deploy|supabase[[:space:]]+db[[:space:]]+push)\b' "$manager"; then
  echo 'Phase B manager contains forbidden direct mutation capability' >&2
  exit 1
fi

# The checkpoint patch is exact-definition-bound and must remain the first semantic mutation
# before any authorized terminalizer call inside the assembled transaction.
python - "$manager" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
checkpoint = text.index('-- BEGIN EXACT CHECKPOINT FREEZE FILE')
guard = text.index('candidateGuardSql(candidates)', checkpoint)
terminalize = text.index('terminalizeSql(candidates)', guard)
if not checkpoint < guard < terminalize:
    raise SystemExit('Phase B transaction ordering drifted')
if "if (archiveRows > 0 && checkpoint.classification !== 'frozen_exact')" not in text:
    raise SystemExit('Phase B manager no longer rejects archive rows with legacy checkpoint')
if "internalEdgeCount !== eligibleCount - rootCount" not in text:
    raise SystemExit('Phase B chain-forest topology gate missing')
if "retainedToOldEdges !== 0" not in text:
    raise SystemExit('Phase B retained-to-old edge gate missing')
PY

bash "$microsecond_test"

echo 'R5 terminal archive Phase B bounded tranche contract PASS'
