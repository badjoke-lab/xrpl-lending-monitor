#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const PROFILE_IDENTITY = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const DATABASE_HALT_BYTES = 400_000_000
const CLAIM_SIGNATURE = 'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
const GUARD_SQL_PATH = 'ops/production-sql/20260816163000_xrpl_r5_revision4_database_halt_guard.sql'

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const token = rest[i]
    const value = rest[i + 1]
    if (!token?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${token ?? '<end>'}`)
    options[token.slice(2)] = value
  }
  return { command, options }
}
function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
  fail('Management API response contains no rows')
}
async function managementQuery(query, readOnly) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  if (!response.ok) fail(`Supabase Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}
function firstState(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
function validateSource(options) {
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  return sourceCommit
}
async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}
async function loadGuardSql() {
  const sql = await readFile(GUARD_SQL_PATH, 'utf8')
  for (const forbidden of [/\bdelete\s+from\b/iu, /\btruncate\b/iu, /\bvacuum\b/iu, /\bcron\./iu, /\bnet\./iu, /\bmainnet\b/iu]) {
    if (forbidden.test(sql)) fail(`database guard SQL contains forbidden capability: ${forbidden}`)
  }
  for (const required of [
    'select p_database_bytes < 400000000::bigint',
    'v_database_bytes := pg_database_size(current_database())',
    "last_error = ''r5_recovery_database_halt''",
    "'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'",
  ]) if (!sql.includes(required)) fail(`database guard SQL missing contract: ${required}`)
  return sql
}

function inspectionSql() {
  return `select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'claimDefinition', pg_get_functiondef('${CLAIM_SIGNATURE}'::regprocedure),
    'helperExists', to_regprocedure('xrpl_r5_v1.database_claim_allowed(bigint)') is not null,
    'run', coalesce((
      select jsonb_build_object(
        'runId', run_id,
        'status', status,
        'lastError', last_error,
        'profileRevision', profile_revision,
        'profileIdentityDigest', profile_identity_digest,
        'network', network,
        'epochId', epoch_id,
        'completedBatches', completed_batches,
        'committedLedgers', committed_ledgers,
        'watermarkLedgerIndex', current_watermark_ledger_index
      )
      from xrpl_r5_v1.recovery_runs
      where run_id='${ACTIVE_RUN_ID}'
    ), 'null'::jsonb),
    'batchCounts', (
      select jsonb_build_object(
        'total', count(*),
        'leased', count(*) filter (where status='leased'),
        'halted', count(*) filter (where status='halted'),
        'committed', count(*) filter (where status='committed')
      ) from xrpl_r5_v1.recovery_batches where run_id='${ACTIVE_RUN_ID}'
    ),
    'scheduler', coalesce((
      select jsonb_build_object(
        'count', count(*),
        'jobId', min(jobid),
        'schedule', min(schedule),
        'active', bool_and(active),
        'commandSha256', encode(extensions.digest(min(command)::text,'sha256'),'hex')
      ) from cron.job where jobname='xrpl-lending-monitor-minute'
    ), 'null'::jsonb)
  ) as state;`
}
function guardInstalled(state) {
  const definition = String(state.claimDefinition ?? '')
  return state.helperExists === true &&
    definition.includes('v_database_bytes := pg_database_size(current_database())') &&
    definition.includes("last_error = 'r5_recovery_database_halt'") &&
    definition.includes('database_claim_allowed(v_database_bytes)')
}
function validateLiveIdentity(state) {
  if (!state.run || state.run.runId !== ACTIVE_RUN_ID) fail('active revision-4 successor run missing')
  if (Number(state.run.profileRevision) !== 4) fail('active run revision drifted')
  if (state.run.profileIdentityDigest !== PROFILE_IDENTITY) fail('active run profile identity drifted')
  if (state.run.network !== 'devnet') fail('active run network is not devnet')
  if (state.run.epochId !== 'supabase-r4c2c-v1') fail('active run epoch drifted')
  if (!state.scheduler || Number(state.scheduler.count) !== 1 || state.scheduler.schedule !== '* * * * *' || state.scheduler.active !== true) fail('one-minute scheduler contract drifted')
  if (!/^[a-f0-9]{64}$/u.test(String(state.scheduler.commandSha256 ?? ''))) fail('scheduler command digest missing')
}
function structuralState(state, sourceCommit, sqlSha256) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  return {
    schemaVersion: 1,
    purpose: 'r5-revision4-database-guard-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    guardSqlSha256: sqlSha256,
    activeRunId: state.run?.runId ?? null,
    profileRevision: Number(state.run?.profileRevision),
    profileIdentityDigest: state.run?.profileIdentityDigest ?? null,
    network: state.run?.network ?? null,
    epochId: state.run?.epochId ?? null,
    runStatus: state.run?.status ?? null,
    runLastError: state.run?.lastError ?? null,
    claimDefinitionSha256: sha256(state.claimDefinition ?? 'missing'),
    helperExists: state.helperExists === true,
    schedulerCount: Number(state.scheduler?.count),
    schedulerSchedule: state.scheduler?.schedule ?? null,
    schedulerActive: state.scheduler?.active === true,
    schedulerCommandSha256: state.scheduler?.commandSha256 ?? null,
  }
}
async function inspect(sourceCommit, sqlSha256) {
  const state = firstState(await managementQuery(inspectionSql(), true))
  validateLiveIdentity(state)
  const structural = structuralState(state, sourceCommit, sqlSha256)
  return {
    schemaVersion: 1,
    purpose: 'r5-revision4-database-guard-state',
    sourceCommit,
    databaseBytes: Number(state.databaseBytes),
    databaseHaltBytes: DATABASE_HALT_BYTES,
    databaseHeadroomBytes: DATABASE_HALT_BYTES - Number(state.databaseBytes),
    guardInstalled: guardInstalled(state),
    run: state.run,
    batchCounts: state.batchCounts,
    scheduler: state.scheduler,
    claimDefinitionSha256: sha256(state.claimDefinition ?? 'missing'),
    helperExists: state.helperExists === true,
    guardSqlSha256: sqlSha256,
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    productionDatabaseReadOnly: true,
    mainnetDisabled: state.run?.network === 'devnet',
    publicReaderMutationAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }
}
async function prepare(options) {
  const sourceCommit = validateSource(options)
  const sql = await loadGuardSql()
  const sqlSha256 = sha256(sql)
  const state = await inspect(sourceCommit, sqlSha256)
  if (state.guardInstalled || state.helperExists) fail('database guard is already installed or helper pre-exists')
  if (state.databaseBytes < DATABASE_HALT_BYTES) fail('database is below the fixed halt; emergency guard apply gate is not eligible')
  if (!['running', 'caught_up'].includes(String(state.run.status)) || state.run.lastError != null) fail(`active successor state is not eligible: ${state.run.status}:${state.run.lastError}`)
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}
async function apply(options) {
  const sourceCommit = validateSource(options)
  const authorizedState = options['authorized-state']
  const authorizedSql = options['authorized-sql']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  if (!/^[a-f0-9]{64}$/u.test(authorizedSql ?? '')) fail('invalid --authorized-sql')
  const sql = await loadGuardSql()
  const sqlSha256 = sha256(sql)
  if (authorizedSql !== sqlSha256) fail('authorized SQL SHA does not match staged database guard SQL')
  const before = await inspect(sourceCommit, sqlSha256)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized database-guard structural state drifted before mutation')
  if (before.guardInstalled || before.helperExists) fail('database guard pre-state is already installed')
  if (before.databaseBytes < DATABASE_HALT_BYTES) fail('database fell below fixed halt before apply')
  if (!['running', 'caught_up'].includes(String(before.run.status)) || before.run.lastError != null) fail(`active successor state changed before apply: ${before.run.status}:${before.run.lastError}`)

  await managementQuery(sql, false)

  const after = await inspect(sourceCommit, sqlSha256)
  if (!after.guardInstalled || !after.helperExists) fail('database guard post-state verification failed')
  if (after.scheduler.commandSha256 !== before.scheduler.commandSha256 || after.scheduler.schedule !== before.scheduler.schedule || after.scheduler.active !== before.scheduler.active) fail('scheduler changed during database guard apply')
  if (after.run.runId !== before.run.runId || after.run.profileIdentityDigest !== before.run.profileIdentityDigest || after.run.network !== 'devnet') fail('active run identity changed during database guard apply')
  const boundaryRows = await managementQuery(`select jsonb_build_object(
    'below',xrpl_r5_v1.database_claim_allowed(399999999::bigint),
    'at',xrpl_r5_v1.database_claim_allowed(400000000::bigint),
    'above',xrpl_r5_v1.database_claim_allowed(400000001::bigint)
  ) as state;`, true)
  const boundary = firstState(boundaryRows)
  if (boundary.below !== true || boundary.at !== false || boundary.above !== false) fail('production database guard boundary verification failed')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-revision4-database-guard-apply',
    sourceCommit,
    authorizedStateSha256: authorizedState,
    guardSqlSha256: authorizedSql,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: after.databaseBytes,
    databaseHaltBytes: DATABASE_HALT_BYTES,
    guardInstalled: true,
    boundary,
    runBefore: before.run,
    runAfterApply: after.run,
    batchCountsBefore: before.batchCounts,
    batchCountsAfterApply: after.batchCounts,
    schedulerBefore: before.scheduler,
    schedulerAfter: after.scheduler,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    rearmAuthorized: false,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}
async function waitForHalt(options) {
  const sourceCommit = validateSource(options)
  const sql = await loadGuardSql()
  const sqlSha256 = sha256(sql)
  const deadline = Date.now() + 150_000
  let last
  while (Date.now() <= deadline) {
    last = await inspect(sourceCommit, sqlSha256)
    if (last.run.status === 'halted' && last.run.lastError === 'r5_recovery_database_halt') {
      const evidence = {
        schemaVersion: 1,
        purpose: 'r5-revision4-database-guard-natural-halt',
        sourceCommit,
        observed: true,
        databaseBytes: last.databaseBytes,
        databaseHaltBytes: DATABASE_HALT_BYTES,
        databaseHeadroomBytes: last.databaseHeadroomBytes,
        run: last.run,
        batchCounts: last.batchCounts,
        scheduler: last.scheduler,
        guardInstalled: last.guardInstalled,
        naturalSchedulerObservationOnly: true,
        manualClaimInvoked: false,
        mainnetDisabled: true,
      }
      await writeJson(options.output, evidence)
      process.stdout.write(`${JSON.stringify(evidence)}\n`)
      return
    }
    if (last.run.lastError != null && last.run.lastError !== 'r5_recovery_database_halt') fail(`run halted/errored for unexpected reason: ${last.run.status}:${last.run.lastError}`)
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  await writeJson(options.output, { observed: false, last })
  fail('natural one-minute scheduler did not expose r5_recovery_database_halt within verification window')
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'prepare') await prepare(options)
else if (command === 'apply') await apply(options)
else if (command === 'wait-for-halt') await waitForHalt(options)
else fail('command must be prepare, apply, or wait-for-halt')
