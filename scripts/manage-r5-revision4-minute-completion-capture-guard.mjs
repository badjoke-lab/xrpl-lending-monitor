#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const VERSION = '20260816040000'
const NAME = 'xrpl_r5_revision4_minute_completion_capture_guard'
const SQL_PATH = `ops/production-sql/${VERSION}_${NAME}.sql`
const PREVIOUS_VERSION = '20260816020000'
const FORMAL_RUN_ID = 'r5-recovery-selected-revision4-entry'
const MINUTE_RUN_ID = 'r5-recovery-selected-revision4-minute-entry'
const QUALIFICATION_KEY = 'r4f-revision4-r5-12-ledger-accounting-v1'
const CONSTRAINT_NAME = 'xrpl_r5_revision4_accounting_qualification_run_check'
const SIGNATURE = 'public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
const INNER_SIGNATURE = 'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
const OLD_CAPTURE = 'if v_batch.ledger_count = 12 then'
const NEW_CAPTURE = "if v_batch.ledger_count = 12\n    and p_run_id = 'r5-recovery-selected-revision4-entry' then"

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) fail(`unexpected argument:${token}`)
    const value = rest[index + 1]
    if (value == null || value.startsWith('--')) fail(`missing value for ${token}`)
    options[token.slice(2)] = value
    index += 1
  }
  return { command, options }
}

function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable:${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const value of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(value)) return value
  }
  fail('Management API response contains no rows')
}

async function managementQuery(query, readOnly = true) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 3000) } }
  if (!response.ok) fail(`Management API query failed (${response.status}):${JSON.stringify(body).slice(0, 3000)}`)
  return rowsFromResponse(body)
}

async function loadSql(expectedSha) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha ?? '')) fail('expected SQL SHA-256 invalid')
  const sql = await readFile(SQL_PATH, 'utf8')
  const actualSha = sha256(sql)
  if (actualSha !== expectedSha) fail('completion capture guard SQL drifted from authorization')
  for (const marker of [FORMAL_RUN_ID, MINUTE_RUN_ID, QUALIFICATION_KEY, CONSTRAINT_NAME, OLD_CAPTURE.replace(' then', ''), 'without_qualification_capture']) {
    if (!sql.includes(marker)) fail(`completion capture guard SQL missing marker:${marker}`)
  }
  for (const forbidden of [
    /\btruncate\b/iu,
    /\bdelete\s+from\b/iu,
    /\bdrop\s+(?:table|schema)\b/iu,
    /\balter\s+table\b/iu,
    /\bupdate\s+xrpl_r5_v1\.revision4_accounting_qualification_evidence\b/iu,
    /\binsert\s+into\s+xrpl_r5_v1\.revision4_accounting_qualification_evidence\b/iu,
  ]) if (forbidden.test(sql)) fail(`completion capture guard SQL contains forbidden mutation:${forbidden}`)
  return { sql, actualSha }
}

function inspectionQuery() {
  return `select jsonb_build_object(
    'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
    'targetMigrationRows',(select count(*) from supabase_migrations.schema_migrations where version::text='${VERSION}'),
    'targetMigrationRecords',coalesce((select jsonb_agg(jsonb_build_object('version',version::text,'statements',statements,'name',name)) from supabase_migrations.schema_migrations where version::text='${VERSION}'),'[]'::jsonb),
    'outerFunctionExists',to_regprocedure('${SIGNATURE}') is not null,
    'innerFunctionExists',to_regprocedure('${INNER_SIGNATURE}') is not null,
    'outerDefinition',case when to_regprocedure('${SIGNATURE}') is null then null else pg_get_functiondef('${SIGNATURE}'::regprocedure) end,
    'outerSecurityDefiner',coalesce((select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${SIGNATURE}')),false),
    'anonExecute',coalesce((select has_function_privilege('anon',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('${SIGNATURE}')),false),
    'authenticatedExecute',coalesce((select has_function_privilege('authenticated',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('${SIGNATURE}')),false),
    'serviceRoleExecute',coalesce((select has_function_privilege('service_role',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('${SIGNATURE}')),false),
    'constraintCount',(select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='xrpl_r5_v1' and t.relname='revision4_accounting_qualification_evidence' and c.conname='${CONSTRAINT_NAME}' and c.contype='c'),
    'constraintDefinition',(select pg_get_constraintdef(c.oid) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='xrpl_r5_v1' and t.relname='revision4_accounting_qualification_evidence' and c.conname='${CONSTRAINT_NAME}' and c.contype='c' limit 1),
    'formalEvidence',(select to_jsonb(e) from xrpl_r5_v1.revision4_accounting_qualification_evidence e where qualification_key='${QUALIFICATION_KEY}' limit 1),
    'formalEvidenceCount',(select count(*) from xrpl_r5_v1.revision4_accounting_qualification_evidence where qualification_key='${QUALIFICATION_KEY}'),
    'formalRun',(select to_jsonb(r) from xrpl_r5_v1.recovery_runs r where run_id='${FORMAL_RUN_ID}'),
    'minuteRun',(select to_jsonb(r) from xrpl_r5_v1.recovery_runs r where run_id='${MINUTE_RUN_ID}'),
    'minuteBatchCounts',(select jsonb_build_object('total',count(*),'leased',count(*) filter(where status='leased'),'failed',count(*) filter(where status='failed'),'completed',count(*) filter(where status='completed')) from xrpl_r5_v1.recovery_batches where run_id='${MINUTE_RUN_ID}')
  ) state`.trim()
}

function parseState(rows) {
  const raw = rows[0]?.state ?? rows[0]
  if (!raw) fail('inspection returned no state')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

function migrationRecordMatches(record, sqlSha) {
  return Boolean(
    record
    && String(record.version) === VERSION
    && record.name === NAME
    && Array.isArray(record.statements)
    && record.statements.length === 1
    && record.statements[0] === `exact-${NAME} sha256:${sqlSha}`
  )
}

function occurrenceCount(text, needle) {
  if (!needle) return 0
  return String(text ?? '').split(needle).length - 1
}

function classify(state, sqlSha, sourceCommit) {
  const definition = String(state.outerDefinition ?? '')
  const constraintDefinition = String(state.constraintDefinition ?? '')
  const records = Array.isArray(state.targetMigrationRecords) ? state.targetMigrationRecords : []
  const formalEvidence = state.formalEvidence
  const formalRun = state.formalRun
  const minuteRun = state.minuteRun
  const prechecks = {
    outerFunctionExists: state.outerFunctionExists === true,
    innerFunctionExists: state.innerFunctionExists === true,
    outerSecurityDefiner: state.outerSecurityDefiner === true,
    outerAnonDenied: state.anonExecute === false,
    outerAuthenticatedDenied: state.authenticatedExecute === false,
    outerServiceRoleAllowed: state.serviceRoleExecute === true,
    strictConstraintExactlyOne: Number(state.constraintCount) === 1,
    strictConstraintFormalRunBound: constraintDefinition.includes(FORMAL_RUN_ID),
    strictConstraintMinuteRunExcluded: !constraintDefinition.includes(MINUTE_RUN_ID),
    formalEvidenceExactlyOne: Number(state.formalEvidenceCount) === 1,
    formalEvidenceFormalRunBound: formalEvidence?.run_id === FORMAL_RUN_ID,
    formalEvidenceQualificationKeyExact: formalEvidence?.qualification_key === QUALIFICATION_KEY,
    formalEvidenceLedgerCountTwelve: Number(formalEvidence?.ledger_count) === 12,
    formalRunPreserved: formalRun?.run_id === FORMAL_RUN_ID && Number(formalRun?.profile_revision) === 4,
    minuteRunExists: minuteRun?.run_id === MINUTE_RUN_ID && Number(minuteRun?.profile_revision) === 4,
    wrapperCallsInner: definition.includes('xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture'),
    wrapperCapturesQualificationEvidence: definition.includes('revision4_accounting_qualification_evidence'),
    oldCaptureExactlyOnce: occurrenceCount(definition, OLD_CAPTURE) === 1,
    guardedCaptureAbsent: occurrenceCount(definition, NEW_CAPTURE) === 0,
    oldCaptureAbsent: occurrenceCount(definition, OLD_CAPTURE) === 0,
    guardedCaptureExactlyOnce: occurrenceCount(definition, NEW_CAPTURE) === 1,
    previousMigrationBoundaryExact: String(state.maxMigrationVersion) === PREVIOUS_VERSION,
    repairMigrationAbsent: Number(state.targetMigrationRows) === 0,
    repairMigrationBoundaryExact: String(state.maxMigrationVersion) === VERSION,
    repairHistoryExact: Number(state.targetMigrationRows) === 1 && migrationRecordMatches(records[0], sqlSha),
  }
  const common = [
    'outerFunctionExists','innerFunctionExists','outerSecurityDefiner','outerAnonDenied','outerAuthenticatedDenied','outerServiceRoleAllowed',
    'strictConstraintExactlyOne','strictConstraintFormalRunBound','strictConstraintMinuteRunExcluded','formalEvidenceExactlyOne',
    'formalEvidenceFormalRunBound','formalEvidenceQualificationKeyExact','formalEvidenceLedgerCountTwelve','formalRunPreserved','minuteRunExists',
    'wrapperCallsInner','wrapperCapturesQualificationEvidence',
  ].every((key) => prechecks[key] === true)

  let classification = 'inconsistent'
  let reason = 'production completion wrapper does not match a reviewed repair lifecycle'
  if (common && prechecks.oldCaptureExactlyOnce && prechecks.guardedCaptureAbsent && prechecks.previousMigrationBoundaryExact && prechecks.repairMigrationAbsent) {
    classification = 'unapplied_expected'
    reason = 'formal evidence is intact and the current wrapper still captures every 12-ledger revision-4 completion'
  } else if (common && prechecks.oldCaptureAbsent && prechecks.guardedCaptureExactlyOnce && prechecks.repairMigrationBoundaryExact && prechecks.repairHistoryExact) {
    classification = 'applied_consistent'
    reason = 'formal evidence remains strict while only the formal run is eligible for qualification capture'
  }

  const stable = {
    schemaVersion: 1,
    purpose: 'r5-revision4-minute-completion-capture-guard-state',
    sourceCommit,
    projectIdentityDigest: sha256(requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)),
    sqlSha256: sqlSha,
    classification,
    maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
    targetMigrationRows: Number(state.targetMigrationRows),
    formalEvidence,
    formalEvidenceDigest: sha256(JSON.stringify(formalEvidence ?? null)),
    formalRun: state.formalRun,
    minuteRun: state.minuteRun,
    minuteBatchCounts: state.minuteBatchCounts,
    constraintDefinition,
    outerDefinitionSha256: sha256(definition),
    prechecks,
    mainnetDisabled: true,
    formalEvidenceMutationAuthorized: false,
    qualificationConstraintMutationAuthorized: false,
    publicReaderMutationAuthorized: false,
    oldRunRewriteAuthorized: false,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }
  return { ...stable, classificationReason: reason, stateSha256: sha256(JSON.stringify(stable)), targetMigrationRecords: records }
}

async function writeOutput(output, value) {
  if (!output) return
  const path = resolve(output)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function boundOptions(options) {
  const sourceCommit = options['source-commit']
  const expectedSha = options['expected-sha']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('source commit invalid')
  return { sourceCommit, expectedSha }
}

async function audit(options) {
  const { sourceCommit, expectedSha } = boundOptions(options)
  const { actualSha } = await loadSql(expectedSha)
  const result = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit)
  await writeOutput(options.output, result)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

async function apply(options) {
  const { sourceCommit, expectedSha } = boundOptions(options)
  const { sql, actualSha } = await loadSql(expectedSha)
  const before = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit)
  if (before.classification === 'applied_consistent') {
    const replay = { schemaVersion: 1, purpose: 'r5-revision4-minute-completion-capture-guard-apply', sourceCommit, replayed: true, mutationPerformed: false, before, after: before, mainnetDisabled: true }
    await writeOutput(options.output, replay)
    process.stdout.write(`${JSON.stringify(replay)}\n`)
    return
  }
  if (before.classification !== 'unapplied_expected') {
    const failure = { schemaVersion: 1, purpose: 'r5-revision4-minute-completion-capture-guard-prestate-failure', sourceCommit, mutationPerformed: false, before, mainnetDisabled: true }
    await writeOutput(options.output, failure)
    fail(`completion capture guard pre-state is ${before.classification}`)
  }

  const marker = `exact-${NAME} sha256:${actualSha}`
  const statement = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\n${sql}\ninsert into supabase_migrations.schema_migrations(version,statements,name) values ('${VERSION}',array['${marker}']::text[],'${NAME}');\ncommit;`
  await managementQuery(statement, false)

  const after = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit)
  if (after.classification !== 'applied_consistent') fail(`completion capture guard post-state is ${after.classification}`)
  if (after.formalEvidenceDigest !== before.formalEvidenceDigest) fail('formal qualification evidence changed during completion capture guard repair')
  if (after.constraintDefinition !== before.constraintDefinition) fail('formal qualification run CHECK changed during completion capture guard repair')
  if (JSON.stringify(after.formalRun) !== JSON.stringify(before.formalRun)) fail('formal qualification run changed during completion capture guard repair')

  const result = {
    schemaVersion: 1,
    purpose: 'r5-revision4-minute-completion-capture-guard-apply',
    sourceCommit,
    replayed: false,
    mutationPerformed: true,
    mutationScope: 'revision-4 completion wrapper capture predicate and exact migration-history marker only',
    formalEvidencePreservedExactly: true,
    qualificationConstraintPreservedExactly: true,
    formalRunPreservedExactly: true,
    before,
    after,
    mainnetDisabled: true,
    publicReaderMutationPerformed: false,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }
  await writeOutput(options.output, result)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'audit') await audit(options)
else if (command === 'apply') await apply(options)
else fail(`unknown command:${command ?? '<missing>'}`)
