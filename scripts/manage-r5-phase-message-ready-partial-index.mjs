#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const VERSION = '20260814130000'
const NAME = 'xrpl_phase_messages_ready_partial_index'
const PREVIOUS_VERSION = '20260813072000'
const MIGRATION_PATH = `supabase/migrations/${VERSION}_${NAME}.sql`
const READY_INDEX = 'xrpl_phase_messages_ready_idx'
const TEMP_INDEX = 'xrpl_phase_messages_ready_claimable_idx'

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

function normalizeJson(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function findFirstKey(value, key) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstKey(entry, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key]
    for (const entry of Object.values(value)) {
      const found = findFirstKey(entry, key)
      if (found !== undefined) return found
    }
  }
  return undefined
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

async function managementQuery(query, parameters = [], readOnly = true) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, parameters, read_only: readOnly }),
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

async function loadMigration(expectedSha) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha ?? '')) fail('expected migration SHA-256 invalid')
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
  ]) {
    if (!migration.includes(required)) fail(`migration missing required contract fragment: ${required}`)
  }
  for (const forbidden of [
    /\btruncate\b/iu,
    /\bdelete\s+from\b/iu,
    /\bupdate\s+[a-z_]/iu,
    /\bvacuum\b/iu,
    /\bdrop\s+table\b/iu,
    /\bdrop\s+schema\b/iu,
  ]) {
    if (forbidden.test(migration)) fail(`migration contains forbidden row/destructive statement: ${forbidden}`)
  }
  return { migration, actualSha }
}

function inspectionQuery() {
  return `
select jsonb_build_object(
  'maxMigrationVersion', (select max(version::text) from supabase_migrations.schema_migrations),
  'targetMigrationRows', (select count(*) from supabase_migrations.schema_migrations where version::text = '${VERSION}'),
  'targetMigrationRecord', coalesce((
    select jsonb_build_object('version', version::text, 'statements', statements, 'name', name)
    from supabase_migrations.schema_migrations
    where version::text = '${VERSION}'
    limit 1
  ), 'null'::jsonb),
  'historyColumns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'columnName', column_name,
      'dataType', data_type,
      'udtName', udt_name,
      'nullable', is_nullable
    ) order by ordinal_position)
    from information_schema.columns
    where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
  ), '[]'::jsonb),
  'databaseBytes', pg_database_size(current_database()),
  'messageRows', (select count(*) from public.xrpl_phase_messages),
  'messageStatusCounts', (select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'retry', count(*) filter (where status = 'retry'),
    'leased', count(*) filter (where status = 'leased'),
    'completed', count(*) filter (where status = 'completed'),
    'error', count(*) filter (where status = 'error')
  ) from public.xrpl_phase_messages),
  'readyIndex', coalesce((
    select jsonb_build_object(
      'definition', pg_get_indexdef(i.indexrelid),
      'predicate', pg_get_expr(i.indpred, i.indrelid),
      'bytes', pg_relation_size(i.indexrelid),
      'valid', i.indisvalid,
      'ready', i.indisready
    )
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = '${READY_INDEX}'
      and i.indrelid = 'public.xrpl_phase_messages'::regclass
  ), 'null'::jsonb),
  'temporaryIndexExists', to_regclass('public.${TEMP_INDEX}') is not null
) as state;
`.trim()
}

function historyColumnsValid(columns) {
  if (!Array.isArray(columns)) return false
  const byName = new Map(columns.map((entry) => [entry.columnName, entry]))
  return byName.get('version')?.dataType === 'text'
    && byName.get('statements')?.dataType === 'ARRAY'
    && byName.get('statements')?.udtName === '_text'
    && byName.get('name')?.dataType === 'text'
}

function assertIndexShape(index, expect) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) fail('ready index state missing')
  if (index.valid !== true || index.ready !== true) fail('ready index is not valid and ready')
  const definition = String(index.definition ?? '')
  if (!definition.includes('(profile_id, status, available_at, created_at, message_id)')) {
    fail(`unexpected ready index definition: ${definition}`)
  }
  const predicate = index.predicate == null ? null : String(index.predicate)
  if (expect === 'full') {
    if (predicate !== null) fail(`expected full ready index predicate, found: ${predicate}`)
  } else {
    if (
      predicate == null
      || !predicate.includes('pending')
      || !predicate.includes('retry')
      || !predicate.includes('leased')
      || predicate.includes('completed')
      || predicate.includes('error')
    ) fail(`unexpected partial ready index predicate: ${predicate}`)
  }
  return { definition, definitionSha256: sha256(definition), predicate }
}

function assertInspection(raw, expect, sourceCommit, migrationSha) {
  const state = normalizeJson(raw)
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('inspection state missing')
  if (!historyColumnsValid(normalizeJson(state.historyColumns))) fail('schema_migrations shape is not the expected version/statements/name contract')
  if (state.temporaryIndexExists !== false) fail('temporary claimable ready index already exists')

  const readyIndex = assertIndexShape(normalizeJson(state.readyIndex), expect)
  const targetRows = Number(state.targetMigrationRows)
  const maxMigrationVersion = String(state.maxMigrationVersion ?? '')

  if (expect === 'full') {
    if (targetRows !== 0) fail('target partial-index migration is already recorded')
    if (maxMigrationVersion !== PREVIOUS_VERSION) fail(`unexpected production migration head before partial-index apply: ${maxMigrationVersion}`)
  } else {
    if (targetRows !== 1) fail(`target partial-index migration must be recorded exactly once, found ${targetRows}`)
    if (maxMigrationVersion !== VERSION) fail(`unexpected production migration head after partial-index apply: ${maxMigrationVersion}`)
    const record = normalizeJson(state.targetMigrationRecord)
    const marker = `exact-phase-ready-partial-index sha256:${migrationSha}`
    if (
      !record
      || record.version !== VERSION
      || record.name !== NAME
      || !Array.isArray(record.statements)
      || record.statements.length !== 1
      || record.statements[0] !== marker
    ) fail('target migration history record mismatch')
  }

  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const authorizationState = {
    schemaVersion: 1,
    purpose: 'r5-phase-message-ready-partial-index-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    migrationVersion: VERSION,
    migrationSha256: migrationSha,
    maxMigrationVersion,
    targetMigrationRows: targetRows,
    readyIndexDefinitionSha256: readyIndex.definitionSha256,
    readyIndexPredicate: readyIndex.predicate,
    temporaryIndexExists: false,
  }

  return {
    schemaVersion: 1,
    purpose: 'r5-phase-message-ready-partial-index-production-state',
    sourceCommit,
    projectIdentityDigest: authorizationState.projectIdentityDigest,
    expectedIndexShape: expect,
    migrationVersion: VERSION,
    migrationName: NAME,
    migrationSha256: migrationSha,
    maxMigrationVersion,
    targetMigrationRows: targetRows,
    databaseBytes: Number(state.databaseBytes),
    messageRows: Number(state.messageRows),
    messageStatusCounts: normalizeJson(state.messageStatusCounts),
    readyIndexBytes: Number(normalizeJson(state.readyIndex)?.bytes),
    readyIndexDefinitionSha256: readyIndex.definitionSha256,
    readyIndexPredicate: readyIndex.predicate,
    temporaryIndexExists: false,
    authorizationState,
    authorizationStateSha256: sha256(JSON.stringify(authorizationState)),
    canonicalHistoryMutationAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    mainnetDisabled: true,
  }
}

async function inspectState({ expect, sourceCommit, migrationSha }) {
  const rows = await managementQuery(inspectionQuery(), [], true)
  const raw = findFirstKey(rows, 'state')
  return assertInspection(raw, expect, sourceCommit, migrationSha)
}

async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

async function inspect(options) {
  const expect = options.expect
  if (!['full', 'partial'].includes(expect)) fail('--expect must be full or partial')
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  const expectedSha = options['expected-sha']
  const { actualSha } = await loadMigration(expectedSha)
  const state = await inspectState({ expect, sourceCommit, migrationSha: actualSha })
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}

async function apply(options) {
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  const authorizedState = options['authorized-state']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  const expectedSha = options['expected-sha']
  const { migration, actualSha } = await loadMigration(expectedSha)

  const before = await inspectState({ expect: 'full', sourceCommit, migrationSha: actualSha })
  if (before.authorizationStateSha256 !== authorizedState) fail('authorized production index state drifted before mutation')

  const marker = `exact-phase-ready-partial-index sha256:${actualSha}`
  const escapedMarker = marker.replaceAll("'", "''")
  const escapedName = NAME.replaceAll("'", "''")
  const transaction = [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '45s';",
    migration,
    `insert into supabase_migrations.schema_migrations(version, statements, name) values ('${VERSION}', array['${escapedMarker}']::text[], '${escapedName}');`,
    'commit;',
  ].join('\n')

  await managementQuery(transaction, [], false)

  const after = await inspectState({ expect: 'partial', sourceCommit, migrationSha: actualSha })
  if (!(after.readyIndexBytes < before.readyIndexBytes)) {
    fail(`replacement ready index did not shrink: before=${before.readyIndexBytes} after=${after.readyIndexBytes}`)
  }
  if (after.messageRows < before.messageRows) {
    fail(`message row count decreased across index-only migration: before=${before.messageRows} after=${after.messageRows}`)
  }

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-phase-message-ready-partial-index-production-apply',
    sourceCommit,
    migrationVersion: VERSION,
    migrationSha256: actualSha,
    authorizedStateSha256: authorizedState,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: after.databaseBytes,
    databaseHeadroomAfter: 400000000 - after.databaseBytes,
    readyIndexBytesBefore: before.readyIndexBytes,
    readyIndexBytesAfter: after.readyIndexBytes,
    readyIndexBytesReclaimed: before.readyIndexBytes - after.readyIndexBytes,
    messageRowsBefore: before.messageRows,
    messageRowsAfter: after.messageRows,
    messageRowCountDecreased: false,
    migrationRecordedExactlyOnce: true,
    canonicalHistoryMutationAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    mainnetDisabled: true,
    productionMutationPerformed: true,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'inspect') {
  await inspect(options)
} else if (command === 'apply') {
  await apply(options)
} else {
  fail('command must be inspect or apply')
}
