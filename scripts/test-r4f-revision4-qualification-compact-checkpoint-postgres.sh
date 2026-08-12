#!/usr/bin/env bash
set -euo pipefail

container_name="${R4F_POSTGRES_CONTAINER:?R4F_POSTGRES_CONTAINER is required}"
checkpoint_sql='scripts/r4f-revision4-qualification-compact-checkpoint.sql'
test -f "$checkpoint_sql"

selection='99a1f97fc17ed6023bc3075bffe963a260e99a4ed0e2d831b068826c7797222f'
checkpoint_id='r5-checkpoint-revision4-proof-99999999999'
observed_at='2026-08-12T14:00:00.000Z'

# The compact checkpoint must trust the canonical drain function's validated return
# value rather than re-reading phase tables in the same SQL statement. This fixture
# therefore models the real production condition observed before the failed proof:
# the active R5 phase machine is still at commit/finalize when the checkpoint starts,
# while the canonical drain returns a bounded scan-boundary proof after consuming only
# those existing commit/finalize phases.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create schema if not exists xrpl_r5_v1;

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

create table public.r4f_compact_checkpoint_fixture (
  singleton boolean primary key default true check (singleton),
  pending_phase text not null,
  work_status text not null,
  watermark_ledger_index bigint not null,
  watermark_ledger_hash text not null,
  target_ledger_index bigint not null,
  target_ledger_hash text not null
);

insert into public.r4f_compact_checkpoint_fixture (
  pending_phase,
  work_status,
  watermark_ledger_index,
  watermark_ledger_hash,
  target_ledger_index,
  target_ledger_hash
) values (
  'commit',
  'staged',
  98,
  repeat('B', 64),
  100,
  repeat('A', 64)
);

create table public.r4f_compact_checkpoint_drain_calls (
  call_id bigserial primary key,
  owner text not null,
  observed_at timestamptz not null
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
  p_owner text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  fixture public.r4f_compact_checkpoint_fixture%rowtype;
begin
  select * into strict fixture
  from public.r4f_compact_checkpoint_fixture
  where singleton is true;

  if fixture.pending_phase not in ('commit', 'finalize')
    or fixture.work_status not in ('staged', 'committing', 'finalizing') then
    raise exception 'fixture_not_at_drainable_transition';
  end if;

  insert into public.r4f_compact_checkpoint_drain_calls (owner, observed_at)
  values (p_owner, p_observed_at);

  return jsonb_build_object(
    'schemaVersion', 1,
    'purpose', 'r5-checkpoint-boundary-drain',
    'drained', true,
    'profileId', 'supabase_free_postgres_pgcron_edge',
    'profileRevision', 3,
    'profileIdentityDigest',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
    'sourceProfileId', 'supabase-devnet',
    'network', 'devnet',
    'epochId', 'supabase-r4c2c-v1',
    'baseIdentity', 'base-identity',
    'drainedStepCount', 2,
    'drainedPhases', jsonb_build_array(
      jsonb_build_object(
        'sequence', 1,
        'phase', 'commit',
        'messageId', 'commit-99',
        'workId', 'work-99',
        'chunkIndex', 0,
        'successorMessageId', 'finalize-99'
      ),
      jsonb_build_object(
        'sequence', 2,
        'phase', 'finalize',
        'messageId', 'finalize-99',
        'workId', 'work-99',
        'chunkIndex', null,
        'successorMessageId', 'scan-101'
      )
    ),
    'watermarkBefore', jsonb_build_object(
      'ledgerIndex', fixture.watermark_ledger_index,
      'ledgerHash', fixture.watermark_ledger_hash,
      'workId', 'work-98'
    ),
    'watermarkAfter', jsonb_build_object(
      'ledgerIndex', fixture.target_ledger_index,
      'ledgerHash', fixture.target_ledger_hash,
      'workId', 'work-100'
    ),
    'pendingScan', jsonb_build_object(
      'messageId', 'scan-101',
      'scanSequence', 101,
      'expectedPreviousLedgerIndex', fixture.target_ledger_index,
      'expectedPreviousLedgerHash', fixture.target_ledger_hash,
      'availableAt', p_observed_at + interval '2 seconds'
    ),
    'checks', jsonb_build_object(
      'collectorQuiescent', true,
      'activeStreamHealthy', true,
      'onlyExistingCommitOrFinalizeDrained', true,
      'noScanExecuted', true,
      'onePendingScan', true,
      'pendingScanBoundToWatermark', true,
      'noInflightWork', true,
      'watermarkIdentityPreserved', true,
      'publicReaderUnchanged', true,
      'mainnetDisabled', true,
      'activeRecoveryStarted', false,
      'stabilizationAuthorized', false,
      'soakAuthorized', false
    )
  );
end;
$$;
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
if any(token in query for token in replacements):
    raise SystemExit('compact-checkpoint token remained after rendering')
Path('/tmp/r4f-compact-checkpoint.sql').write_text(query)
PY

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < /tmp/r4f-compact-checkpoint.sql \
  > /tmp/r4f-compact-checkpoint-result.txt

# The first execution must consume exactly one canonical drain proof and retain one
# qualification-only checkpoint whose state digest and drain-boundary facts agree.
test "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from public.r4f_compact_checkpoint_drain_calls')" = '1'

docker exec "$container_name" psql -U postgres -d postgres -Atqc \
  "select jsonb_build_object(
    'count', count(*),
    'profileRevision', min(profile_revision),
    'selectionDigest', min(selection_digest),
    'stateDigestMatches', bool_and(public.xrpl_transfer_json_digest(state)=state_digest),
    'purpose', min(state->>'purpose'),
    'qualificationBoundaryOnly', bool_and(coalesce((state#>>'{checks,qualificationBoundaryOnly}')::boolean,false)),
    'fullRecoveryStateCaptured', bool_and(coalesce((state#>>'{checks,fullRecoveryStateCaptured}')::boolean,true)),
    'pendingScanBoundToWatermark', bool_and(coalesce((state#>>'{checks,pendingScanBoundToWatermark}')::boolean,false)),
    'noInflightWork', bool_and(coalesce((state#>>'{checks,noInflightWork}')::boolean,false)),
    'drainedStepCount', min((row_counts->>'drainedStepCount')::integer),
    'drainedPhaseCount', min(jsonb_array_length(state#>'{boundaryDrain,drainedPhases}')),
    'pendingMessages', min((row_counts->>'pendingMessages')::integer),
    'leasedMessages', min((row_counts->>'leasedMessages')::integer),
    'retryMessages', min((row_counts->>'retryMessages')::integer),
    'inflightWork', min((row_counts->>'inflightWork')::integer),
    'watermarkLedgerIndex', min(watermark_ledger_index),
    'pendingExpectedLedgerIndex', min((state#>>'{boundaryDrain,pendingScan,expectedPreviousLedgerIndex}')::bigint),
    'watermarkHashMatchesPending', bool_and(
      upper(state#>>'{boundaryDrain,watermarkAfter,ledgerHash}') =
      upper(state#>>'{boundaryDrain,pendingScan,expectedPreviousLedgerHash}')
    )
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
  .pendingScanBoundToWatermark == true and
  .noInflightWork == true and
  .drainedStepCount == 2 and
  .drainedPhaseCount == 2 and
  .pendingMessages == 1 and
  .leasedMessages == 0 and
  .retryMessages == 0 and
  .inflightWork == 0 and
  .watermarkLedgerIndex == 100 and
  .pendingExpectedLedgerIndex == 100 and
  .watermarkHashMatchesPending == true
' /tmp/r4f-compact-checkpoint-assert.json > /dev/null

# Exact replay must converge to the existing row WITHOUT invoking the drain again.
# This matters because replaying a drain against a later phase-machine state would
# create a new mutation surface rather than prove idempotency.
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < /tmp/r4f-compact-checkpoint.sql \
  > /tmp/r4f-compact-checkpoint-replay.txt

test "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc "select count(*) from xrpl_r5_v1.active_checkpoints where checkpoint_id='${checkpoint_id}'")" = '1'
test "$(docker exec "$container_name" psql -U postgres -d postgres -Atqc 'select count(*) from public.r4f_compact_checkpoint_drain_calls')" = '1'

printf '%s\n' 'R4F revision-4 compact qualification checkpoint PostgreSQL integration: PASS'
