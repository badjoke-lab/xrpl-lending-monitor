#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const VERSION = '20260814130000'
const NAME = 'xrpl_phase_messages_ready_partial_index'
const MIGRATION_PATH = `supabase/migrations/${VERSION}_${NAME}.sql`
const READY_INDEX = 'xrpl_phase_messages_ready_idx'
const TEMP_INDEX = 'xrpl_phase_messages_ready_claimable_idx'
const INTERNAL_DB_HALT = 400_000_000
const MAX_EXPECTED_PARTIAL_BYTES = 1_048_576

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }

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

function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) if (Array.isArray(candidate)) return candidate
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

async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function validateSource(options) {
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  const expectedSha = options['expected-sha']
  if (!/^[a-f0-9]{64}$/u.test(expectedSha ?? '')) fail('invalid --expected-sha')
  return { sourceCommit, expectedSha }
}

async function loadMigration(expectedSha) {
  const migration = await readFile(MIGRATION_PATH, 'utf8')
  const actualSha = sha256(migration)
  if (actualSha !== expectedSha) fail('phase ready-index migration source drifted')
  for (const required of [
    'create index xrpl_phase_messages_ready_claimable_idx',
    "where status in ('pending', 'retry', 'leased')",
    'drop index public.xrpl_phase_messages_ready_idx;',
    'rename to xrpl_phase_messages_ready_idx;',
    "position('completed' in v_predicate) > 0",
    "position('error' in v_predicate) > 0",
  ]) if (!migration.includes(required)) fail(`migration missing required contract fragment: ${required}`)
  for (const forbidden of [
    /\btruncate\b/iu,
    /\bdelete\s+from\b/iu,
    /\bupdate\s+[a-z_]/iu,
    /\bvacuum\b/iu,
    /\bdrop\s+table\b/iu,
    /\bdrop\s+schema\b/iu,
    /\balter\s+table\b/iu,
    /\bcreate\s+table\b/iu,
    /\bcron\./iu,
  ]) if (forbidden.test(migration)) fail(`migration contains forbidden capability: ${forbidden}`)
  return { migration, actualSha }
}

function inspectionSql() {
  return `select jsonb_build_object(
    'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
    'targetMigrationRows',(select count(*) from supabase_migrations.schema_migrations where version::text='${VERSION}'),
    'targetMigrationRecords',coalesce((select jsonb_agg(jsonb_build_object('version',version::text,'statements',statements,'name',name) order by name,statements::text) from supabase_migrations.schema_migrations where version::text='${VERSION}'),'[]'::jsonb),
    'databaseBytes',pg_database_size(current_database()),
    'messageRows',(select count(*) from public.xrpl_phase_messages),
    'messageStatusCounts',(select coalesce(jsonb_object_agg(status,n order by status),'{}'::jsonb) from (select status,count(*) n from public.xrpl_phase_messages group by status) s),
    'readyIndex',coalesce((select jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'predicate',pg_get_expr(i.indpred,i.indrelid),'bytes',pg_relation_size(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) from pg_index i where i.indexrelid=to_regclass('public.${READY_INDEX}')),'null'::jsonb),
    'temporaryIndexExists',to_regclass('public.${TEMP_INDEX}') is not null,
    'tableContract',jsonb_build_object(
      'columns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'udtName',udt_name,'nullable',is_nullable) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='xrpl_phase_messages'),
      'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.xrpl_phase_messages'::regclass)
    )
  ) as state;`
}

function indexShape(index) {
  if (!index || typeof index !== 'object') return 'missing'
  const definition = String(index.definition ?? '')
  const predicate = index.predicate == null ? null : String(index.predicate)
  const keys = definition.includes('(profile_id, status, available_at, created_at, message_id)')
  if (!keys || index.valid !== true || index.ready !== true) return 'drift'
  if (predicate === null) return 'full'
  if (predicate.includes('pending') && predicate.includes('retry') && predicate.includes('leased') && !predicate.includes('completed') && !predicate.includes('error')) return 'partial'
  return 'drift'
}

function expectedHistoryRecord(migrationSha) {
  return { version: VERSION, statements: [`exact-phase-ready-partial-index sha256:${migrationSha}`], name: NAME }
}

function historyRecordMatches(record, migrationSha) {
  const expected = expectedHistoryRecord(migrationSha)
  return Boolean(record && record.version === expected.version && record.name === expected.name && Array.isArray(record.statements) && record.statements.length === 1 && record.statements[0] === expected.statements[0])
}

function structuralState(state, sourceCommit, migrationSha) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  return {
    schemaVersion: 1,
    purpose: 'r5-phase-message-ready-live-safe-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    migrationVersion: VERSION,
    migrationSha256: migrationSha,
    maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
    targetMigrationRows: Number(state.targetMigrationRows),
    targetMigrationRecordsSha256: sha256(JSON.stringify(state.targetMigrationRecords ?? [])),
    readyIndexShape: indexShape(state.readyIndex),
    readyIndexDefinitionSha256: sha256(state.readyIndex?.definition ?? 'missing'),
    readyIndexPredicate: state.readyIndex?.predicate ?? null,
    tableContractSha256: sha256(JSON.stringify(state.tableContract)),
    temporaryIndexExists: state.temporaryIndexExists === true,
  }
}

async function inspect(sourceCommit, migrationSha) {
  const state = firstState(await managementQuery(inspectionSql(), true))
  const targetRecords = Array.isArray(state.targetMigrationRecords) ? state.targetMigrationRecords : []
  const structural = structuralState(state, sourceCommit, migrationSha)
  const targetRows = Number(state.targetMigrationRows)
  const maxMigrationVersion = String(state.maxMigrationVersion ?? '')
  return {
    schemaVersion: 1,
    purpose: 'r5-phase-message-ready-live-safe-state',
    sourceCommit,
    migrationVersion: VERSION,
    migrationSha256: migrationSha,
    projectIdentityDigest: structural.projectIdentityDigest,
    maxMigrationVersion,
    retroactiveTargetBehindHead: /^\d{14}$/u.test(maxMigrationVersion) && maxMigrationVersion > VERSION,
    targetMigrationRows: targetRows,
    targetMigrationRecords: targetRecords,
    exactTargetMigrationRecord: targetRows === 1 && historyRecordMatches(targetRecords[0], migrationSha),
    databaseBytes: Number(state.databaseBytes),
    databaseHaltBytes: INTERNAL_DB_HALT,
    databaseHeadroomBytes: INTERNAL_DB_HALT - Number(state.databaseBytes),
    messageRows: Number(state.messageRows),
    messageStatusCounts: state.messageStatusCounts ?? {},
    readyIndexBytes: Number(state.readyIndex?.bytes ?? 0),
    readyIndexShape: indexShape(state.readyIndex),
    readyIndexDefinition: state.readyIndex?.definition ?? null,
    readyIndexDefinitionSha256: structural.readyIndexDefinitionSha256,
    readyIndexPredicate: state.readyIndex?.predicate ?? null,
    temporaryIndexExists: state.temporaryIndexExists === true,
    tableContractSha256: structural.tableContractSha256,
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    rowMutationAuthorized: false,
    vacuumAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    mainnetDisabled: true,
  }
}

async function prepare(options) {
  const { sourceCommit, expectedSha } = validateSource(options)
  const { actualSha } = await loadMigration(expectedSha)
  const state = await inspect(sourceCommit, actualSha)
  if (!state.retroactiveTargetBehindHead) fail(`target migration ${VERSION} is not strictly behind current migration head ${state.maxMigrationVersion}`)
  if (state.targetMigrationRows !== 0) fail(`target migration already has ${state.targetMigrationRows} history row(s)`)
  if (state.readyIndexShape !== 'full') fail(`ready index pre-state is ${state.readyIndexShape}, expected full`)
  if (state.temporaryIndexExists) fail('temporary claimable ready index already exists')
  if (state.readyIndexBytes <= MAX_EXPECTED_PARTIAL_BYTES) fail('full ready index is already too small for this replacement gate')
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}

async function apply(options) {
  const { sourceCommit, expectedSha } = validateSource(options)
  const authorizedState = options['authorized-state']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  const { migration, actualSha } = await loadMigration(expectedSha)
  const before = await inspect(sourceCommit, actualSha)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized phase ready-index structural state drifted before mutation')
  if (!before.retroactiveTargetBehindHead || before.targetMigrationRows !== 0 || before.readyIndexShape !== 'full' || before.temporaryIndexExists) fail('phase ready-index apply pre-state is not eligible')

  const marker = `exact-phase-ready-partial-index sha256:${actualSha}`.replaceAll("'", "''")
  const escapedName = NAME.replaceAll("'", "''")
  const transaction = [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '45s';",
    'lock table public.xrpl_phase_messages in share mode;',
    migration,
    `insert into supabase_migrations.schema_migrations(version,statements,name) values ('${VERSION}',array['${marker}']::text[],'${escapedName}');`,
    'commit;',
  ].join('\n')

  for (const forbidden of [/\bdelete\s+from\b/iu, /\bupdate\s+[a-z_]/iu, /\btruncate\b/iu, /\bvacuum\b/iu, /\bdrop\s+table\b/iu, /\balter\s+table\b/iu, /\bcron\./iu]) {
    if (forbidden.test(transaction)) fail(`phase ready-index transaction contains forbidden capability: ${forbidden}`)
  }

  await managementQuery(transaction, false)

  const after = await inspect(sourceCommit, actualSha)
  if (after.readyIndexShape !== 'partial') fail('phase ready-index partial post-state mismatch')
  if (after.temporaryIndexExists) fail('temporary claimable ready index remains after apply')
  if (after.targetMigrationRows !== 1 || !after.exactTargetMigrationRecord) fail('exact target migration-history record missing after apply')
  if (after.maxMigrationVersion !== before.maxMigrationVersion) fail(`migration head changed across retroactive target apply: before=${before.maxMigrationVersion} after=${after.maxMigrationVersion}`)
  if (!(after.readyIndexBytes < before.readyIndexBytes)) fail('phase ready index did not shrink')
  if (after.readyIndexBytes > MAX_EXPECTED_PARTIAL_BYTES) fail(`partial ready index exceeds ${MAX_EXPECTED_PARTIAL_BYTES} bytes`)
  if (after.messageRows < before.messageRows) fail(`phase-message row count decreased: before=${before.messageRows} after=${after.messageRows}`)

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-phase-message-ready-live-safe-apply',
    sourceCommit,
    migrationVersion: VERSION,
    migrationSha256: actualSha,
    authorizedStateSha256: authorizedState,
    migrationHeadBefore: before.maxMigrationVersion,
    migrationHeadAfter: after.maxMigrationVersion,
    messageRowsBefore: before.messageRows,
    messageRowsAfter: after.messageRows,
    statusCountsBefore: before.messageStatusCounts,
    statusCountsAfter: after.messageStatusCounts,
    readyIndexBytesBefore: before.readyIndexBytes,
    readyIndexBytesAfter: after.readyIndexBytes,
    readyIndexBytesReclaimed: before.readyIndexBytes - after.readyIndexBytes,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: after.databaseBytes,
    databaseBelowHaltAfter: after.databaseBytes < INTERNAL_DB_HALT,
    databaseHeadroomBytesAfter: INTERNAL_DB_HALT - after.databaseBytes,
    exactMigrationHistoryRecordVerified: true,
    rowMutationPerformed: false,
    vacuumPerformed: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    r5RestartAuthorized: false,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'prepare') await prepare(options)
else if (command === 'apply') await apply(options)
else fail('command must be prepare or apply')
