import { readFile, mkdir, writeFile } from 'node:fs/promises'

const evidenceDirectory = 'supabase-remote-probe-evidence'
const ownershipPath = `${evidenceDirectory}/r5-recovery-ownership.json`
const combinedSuccessPath = `${evidenceDirectory}/verified-retained-r5-qualification-evidence.json`
const combinedFailurePath = `${evidenceDirectory}/failed-retained-r5-qualification-evidence.json`
const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const archiveId = 'r5-catchup-reclaim-20260805-v1'
const retainedCatchUpRunId = 'r4c2d-msflb2xi-9529f8e9'
const retainedSteadySessionId = 'r4c2d-steady-msflb8fo-5ebc5adc'
const sourceWorkflowRunId = 30975277983
const sourceCommit = 'd7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c'
const sourceArtifactId = 8918144753
const sourceArtifactDigest = 'sha256:c0f519dc4a1fe5dfff3f0ae79641cc84fd54e99fb2f0b2d073f20639e1dda2ac'
const sourceCatchUpEvidenceSha256 = '165f01e582bc4e52e1676d143a240429d203ae803bd0eabfb4c5069ac7d6870b'
const sourceSteadyEvidenceSha256 = 'fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c'
const databaseHaltBytes = 400_000_000

const retainedCatchUpEvidence = {
  schemaVersion: 1,
  purpose: 'r4c2d-isolated-catchup-throughput-verification',
  verifiedAt: '2026-08-05T04:31:43.959Z',
  runId: retainedCatchUpRunId,
  profileId: 'supabase-devnet-catchup-qualification',
  sourceProfileId: 'supabase-devnet',
  network: 'devnet',
  sourceCount: 64,
  trialCount: 5,
  summary: {
    minimumCommittedLedgersPerMinute: 2766.9865701856884,
    p50CommittedLedgersPerMinute: 4176.501988966079,
    p95CommittedLedgersPerMinute: 6996.037761566797,
    maximumCommittedLedgersPerMinute: 7157.431916261594,
    p50DbElapsedMilliseconds: 290.452,
    p95DbElapsedMilliseconds: 643.6411999999999,
    p50EdgeWallMilliseconds: 919.4297070000002,
    p95EdgeWallMilliseconds: 1302.0927001999999,
    catchUpThreshold: 30,
    catchUpObservedPass: true,
    steadyObservedPass: false,
    steadyEvidenceSource: 'r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03',
    g7Qualified: false,
    g7Reason: 'isolated catch-up passed, but retained steady p95 remains below the fixed threshold',
  },
  checks: {
    fiveTrialsCompleted: true,
    sixtyFourWorksPerTrial: true,
    fullPhaseSchedulerParity: true,
    allCompletedAttemptsOne: true,
    committedRowDigestParity: true,
    targetWatermarkParity: true,
    activeProfileNonRegressing: true,
    catchUpComponentMeasured: true,
    g7NotOverstated: true,
  },
  credentialChecks: {
    missingTokenRejected: true,
    wrongPurposeRejected: true,
  },
}

const retainedSteadyEvidence = {
  schemaVersion: 1,
  purpose: 'r4c2d-network-steady-throughput-verification',
  verifiedAt: '2026-08-05T04:37:08.161Z',
  sessionId: retainedSteadySessionId,
  profileId: 'supabase-devnet-steady-qualification',
  sourceProfileId: 'supabase-devnet',
  network: 'devnet',
  minuteRates: [24, 24, 24, 24, 24, 24],
  summary: {
    minimumCommittedLedgersPerMinute: 24,
    p50CommittedLedgersPerMinute: 24,
    p95CommittedLedgersPerMinute: 24,
    maximumCommittedLedgersPerMinute: 24,
    steadyThreshold: 21,
    steadyObservedPass: true,
    catchUpThreshold: 30,
    catchUpObservedPass: true,
    g7Qualified: true,
  },
  memorySummary: {
    runtimeMemoryMeasurementAvailable: false,
    measurementReason: 'Deno.memoryUsage returned zero RSS for every retained sample; nonzero heap or external counters cannot prove total Edge memory high water',
    minimumMemoryHighWaterBytes: null,
    p50MemoryHighWaterBytes: null,
    p95MemoryHighWaterBytes: null,
    maximumMemoryHighWaterBytes: null,
    memoryHaltBytes: 209715200,
    memoryHardBytes: 268435456,
    memoryHeadroomBytes: null,
    allSixTicksBelowHalt: null,
    memoryHeadroomQualified: false,
  },
  totalMemorySamples: 36,
  checks: {
    sixConsecutiveMinuteBuckets: true,
    twentyFourNetworkLedgersPerMinute: true,
    networkFetchAndNormalizationMeasured: true,
    fullPhaseAtomicBatchMeasured: true,
    sixCompletedTicksMemoryMeasured: false,
    requiredMemoryPhasesMeasured: false,
    memoryHighWaterRecalculated: false,
    memoryRecordedBeforeCommit: true,
    memoryFailClosedBelowHardLimit: false,
    activeProfileReadOnly: true,
    steadyComponentPassed: true,
    catchUpComponentPassed: true,
    g7Qualified: true,
    g8Qualified: false,
    profileSelected: false,
    sixCompletedTicksMemorySamplesRecorded: true,
    requiredMemoryPhasesSampled: true,
    memoryMeasurementAvailable: false,
    partialHeapCountersNotSubstitutedForRss: true,
    memoryCoverageNotOverstated: true,
    memoryQualified: false,
  },
  session: {
    status: 'completed',
    ticks: [1, 2, 3, 4, 5, 6].map((sequence) => ({
      tickId: `steady:v1:${retainedSteadySessionId}:tick:${sequence}`,
      tickSequence: sequence,
      status: 'completed',
      scheduledMinute: `2026-08-05T04:${String(31 + sequence).padStart(2, '0')}:00+00:00`,
    })),
  },
  credentialChecks: {
    missingTokenRejected: true,
    wrongPurposeRejected: true,
  },
}

function parse(text) {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 2_000) } }
}

function rows(body) {
  for (const value of [body, body?.result, body?.data, body?.rows, body?.result?.rows]) {
    if (Array.isArray(value)) return value
  }
  throw new Error('retained qualification query response contains no rows')
}

function object(value, name) {
  const parsed = typeof value === 'string' ? parse(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be an object`)
  }
  return parsed
}

function integer(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return parsed
}

async function ownership() {
  let parsed
  try {
    parsed = object(parse(await readFile(ownershipPath, 'utf8')), 'R5 ownership evidence')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (parsed.activeRecoveryOwned !== true) return null
  if (
    parsed.schemaVersion !== 1
    || parsed.purpose !== 'r5-supabase-active-recovery-ownership-detection'
    || parsed.recoveryRunId !== recoveryRunId
    || parsed.recoveryFound !== true
    || !['running', 'caught_up'].includes(parsed.recoveryStatus)
    || parsed.checks?.exactRevision3Identity !== true
    || parsed.checks?.activeProbeMustBeSkipped !== true
    || parsed.checks?.publicReaderUnchanged !== true
    || parsed.checks?.mainnetDisabled !== true
    || parsed.checks?.stabilizationAuthorized !== false
    || parsed.checks?.soakAuthorized !== false
  ) {
    throw new Error('active R5 ownership evidence is malformed or outside the retained-evidence boundary')
  }
  return parsed
}

async function queryRetainedState() {
  const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
  if (!/^[a-z]{20}$/.test(projectRef)) {
    throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
  }
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (accessToken.length < 20) {
    throw new Error('SUPABASE_ACCESS_TOKEN is unavailable for retained evidence verification')
  }

  const sql = `
with catchup_counts as (
  select
      (select count(*) from xrpl_catchup_v1.trials)
    + (select count(*) from xrpl_catchup_v1.source_works)
    + (select count(*) from xrpl_catchup_v1.streams)
    + (select count(*) from xrpl_catchup_v1.messages)
    + (select count(*) from xrpl_catchup_v1.successors)
    + (select count(*) from xrpl_catchup_v1.work)
    + (select count(*) from xrpl_catchup_v1.payload_chunks)
    + (select count(*) from xrpl_catchup_v1.reference_rows)
    + (select count(*) from xrpl_catchup_v1.commit_chunks)
    + (select count(*) from xrpl_catchup_v1.watermarks) as live_rows
), catchup_size as (
  select coalesce(sum(pg_total_relation_size(class.oid)), 0)::bigint as total_bytes
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'xrpl_catchup_v1'
    and class.relkind in ('r', 'm', 'p')
), steady as (
  select
    session.*,
    (select count(*) from xrpl_steady_v1.ticks tick
      where tick.session_id = session.session_id and tick.status = 'completed')::integer as completed_tick_rows,
    (select count(*) from xrpl_steady_v1.works work
      where work.session_id = session.session_id and work.status = 'committed')::integer as committed_work_rows,
    (select count(distinct tick.scheduled_minute) from xrpl_steady_v1.ticks tick
      where tick.session_id = session.session_id and tick.status = 'completed')::integer as distinct_minutes,
    (select count(*) from xrpl_steady_v1.sessions running where running.status = 'running')::integer as running_sessions
  from xrpl_steady_v1.sessions session
  where session.session_id = $3::text
), recovery as (
  select * from xrpl_r5_v1.recovery_runs where run_id = $2::text
)
select jsonb_build_object(
  'databaseBytes', pg_database_size(current_database())::bigint,
  'databaseHaltBytes', $4::bigint,
  'catchupLiveRows', (select live_rows from catchup_counts),
  'catchupTotalBytes', (select total_bytes from catchup_size),
  'archive', (
    select to_jsonb(archive)
    from xrpl_qualification_archive_v1.catchup_reclaims archive
    where archive.archive_id = $1::text
  ),
  'seal', (
    select to_jsonb(seal)
    from xrpl_qualification_archive_v1.catchup_reclaim_seals seal
    where seal.archive_id = $1::text
  ),
  'recovery', (select to_jsonb(recovery) from recovery),
  'steady', (select to_jsonb(steady) from steady),
  'activeWatermark', (
    select to_jsonb(watermark)
    from public.xrpl_phase_watermarks watermark
    where watermark.profile_id = 'supabase-devnet'
  )
) as retained_state
`
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: sql,
      parameters: [archiveId, recoveryRunId, retainedSteadySessionId, databaseHaltBytes],
      read_only: true,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  const body = parse(await response.text())
  if (!response.ok) {
    throw new Error(`retained qualification query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`)
  }
  const row = rows(body)[0]
  if (!row) throw new Error('retained qualification query returned no row')
  return object(row.retained_state ?? row.retainedState ?? row, 'retained qualification state')
}

function verifyState(state) {
  const archive = object(state.archive, 'catch-up archive')
  const archiveEvidence = object(archive.evidence, 'catch-up archive evidence')
  const seal = object(state.seal, 'catch-up archive seal')
  const sealChecks = object(seal.checks, 'catch-up archive seal checks')
  const recovery = object(state.recovery, 'R5 recovery')
  const steady = object(state.steady, 'retained steady session')
  const watermark = object(state.activeWatermark, 'active watermark')
  const databaseBytes = integer(state.databaseBytes, 'database bytes')

  if (databaseBytes >= databaseHaltBytes) {
    throw new Error(`database remains above the fixed halt: ${databaseBytes}`)
  }
  if (integer(state.catchupLiveRows, 'catch-up live rows') !== 0) {
    throw new Error('catch-up raw qualification rows were not fully reclaimed')
  }
  if (integer(state.catchupTotalBytes, 'catch-up total bytes') >= 17_000_000) {
    throw new Error('catch-up qualification storage was not materially reclaimed')
  }
  if (
    archive.archive_id !== archiveId
    || integer(archive.source_workflow_run_id, 'archive source run') !== sourceWorkflowRunId
    || archive.source_commit !== sourceCommit
    || integer(archive.source_artifact_id, 'archive artifact id') !== sourceArtifactId
    || archive.source_artifact_digest !== sourceArtifactDigest
    || archive.retained_run_id !== retainedCatchUpRunId
    || integer(archive.retained_trial_count, 'archive trial count') !== 5
    || archive.reclaimed_schema !== 'xrpl_catchup_v1'
    || !/^[a-f0-9]{64}$/.test(archive.evidence_digest ?? '')
    || archiveEvidence.sourceCatchUpEvidenceSha256 !== sourceCatchUpEvidenceSha256
    || archiveEvidence.sourceSteadyEvidenceSha256 !== sourceSteadyEvidenceSha256
  ) {
    throw new Error('catch-up archive identity is invalid')
  }
  if (
    seal.archive_id !== archiveId
    || integer(seal.schema_version, 'seal schema version') !== 1
    || integer(seal.source_workflow_run_id, 'seal source run') !== sourceWorkflowRunId
    || seal.source_commit !== sourceCommit
    || integer(seal.source_artifact_id, 'seal artifact id') !== sourceArtifactId
    || seal.source_artifact_digest !== sourceArtifactDigest
    || seal.retained_run_id !== retainedCatchUpRunId
    || seal.evidence_digest !== archive.evidence_digest
    || seal.source_catchup_evidence_sha256 !== sourceCatchUpEvidenceSha256
    || seal.source_steady_evidence_sha256 !== sourceSteadyEvidenceSha256
    || sealChecks.archiveDigestRecomputedAtDeploy !== true
    || sealChecks.exactSourceArtifactPinned !== true
    || sealChecks.fiveRetainedTrialsPresent !== true
    || sealChecks.activeR5TablesUntouched !== true
    || sealChecks.activePublicTablesUntouched !== true
    || sealChecks.steadyQualificationUntouched !== true
    || sealChecks.revision3AccountingUntouched !== true
    || sealChecks.publicReaderUnchanged !== true
    || sealChecks.mainnetDisabled !== true
    || sealChecks.stabilizationAuthorized !== false
    || sealChecks.soakAuthorized !== false
    || sealChecks.privateDigestExecuteNotGranted !== true
  ) {
    throw new Error('catch-up archive deploy seal is invalid')
  }
  if (
    recovery.run_id !== recoveryRunId
    || !['running', 'caught_up'].includes(recovery.status)
    || recovery.profile_id !== 'supabase_free_postgres_pgcron_edge'
    || integer(recovery.profile_revision, 'R5 profile revision') !== 3
    || recovery.profile_identity_digest !== '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
    || recovery.selection_digest !== '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
    || recovery.network !== 'devnet'
    || recovery.epoch_id !== 'supabase-r4c2c-v1'
  ) {
    throw new Error('R5 recovery identity changed during retained qualification verification')
  }
  if (
    steady.session_id !== retainedSteadySessionId
    || steady.status !== 'completed'
    || steady.source_profile_id !== 'supabase-devnet'
    || steady.target_profile_id !== 'supabase-devnet-steady-qualification'
    || steady.network !== 'devnet'
    || steady.epoch_id !== 'supabase-r4c2c-v1'
    || integer(steady.target_ticks, 'steady target ticks') !== 6
    || integer(steady.batch_size, 'steady batch size') !== 24
    || integer(steady.completed_ticks, 'steady completed ticks') !== 6
    || integer(steady.committed_ledgers, 'steady committed ledgers') !== 144
    || integer(steady.completed_tick_rows, 'steady completed tick rows') !== 6
    || integer(steady.committed_work_rows, 'steady committed work rows') !== 144
    || integer(steady.distinct_minutes, 'steady minute buckets') !== 6
    || integer(steady.running_sessions, 'steady running sessions') !== 0
  ) {
    throw new Error('retained steady qualification evidence is incomplete or active')
  }
  if (
    watermark.profile_id !== 'supabase-devnet'
    || watermark.network !== 'devnet'
    || watermark.epoch_id !== 'supabase-r4c2c-v1'
    || integer(watermark.ledger_index, 'active watermark ledger') < 1
  ) {
    throw new Error('active Devnet watermark boundary is invalid')
  }

  return {
    databaseBytes,
    databaseHaltBytes,
    databaseHeadroomBytes: databaseHaltBytes - databaseBytes,
    catchupLiveRows: 0,
    catchupTotalBytes: integer(state.catchupTotalBytes, 'catch-up total bytes'),
    archivedPhysicalBytesBefore: integer(archive.physical_bytes_before, 'archive physical bytes before'),
    recoveryStatus: recovery.status,
    recoveryCompletedBatches: integer(recovery.completed_batches, 'R5 completed batches'),
    recoveryCommittedLedgers: integer(recovery.committed_ledgers, 'R5 committed ledgers'),
    activeWatermarkLedger: integer(watermark.ledger_index, 'active watermark ledger'),
    retainedSteadyCompletedTicks: 6,
    retainedSteadyCommittedLedgers: 144,
  }
}

export async function verifyRetainedR5Qualifications() {
  const ownershipEvidence = await ownership()
  if (ownershipEvidence === null) return null
  await mkdir(evidenceDirectory, { recursive: true })
  try {
    const state = await queryRetainedState()
    const observed = verifyState(state)
    const combined = {
      schemaVersion: 1,
      purpose: 'r5-retained-qualification-evidence-verification',
      verifiedAt: new Date().toISOString(),
      sourceWorkflowRunId,
      sourceCommit,
      sourceArtifactId,
      sourceArtifactDigest,
      sourceCatchUpEvidenceSha256,
      sourceSteadyEvidenceSha256,
      recoveryRunId,
      retainedCatchUpRunId,
      retainedSteadySessionId,
      ownership: ownershipEvidence,
      observed,
      checks: {
        readOnlyDatabaseQuery: true,
        exactSourceArtifactPinned: true,
        catchUpRawRowsReclaimed: true,
        catchUpEvidenceDeploySealed: true,
        privateDigestExecuteNotGranted: true,
        fixedDatabaseHaltRestored: true,
        R5RecoveryIdentityUnchanged: true,
        steadyEvidenceRetained: true,
        noFreshQualificationExecuted: true,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      },
    }
    await writeFile(combinedSuccessPath, `${JSON.stringify(combined, null, 2)}\n`)
    return {
      combined,
      catchUp: {
        ...retainedCatchUpEvidence,
        retainedDuringR5Recovery: true,
        retainedSource: combined,
      },
      steady: {
        ...retainedSteadyEvidence,
        retainedDuringR5Recovery: true,
        retainedSource: combined,
      },
    }
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      purpose: 'r5-retained-qualification-evidence-verification',
      failedAt: new Date().toISOString(),
      recoveryRunId,
      reason: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    }
    await writeFile(combinedFailurePath, `${JSON.stringify(failure, null, 2)}\n`)
    throw error
  }
}

if (process.argv[1]?.endsWith('verify-supabase-retained-r5-qualification-evidence-v2.mjs')) {
  const retained = await verifyRetainedR5Qualifications()
  if (retained === null) {
    throw new Error('active R5 recovery ownership is required for retained qualification verification')
  }
  process.stdout.write(`${JSON.stringify(retained.combined)}\n`)
}
