#!/usr/bin/env bash
set -euo pipefail

container_name="${R4F_POSTGRES_CONTAINER:?R4F_POSTGRES_CONTAINER is required}"
checkpoint_sql='scripts/r4f-revision4-qualification-compact-checkpoint.sql'
test -f "$checkpoint_sql"

hash='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
selection='99a1f97fc17ed6023bc3075bffe963a260e99a4ed0e2d831b068826c7797222f'
checkpoint_id='r5-checkpoint-revision4-proof-99999999999'
observed_at='2026-08-12T14:00:00.000Z'

# Build a minimal schema fixture that matches the production columns/types consumed
# by the qualification-only checkpoint. The real target-table schema/type/PK shape
# is independently verified read-only against production before promotion.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create schema if not exists xrpl_resource_guard_v2;
create schema if not exists xrpl_r5_v1;

create table public.xrpl_collector_runtime (
  profile_id text primary key,
  network text not null,
  status text not null,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0
);

create table public.xrpl_phase_streams (
  profile_id text primary key,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  status text not null,
  last_error_classification text,
  last_error_message text
);

create table public.xrpl_phase_watermarks (
  profile_id text primary key,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  ledger_index bigint not null,
  ledger_hash text not null,
  work_id text not null
);

create table public.xrpl_phase_messages (
  message_id text primary key,
  profile_id text not null,
  status text not null,
  phase text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb
);

create table public.xrpl_phase_successors (
  current_message_id text not null,
  successor_message_id text not null,
  primary key (current_message_id, successor_message_id)
);

create table public.xrpl_phase_work (
  work_id text primary key,
  profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  status text not null,
  scanned_end_ledger_index bigint,
  final_ledger_hash text,
  committed_at timestamptz
);

create table public.xrpl_phase_payload_chunks (
  work_id text not null,
  chunk_id text not null,
  primary key (work_id, chunk_id)
);

create table public.xrpl_phase_reference_rows (
  work_id text not null,
  row_id text not null,
  primary key (work_id, row_id)
);

create table public.xrpl_phase_commit_chunks (
  work_id text not null,
  chunk_id text not null,
  primary key (work_id, chunk_id)
);

create table xrpl_resource_guard_v2.attempts (
  attempt_id text primary key
);

create table xrpl_resource_guard_v2.tick_accounting (
  tick_id text primary key
);

create table xrpl_r5_v1.active_checkpoints (
  checkpoint_id text primary key,
  profile_id text not null,
  profile_revision integer not null,
  profile_identity_digest text not null,
  selection_digest text not null,
  source_profile_id text not null,
  network text not null,
  epoch_id text not null,
  base_identity text not null,
  watermark_ledger_index bigint not null,
  watermark_ledger_hash text not null,
  watermark_work_id text not null,
  observed_at timestamptz not null,
  state_digest text not null,
  row_counts jsonb not null,
  section_digests jsonb not null,
  state jsonb not null
);

create or replace function public.xrpl_transfer_json_digest(p_value jsonb)
returns text
language sql
immutable
strict
as $$
  select encode(extensions.digest(convert_to(p_value::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.xrpl_drain_r5_checkpoint_boundary(
  p_session_id text,
  p_observed_at timestamptz
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r5-checkpoint-boundary-drain',
    'drained', true,
    'sessionId', p_session_id,
    'observedAt', p_observed_at,
    'checks', jsonb_build_object(
      'collectorQuiescent', true,
      'activeStreamHealthy', true,
      'noScanExecuted', true,
      'onePendingScan', true,
      'pendingScanBoundToWatermark', true,
      'noInflightWork', true,
      'watermarkIdentityPreserved', true
    ),
    'watermarkAfter', jsonb_build_object(
      'ledgerIndex', 100,
      'ledgerHash', repeat('A', 64),
      'workId', 'work-100'
    ),
    'pendingScan', jsonb_build_object('messageId', 'scan-101')
  )
$$;

insert into public.xrpl_collector_runtime (
  profile_id, network, status, lease_owner, lease_expires_at, last_error, consecutive_failures
) values ('supabase-devnet', 'devnet', 'stopped', null, null, null, 0);

insert into public.xrpl_phase_streams (
  profile_id, network, epoch_id, base_identity, status, last_error_classification, last_error_message
) values ('supabase-devnet', 'devnet', 'supabase-r4c2c-v1', 'base-identity', 'active', null, null);

insert into public.xrpl_phase_watermarks (
  profile_id, network, epoch_id, base_identity, ledger_index, ledger_hash, work_id
) values ('supabase-devnet', 'devnet', 'supabase-r4c2c-v1', 'base-identity', 100, repeat('A', 64), 'work-100');

insert into public.xrpl_phase_messages (message_id, profile_id, status, phase, payload, result)
values
  (
    'finalize-100', 'supabase-devnet', 'completed', 'finalize', '{}'::jsonb,
    jsonb_build_object(
      'status', 'committed',
      'workId', 'work-100',
      'ledgerIndex', 100,
      'ledgerHash', repeat('A', 64)
    )
  ),
  (
    'scan-101', 'supabase-devnet', 'pending', 'scan',
    jsonb_build_object(
      'expectedPreviousLedgerIndex', 100,
      'expectedPreviousLedgerHash', repeat('A', 64),
      'network', 'devnet',
      'epochId', 'supabase-r4c2c-v1',
      'baseIdentity', 'base-identity'
    ),
    '{}'::jsonb
  );

insert into public.xrpl_phase_successors (current_message_id, successor_message_id)
values ('finalize-100', 'scan-101');

insert into public.xrpl_phase_work (
  work_id, profile_id, network, epoch_id, base_identity, status,
  scanned_end_ledger_index, final_ledger_hash, committed_at
) values (
  'work-100', 'supabase-devnet', 'devnet', 'supabase-r4c2c-v1', 'base-identity',
  'committed', 100, repeat('A', 64), '2026-08-12T13:59:00Z'::timestamptz
);

insert into public.xrpl_phase_payload_chunks values ('work-100', 'payload-1');
insert into public.xrpl_phase_reference_rows values ('work-100', 'reference-1');
insert into public.xrpl_phase_commit_chunks values ('work-100', 'commit-1');
insert into xrpl_resource_guard_v2.attempts values ('attempt-1');
insert into xrpl_resource_guard_v2.tick_accounting values ('tick-1');
SQL

CHECKPOINT_ID="$checkpoint_id" \
SELECTION_DIGEST="$selection" \
OBSERVED_AT="$observed_at" \
CHECKPOINT_SQL_PATH="$checkpoint_sql" \
python - <<'PY'
import os
from pathlib import Path

path = Path(os.environ['CHECKPOINT_SQL_PATH'])
query = path.read_text()
replacements = {
    '__CHECKPOINT_ID__': os.environ['CHECKPOINT_ID'],
    '__SELECTION_DIGEST__': os.environ['SELECTION_DIGEST'],
    '__OBSERVED_AT__': os.environ['OBSERVED_AT'],
}
for token, value in replacements.items():
    if token not in query:
        raise SystemExit(f'missing compact-checkpoint token: {token}')
    query = query.replace(token, value)
if '__' in query and any(token in query for token in replacements):
    raise SystemExit('compact-checkpoint token remained after rendering')
Path('/tmp/r4f-compact-checkpoint.sql').write_text(query)
PY

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < /tmp/r4f-compact-checkpoint.sql \
  > /tmp/r4f-compact-checkpoint-result.txt

# psql's aligned output may include a header; query the retained row directly for
# unambiguous assertions after the compact statement succeeds.
docker exec "$container_name" psql -U postgres -d postgres -Atqc \
  "select jsonb_build_object(
    'count', count(*),
    'profileRevision', min(profile_revision),
    'selectionDigest', min(selection_digest),
    'stateDigestMatches', bool_and(public.xrpl_transfer_json_digest(state)=state_digest),
    'purpose', min(state->>'purpose'),
    'qualificationBoundaryOnly', bool_and(coalesce((state#>>'{checks,qualificationBoundaryOnly}')::boolean,false)),
    'fullRecoveryStateCaptured', bool_and(coalesce((state#>>'{checks,fullRecoveryStateCaptured}')::boolean,true)),
    'messages', min((row_counts->>'messages')::integer),
    'referenceRows', min((row_counts->>'referenceRows')::integer)
  ) from xrpl_r5_v1.active_checkpoints where checkpoint_id='${checkpoint_id}';" \
  > /tmp/r4f-compact-checkpoint-assert.json

jq -e --arg selection "$selection" '
  .count == 1 and
  .profileRevision == 4 and
  .selectionDigest == $selection and
  .stateDigestMatches == true and
  .purpose == "r5-revision4-qualification-boundary-checkpoint" and
  .qualificationBoundaryOnly == true and
  .fullRecoveryStateCaptured == false and
  .messages == 2 and
  .referenceRows == 1
' /tmp/r4f-compact-checkpoint-assert.json > /dev/null

# Exact replay must converge to the same single row.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < /tmp/r4f-compact-checkpoint.sql \
  > /tmp/r4f-compact-checkpoint-replay.txt

test "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_r5_v1.active_checkpoints where checkpoint_id='${checkpoint_id}'")" = '1'

printf '%s\n' 'R4F revision-4 compact qualification checkpoint PostgreSQL integration: PASS'
