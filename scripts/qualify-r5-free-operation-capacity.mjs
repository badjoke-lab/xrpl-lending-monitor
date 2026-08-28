#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const PROFILE_IDENTITY = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const DATABASE_HALT_BYTES = 400_000_000
const PROJECT_EGRESS_HALT_31D_BYTES = 4 * 1024 * 1024 * 1024
const PROJECT_MEMORY_HALT_BYTES = 224 * 1024 * 1024
const PROJECT_INVOCATION_HALT_31D = 400_000
const SELECTED_MAX_LEDGERS_PER_CLAIM = 12
const RETAINED_SAMPLE_LEDGERS = 14
const RESERVE_WINDOWS = 14
const OBSERVED_ROW_COUNT_SAFETY_MULTIPLIER = 2
const TRANSPORT_AND_R5_OVERHEAD_ROWS_PER_LEDGER = 4
const MIN_PHYSICAL_ROW_BYTES = 512
const RAW_JOB_NAME = 'xrpl-r5-raw-evidence-retention-v1'
const RAW_JOB_SCHEDULE = '47 */6 * * *'
const RAW_JOB_COMMAND_SHA256 = 'a7029e464b56f7652b7690b6a8f5b90331d5dfbb0812e3a0ab2788987c64ec98'
const RAW_CADENCE_LAG_BUDGET_WORK = 120

const REVIEWED_RESOURCE_BASELINE = {
  runId: 31882543711,
  sourceCommit: '30d066ccb90c1efde1bd6bc80af620e32e214143',
  evidenceDigest: '46d2b25203b291dfa26030b31d1742bde883fda96763ea61ac88db6a449f31c9',
  classification: 'no_resource_halt_reproduced',
  egressUpperBytes: 10_197,
  memoryUpperBytes: 211_700_811,
  projectEgressHeadroomBeforeBatch: 127_398_928,
  runtimeAccountingBlobSha1: '3e20670008ee9438797eef8e79ff40fcd4fb23d7',
  directionalContractBlobSha1: 'b9bc8222ccf7383ba9f29766d4e061eb3ca66e96',
}
const RUNTIME_ACCOUNTING_PATH = 'src/shared/supabase-revision4-r5-runtime-accounting.ts'
const DIRECTIONAL_CONTRACT_PATH = 'src/shared/supabase-revision4-directional-egress-contract.ts'

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    const token = argv[i]
    const value = argv[i + 1]
    if (!token?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${token ?? '<end>'}`)
    options[token.slice(2)] = value
  }
  return options
}
function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
  fail('Management API response contains no rows')
}
async function managementQuery(query) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(90_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  if (!response.ok) fail(`Supabase Management API read-only query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}
function firstState(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
function number(value, name) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) fail(`${name} invalid`)
  return parsed
}
async function gitBlobSha1(path) {
  const content = await readFile(resolve(path))
  return createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex')
}
async function writeJson(path, value) {
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function stateSql() {
  return `with recent_work as (
    select work_id,
           greatest(coalesce(expected_payload_chunks,0),0)::bigint as expected_payload_chunks,
           greatest(coalesce(expected_commit_chunks,0),0)::bigint as expected_commit_chunks
      from public.xrpl_phase_work
     where profile_id='supabase-devnet' and status='committed' and committed_at is not null
     order by committed_at desc, work_id desc
     limit ${RETAINED_SAMPLE_LEDGERS}
  ), per_work as (
    select r.work_id,
           1::bigint as work_rows,
           r.expected_payload_chunks as generated_payload_rows,
           r.expected_commit_chunks as generated_commit_rows,
           (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=r.work_id)::bigint as retained_payload_rows,
           (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=r.work_id)::bigint as retained_commit_rows,
           (select count(*) from public.xrpl_phase_reference_rows x where x.work_id=r.work_id)::bigint as reference_rows
      from recent_work r
  ), relation_metrics as (
    select 'xrpl_phase_work'::text as name, 'persistent'::text as retention_class,
           count(*)::bigint as exact_rows, pg_total_relation_size('public.xrpl_phase_work'::regclass)::bigint as total_bytes,
           coalesce(sum(pg_column_size(to_jsonb(t))),0)::bigint as logical_bytes,
           coalesce(max(pg_column_size(to_jsonb(t))),0)::bigint as max_logical_row_bytes
      from public.xrpl_phase_work t
    union all
    select 'xrpl_phase_payload_chunks','raw_24h',count(*)::bigint,pg_total_relation_size('public.xrpl_phase_payload_chunks'::regclass)::bigint,
           coalesce(sum(pg_column_size(to_jsonb(t))),0)::bigint,coalesce(max(pg_column_size(to_jsonb(t))),0)::bigint
      from public.xrpl_phase_payload_chunks t
    union all
    select 'xrpl_phase_commit_chunks','raw_24h',count(*)::bigint,pg_total_relation_size('public.xrpl_phase_commit_chunks'::regclass)::bigint,
           coalesce(sum(pg_column_size(to_jsonb(t))),0)::bigint,coalesce(max(pg_column_size(to_jsonb(t))),0)::bigint
      from public.xrpl_phase_commit_chunks t
    union all
    select 'xrpl_phase_reference_rows','persistent',count(*)::bigint,pg_total_relation_size('public.xrpl_phase_reference_rows'::regclass)::bigint,
           coalesce(sum(pg_column_size(to_jsonb(t))),0)::bigint,coalesce(max(pg_column_size(to_jsonb(t))),0)::bigint
      from public.xrpl_phase_reference_rows t
    union all
    select 'xrpl_phase_messages','persistent',count(*)::bigint,pg_total_relation_size('public.xrpl_phase_messages'::regclass)::bigint,
           coalesce(sum(pg_column_size(to_jsonb(t))),0)::bigint,coalesce(max(pg_column_size(to_jsonb(t))),0)::bigint
      from public.xrpl_phase_messages t
    union all
    select 'xrpl_phase_successors','persistent',count(*)::bigint,pg_total_relation_size('public.xrpl_phase_successors'::regclass)::bigint,
           coalesce(sum(pg_column_size(to_jsonb(t))),0)::bigint,coalesce(max(pg_column_size(to_jsonb(t))),0)::bigint
      from public.xrpl_phase_successors t
    union all
    select 'recovery_batches','persistent',count(*)::bigint,pg_total_relation_size('xrpl_r5_v1.recovery_batches'::regclass)::bigint,
           coalesce(sum(pg_column_size(to_jsonb(t))),0)::bigint,coalesce(max(pg_column_size(to_jsonb(t))),0)::bigint
      from xrpl_r5_v1.recovery_batches t
  ), active_watermark as (
    select * from public.xrpl_phase_watermarks where profile_id='supabase-devnet'
  ), current_work as (
    select w.* from public.xrpl_phase_work w join active_watermark wm on wm.work_id=w.work_id
     where w.profile_id='supabase-devnet' and w.status='committed' and w.committed_at is not null
       and w.scanned_end_ledger_index=wm.ledger_index and w.final_ledger_hash=wm.ledger_hash
  ), predecessor_work as (
    select p.* from current_work c join public.xrpl_phase_work p
      on p.profile_id=c.profile_id and p.status='committed' and p.committed_at is not null
     and p.scanned_end_ledger_index=c.previous_ledger_index and p.final_ledger_hash=c.expected_parent_hash
     order by p.committed_at desc,p.work_id desc limit 1
  ), protected_work as (
    select work_id from current_work union select work_id from predecessor_work
  ), old_complete_work as (
    select w.work_id from public.xrpl_phase_work w
     where w.profile_id='supabase-devnet' and w.status='committed' and w.committed_at is not null
       and w.committed_at < now()-interval '24 hours'
       and not exists(select 1 from protected_work p where p.work_id=w.work_id)
       and (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=w.work_id)=w.expected_payload_chunks
       and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id)=w.expected_commit_chunks
       and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id and c.status='completed')=w.expected_commit_chunks
  ), raw_job as (
    select count(*)::bigint as rows,
           min(schedule)::text as schedule,
           coalesce(bool_and(active),false) as active,
           coalesce(encode(extensions.digest(min(command)::text,'sha256'),'hex'),'') as command_sha256
      from cron.job where jobname='${RAW_JOB_NAME}'
  )
  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database())::bigint,
    'restoreSchemaExists', to_regnamespace('xrpl_resource_restore_v1') is not null,
    'archiveTableExists', to_regclass('xrpl_phase_archive_v1.terminal_messages') is not null,
    'archiveRlsEnabled', coalesce((select relrowsecurity from pg_class where oid=to_regclass('xrpl_phase_archive_v1.terminal_messages')), false),
    'archiveRows', (select count(*)::bigint from xrpl_phase_archive_v1.terminal_messages),
    'sampleLedgerCount', (select count(*)::bigint from recent_work),
    'samplePerLedgerRows', coalesce((select jsonb_agg(jsonb_build_object(
       'workId',work_id,'workRows',work_rows,
       'generatedPayloadRows',generated_payload_rows,'generatedCommitRows',generated_commit_rows,
       'retainedPayloadRows',retained_payload_rows,'retainedCommitRows',retained_commit_rows,
       'referenceRows',reference_rows,
       'generatedDirectRows',work_rows+generated_payload_rows+generated_commit_rows+reference_rows
    ) order by work_id) from per_work), '[]'::jsonb),
    'maxWorkRowsPerLedger', coalesce((select max(work_rows)::bigint from per_work),0),
    'maxGeneratedPayloadRowsPerLedger', coalesce((select max(generated_payload_rows)::bigint from per_work),0),
    'maxGeneratedCommitRowsPerLedger', coalesce((select max(generated_commit_rows)::bigint from per_work),0),
    'maxReferenceRowsPerLedger', coalesce((select max(reference_rows)::bigint from per_work),0),
    'maxGeneratedDirectRowsPerLedger', coalesce((select max(work_rows+generated_payload_rows+generated_commit_rows+reference_rows)::bigint from per_work),0),
    'relationMetrics', (select jsonb_agg(jsonb_build_object(
       'name',name,'retentionClass',retention_class,'exactRows',exact_rows,'totalBytes',total_bytes,
       'logicalBytes',logical_bytes,'maxLogicalRowBytes',max_logical_row_bytes
    ) order by name) from relation_metrics),
    'persistentPhysicalAmplificationFactor', coalesce((select ceil(sum(total_bytes)::numeric/greatest(sum(logical_bytes),1))::bigint from relation_metrics where retention_class='persistent'),0),
    'maxPersistentPhysicalBytesPerRow', coalesce((select max(ceil(total_bytes::numeric/greatest(exact_rows,1)))::bigint from relation_metrics where retention_class='persistent'),0),
    'rawRetention', (select jsonb_build_object(
       'jobCount',rows,'schedule',schedule,'active',active,'commandSha256',command_sha256,
       'oldCompleteWorkCount',(select count(*)::bigint from old_complete_work)
    ) from raw_job),
    'run', coalesce((select jsonb_build_object(
       'runId',run_id,'status',status,'lastError',last_error,'profileRevision',profile_revision,
       'profileIdentityDigest',profile_identity_digest,'network',network,'epochId',epoch_id,
       'completedBatches',completed_batches,'committedLedgers',committed_ledgers,'watermarkLedgerIndex',current_watermark_ledger_index
     ) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),'null'::jsonb),
    'batchCounts', (select jsonb_build_object('total',count(*),'leased',count(*) filter(where status='leased'),'halted',count(*) filter(where status='halted'),'committed',count(*) filter(where status='committed')) from xrpl_r5_v1.recovery_batches where run_id='${ACTIVE_RUN_ID}'),
    'scheduler', coalesce((select jsonb_build_object('count',count(*),'schedule',min(schedule),'active',bool_and(active),'commandSha256',encode(extensions.digest(min(command)::text,'sha256'),'hex')) from cron.job where jobname='xrpl-lending-monitor-minute'),'null'::jsonb),
    'migrationHead', (select max(version::text) from supabase_migrations.schema_migrations)
  ) as state;`
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
if (!options.output) fail('--output is required')

const [runtimeAccountingBlobSha1, directionalContractBlobSha1] = await Promise.all([
  gitBlobSha1(RUNTIME_ACCOUNTING_PATH),
  gitBlobSha1(DIRECTIONAL_CONTRACT_PATH),
])
const reviewedResourceAccountingUnchanged = runtimeAccountingBlobSha1 === REVIEWED_RESOURCE_BASELINE.runtimeAccountingBlobSha1
  && directionalContractBlobSha1 === REVIEWED_RESOURCE_BASELINE.directionalContractBlobSha1
const state = firstState(await managementQuery(stateSql()))

const databaseBytes = number(state.databaseBytes, 'databaseBytes')
const databaseHeadroomBytes = DATABASE_HALT_BYTES - databaseBytes
const sampleLedgerCount = number(state.sampleLedgerCount, 'sampleLedgerCount')
const physicalAmplificationFactor = number(state.persistentPhysicalAmplificationFactor, 'persistentPhysicalAmplificationFactor')
const maxPersistentPhysicalBytesPerRow = Math.max(number(state.maxPersistentPhysicalBytesPerRow, 'maxPersistentPhysicalBytesPerRow'), MIN_PHYSICAL_ROW_BYTES)
const relationMetrics = Array.isArray(state.relationMetrics) ? state.relationMetrics : []
function metric(name) {
  const found = relationMetrics.find((entry) => entry?.name === name)
  if (!found) fail(`missing relation metric: ${name}`)
  return found
}
function projectedPhysicalRowBytes(name) {
  const maxLogical = number(metric(name).maxLogicalRowBytes, `${name}.maxLogicalRowBytes`)
  if (maxLogical <= 0) fail(`${name} has no logical-row sample`)
  return Math.max(MIN_PHYSICAL_ROW_BYTES, Math.ceil(maxLogical * physicalAmplificationFactor))
}

const observedRows = {
  work: number(state.maxWorkRowsPerLedger, 'maxWorkRowsPerLedger'),
  payload: number(state.maxGeneratedPayloadRowsPerLedger, 'maxGeneratedPayloadRowsPerLedger'),
  commit: number(state.maxGeneratedCommitRowsPerLedger, 'maxGeneratedCommitRowsPerLedger'),
  reference: number(state.maxReferenceRowsPerLedger, 'maxReferenceRowsPerLedger'),
}
const maxGeneratedDirectRowsPerLedger = number(state.maxGeneratedDirectRowsPerLedger, 'maxGeneratedDirectRowsPerLedger')
const projectedRows = {
  work: Math.max(1, observedRows.work) * OBSERVED_ROW_COUNT_SAFETY_MULTIPLIER,
  payload: Math.max(1, observedRows.payload) * OBSERVED_ROW_COUNT_SAFETY_MULTIPLIER,
  commit: Math.max(1, observedRows.commit) * OBSERVED_ROW_COUNT_SAFETY_MULTIPLIER,
  reference: Math.max(1, observedRows.reference) * OBSERVED_ROW_COUNT_SAFETY_MULTIPLIER,
  genericOverhead: TRANSPORT_AND_R5_OVERHEAD_ROWS_PER_LEDGER,
}
const projectedPhysicalBytes = {
  work: projectedPhysicalRowBytes('xrpl_phase_work'),
  payload: projectedPhysicalRowBytes('xrpl_phase_payload_chunks'),
  commit: projectedPhysicalRowBytes('xrpl_phase_commit_chunks'),
  reference: projectedPhysicalRowBytes('xrpl_phase_reference_rows'),
  genericOverhead: maxPersistentPhysicalBytesPerRow,
}
const projectedRowsPerLedger = Object.values(projectedRows).reduce((sum, value) => sum + value, 0)
const projectedDatabaseBytesPerLedger = Object.entries(projectedRows).reduce(
  (sum, [key, rows]) => sum + (rows * projectedPhysicalBytes[key]),
  0,
)
const projectedIncrementalRows = projectedRowsPerLedger * SELECTED_MAX_LEDGERS_PER_CLAIM
const requiredReserveRows = projectedIncrementalRows * RESERVE_WINDOWS
const projectedIncrementalDatabaseBytes = projectedDatabaseBytesPerLedger * SELECTED_MAX_LEDGERS_PER_CLAIM
const requiredReserveDatabaseBytes = projectedIncrementalDatabaseBytes * RESERVE_WINDOWS
const projectedDatabaseBytesOneClaim = databaseBytes + projectedIncrementalDatabaseBytes
const projectedDatabaseBytesReserve = databaseBytes + requiredReserveDatabaseBytes
const maxProjectedPhysicalBytesPerRow = Math.max(...Object.values(projectedPhysicalBytes))
const effectiveProjectedPhysicalBytesPerRow = Math.max(1, Math.ceil(projectedIncrementalDatabaseBytes / projectedIncrementalRows))
const conservativeRemainingCapacityRows = databaseHeadroomBytes > 0
  ? Math.floor(databaseHeadroomBytes / effectiveProjectedPhysicalBytesPerRow)
  : 0

const rawRetention = state.rawRetention ?? {}
const rawRetentionExactContract = Number(rawRetention.jobCount) === 1
  && rawRetention.schedule === RAW_JOB_SCHEDULE
  && rawRetention.active === true
  && rawRetention.commandSha256 === RAW_JOB_COMMAND_SHA256
const rawRetentionLagWithinCadence = number(rawRetention.oldCompleteWorkCount, 'rawRetention.oldCompleteWorkCount') <= RAW_CADENCE_LAG_BUDGET_WORK

const priorEgress31dBytes = PROJECT_EGRESS_HALT_31D_BYTES - REVIEWED_RESOURCE_BASELINE.projectEgressHeadroomBeforeBatch
const projectedEgress31dBytes = priorEgress31dBytes + REVIEWED_RESOURCE_BASELINE.egressUpperBytes
const projectedInvocations31d = 31 * 24 * 60

const currentSpecificationIntact = state.run?.runId === ACTIVE_RUN_ID
  && Number(state.run?.profileRevision) === 4
  && state.run?.profileIdentityDigest === PROFILE_IDENTITY
  && state.run?.network === 'devnet'
  && state.run?.status === 'halted'
  && state.run?.lastError === 'r5_recovery_database_halt'
  && Number(state.batchCounts?.leased ?? -1) === 0
  && Number(state.scheduler?.count ?? -1) === 1
  && state.scheduler?.schedule === '* * * * *'
  && state.scheduler?.active === true

const integrityPreservingReclaimOrRetentionProven = state.restoreSchemaExists === false
  && state.archiveTableExists === true
  && state.archiveRlsEnabled === true
  && rawRetentionExactContract
  && rawRetentionLagWithinCadence

const databaseCapacitySafe = sampleLedgerCount === RETAINED_SAMPLE_LEDGERS
  && physicalAmplificationFactor >= 1
  && maxGeneratedDirectRowsPerLedger > 0
  && projectedIncrementalDatabaseBytes > 0
  && requiredReserveDatabaseBytes < databaseHeadroomBytes
  && projectedDatabaseBytesReserve < DATABASE_HALT_BYTES
const egressCapacitySafe = reviewedResourceAccountingUnchanged
  && projectedEgress31dBytes < PROJECT_EGRESS_HALT_31D_BYTES
const memoryCapacitySafe = reviewedResourceAccountingUnchanged
  && REVIEWED_RESOURCE_BASELINE.memoryUpperBytes < PROJECT_MEMORY_HALT_BYTES
const invocationCapacitySafe = projectedInvocations31d < PROJECT_INVOCATION_HALT_31D

const safeForR5Rearm = currentSpecificationIntact
  && integrityPreservingReclaimOrRetentionProven
  && databaseCapacitySafe
  && egressCapacitySafe
  && memoryCapacitySafe
  && invocationCapacitySafe

const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
const evidence = {
  schemaVersion: 3,
  purpose: 'r5-free-operation-capacity-readonly-qualification',
  sourceCommit,
  projectIdentityDigest: sha256(projectId),
  currentSpecificationIntact,
  integrityPreservingReclaimOrRetentionProven,
  postReclaimCapacityRemeasured: true,
  growthRemeasured: sampleLedgerCount === RETAINED_SAMPLE_LEDGERS,
  growthModel: {
    method: 'retention_aware_generated_rows_times_persistent_physical_amplification',
    logicalByteMeasure: 'pg_column_size(to_jsonb(row))',
    sampleLedgerCount,
    requiredSampleLedgerCount: RETAINED_SAMPLE_LEDGERS,
    generatedRawRowsReconstructedFromWorkExpectations: true,
    observedRowsPerLedger: observedRows,
    maxDirectRowsPerLedger: maxGeneratedDirectRowsPerLedger,
    rowCountSafetyMultiplier: OBSERVED_ROW_COUNT_SAFETY_MULTIPLIER,
    projectedComponentRowsPerLedger: projectedRows,
    projectedComponentPhysicalBytesPerRow: projectedPhysicalBytes,
    projectedRowsPerLedger,
    projectedDatabaseBytesPerLedger,
    selectedMaximumLedgersPerClaim: SELECTED_MAX_LEDGERS_PER_CLAIM,
    projectedIncrementalRows,
    reserveWindows: RESERVE_WINDOWS,
    requiredReserveRows,
    physicalAmplificationFactor,
    maxPersistentPhysicalBytesPerRow,
    maxProjectedPhysicalBytesPerRow,
    maxObservedPhysicalBytesPerRow: maxProjectedPhysicalBytesPerRow,
    effectiveProjectedPhysicalBytesPerRow,
    projectedIncrementalDatabaseBytes,
    requiredReserveDatabaseBytes,
    relationMetrics,
    samplePerLedgerRows: state.samplePerLedgerRows,
  },
  rawRetention: {
    jobName: RAW_JOB_NAME,
    expectedSchedule: RAW_JOB_SCHEDULE,
    expectedCommandSha256: RAW_JOB_COMMAND_SHA256,
    exactContractPresent: rawRetentionExactContract,
    oldCompleteWorkCount: number(rawRetention.oldCompleteWorkCount, 'rawRetention.oldCompleteWorkCount'),
    cadenceLagBudgetWork: RAW_CADENCE_LAG_BUDGET_WORK,
    lagWithinCadence: rawRetentionLagWithinCadence,
  },
  databaseBytes,
  databaseHaltBytes: DATABASE_HALT_BYTES,
  databaseHeadroomBytes,
  conservativeRemainingCapacityRows,
  projectedDatabaseBytesOneClaim,
  projectedDatabaseBytesReserve,
  databaseCapacitySafe,
  resourceBounds: {
    reviewedBaselineRunId: REVIEWED_RESOURCE_BASELINE.runId,
    reviewedBaselineSourceCommit: REVIEWED_RESOURCE_BASELINE.sourceCommit,
    reviewedBaselineEvidenceDigest: REVIEWED_RESOURCE_BASELINE.evidenceDigest,
    reviewedBaselineClassification: REVIEWED_RESOURCE_BASELINE.classification,
    runtimeAccountingBlobSha1,
    expectedRuntimeAccountingBlobSha1: REVIEWED_RESOURCE_BASELINE.runtimeAccountingBlobSha1,
    directionalContractBlobSha1,
    expectedDirectionalContractBlobSha1: REVIEWED_RESOURCE_BASELINE.directionalContractBlobSha1,
    reviewedResourceAccountingUnchanged,
    egressUpperBytes: REVIEWED_RESOURCE_BASELINE.egressUpperBytes,
    priorEgress31dBytes,
    projectedEgress31dBytes,
    projectEgressHalt31dBytes: PROJECT_EGRESS_HALT_31D_BYTES,
    egressCapacitySafe,
    memoryUpperBytes: REVIEWED_RESOURCE_BASELINE.memoryUpperBytes,
    projectMemoryHaltBytes: PROJECT_MEMORY_HALT_BYTES,
    memoryCapacitySafe,
    projectedInvocations31d,
    projectInvocationHalt31d: PROJECT_INVOCATION_HALT_31D,
    invocationCapacitySafe,
  },
  activeRun: state.run,
  batchCounts: state.batchCounts,
  scheduler: state.scheduler,
  migrationHead: state.migrationHead,
  archiveRows: state.archiveRows,
  restoreSchemaExists: state.restoreSchemaExists,
  sustainedFreeOperationCapacityProblemClosed: safeForR5Rearm,
  safeForR5Rearm,
  productionDatabaseReadOnly: true,
  bsrReadExecuted: true,
  rowMutationPerformed: false,
  schedulerMutationPerformed: false,
  deploymentPerformed: false,
  publicReaderMutationPerformed: false,
  migrationMutationPerformed: false,
  r5RearmAuthorized: false,
  r5RearmPerformed: false,
  mainnetEnabled: false,
  generatedAt: new Date().toISOString(),
}
evidence.evidenceDigest = sha256(JSON.stringify({ ...evidence, evidenceDigest: '' }))

await writeJson(options.output, evidence)
process.stdout.write(`${JSON.stringify(evidence)}\n`)
