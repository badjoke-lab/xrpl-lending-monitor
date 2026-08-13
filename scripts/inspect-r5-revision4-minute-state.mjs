import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const outputPath = process.argv[2] ?? 'r5-revision4-minute-activation-evidence/state.json'
const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const invocationHalt31d = 400000
const baseMigrationVersion = '20260813060000'
const targetMigrationVersion = '20260813072000'
const runId = 'r5-recovery-selected-revision4-entry'
const profileDigest = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const continuousSignature = 'public.xrpl_refresh_r5_revision4_continuous_head(text,bigint,text,timestamp with time zone)'

if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID must be exact')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN unavailable')

const projectIdentityDigest = createHash('sha256').update(projectRef).digest('hex')
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

function parseJson(text) {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 2000) } }
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  throw new Error('Management API response contains no rows')
}

async function query(sql, parameters = []) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query: sql, parameters, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new Error(`Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  }
  return rowsFromResponse(body)
}

function exactlyOne(rows, name) {
  if (rows.length !== 1) throw new Error(`${name} expected one row, found ${rows.length}`)
  return rows[0]
}

function integer(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} invalid`)
  return parsed
}

const run = exactlyOne(await query(
  `select run_id, profile_id, profile_revision, profile_identity_digest, selection_digest,
          source_profile_id, network, epoch_id, base_identity, status, last_error,
          current_watermark_ledger_index, current_watermark_ledger_hash, current_watermark_work_id,
          initial_validated_head_ledger_index, initial_validated_head_ledger_hash,
          completed_batches, committed_ledgers, last_accounting_digest,
          started_at, completed_at, updated_at
     from xrpl_r5_v1.recovery_runs
    where run_id = $1::text`,
  [runId],
), 'R5 run')

if (
  run.run_id !== runId
  || run.profile_id !== 'supabase_free_postgres_pgcron_edge'
  || integer(run.profile_revision, 'profile revision') !== 4
  || run.profile_identity_digest !== profileDigest
  || run.source_profile_id !== 'supabase-devnet'
  || run.network !== 'devnet'
  || run.epoch_id !== 'supabase-r4c2c-v1'
  || typeof run.base_identity !== 'string'
  || run.base_identity.length === 0
) throw new Error('R5 run identity is not the exact revision-4 Devnet run')

const batchCounts = exactlyOne(await query(
  `select count(*)::bigint as total,
          count(*) filter (where status = 'leased')::bigint as leased,
          count(*) filter (where status = 'committed')::bigint as committed,
          count(*) filter (where status = 'failed')::bigint as failed
     from xrpl_r5_v1.recovery_batches
    where run_id = $1::text`,
  [runId],
), 'R5 batch counts')

const latestBatchRows = await query(
  `select to_jsonb(b) as batch
     from xrpl_r5_v1.recovery_batches b
    where b.run_id = $1::text
    order by b.batch_sequence desc, b.batch_id desc
    limit 1`,
  [runId],
)
if (latestBatchRows.length > 1) throw new Error('latest R5 batch query returned multiple rows')
const latestBatch = latestBatchRows.length === 1 ? latestBatchRows[0].batch : null

const watermark = exactlyOne(await query(
  `select profile_id, network, epoch_id, base_identity, ledger_index, ledger_hash, work_id, updated_at
     from public.xrpl_phase_watermarks
    where profile_id = 'supabase-devnet'`,
), 'public watermark')
if (watermark.network !== run.network || watermark.epoch_id !== run.epoch_id || watermark.base_identity !== run.base_identity) {
  throw new Error('public watermark identity does not match retained R5 run')
}

const runWatermarkLedger = integer(run.current_watermark_ledger_index, 'run watermark ledger')
const activeWatermarkLedger = integer(watermark.ledger_index, 'active watermark ledger')
if (activeWatermarkLedger < runWatermarkLedger) throw new Error('public watermark regressed behind retained R5 boundary')
const boundaryDriftLedgers = activeWatermarkLedger - runWatermarkLedger
if (boundaryDriftLedgers === 0 && (watermark.ledger_hash !== run.current_watermark_ledger_hash || watermark.work_id !== run.current_watermark_work_id)) {
  throw new Error('same-ledger public watermark identity conflicts with retained R5 boundary')
}

const snapshot = exactlyOne(await query(
  `select snapshot_id, source_run_id, source_commit, observed_at,
          management_api_available, invocation_count_24h, projected_invocations_31d,
          function_count, max_bundle_bytes, max_bundle_name, bundle_count, evidence_digest
     from xrpl_resource_guard_v1.external_snapshots
    order by observed_at desc, snapshot_id desc
    limit 1`,
), 'latest external resource snapshot')
const observedAt = Date.parse(String(snapshot.observed_at ?? ''))
if (!Number.isFinite(observedAt)) throw new Error('latest resource snapshot observed_at invalid')
const snapshotFresh = Date.now() - observedAt >= 0 && Date.now() - observedAt <= 25 * 60 * 60 * 1000
const projectedInvocations31d = integer(snapshot.projected_invocations_31d, 'projected invocations 31d')
const invocationCount24h = integer(snapshot.invocation_count_24h, 'invocation count 24h')
const functionCount = integer(snapshot.function_count, 'function count')
const maxBundleBytes = integer(snapshot.max_bundle_bytes, 'max bundle bytes')
const bundleCount = integer(snapshot.bundle_count, 'bundle count')
if (!snapshotFresh) throw new Error('provider_snapshot_stale')
if (projectedInvocations31d >= invocationHalt31d) throw new Error('monthly_invocation_halt')
if (snapshot.management_api_available !== true || functionCount < 1 || maxBundleBytes < 1 || bundleCount < 1 || typeof snapshot.max_bundle_name !== 'string' || snapshot.max_bundle_name.length === 0 || typeof snapshot.evidence_digest !== 'string' || !/^[a-f0-9]{64}$/u.test(snapshot.evidence_digest)) {
  throw new Error('fresh resource snapshot lacks required exact management/bundle coverage')
}

const migrationRows = await query(
  `select version::text as version from supabase_migrations.schema_migrations
    where version::text in ($1::text, $2::text) order by version::text`,
  [baseMigrationVersion, targetMigrationVersion],
)
const versions = migrationRows.map((row) => String(row.version))
if (!versions.includes(baseMigrationVersion)) throw new Error('base continuous-head migration is not applied')
const targetApplied = versions.includes(targetMigrationVersion)
const migrationMax = String(exactlyOne(await query(
  `select max(version::text) as max_version from supabase_migrations.schema_migrations`,
), 'migration max').max_version ?? '')
if (!targetApplied && migrationMax !== baseMigrationVersion) throw new Error(`unexpected migration boundary before follow-up:${migrationMax}`)
if (targetApplied && migrationMax !== targetMigrationVersion) throw new Error(`unexpected migration exists after follow-up:${migrationMax}`)

const contract = exactlyOne(await query(
  `select p.prosecdef as security_definer,
          pg_get_functiondef(p.oid) as function_definition,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
     from pg_proc p where p.oid = to_regprocedure($1::text)`,
  [continuousSignature],
), 'continuous-head function')
const definition = String(contract.function_definition ?? '')
const commonMarkers = [
  'r5-recovery-selected-revision4-entry', profileDigest,
  'v_invocation_halt constant bigint := 400000', 'r5_recovery_monthly_invocation_halt',
  'provider_snapshot_stale', 'monthly_invocation_halt', 'claimResourceGuardsStillRequired', 'mainnetDisabled',
]
for (const marker of commonMarkers) if (!definition.includes(marker)) throw new Error(`continuous-head common marker missing:${marker}`)
if (contract.security_definer !== true || contract.anon_execute !== false || contract.authenticated_execute !== false || contract.service_role_execute !== true) {
  throw new Error('continuous-head ACL/security contract mismatch')
}
const rebindMarkers = [
  'public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(',
  'active_boundary_drift_requires_operator',
  'invocation_halt_rearmed_and_active_boundary_rebound',
]
if (targetApplied) {
  for (const marker of rebindMarkers) if (!definition.includes(marker)) throw new Error(`follow-up rebind marker missing:${marker}`)
} else {
  if (!definition.includes('r5_revision4_continuous_head_watermark_drift')) throw new Error('base continuous-head marker missing')
  if (rebindMarkers.some((marker) => definition.includes(marker))) throw new Error('follow-up semantics present without registered follow-up migration')
}
const functionDefinitionDigest = createHash('sha256').update(definition).digest('hex')

const totalBatches = integer(batchCounts.total, 'batch total')
const leasedBatches = integer(batchCounts.leased, 'leased batches')
const committedBatches = integer(batchCounts.committed, 'committed batch rows')
const failedBatches = integer(batchCounts.failed, 'failed batch rows')
const runCompletedBatches = integer(run.completed_batches, 'run completed batches')
const committedLedgers = integer(run.committed_ledgers, 'run committed ledgers')
if (leasedBatches !== 0) throw new Error('R5 has an active leased batch')

let activationMode
let activationBlockedReason = null
if (run.status === 'halted' && run.last_error === 'r5_recovery_monthly_invocation_halt') {
  if (totalBatches !== 0 || committedBatches !== 0 || runCompletedBatches !== 0 || committedLedgers !== 0 || run.last_accounting_digest !== null) {
    throw new Error('invocation-halted R5 run contains unexpected recovery progress')
  }
  activationMode = 'halted_invocation_rearm'
} else if (run.status === 'prepared') {
  if (totalBatches !== 0 || runCompletedBatches !== 0 || committedLedgers !== 0 || run.last_accounting_digest !== null) {
    throw new Error('prepared R5 run contains unexpected recovery progress')
  }
  activationMode = 'prepared_continue'
} else if (run.status === 'caught_up') {
  if (boundaryDriftLedgers !== 0) throw new Error('caught-up R5 run drifted under old collector')
  activationMode = 'caught_up_reopen'
} else {
  activationMode = 'blocked_failure_state'
  activationBlockedReason = `unsupported R5 activation state:${String(run.status)}:${String(run.last_error)}`
}

const migrationState = targetApplied ? 'applied_verified' : 'pending'
const stableBinding = {
  projectIdentityDigest, activationMode, activationBlockedReason,
  runId: run.run_id, runStatus: run.status, runLastError: run.last_error,
  profileRevision: Number(run.profile_revision),
  profileIdentityDigest: run.profile_identity_digest, selectionDigest: run.selection_digest,
  runWatermarkLedger, runWatermarkHash: run.current_watermark_ledger_hash,
  activeWatermarkLedger, activeWatermarkHash: watermark.ledger_hash, activeWatermarkWorkId: watermark.work_id,
  boundaryDriftLedgers, totalBatches, failedBatches,
  completedBatches: runCompletedBatches, committedLedgers,
  snapshotId: snapshot.snapshot_id, snapshotObservedAt: snapshot.observed_at,
  snapshotSourceRunId: Number(snapshot.source_run_id), snapshotSourceCommit: snapshot.source_commit,
  invocationCount24h, projectedInvocations31d, invocationHalt31d, functionCount,
  maxBundleBytes, maxBundleName: snapshot.max_bundle_name, bundleCount,
  baseMigrationVersion, targetMigrationVersion, migrationState, currentMaxMigrationVersion: migrationMax,
  functionDefinitionDigest,
}
const stateDigest = createHash('sha256').update(JSON.stringify(stableBinding)).digest('hex')

const evidence = {
  schemaVersion: 4,
  purpose: 'r5-revision4-minute-activation-state',
  projectIdentityDigest,
  run: {
    runId: run.run_id, status: run.status, lastError: run.last_error,
    profileRevision: Number(run.profile_revision), profileIdentityDigest: run.profile_identity_digest,
    selectionDigest: run.selection_digest, completedBatches: runCompletedBatches, committedLedgers,
    lastAccountingDigest: run.last_accounting_digest,
    currentWatermarkLedgerIndex: runWatermarkLedger,
    currentWatermarkLedgerHash: run.current_watermark_ledger_hash,
    initialValidatedHeadLedgerIndex: Number(run.initial_validated_head_ledger_index), updatedAt: run.updated_at,
  },
  batchCounts: {
    total: totalBatches,
    leased: leasedBatches,
    committed: committedBatches,
    failed: failedBatches,
  },
  latestBatch,
  activeWatermark: { ledgerIndex: activeWatermarkLedger, ledgerHash: watermark.ledger_hash, workId: watermark.work_id, updatedAt: watermark.updated_at },
  boundaryDriftLedgers,
  boundaryRebindRequired: boundaryDriftLedgers > 0,
  resourceSnapshot: {
    snapshotId: snapshot.snapshot_id, sourceRunId: Number(snapshot.source_run_id), sourceCommit: snapshot.source_commit,
    observedAt: snapshot.observed_at, managementApiAvailable: snapshot.management_api_available,
    invocationCount24h, projectedInvocations31d, invocationHalt31d, functionCount, maxBundleBytes,
    maxBundleName: snapshot.max_bundle_name, bundleCount, evidenceDigest: snapshot.evidence_digest, fresh: snapshotFresh,
  },
  migration: {
    baseVersion: baseMigrationVersion, targetVersion: targetMigrationVersion, targetApplied,
    migrationState, currentMaxVersion: migrationMax, functionDefinitionDigest,
  },
  activationMode,
  activationBlockedReason,
  stateDigest,
  stableBinding,
  mainnetDisabled: true,
  checkedAt: new Date().toISOString(),
}

await mkdir(outputPath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify(evidence))

if (activationBlockedReason !== null) {
  throw new Error(activationBlockedReason)
}

if (process.env.GITHUB_OUTPUT) {
  const lines = [
    `activation_mode=${activationMode}`,
    `state_digest=${stateDigest}`,
    `snapshot_id=${snapshot.snapshot_id}`,
    `snapshot_observed_at=${snapshot.observed_at}`,
    `projected_invocations_31d=${projectedInvocations31d}`,
    `run_watermark_ledger_index=${runWatermarkLedger}`,
    `active_watermark_ledger_index=${activeWatermarkLedger}`,
    `boundary_drift_ledgers=${boundaryDriftLedgers}`,
    `migration_max=${migrationMax}`,
    `migration_state=${migrationState}`,
    `migration_function_digest=${functionDefinitionDigest}`,
  ]
  const { appendFile } = await import('node:fs/promises')
  await appendFile(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}
