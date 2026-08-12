import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const PROFILE_DIGEST = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const SELECTION_DIGEST = '99a1f97fc17ed6023bc3075bffe963a260e99a4ed0e2d831b068826c7797222f'
const RUN_ID = 'r5-recovery-selected-revision4-entry'
const QUALIFICATION_KEY = 'r4f-revision4-r5-12-ledger-accounting-v1'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function parseArgs(argv) {
  let output = ''
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') {
      output = argv[index + 1] ?? ''
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argv[index]}`)
  }
  if (!output) throw new Error('Missing --output')
  return { output: resolve(output) }
}

function findState(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findState(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    if (value.state && typeof value.state === 'object' && !Array.isArray(value.state)) {
      return value.state
    }
    for (const item of Object.values(value)) {
      const found = findState(item)
      if (found) return found
    }
  }
  return null
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    )
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(stable(value))
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

const { output } = parseArgs(process.argv.slice(2))
const accessToken = requiredEnv('SUPABASE_ACCESS_TOKEN')
const projectId = requiredEnv('SUPABASE_PROJECT_ID')
expect(/^[a-z]{20}$/u.test(projectId), 'invalid Supabase project id')

const query = `
select jsonb_build_object(
  'checkpointRev4Exists', to_regprocedure('public.xrpl_create_r5_revision4_active_checkpoint(text,text,timestamp with time zone)') is not null,
  'prepareRev4Exists', to_regprocedure('public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone)') is not null,
  'rebindStrictRev4Exists', to_regprocedure('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)') is not null,
  'rebindRev4Exists', to_regprocedure('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(text,timestamp with time zone)') is not null,
  'claimRev4Exists', to_regprocedure('public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)') is not null,
  'progressiveClaimRev4Exists', to_regprocedure('public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)') is not null,
  'completionRev4Exists', to_regprocedure('public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)') is not null,
  'checkpointRows', (select count(*) from xrpl_r5_v1.active_checkpoints where profile_revision = 4),
  'runRows', (select count(*) from xrpl_r5_v1.recovery_runs where profile_revision = 4),
  'batchRows', (select count(*) from xrpl_r5_v1.recovery_batches where profile_revision = 4),
  'runIdRows', (select count(*) from xrpl_r5_v1.recovery_runs where run_id = '${RUN_ID}'),
  'evidenceRows', (select count(*) from xrpl_r5_v1.revision4_accounting_qualification_evidence where qualification_key = '${QUALIFICATION_KEY}'),
  'egressPolicyRows', (
    select count(*)
    from xrpl_r5_v1.revision4_egress_budget_policy
    where policy_id = 'r5-revision4-egress-4581-v1'
      and profile_revision = 4
      and maximum_ledgers_per_claim = 12
      and maximum_billable_egress_bytes_per_ledger = 4581
      and maximum_claim_billable_egress_bytes = 54972
      and maximum_claim_exclusive_reservation_bytes = 54973
      and public_reader_unchanged = true
      and mainnet_disabled = true
      and stabilization_authorized = false
      and soak_authorized = false
  ),
  'resume', (
    select jsonb_build_object(
      'checkpointId', c.checkpoint_id,
      'checkpointStateDigest', c.state_digest,
      'checkpointStateDigestRecomputed', encode(extensions.digest(convert_to(c.state::text, 'UTF8'), 'sha256'), 'hex'),
      'checkpointProfileId', c.profile_id,
      'checkpointProfileRevision', c.profile_revision,
      'checkpointProfileIdentityDigest', c.profile_identity_digest,
      'checkpointSelectionDigest', c.selection_digest,
      'checkpointSourceProfileId', c.source_profile_id,
      'checkpointNetwork', c.network,
      'checkpointEpochId', c.epoch_id,
      'checkpointWatermarkLedgerIndex', c.watermark_ledger_index,
      'checkpointWatermarkLedgerHash', c.watermark_ledger_hash,
      'checkpointWatermarkWorkId', c.watermark_work_id,
      'checkpointObservedAt', c.observed_at,
      'checkpointPurpose', c.state->>'purpose',
      'qualificationBoundaryOnly', coalesce((c.state #>> '{checks,qualificationBoundaryOnly}')::boolean, false),
      'fullRecoveryStateCaptured', coalesce((c.state #>> '{checks,fullRecoveryStateCaptured}')::boolean, true),
      'checkpointPublicReaderUnchanged', coalesce((c.state #>> '{checks,publicReaderUnchanged}')::boolean, false),
      'checkpointMainnetDisabled', coalesce((c.state #>> '{checks,mainnetDisabled}')::boolean, false),
      'checkpointStabilizationAuthorized', coalesce((c.state #>> '{checks,stabilizationAuthorized}')::boolean, true),
      'checkpointSoakAuthorized', coalesce((c.state #>> '{checks,soakAuthorized}')::boolean, true),
      'runId', r.run_id,
      'runCheckpointId', r.checkpoint_id,
      'runCheckpointStateDigest', r.checkpoint_state_digest,
      'runProfileId', r.profile_id,
      'runProfileRevision', r.profile_revision,
      'runProfileIdentityDigest', r.profile_identity_digest,
      'runSelectionDigest', r.selection_digest,
      'runSourceProfileId', r.source_profile_id,
      'runNetwork', r.network,
      'runEpochId', r.epoch_id,
      'runBaseIdentity', r.base_identity,
      'runStatus', r.status,
      'runBatchSize', r.batch_size,
      'runInitialValidatedHeadLedgerIndex', r.initial_validated_head_ledger_index,
      'runInitialValidatedHeadLedgerHash', r.initial_validated_head_ledger_hash,
      'runCurrentWatermarkLedgerIndex', r.current_watermark_ledger_index,
      'runCurrentWatermarkLedgerHash', r.current_watermark_ledger_hash,
      'runCurrentWatermarkWorkId', r.current_watermark_work_id,
      'runCompletedBatches', r.completed_batches,
      'runCommittedLedgers', r.committed_ledgers,
      'runLastAccountingDigest', r.last_accounting_digest,
      'runLastError', r.last_error,
      'runPreparedAt', r.prepared_at,
      'runStartedAt', r.started_at,
      'runCompletedAt', r.completed_at
    )
    from xrpl_r5_v1.recovery_runs r
    join xrpl_r5_v1.active_checkpoints c
      on c.checkpoint_id = r.checkpoint_id
    where r.run_id = '${RUN_ID}'
  )
) as state;
`

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectId}/database/query`,
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(30_000),
  },
)
const text = await response.text()
if (!response.ok) {
  throw new Error(`qualification state query failed (${response.status}): ${text.slice(0, 1000)}`)
}
const payload = JSON.parse(text)
const state = findState(payload)
expect(state !== null, 'qualification state query returned no state')

for (const key of [
  'checkpointRev4Exists',
  'prepareRev4Exists',
  'rebindStrictRev4Exists',
  'rebindRev4Exists',
  'claimRev4Exists',
  'progressiveClaimRev4Exists',
  'completionRev4Exists',
]) {
  expect(state[key] === true, `${key} is not true`)
}
expect(state.egressPolicyRows === 1, 'revision4 egress policy mismatch')
expect(state.batchRows === 0, 'revision4 batch residue is not prebatch')
expect(state.evidenceRows === 0, 'revision4 qualification evidence already exists')

let mode
let checkpointId = ''
if (
  state.checkpointRows === 0
  && state.runRows === 0
  && state.runIdRows === 0
  && state.resume === null
) {
  mode = 'clean'
} else {
  expect(state.checkpointRows === 1, 'prepared resume requires exactly one revision4 checkpoint')
  expect(state.runRows === 1, 'prepared resume requires exactly one revision4 run')
  expect(state.runIdRows === 1, 'prepared resume requires exact qualification run id')
  const resume = state.resume
  expect(resume && typeof resume === 'object' && !Array.isArray(resume), 'prepared resume metadata missing')
  checkpointId = resume.checkpointId
  expect(/^r5-checkpoint-revision4-proof-[0-9]+$/u.test(checkpointId), 'prepared resume checkpoint id invalid')
  expect(resume.checkpointStateDigest === resume.checkpointStateDigestRecomputed, 'checkpoint state digest mismatch')
  expect(resume.runCheckpointStateDigest === resume.checkpointStateDigest, 'run/checkpoint state digest mismatch')
  expect(resume.runCheckpointId === checkpointId, 'run/checkpoint id mismatch')
  expect(resume.checkpointProfileId === 'supabase_free_postgres_pgcron_edge', 'checkpoint profile id mismatch')
  expect(resume.checkpointProfileRevision === 4, 'checkpoint profile revision mismatch')
  expect(resume.checkpointProfileIdentityDigest === PROFILE_DIGEST, 'checkpoint profile digest mismatch')
  expect(resume.checkpointSelectionDigest === SELECTION_DIGEST, 'checkpoint selection digest mismatch')
  expect(resume.checkpointSourceProfileId === 'supabase-devnet', 'checkpoint source profile mismatch')
  expect(resume.checkpointNetwork === 'devnet', 'checkpoint network mismatch')
  expect(resume.checkpointEpochId === 'supabase-r4c2c-v1', 'checkpoint epoch mismatch')
  expect(resume.checkpointPurpose === 'r5-revision4-qualification-boundary-checkpoint', 'checkpoint purpose mismatch')
  expect(resume.qualificationBoundaryOnly === true, 'checkpoint is not qualification-only')
  expect(resume.fullRecoveryStateCaptured === false, 'checkpoint incorrectly claims full recovery state')
  expect(resume.checkpointPublicReaderUnchanged === true, 'checkpoint public-reader boundary mismatch')
  expect(resume.checkpointMainnetDisabled === true, 'checkpoint Mainnet boundary mismatch')
  expect(resume.checkpointStabilizationAuthorized === false, 'checkpoint stabilization boundary mismatch')
  expect(resume.checkpointSoakAuthorized === false, 'checkpoint soak boundary mismatch')
  expect(resume.runId === RUN_ID, 'prepared resume run id mismatch')
  expect(resume.runProfileId === 'supabase_free_postgres_pgcron_edge', 'run profile id mismatch')
  expect(resume.runProfileRevision === 4, 'run profile revision mismatch')
  expect(resume.runProfileIdentityDigest === PROFILE_DIGEST, 'run profile digest mismatch')
  expect(resume.runSelectionDigest === SELECTION_DIGEST, 'run selection digest mismatch')
  expect(resume.runSourceProfileId === 'supabase-devnet', 'run source profile mismatch')
  expect(resume.runNetwork === 'devnet', 'run network mismatch')
  expect(resume.runEpochId === 'supabase-r4c2c-v1', 'run epoch mismatch')
  expect(typeof resume.runBaseIdentity === 'string' && resume.runBaseIdentity.length > 0, 'run base identity missing')
  expect(resume.runStatus === 'prepared', 'run is not prepared')
  expect(resume.runBatchSize === 24, 'run batch size mismatch')
  expect(resume.runCompletedBatches === 0, 'prepared run has completed batches')
  expect(resume.runCommittedLedgers === 0, 'prepared run has committed ledgers')
  expect(resume.runLastAccountingDigest === null, 'prepared run has accounting digest')
  expect(resume.runLastError === null, 'prepared run has last error')
  expect(resume.runStartedAt === null, 'prepared run already started')
  expect(resume.runCompletedAt === null, 'prepared run already completed')
  expect(typeof resume.runPreparedAt === 'string' && resume.runPreparedAt.length > 0, 'prepared timestamp missing')
  expect(Number.isSafeInteger(resume.runInitialValidatedHeadLedgerIndex), 'prepared head ledger index invalid')
  expect(Number.isSafeInteger(resume.runCurrentWatermarkLedgerIndex), 'current watermark ledger index invalid')
  expect(
    resume.runInitialValidatedHeadLedgerIndex - resume.runCurrentWatermarkLedgerIndex >= 12,
    'prepared run does not retain at least 12 ledgers of headroom',
  )
  expect(/^[A-F0-9]{64}$/u.test(resume.runInitialValidatedHeadLedgerHash), 'prepared head hash invalid')
  expect(/^[A-F0-9]{64}$/u.test(resume.runCurrentWatermarkLedgerHash), 'current watermark hash invalid')
  expect(typeof resume.runCurrentWatermarkWorkId === 'string' && resume.runCurrentWatermarkWorkId.length > 0, 'current watermark work id missing')
  mode = 'prepared_resume'
}

const stateDigest = digest(state)
const evidence = {
  schemaVersion: 1,
  mode,
  digest: stateDigest,
  checkpointId,
  state,
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`)

if (process.env.GITHUB_OUTPUT) {
  writeFileSync(
    process.env.GITHUB_OUTPUT,
    `state_mode=${mode}\nstate_digest=${stateDigest}\ncheckpoint_id=${checkpointId}\n`,
    { flag: 'a' },
  )
}
console.log(JSON.stringify({
  mode,
  digest: stateDigest,
  checkpointId: checkpointId || null,
  checkpointRows: state.checkpointRows,
  runRows: state.runRows,
  batchRows: state.batchRows,
  evidenceRows: state.evidenceRows,
}))
