#!/usr/bin/env bash
set -euo pipefail

proof='scripts/test-r5-terminal-transport-dual-rewrite-postgres.sh'
[[ -f "$proof" ]]
bash -n "$proof"

for required in \
  "image='postgres:15-alpine'" \
  "production database used: \\`false\\`" \
  "production compaction authorized: \\`false\\`" \
  "create table proof.messages" \
  "create table proof.successors" \
  "current_message_id text primary key references proof.messages(message_id)" \
  "successor_message_id text not null unique references proof.messages(message_id)" \
  "alter table proof.messages enable row level security" \
  "alter table proof.successors enable row level security" \
  "create index messages_ready_idx" \
  "where status in ('pending','retry','leased')" \
  "select pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b',0))" \
  "select pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint',0))" \
  "set local lock_timeout='5s'" \
  "set local statement_timeout='180s'" \
  "lock table proof.successors in access exclusive mode" \
  "lock table proof.messages in access exclusive mode" \
  "create temp table snapshot_messages on commit drop as select * from proof.messages" \
  "create temp table snapshot_successors on commit drop as select * from proof.successors" \
  "truncate table proof.successors, proof.messages" \
  "insert into proof.messages select * from snapshot_messages order by message_id" \
  "insert into proof.successors select * from snapshot_successors order by current_message_id" \
  "injected_dual_rewrite_failure" \
  "schemaFingerprintPreserved" \
  "relationOidsPreserved" \
  "peakBytesOverBaseline"; do
  grep -Fq "$required" "$proof" || { echo "dual-rewrite proof missing: $required" >&2; exit 1; }
done

# The local proof may exercise physical rewrite primitives, but it must not contain
# any production/provider credentials, Management API mutation, scheduler mutation,
# deployment command, or R5 rearm path.
for forbidden in \
  'SUPABASE_ACCESS_TOKEN' \
  'SUPABASE_PROJECT_ID' \
  'api.supabase.com' \
  'read_only:false' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy' \
  'supabase functions deploy' \
  'MAINNET_ENABLED' \
  'r5Rearm' \
  'r5-revision4-resource-halt-rearm'; do
  if grep -Fq "$forbidden" "$proof"; then
    echo "dual-rewrite proof contains forbidden production capability: $forbidden" >&2
    exit 1
  fi
done

# There must be exactly two TRUNCATE occurrences: one injected-failure proof and one
# successful proof. Both must name both FK-participating tables together.
[[ "$(grep -Fc 'truncate table proof.successors, proof.messages;' "$proof")" -eq 2 ]]

# Temporary snapshots intentionally use CTAS rather than LIKE INCLUDING ALL, so they
# do not duplicate indexes/constraints and inflate peak storage unnecessarily.
if grep -Eiq 'create[[:space:]]+temp[[:space:]]+table.*like.*including' "$proof"; then
  echo 'dual-rewrite proof duplicates schema/indexes into temporary snapshot' >&2
  exit 1
fi

echo 'R5 terminal transport dual-table rewrite contract PASS'
