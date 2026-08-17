#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const SQL_PATH = 'ops/production-sql/20260817110500_xrpl_r5_checkpoint_terminal_archive_fail_close.sql'
const TARGET_SIGNATURE = 'public.xrpl_create_r5_active_checkpoint_strict(text,timestamp with time zone)'
const BEFORE_DEFINITION_SHA = 'bc135435e0d729526aff6940c96b3ef78530b4612586f82ef73a7b99e145da10'
const BEFORE_SOURCE_SHA = 'd17d392292b4ca38c9b1f85fb0d8f2bebe3cd6db978ca42a70cfd3bc3deb133c'
const AFTER_DEFINITION_SHA = 'e170166e6c73bf4e7a112ad3daf94873935d0b2b248abf55f7bb42059575c733'
const FAIL_CLOSE_MARKER = 'r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint'
const CLAIM_SIGNATURE = 'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
const RETIRED_REV3 = [
  'public.xrpl_prepare_r5_active_recovery(text,text,text,bigint,text,timestamp with time zone)',
  'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)',
  'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)',
  'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)',
]

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'` }
function sameObject(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

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

function requireEnv(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
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
    signal: AbortSignal.timeout(90_000),
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
  return sourceCommit
}

async function loadPlan(sourceCommit) {
  const sql = await readFile(SQL_PATH, 'utf8')
  if (!sql.trimStart().startsWith('do $patch$')) fail('checkpoint fail-close SQL shape drifted')
  for (const marker of [BEFORE_DEFINITION_SHA, BEFORE_SOURCE_SHA, AFTER_DEFINITION_SHA, FAIL_CLOSE_MARKER, 'xrpl_create_r5_active_checkpoint_strict']) {
    if (!sql.includes(marker)) fail(`checkpoint fail-close SQL missing exact marker: ${marker}`)
  }
  for (const forbidden of [/\bdelete\s+from\b/iu, /\btruncate\b/iu, /\bvacuum\b/iu, /\breindex\b/iu, /\bdrop\s+(table|schema)\b/iu, /\bcron\./iu, /\bnet\./iu, /\bsupabase_migrations\b/iu, /terminalize_(message|completed_window)\s*\(/iu]) {
    if (forbidden.test(sql)) fail(`checkpoint fail-close SQL contains forbidden capability: ${forbidden}`)
  }
  const file = { path: SQL_PATH, sha256: sha256(sql), bytes: Buffer.byteLength(sql, 'utf8') }
  const digestInput = { schemaVersion: 1, purpose: 'r5-checkpoint-archive-fail-close-plan', sourceCommit, file }
  return { sql, file, digestInput, planDigestSha256: sha256(JSON.stringify(digestInput)) }
}

function inspectionSql() {
  const retiredPairs = RETIRED_REV3.map((signature, index) => `${sqlLiteral(String(index))}, jsonb_build_object(
      'signature', ${sqlLiteral(signature)},
      'serviceRoleExecute', has_function_privilege('service_role', ${sqlLiteral(signature)}::regprocedure, 'EXECUTE'),
      'authenticatedExecute', has_function_privilege('authenticated', ${sqlLiteral(signature)}::regprocedure, 'EXECUTE'),
      'anonExecute', has_function_privilege('anon', ${sqlLiteral(signature)}::regprocedure, 'EXECUTE')
    )`).join(',\n      ')
  return `select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'maxMigrationVersion', (select max(version::text) from supabase_migrations.schema_migrations),
    'archive', jsonb_build_object(
      'rows', (select count(*) from xrpl_phase_archive_v1.terminal_messages),
      'rlsEnabled', (select relrowsecurity from pg_class where oid='xrpl_phase_archive_v1.terminal_messages'::regclass),
      'serviceRoleSchemaUsage', has_schema_privilege('service_role','xrpl_phase_archive_v1','USAGE'),
      'serviceRoleTableSelect', has_table_privilege('service_role','xrpl_phase_archive_v1.terminal_messages','SELECT')
    ),
    'checkpoint', (select jsonb_build_object(
      'definition', pg_get_functiondef(p.oid),
      'sourceSha256', encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),
      'serviceRoleExecute', has_function_privilege('service_role',p.oid,'EXECUTE')
    ) from pg_proc p where p.oid=${sqlLiteral(TARGET_SIGNATURE)}::regprocedure),
    'retiredRev3', jsonb_build_object(${retiredPairs}),
    'claimGuardHelperExists', to_regprocedure('xrpl_r5_v1.database_claim_allowed(bigint)') is not null,
    'claimDefinition', pg_get_functiondef(${sqlLiteral(CLAIM_SIGNATURE)}::regprocedure),
    'canonicalCounts', jsonb_build_object(
      'messages', (select count(*) from public.xrpl_phase_messages),
      'successors', (select count(*) from public.xrpl_phase_successors),
      'work', (select count(*) from public.xrpl_phase_work),
      'referenceRows', (select count(*) from public.xrpl_phase_reference_rows)
    ),
    'run', coalesce((select jsonb_build_object(
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
    ) from xrpl_r5_v1.recovery_runs where run_id=${sqlLiteral(ACTIVE_RUN_ID)}), 'null'::jsonb),
    'batchCounts', (select jsonb_build_object(
      'total', count(*),
      'pending', count(*) filter (where status='pending'),
      'leased', count(*) filter (where status='leased'),
      'halted', count(*) filter (where status='halted'),
      'committed', count(*) filter (where status='committed')
    ) from xrpl_r5_v1.recovery_batches where run_id=${sqlLiteral(ACTIVE_RUN_ID)}),
    'scheduler', coalesce((select jsonb_build_object(
      'count', count(*),
      'rows', coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')) order by jobid),'[]'::jsonb)
    ) from cron.job where jobname='xrpl-lending-monitor-minute'), 'null'::jsonb)
  ) as state;`
}

function checkpointDefinitionSha(state) { return sha256(state.checkpoint?.definition ?? 'missing') }
function guardInstalled(state) {
  return state.claimGuardHelperExists === true && String(state.claimDefinition ?? '').includes('database_claim_allowed') && String(state.claimDefinition ?? '').includes('r5_recovery_database_halt')
}

function validateProtectedState(state) {
  const run = state.run
  if (!run || run.runId !== ACTIVE_RUN_ID) fail('active revision-4 successor run missing')
  if (run.status !== 'halted' || run.lastError !== 'r5_recovery_database_halt') fail(`R5 successor is not database-guard halted: ${run.status}:${run.lastError}`)
  if (Number(run.profileRevision) !== 4 || run.network !== 'devnet') fail('active revision-4 run identity drifted')
  if (!guardInstalled(state)) fail('R5 database guard is not installed')
  if (state.archive?.rlsEnabled !== true || state.archive?.serviceRoleSchemaUsage !== false || state.archive?.serviceRoleTableSelect !== false) fail('terminal archive private security contract drifted')
  if (state.checkpoint?.serviceRoleExecute !== true) fail('retained strict checkpoint is not executable by service_role')
  for (const [key, value] of Object.entries(state.retiredRev3 ?? {})) {
    if (value?.serviceRoleExecute !== false || value?.authenticatedExecute !== false || value?.anonExecute !== false) fail(`legacy revision-3 recovery entry point is not retired: ${key}`)
  }
}

function classification(state) {
  const digest = checkpointDefinitionSha(state)
  const source = state.checkpoint?.sourceSha256
  const hasMarker = String(state.checkpoint?.definition ?? '').includes(FAIL_CLOSE_MARKER)
  if (digest === BEFORE_DEFINITION_SHA && source === BEFORE_SOURCE_SHA && !hasMarker) return 'unapplied_expected'
  if (digest === AFTER_DEFINITION_SHA && hasMarker) return 'applied_consistent'
  return 'drift'
}

function structuralState(state, sourceCommit, plan) {
  return {
    schemaVersion: 1,
    purpose: 'r5-checkpoint-archive-fail-close-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)),
    planDigestSha256: plan.planDigestSha256,
    maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
    archive: state.archive,
    checkpointDefinitionSha256: checkpointDefinitionSha(state),
    checkpointSourceSha256: state.checkpoint?.sourceSha256 ?? null,
    checkpointServiceRoleExecute: state.checkpoint?.serviceRoleExecute === true,
    retiredRev3: state.retiredRev3 ?? {},
    canonicalCounts: state.canonicalCounts ?? {},
    activeRun: state.run ?? null,
    batchCounts: state.batchCounts ?? {},
    databaseGuardInstalled: guardInstalled(state),
    claimDefinitionSha256: sha256(state.claimDefinition ?? 'missing'),
    schedulerSha256: sha256(JSON.stringify(state.scheduler ?? null)),
  }
}

async function inspect(sourceCommit, plan) {
  const state = firstState(await managementQuery(inspectionSql(), true))
  validateProtectedState(state)
  const structural = structuralState(state, sourceCommit, plan)
  return {
    schemaVersion: 1,
    purpose: 'r5-checkpoint-archive-fail-close-state',
    sourceCommit,
    projectIdentityDigest: structural.projectIdentityDigest,
    plan: plan.digestInput,
    planDigestSha256: plan.planDigestSha256,
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    classification: classification(state),
    databaseBytes: Number(state.databaseBytes),
    maxMigrationVersion: structural.maxMigrationVersion,
    archiveRows: Number(state.archive?.rows ?? -1),
    checkpointDefinitionSha256: structural.checkpointDefinitionSha256,
    checkpointSourceSha256: structural.checkpointSourceSha256,
    canonicalCounts: structural.canonicalCounts,
    activeRun: structural.activeRun,
    batchCounts: structural.batchCounts,
    scheduler: state.scheduler,
    schedulerSha256: structural.schedulerSha256,
    productionDatabaseReadOnly: true,
    functionDefinitionMutationAuthorized: false,
    terminalTransportMutationAuthorized: false,
    canonicalHistoryRowMutationAuthorized: false,
    physicalCompactionAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    mainnetDisabled: state.run?.network === 'devnet',
    stabilizationAuthorized: false,
    soakAuthorized: false,
    r5RearmAuthorized: false,
  }
}

async function prepare(options) {
  const sourceCommit = validateSource(options)
  const plan = await loadPlan(sourceCommit)
  const state = await inspect(sourceCommit, plan)
  if (state.classification !== 'unapplied_expected') fail(`checkpoint fail-close pre-state is ${state.classification}, expected unapplied_expected`)
  if (state.archiveRows !== 0) fail('checkpoint fail-close must be installed before the first terminal archive row')
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}

async function apply(options) {
  const sourceCommit = validateSource(options)
  const authorizedState = options['authorized-state']
  const authorizedPlan = options['authorized-plan']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  if (!/^[a-f0-9]{64}$/u.test(authorizedPlan ?? '')) fail('invalid --authorized-plan')

  const plan = await loadPlan(sourceCommit)
  if (plan.planDigestSha256 !== authorizedPlan) fail('authorized checkpoint fail-close plan digest does not match exact staged SQL')
  const before = await inspect(sourceCommit, plan)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized checkpoint fail-close structural state drifted before mutation')
  if (before.classification !== 'unapplied_expected' || before.archiveRows !== 0) fail('checkpoint fail-close production pre-state is no longer eligible')

  await managementQuery(`begin;\nset local lock_timeout='5s';\nset local statement_timeout='30s';\n${plan.sql}\ncommit;`, false)

  const after = await inspect(sourceCommit, plan)
  if (after.classification !== 'applied_consistent') fail(`checkpoint fail-close post-state is ${after.classification}`)
  if (after.checkpointDefinitionSha256 !== AFTER_DEFINITION_SHA) fail('checkpoint fail-close post-definition digest mismatch')
  if (after.archiveRows !== 0) fail('checkpoint fail-close apply unexpectedly changed terminal archive rows')
  if (!sameObject(after.canonicalCounts, before.canonicalCounts)) fail('canonical transport/history row counts changed during checkpoint fail-close apply')
  if (!sameObject(after.activeRun, before.activeRun)) fail('R5 halted run state changed during checkpoint fail-close apply')
  if (!sameObject(after.batchCounts, before.batchCounts)) fail('R5 batch state changed during checkpoint fail-close apply')
  if (after.schedulerSha256 !== before.schedulerSha256) fail('scheduler state changed during checkpoint fail-close apply')
  if (after.maxMigrationVersion !== before.maxMigrationVersion) fail('production migration head changed during checkpoint fail-close apply')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-checkpoint-archive-fail-close-apply',
    sourceCommit,
    authorizedStateSha256: authorizedState,
    authorizedPlanDigestSha256: authorizedPlan,
    plan: plan.digestInput,
    classificationBefore: before.classification,
    classificationAfter: after.classification,
    checkpointDefinitionSha256Before: before.checkpointDefinitionSha256,
    checkpointDefinitionSha256After: after.checkpointDefinitionSha256,
    archiveRowsBefore: before.archiveRows,
    archiveRowsAfter: after.archiveRows,
    canonicalCountsBefore: before.canonicalCounts,
    canonicalCountsAfter: after.canonicalCounts,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: after.databaseBytes,
    activeRunBefore: before.activeRun,
    activeRunAfter: after.activeRun,
    schedulerSha256Before: before.schedulerSha256,
    schedulerSha256After: after.schedulerSha256,
    maxMigrationVersionBefore: before.maxMigrationVersion,
    maxMigrationVersionAfter: after.maxMigrationVersion,
    functionDefinitionMutationPerformed: true,
    terminalTransportMutationPerformed: false,
    canonicalHistoryRowMutationPerformed: false,
    physicalCompactionPerformed: false,
    vacuumPerformed: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    mainnetDisabled: true,
    stabilizationPerformed: false,
    soakPerformed: false,
    r5RearmPerformed: false,
    postVerificationReadOnly: true,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'prepare') await prepare(options)
else if (command === 'apply') await apply(options)
else fail('command must be prepare or apply')
