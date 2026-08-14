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
  'targetMigrationRecords', coalesce((
    select jsonb_agg(
      jsonb_build_object('version', version::text, 'statements', statements, 'name', name)
      order by name, statements::text
    )
    from supabase_migrations.schema_migrations
    where version::text = '${VERSION}'
  ), '[]'::jsonb),
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

function parseIndexShape(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    return { shape: 'missing', definition: null, definitionSha256: null, predicate: null, valid: false, ready: false }
  }
  const definition = String(index.definition ?? '')
  const predicate = index.predicate == null ? null : String(index.predicate)
  const columnsExpected = definition.includes('(profile_id, status, available_at, created_at, message_id)')
  const validAndReady = index.valid === true && index.ready === true
  let shape = 'drift'
  if (columnsExpected && validAndReady && predicate === null) {
    shape = 'full'
  } else if (
    columnsExpected
    && validAndReady
    && predicate != null
    && predicate.includes('pending')
    && predicate.includes('retry')
    && predicate.includes('leased')
    && !predicate.includes('completed')
    && !predicate.includes('error')
  ) {
    shape = 'partial'
  }
  return {
    shape,
    definition,
    definitionSha256: sha256(definition),
    predicate,
    valid: index.valid === true,
    ready: index.ready === true,
  }
}

function assertIndexShape(index, expect) {
  const parsed = parseIndexShape(index)
  if (parsed.shape === 'missing') fail('ready index state missing')
  if (!parsed.valid || !parsed.ready) fail('ready index is not valid and ready')
  if (expect === 'full' && parsed.shape !== 'full') {
    fail(`expected full ready index predicate, found: ${parsed.predicate}`)
  }
  if (expect === 'partial' && parsed.shape !== 'partial') {
    fail(`unexpected partial ready index predicate: ${parsed.predicate}`)
  }
  return parsed
}

function expectedHistoryRecord(migrationSha) {
  return {
    version: VERSION,
    statements: [`exact-phase-ready-partial-index sha256:${migrationSha}`],
    name: NAME,
  }
}

function historyRecordMatches(record, migrationSha) {
  const expected = expectedHistoryRecord(migrationSha)
  return Boolean(
    record
    && record.version === expected.version
    && record.name === expected.name
    && Array.isArray(record.statements)
    && record.statements.length === 1
    && record.statements[0] === expected.statements[0]
  )
}

function classifyAudit(raw, sourceCommit, migrationSha) {
  const state = normalizeJson(raw)
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('inspection state missing')
  if (!historyColumnsValid(normalizeJson(state.historyColumns))) fail('schema_migrations shape is not the expected version/statements/name contract')

  const targetRows = Number(state.targetMigrationRows)
  const targetRecords = normalizeJson(state.targetMigrationRecords)
  if (!Number.isInteger(targetRows) || targetRows < 0) fail('target migration row count invalid')
  if (!Array.isArray(targetRecords) || targetRecords.length !== targetRows) fail('target migration records/count mismatch')

  const maxMigrationVersion = String(state.maxMigrationVersion ?? '')
  const temporaryIndexExists = state.temporaryIndexExists === true
  const readyIndex = parseIndexShape(normalizeJson(state.readyIndex))
  const exactRecord = targetRows === 1 && historyRecordMatches(targetRecords[0], migrationSha)

  let classification = 'inconsistent'
  let reason = 'state does not match an authorized lifecycle state'

  if (
    !temporaryIndexExists
    && readyIndex.shape === 'full'
    && targetRows === 0
    && maxMigrationVersion === PREVIOUS_VERSION
  ) {
    classification = 'unapplied_expected'
    reason = 'full index and previous migration head are intact; authorization may be proposed'
  } else if (
    !temporaryIndexExists
    && readyIndex.shape === 'partial'
    && targetRows === 1
    && maxMigrationVersion === VERSION
    && exactRecord
  ) {
    classification = 'applied_consistent'
    reason = 'partial index and exact target migration-history record are both present'
  } else if (
    !temporaryIndexExists
    && readyIndex.shape === 'partial'
    && targetRows === 0
    && maxMigrationVersion === PREVIOUS_VERSION
  ) {
    classification = 'partial_unrecorded'
    reason = 'partial index exists but target migration history is absent'
  } else if (
    !temporaryIndexExists
    && readyIndex.shape === 'partial'
    && targetRows === 1
    && maxMigrationVersion === VERSION
    && !exactRecord
  ) {
    classification = 'applied_record_mismatch'
    reason = 'partial index and target migration version exist, but the target history record does not match the guarded exact record'
  } else if (temporaryIndexExists) {
    classification = 'temporary_index_present'
    reason = 'temporary claimable index exists; state may reflect an interrupted or out-of-band migration'
  } else if (readyIndex.shape === 'drift' || readyIndex.shape === 'missing') {
    classification = 'index_shape_drift'
    reason = `ready index shape is ${readyIndex.shape}`
  } else if (targetRows > 1) {
    classification = 'duplicate_migration_history'
    reason = `target migration is recorded ${targetRows} times`
  } else if (maxMigrationVersion !== PREVIOUS_VERSION && maxMigrationVersion !== VERSION) {
    classification = 'migration_head_drift'
    reason = `unexpected migration head ${maxMigrationVersion}`
  }

  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const projectIdentityDigest = sha256(projectId)
  const authorizationState = {
    schemaVersion: 2,
    purpose: 'r5-phase-message-ready-partial-index-authorization-state',
    sourceCommit,
    projectIdentityDigest,
    migrationVersion: VERSION,
    migrationSha256: migrationSha,
    maxMigrationVersion,
    targetMigrationRows: targetRows,
    targetMigrationRecordSha256: targetRows === 1 ? sha256(JSON.stringify(targetRecords[0])) : null,
    readyIndexDefinitionSha256: readyIndex.definitionSha256,
    readyIndexPredicate: readyIndex.predicate,
    temporaryIndexExists,
    classification,
  }

  return {
    schemaVersion: 2,
    purpose: 'r5-phase-message-ready-partial-index-production-audit',
    sourceCommit,
    projectIdentityDigest,
    migrationVersion: VERSION,
    migrationName: NAME,
    migrationSha256: migrationSha,
    classification,
    classificationReason: reason,
    authorizationEligible: classification === 'unapplied_expected',
    alreadyAppliedVerified: classification === 'applied_consistent',
    maxMigrationVersion,
    targetMigrationRows: targetRows,
    targetMigrationRecords: targetRecords,
    exactTargetMigrationRecord: exactRecord,
    databaseBytes: Number(state.databaseBytes),
    messageRows: Number(state.messageRows),
    messageStatusCounts: normalizeJson(state.messageStatusCounts),
    readyIndexShape: readyIndex.shape,
    readyIndexBytes: Number(normalizeJson(state.readyIndex)?.bytes),
    readyIndexDefinitionSha256: readyIndex.definitionSha256,
    readyIndexPredicate: readyIndex.predicate,
    temporaryIndexExists,
    authorizationState,
    authorizationStateSha256: sha256(JSON.stringify(authorizationState)),
    canonicalHistoryMutationAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    mainnetDisabled: true,
  }
}

function assertInspection(raw, expect, sourceCommit, migrationSha) {
  const audit = classifyAudit(raw, sourceCommit, migrationSha)
  if (audit.temporaryIndexExists) fail('temporary claimable ready index already exists')

  if (expect === 'full') {
    if (audit.classification !== 'unapplied_expected') {
      fail(`expected unapplied full-index state, found ${audit.classification}: ${audit.classificationReason}`)
    }
  } else if (expect === 'partial') {
    if (audit.classification !== 'applied_consistent') {
      fail(`expected exact applied partial-index state, found ${audit.classification}: ${audit.classificationReason}`)
    }
  } else {
    fail(`unsupported expected state: ${expect}`)
  }

  return {
    ...audit,
    purpose: 'r5-phase-message-ready-partial-index-production-state',
    expectedIndexShape: expect,
  }
}

async function rawInspection() {
  const rows = await managementQuery(inspectionQuery(), [], true)
  return findFirstKey(rows, 'state')
}

async function auditState({ sourceCommit, migrationSha }) {
  return classifyAudit(await rawInspection(), sourceCommit, migrationSha)
}

async function inspectState({ expect, sourceCommit, migrationSha }) {
  return assertInspection(await rawInspection(), expect, sourceCommit, migrationSha)
}

async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function validateCommonOptions(options) {
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  const expectedSha = options['expected-sha']
  return { sourceCommit, expectedSha }
}

async function audit(options) {
  const { sourceCommit, expectedSha } = validateCommonOptions(options)
  const { actualSha } = await loadMigration(expectedSha)
  const state = await auditState({ sourceCommit, migrationSha: actualSha })
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}

async function inspect(options) {
  const expect = options.expect
  if (!['full', 'partial'].includes(expect)) fail('--expect must be full or partial')
  const { sourceCommit, expectedSha } = validateCommonOptions(options)
  const { actualSha } = await loadMigration(expectedSha)
  const state = await inspectState({ expect, sourceCommit, migrationSha: actualSha })
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}

async function apply(options) {
  const { sourceCommit, expectedSha } = validateCommonOptions(options)
  const authorizedState = options['authorized-state']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
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
    schemaVersion: 2,
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
    exactMigrationHistoryRecordVerified: true,
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
if (command === 'audit') {
  await audit(options)
} else if (command === 'inspect') {
  await inspect(options)
} else if (command === 'apply') {
  await apply(options)
} else {
  fail('command must be audit, inspect, or apply')
}
