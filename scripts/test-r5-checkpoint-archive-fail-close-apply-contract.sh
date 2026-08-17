#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-checkpoint-archive-fail-close-apply.yml'
manager='scripts/manage-r5-checkpoint-archive-fail-close-apply.mjs'
extender='scripts/extend-actions-policy-r5-checkpoint-archive-fail-close-apply.py'
sql='ops/production-sql/20260817110500_xrpl_r5_checkpoint_terminal_archive_fail_close.sql'

for file in "$workflow" "$manager" "$extender" "$sql"; do
  test -s "$file"
done

node --check "$manager"
python -m py_compile "$extender"

grep -Fq "github.event.comment.body == '/r5-checkpoint-archive-fail-close-prepare'" "$workflow"
grep -Fq "startsWith(github.event.comment.body, '/r5-checkpoint-archive-fail-close-authorize ')" "$workflow"
grep -Fq 'Apply only exact authorized checkpoint archive fail-close' "$workflow"
grep -Fq 'archiveRowsAfter' "$workflow"
grep -Fq 'functionDefinitionMutationPerformed' "$workflow"
grep -Fq 'terminalTransportMutationPerformed' "$workflow"
grep -Fq 'physicalCompactionPerformed' "$workflow"
grep -Fq 'r5RearmPerformed' "$workflow"

grep -Fq "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'" "$manager"
grep -Fq '20260817110500_xrpl_r5_checkpoint_terminal_archive_fail_close.sql' "$manager"
grep -Fq 'checkpoint fail-close must be installed before the first terminal archive row' "$manager"
grep -Fq 'legacy revision-3 recovery entry point is not retired' "$manager"
grep -Fq 'authorized checkpoint fail-close structural state drifted before mutation' "$manager"
grep -Fq 'postVerificationReadOnly: true' "$manager"

grep -Fq 'bc135435e0d729526aff6940c96b3ef78530b4612586f82ef73a7b99e145da10' "$sql"
grep -Fq 'e170166e6c73bf4e7a112ad3daf94873935d0b2b248abf55f7bb42059575c733' "$sql"
grep -Fq 'r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint' "$sql"

for forbidden in 'workflow_dispatch' 'pull_request_target' 'contents: write' 'supabase functions deploy' 'supabase db push' 'cron.schedule' 'cron.unschedule' 'wrangler deploy'; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "checkpoint archive fail-close workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

python - "$manager" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text().replace(' ', '')
required = [
    'functionDefinitionMutationPerformed:true',
    'terminalTransportMutationPerformed:false',
    'canonicalHistoryRowMutationPerformed:false',
    'physicalCompactionPerformed:false',
    'vacuumPerformed:false',
    'schedulerMutationPerformed:false',
    'deploymentPerformed:false',
    'publicReaderMutationPerformed:false',
    'mainnetDisabled:true',
    'r5RearmPerformed:false',
]
for marker in required:
    if marker not in text:
        raise SystemExit(f'missing bounded result marker: {marker}')
PY

echo 'R5 checkpoint archive fail-close apply contract PASS'
