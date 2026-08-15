#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const VERSION = '20260815211500'
const NAME = 'xrpl_r5_revision4_prepared_head_memory_retry_fix'
const PREVIOUS_VERSION = '20260814130000'
const SQL_PATH = `ops/production-sql/${VERSION}_${NAME}.sql`
const RUN_ID = 'r5-recovery-selected-revision4-entry'
const JOB_NAME = 'xrpl-lending-monitor-minute'

function fail(message) {
  throw new Error(message)
}

function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) fail(`unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = rest[index + 1]
    if (value == null || value.startsWith('--')) fail(`missing value for --${key}`)
    options[key] = value
    index += 1
  }
  return { command, options }
}

function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  fail('Management API response contains no rows')
}

async function managementQuery(query, readOnly = true) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 2000) }
  }
  if (!response.ok) fail(`Supabase Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}

async function loadSql(expectedSha) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha ?? '')) fail('expected staged SQL SHA-256 invalid')
  const sql = await readFile(SQL_PATH, 'utf8')
  const actualSha = sha256(sql)
  if (actualSha !== expectedSha) fail('staged repair SQL drifted')

  const required = [
    'xrpl_claim_r5_revision4_recovery_batch_from_prepared_head',
    'xrpl_claim_r5_memory_retry_batch(',
    "v_run.profile_revision <> 4",
    'xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(',
    'xrpl_claim_r5_revision4_recovery_batch(',
    'xrpl_adopt_r5_revision4_committed_active_descendants(',
    'r5_revision3_memory_retry_contract_changed',
  ]
  for (const fragment of required) {
    if (!sql.includes(fragment)) fail(`staged SQL missing required contract fragment: ${fragment}`)
  }

  for (const forbidden of [
    /\btruncate\b/iu,
    /\bdelete\s+from\b/iu,
    /\bupdate\s+(?:public\.|xrpl_r5_v1\.)?(?:xrpl_phase_|recovery_runs|recovery_batches)/iu,
    /\bvacuum\b/iu,
    /\bdrop\s+(?:table|schema)\b/iu,
    /\bcron\.schedule\b/iu,
    /\bcron\.unschedule\b/iu,
  ]) {
    if (forbidden.test(sql)) fail(`staged SQL contains forbidden mutation: ${forbidden}`)
  }
  return { sql, actualSha }
}

function inspectionQuery() {
  return `
with defs as (
  select
    pg_get_functiondef('public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'::regprocedure) as rev4,
    pg_get_functiondef('public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)'::regprocedure) as rev3
), run_state as (
  select to_jsonb(r) as value
  from xrpl_r5_v1.recovery_runs r
  where r.run_id = '${RUN_ID}'
), job_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobid', jobid,
    'jobname', jobname,
    'schedule', schedule,
    'command', command,
    'active', active
  ) order by jobid), '[]'::jsonb) as value
  from cron.job
  where jobname = '${JOB_NAME}'
)
select jsonb_build_object(
  'maxMigrationVersion', (select max(version::text) from supabase_migrations.schema_migrations),
  'targetMigrationRows', (select count(*) from supabase_migrations.schema_migrations where version::text = '${VERSION}'),
  'targetMigrationRecords', coalesce((
    select jsonb_agg(jsonb_build_object('version', version::text, 'statements', statements, 'name', name) order by name, statements::text)
    from supabase_migrations.schema_migrations
    where version::text = '${VERSION}'
  ), '[]'::jsonb),
  'revision4MemoryRetryCalls', (select (length(rev4) - length(replace(rev4, 'public.xrpl_claim_r5_memory_retry_batch(', ''))) / length('public.xrpl_claim_r5_memory_retry_batch(') from defs),
  'revision3MemoryRetryCalls', (select (length(rev3) - length(replace(rev3, 'public.xrpl_claim_r5_memory_retry_batch(', ''))) / length('public.xrpl_claim_r5_memory_retry_batch(') from defs),
  'revision4DefinitionSha256', (select encode(extensions.digest(convert_to(rev4, 'UTF8'), 'sha256'), 'hex') from defs),
  'revision3DefinitionSha256', (select encode(extensions.digest(convert_to(rev3, 'UTF8'), 'sha256'), 'hex') from defs),
  'revision4Guards', (select jsonb_build_object(
    'profileRevision4', position('v_run.profile_revision <> 4' in rev4) > 0,
    'revision4Rebind', position('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(' in rev4) > 0,
    'revision4Claim', position('public.xrpl_claim_r5_revision4_recovery_batch(' in rev4) > 0,
    'revision4Adoption', position('public.xrpl_adopt_r5_revision4_committed_active_descendants(' in rev4) > 0,
    'pendingScanLockHeldThroughClaim', position('pendingScanLockHeldThroughClaim' in rev4) > 0,
    'noScanExecutedBeforeClaim', position('noScanExecutedBeforeClaim' in rev4) > 0
  ) from defs),
  'run', coalesce((select value from run_state), 'null'::jsonb),
  'activeBatchCount', (select count(*) from xrpl_r5_v1.recovery_batches where run_id = '${RUN_ID}' and status in ('leased','halted')),
  'scheduler', (select value from job_state),
  'canonicalWatermark', (select jsonb_build_object('ledgerIndex', ledger_index, 'ledgerHash', ledger_hash, 'workId', work_id) from public.xrpl_phase_watermarks where profile_id = 'supabase-devnet'),
  'databaseBytes', pg_database_size(current_database())
) as state;
`.trim()
}

function parseState(rows) {
  const row = rows[0]
  if (!row) fail('inspection returned no rows')
  const raw = row.state ?? row
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

function expectedHistoryRecord(sqlSha) {
  return {
    version: VERSION,
    statements: [`exact-r5-revision4-prepared-head-memory-retry-fix sha256:${sqlSha}`],
    name: NAME,
  }
}

function historyRecordMatches(record, sqlSha) {
  const expected = expectedHistoryRecord(sqlSha)
  return Boolean(record
    && record.version === expected.version
    && record.name === expected.name
    && Array.isArray(record.statements)
    && record.statements.length === 1
    && record.statements[0] === expected.statements[0])
}

function allRevision4GuardsTrue(guards) {
  return Boolean(guards
    && guards.profileRevision4 === true
    && guards.revision4Rebind === true
    && guards.revision4Claim === true
    && guards.revision4Adoption === true
    && guards.pendingScanLockHeldThroughClaim === true
    && guards.noScanExecutedBeforeClaim === true)
}

function schedulerIsRestoredCollector(scheduler) {
  return Array.isArray(scheduler)
    && scheduler.length === 1
    && scheduler[0]?.jobname === JOB_NAME
    && scheduler[0]?.schedule === '* * * * *'
    && scheduler[0]?.active === true
    && String(scheduler[0]?.command ?? '').includes('xrpl-collector-tick')
    && !String(scheduler[0]?.command ?? '').includes('xrpl-r5-minute-driver')
}

function runIsZeroProgressPrepared(run) {
  return Boolean(run
    && run.run_id === RUN_ID
    && run.status === 'prepared'
    && Number(run.profile_revision) === 4
    && Number(run.completed_batches) === 0
    && Number(run.committed_ledgers) === 0
    && run.last_error == null
    && run.last_accounting_digest == null
    && run.started_at == null
    && run.completed_at == null)
}

function classify(state, sqlSha, sourceCommit) {
  const targetRows = Number(state.targetMigrationRows)
  const records = Array.isArray(state.targetMigrationRecords) ? state.targetMigrationRecords : []
  const exactRecord = targetRows === 1 && historyRecordMatches(records[0], sqlSha)
  const preCommon = allRevision4GuardsTrue(state.revision4Guards)
    && Number(state.revision3MemoryRetryCalls) === 1
    && runIsZeroProgressPrepared(state.run)
    && Number(state.activeBatchCount) === 0
    && schedulerIsRestoredCollector(state.scheduler)

  let classification = 'inconsistent'
  let reason = 'state does not match an authorized lifecycle state'

  if (preCommon
    && String(state.maxMigrationVersion) === PREVIOUS_VERSION
    && targetRows === 0
    && Number(state.revision4MemoryRetryCalls) === 1) {
    classification = 'unapplied_expected'
    reason = 'revision-4 wrapper retains exactly one revision-3 memory-retry call and production is safely rolled back'
  } else if (preCommon
    && String(state.maxMigrationVersion) === VERSION
    && targetRows === 1
    && exactRecord
    && Number(state.revision4MemoryRetryCalls) === 0) {
    classification = 'applied_consistent'
    reason = 'revision-4 memory-retry call is absent and exact migration-history record is present'
  }

  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const projectIdentityDigest = sha256(projectId)
  const authorizationState = {
    schemaVersion: 1,
    purpose: 'r5-revision4-prepared-head-memory-retry-fix-authorization-state',
    sourceCommit,
    projectIdentityDigest,
    sqlSha256: sqlSha,
    classification,
    maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
    targetMigrationRows: targetRows,
    revision4MemoryRetryCalls: Number(state.revision4MemoryRetryCalls),
    revision3MemoryRetryCalls: Number(state.revision3MemoryRetryCalls),
    revision4DefinitionSha256: String(state.revision4DefinitionSha256 ?? ''),
    revision3DefinitionSha256: String(state.revision3DefinitionSha256 ?? ''),
    revision4Guards: state.revision4Guards,
    run: state.run,
    activeBatchCount: Number(state.activeBatchCount),
    scheduler: state.scheduler,
    canonicalWatermark: state.canonicalWatermark,
    databaseBytes: Number(state.databaseBytes),
    mainnetDisabled: true,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    canonicalHistoryMutationAuthorized: false,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }
  return {
    ...authorizationState,
    classificationReason: reason,
    authorizationStateSha256: sha256(JSON.stringify(authorizationState)),
    targetMigrationRecords: records,
  }
}

async function audit(options) {
  const sourceCommit = options['source-commit']
  const expectedSha = options['expected-sha']
  const output = options.output
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('source commit invalid')
  const { actualSha } = await loadSql(expectedSha)
  const state = parseState(await managementQuery(inspectionQuery(), true))
  const result = classify(state, actualSha, sourceCommit)
  if (output) {
    const path = resolve(output)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

async function apply(options) {
  const sourceCommit = options['source-commit']
  const expectedSha = options['expected-sha']
  const expectedState = options['expected-state']
  const output = options.output
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('source commit invalid')
  if (!/^[a-f0-9]{64}$/u.test(expectedState ?? '')) fail('expected state SHA invalid')
  const { sql, actualSha } = await loadSql(expectedSha)

  const before = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit)
  if (before.classification !== 'unapplied_expected') fail(`production pre-state is ${before.classification}`)
  if (before.authorizationStateSha256 !== expectedState) fail('production pre-state drifted from authorization')

  const record = expectedHistoryRecord(actualSha)
  const statement = `begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '45s';\n${sql}\ninsert into supabase_migrations.schema_migrations(version, statements, name) values ('${VERSION}', array['${record.statements[0]}']::text[], '${NAME}');\ncommit;`
  await managementQuery(statement, false)

  const after = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit)
  if (after.classification !== 'applied_consistent') fail(`production post-state is ${after.classification}`)

  const result = {
    schemaVersion: 1,
    purpose: 'r5-revision4-prepared-head-memory-retry-fix-apply',
    sourceCommit,
    sqlSha256: actualSha,
    authorizationStateSha256: expectedState,
    before,
    after,
    mutationPerformed: true,
    mutationScope: 'revision4 prepared-head function definition plus exact migration-history record',
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    canonicalHistoryMutationPerformed: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }
  if (output) {
    const path = resolve(output)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'audit') await audit(options)
else if (command === 'apply') await apply(options)
else fail(`unknown command: ${command ?? '<missing>'}`)
