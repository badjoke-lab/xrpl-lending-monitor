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
const MIN_PHYSICAL_ROW_BYTES = 512
const TRANSPORT_AND_R5_OVERHEAD_ROWS_PER_LEDGER = 4

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
async function readJson(path) {
  if (!path) fail('resource diagnostic path missing')
  return JSON.parse(await readFile(resolve(path), 'utf8'))
}
async function writeJson(path, value) {
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function stateSql() {
  return `with recent_work as (
    select work_id, row_number() over (order by committed_at desc, work_id desc) as ordinal
      from public.xrpl_phase_work
     where profile_id='supabase-devnet' and status='committed' and committed_at is not null
     order by committed_at desc, work_id desc
     limit ${RETAINED_SAMPLE_LEDGERS}
  ), per_work as (
    select r.work_id,
           1::bigint as work_rows,
           (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=r.work_id)::bigint as payload_rows,
           (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=r.work_id)::bigint as commit_rows,
           (select count(*) from public.xrpl_phase_reference_rows x where x.work_id=r.work_id)::bigint as reference_rows
      from recent_work r
  ), relation_metrics as (
    select * from (values
      ('xrpl_phase_work'::text, (select count(*)::bigint from public.xrpl_phase_work), pg_total_relation_size('public.xrpl_phase_work'::regclass)::bigint),
      ('xrpl_phase_payload_chunks', (select count(*)::bigint from public.xrpl_phase_payload_chunks), pg_total_relation_size('public.xrpl_phase_payload_chunks'::regclass)::bigint),
      ('xrpl_phase_commit_chunks', (select count(*)::bigint from public.xrpl_phase_commit_chunks), pg_total_relation_size('public.xrpl_phase_commit_chunks'::regclass)::bigint),
      ('xrpl_phase_reference_rows', (select count(*)::bigint from public.xrpl_phase_reference_rows), pg_total_relation_size('public.xrpl_phase_reference_rows'::regclass)::bigint),
      ('xrpl_phase_messages', (select count(*)::bigint from public.xrpl_phase_messages), pg_total_relation_size('public.xrpl_phase_messages'::regclass)::bigint),
      ('xrpl_phase_successors', (select count(*)::bigint from public.xrpl_phase_successors), pg_total_relation_size('public.xrpl_phase_successors'::regclass)::bigint),
      ('recovery_batches', (select count(*)::bigint from xrpl_r5_v1.recovery_batches), pg_total_relation_size('xrpl_r5_v1.recovery_batches'::regclass)::bigint)
    ) as m(name, exact_rows, total_bytes)
  )
  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database())::bigint,
    'restoreSchemaExists', to_regnamespace('xrpl_resource_restore_v1') is not null,
    'archiveTableExists', to_regclass('xrpl_phase_archive_v1.terminal_messages') is not null,
    'archiveRlsEnabled', coalesce((select relrowsecurity from pg_class where oid=to_regclass('xrpl_phase_archive_v1.terminal_messages')), false),
    'archiveRows', case when to_regclass('xrpl_phase_archive_v1.terminal_messages') is null then null else (select count(*)::bigint from xrpl_phase_archive_v1.terminal_messages) end,
    'sampleLedgerCount', (select count(*)::bigint from recent_work),
    'samplePerLedgerRows', coalesce((select jsonb_agg(jsonb_build_object(
       'workId',work_id,'workRows',work_rows,'payloadRows',payload_rows,'commitRows',commit_rows,'referenceRows',reference_rows,
       'directRows',work_rows+payload_rows+commit_rows+reference_rows
    ) order by work_id) from per_work), '[]'::jsonb),
    'maxDirectRowsPerLedger', coalesce((select max(work_rows+payload_rows+commit_rows+reference_rows)::bigint from per_work),0),
    'relationMetrics', (select jsonb_agg(jsonb_build_object('name',name,'exactRows',exact_rows,'totalBytes',total_bytes) order by name) from relation_metrics),
    'maxObservedPhysicalBytesPerRow', coalesce((select max(ceil(total_bytes::numeric/greatest(exact_rows,1)))::bigint from relation_metrics),0),
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
const resourceDiagnostic = await readJson(options['resource-diagnostic'])
const state = firstState(await managementQuery(stateSql()))

const databaseBytes = number(state.databaseBytes, 'databaseBytes')
const databaseHeadroomBytes = DATABASE_HALT_BYTES - databaseBytes
const sampleLedgerCount = number(state.sampleLedgerCount, 'sampleLedgerCount')
const maxDirectRowsPerLedger = number(state.maxDirectRowsPerLedger, 'maxDirectRowsPerLedger')
const observedPhysicalBytesPerRow = Math.max(number(state.maxObservedPhysicalBytesPerRow, 'maxObservedPhysicalBytesPerRow'), MIN_PHYSICAL_ROW_BYTES)
const projectedRowsPerLedger = Math.max(1, Math.ceil(maxDirectRowsPerLedger * 2) + TRANSPORT_AND_R5_OVERHEAD_ROWS_PER_LEDGER)
const projectedIncrementalRows = projectedRowsPerLedger * SELECTED_MAX_LEDGERS_PER_CLAIM
const conservativeRemainingCapacityRows = databaseHeadroomBytes > 0 ? Math.floor(databaseHeadroomBytes / observedPhysicalBytesPerRow) : 0
const requiredReserveRows = projectedIncrementalRows * RESERVE_WINDOWS
const projectedIncrementalDatabaseBytes = projectedIncrementalRows * observedPhysicalBytesPerRow
const projectedDatabaseBytesOneClaim = databaseBytes + projectedIncrementalDatabaseBytes
const projectedDatabaseBytesReserve = databaseBytes + (projectedIncrementalDatabaseBytes * RESERVE_WINDOWS)

const egressUpperBytes = number(resourceDiagnostic?.bounds?.egressUpperBytes, 'resourceDiagnostic.bounds.egressUpperBytes')
const memoryUpperBytes = number(resourceDiagnostic?.bounds?.memoryUpperBeforeEarlyRssHalt, 'resourceDiagnostic.bounds.memoryUpperBeforeEarlyRssHalt')
const priorEgress31dBytes = number(resourceDiagnostic?.guards?.priorEgress31dBytes, 'resourceDiagnostic.guards.priorEgress31dBytes')
const projectedEgress31dBytes = priorEgress31dBytes + egressUpperBytes
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

const databaseCapacitySafe = sampleLedgerCount === RETAINED_SAMPLE_LEDGERS
  && projectedIncrementalRows > 0
  && conservativeRemainingCapacityRows > requiredReserveRows
  && projectedDatabaseBytesReserve < DATABASE_HALT_BYTES
const egressCapacitySafe = resourceDiagnostic?.verdict?.classification === 'no_resource_halt_reproduced'
  && projectedEgress31dBytes < PROJECT_EGRESS_HALT_31D_BYTES
const memoryCapacitySafe = memoryUpperBytes < PROJECT_MEMORY_HALT_BYTES
const invocationCapacitySafe = projectedInvocations31d < PROJECT_INVOCATION_HALT_31D

const safeForR5Rearm = currentSpecificationIntact
  && integrityPreservingReclaimOrRetentionProven
  && databaseCapacitySafe
  && egressCapacitySafe
  && memoryCapacitySafe
  && invocationCapacitySafe

const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
const evidence = {
  schemaVersion: 2,
  purpose: 'r5-free-operation-capacity-readonly-qualification',
  sourceCommit,
  projectIdentityDigest: sha256(projectId),
  currentSpecificationIntact,
  integrityPreservingReclaimOrRetentionProven,
  postReclaimCapacityRemeasured: true,
  growthRemeasured: sampleLedgerCount === RETAINED_SAMPLE_LEDGERS,
  growthModel: {
    method: 'last_14_committed_ledgers_max_direct_rows_x2_plus_transport_overhead_physical_row_upper_bound',
    sampleLedgerCount,
    requiredSampleLedgerCount: RETAINED_SAMPLE_LEDGERS,
    maxDirectRowsPerLedger,
    projectedRowsPerLedger,
    selectedMaximumLedgersPerClaim: SELECTED_MAX_LEDGERS_PER_CLAIM,
    projectedIncrementalRows,
    reserveWindows: RESERVE_WINDOWS,
    requiredReserveRows,
    maxObservedPhysicalBytesPerRow: observedPhysicalBytesPerRow,
    projectedIncrementalDatabaseBytes,
    relationMetrics: state.relationMetrics,
    samplePerLedgerRows: state.samplePerLedgerRows,
  },
  databaseBytes,
  databaseHaltBytes: DATABASE_HALT_BYTES,
  databaseHeadroomBytes,
  conservativeRemainingCapacityRows,
  projectedDatabaseBytesOneClaim,
  projectedDatabaseBytesReserve,
  databaseCapacitySafe,
  resourceBounds: {
    diagnosticPurpose: resourceDiagnostic?.purpose ?? null,
    diagnosticEvidenceDigest: resourceDiagnostic?.evidenceDigest ?? null,
    diagnosticClassification: resourceDiagnostic?.verdict?.classification ?? null,
    egressUpperBytes,
    priorEgress31dBytes,
    projectedEgress31dBytes,
    projectEgressHalt31dBytes: PROJECT_EGRESS_HALT_31D_BYTES,
    egressCapacitySafe,
    memoryUpperBytes,
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
