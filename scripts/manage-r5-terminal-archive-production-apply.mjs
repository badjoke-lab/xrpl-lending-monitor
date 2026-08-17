#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const INTERNAL_DB_HALT = 400_000_000
const CLAIM_SIGNATURE = 'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'

const SQL_PATHS = [
  'ops/production-sql/20260816183000_xrpl_phase_terminal_archive_contract.sql',
  'ops/production-sql/20260816190000_xrpl_phase_terminal_archive_window.sql',
  'ops/production-sql/20260816193000_xrpl_r5_revision4_terminal_archive_completion_patch.sql',
  'ops/production-sql/20260816200000_xrpl_phase_terminal_archive_core_compat_patch.sql',
  'ops/production-sql/20260816201000_xrpl_r5_revision4_archive_prepare_compat_patch.sql',
]

const TARGET_FUNCTIONS = [
  ['revision4Completion', 'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)', 'd759dfef8b11de9379af3d72cf28caba2f109e28f7aa83b36ece32e230a2b150', 'a7114afea201a32bd90c3f6ee08ae666e033e83bcc99384eb2a5b4a415f814b7'],
  ['phaseInsert', 'public.xrpl_phase_insert_message(text,text,text,jsonb,timestamp with time zone,timestamp with time zone)', '39f4bbe6c9e15e1f03549e7a389a30b30bf343c3bdf9e840468ebe58cd6f96ce', '1da5932584f944509782eb2dba50ad68b7e2c832e82463984975d5c08f44879a'],
  ['reserveSuccessor', 'public.xrpl_phase_reserve_successor(text,text,timestamp with time zone)', 'c6a2bc130386d9e5c6001e005ba299fc1cc874124e7a70b557208441377a4df9', 'e07a1d323e24d80909861a5379e0ee57a029648f92bdf5ed21c7d98155a1714f'],
  ['caughtUpScan', 'public.xrpl_complete_caught_up_scan(text,text,timestamp with time zone)', 'e1541a3c93835662a8f0f255eb12e4726b26c00f125b4d6048fa983dfa2a3a0c', '3d7f4c7d7ed7cbd91b54f268dad5bdead09ef4eba278085e3146f45c07ebc899'],
  ['scanPhase', 'public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,bigint,text,text,integer)', '583f7c6acbad42430c9b7c18c159667b01c4384bfdbb69900644d193d01e57f6', 'cd6b05ccd95eb29bfa046d29cfd01236371301865ceef7bb8db3fd2afadd6bff'],
  ['commitPhase', 'public.xrpl_complete_commit_phase(text,text,timestamp with time zone)', '5dfe3d3f2b5ea079b6efbd89ffb8794cc50fa7a2b25abd1525f8ee5c6dd38ad8', 'ab452bea0f967427122a89628cd9274621773700d9e06c5ddef628ac02bf75f4'],
  ['finalizePhase', 'public.xrpl_complete_finalize_phase(text,text,timestamp with time zone)', 'f66e1276e0f35ee16e5d91462fa8004acbe4174a76db1246d98c6749b4d38cf2', 'd3051c3b654274f7e6fa222be829b42829c6695c39a09c697065093364a6ff35'],
  ['portableScan', 'public.xrpl_complete_portable_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,text)', '74cf2ff52d821515a93cfaa40386fb88a3ea16aea550c8f8346189104e78fab7', '6f65875ec781135434326c53ed159c61154dc7f24728e02a9f578778dfea717d'],
  ['portableCommit', 'public.xrpl_complete_portable_commit_phase_strict(text,text,timestamp with time zone,text,text)', 'd3fe3b081fd25299bfa27bce53d2d8d1a5065690eccd0aaf2c1f1d27356d1fe5', '524a48ab154d650f0a37ada2386d52172163ab51acbfeed795b5bcbd224fbcfb'],
  ['portableFinalize', 'public.xrpl_complete_portable_finalize_phase(text,text,timestamp with time zone)', '6b6b5fabc8ce71e4d1985b2a4af917ccf9de3615fcbd5ec467cb8928f70bf898', '8d761a2bf69ea4228f18f482ab620e294354644f60eea6e8101a4efd55766a0a'],
  ['revision4Prepare', 'public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone)', 'aaf2014c2553813458bec1b14fc06edc3901364cd0cfc9b2370a056b9432f494', '2795e4abe98f2dea95adb8a937446e824e85b3708b6aaeca2d2047a16dff3d5c'],
]

const ARCHIVE_FUNCTIONS = [
  'xrpl_phase_archive_v1.assert_message_identity(text,text,text,jsonb)',
  'xrpl_phase_archive_v1.assert_successor_identity(text,text)',
  'xrpl_phase_archive_v1.duplicate_completion(text,text)',
  'xrpl_phase_archive_v1.terminalize_message(text,timestamp with time zone)',
  'xrpl_phase_archive_v1.terminalize_completed_window(text,timestamp with time zone,timestamp with time zone)',
]

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'` }

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

function validateSqlSource(path, sql, index) {
  const expectedStarts = ['create schema if not exists xrpl_phase_archive_v1;', 'create or replace function xrpl_phase_archive_v1.terminalize_completed_window(', 'do $patch$', 'do $patch$', 'do $patch$']
  if (!sql.trimStart().startsWith(expectedStarts[index])) fail(`Phase A SQL shape drifted at ${path}`)
  for (const forbidden of [/\btruncate\b/iu, /\bvacuum\b/iu, /\bcron\./iu, /\bnet\./iu, /supabase_migrations/iu]) {
    if (forbidden.test(sql)) fail(`Phase A SQL contains forbidden capability at ${path}: ${forbidden}`)
  }
  if (/\bdrop\s+(table|schema)\b/iu.test(sql)) fail(`Phase A SQL contains destructive schema drop at ${path}`)
  if (/\bcall\s+xrpl_phase_archive_v1\./iu.test(sql)) fail(`Phase A SQL directly invokes archive mutation at ${path}`)
}

async function loadPlan(sourceCommit) {
  const files = []
  for (let index = 0; index < SQL_PATHS.length; index += 1) {
    const path = SQL_PATHS[index]
    const sql = await readFile(path, 'utf8')
    validateSqlSource(path, sql, index)
    files.push({ path, sha256: sha256(sql), bytes: Buffer.byteLength(sql, 'utf8'), sql })
  }
  const digestInput = {
    schemaVersion: 1,
    purpose: 'r5-terminal-archive-phase-a-plan',
    sourceCommit,
    files: files.map(({ path, sha256: digest, bytes }) => ({ path, sha256: digest, bytes })),
  }
  return { files, digestInput, planDigestSha256: sha256(JSON.stringify(digestInput)) }
}

function inspectionSql() {
  const functionPairs = TARGET_FUNCTIONS.map(([key, signature]) => `${sqlLiteral(key)}, pg_get_functiondef(${sqlLiteral(signature)}::regprocedure)`).join(',\n      ')
  const archivePairs = ARCHIVE_FUNCTIONS.map((signature, index) => `${sqlLiteral(String(index))}, to_regprocedure(${sqlLiteral(signature)}) is not null`).join(',\n      ')
  return `select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'maxMigrationVersion', (select max(version::text) from supabase_migrations.schema_migrations),
    'archiveSchemaExists', to_regnamespace('xrpl_phase_archive_v1') is not null,
    'archiveTableExists', to_regclass('xrpl_phase_archive_v1.terminal_messages') is not null,
    'archiveFunctions', jsonb_build_object(${archivePairs}),
    'targetDefinitions', jsonb_build_object(${functionPairs}),
    'claimGuardHelperExists', to_regprocedure('xrpl_r5_v1.database_claim_allowed(bigint)') is not null,
    'claimDefinition', pg_get_functiondef('${CLAIM_SIGNATURE}'::regprocedure),
    'canonicalCounts', jsonb_build_object(
      'messages', (select count(*) from public.xrpl_phase_messages),
      'successors', (select count(*) from public.xrpl_phase_successors),
      'work', (select count(*) from public.xrpl_phase_work),
      'referenceRows', (select count(*) from public.xrpl_phase_reference_rows)
    ),
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
      ) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'
    ), 'null'::jsonb),
    'batchCounts', (select jsonb_build_object(
      'total', count(*),
      'pending', count(*) filter (where status='pending'),
      'leased', count(*) filter (where status='leased'),
      'halted', count(*) filter (where status='halted'),
      'committed', count(*) filter (where status='committed')
    ) from xrpl_r5_v1.recovery_batches where run_id='${ACTIVE_RUN_ID}'),
    'scheduler', coalesce((select jsonb_build_object(
      'count', count(*),
      'rows', coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')) order by jobid),'[]'::jsonb)
    ) from cron.job where jobname='xrpl-lending-monitor-minute'), 'null'::jsonb)
  ) as state;`
}

function digestDefinitions(definitions) {
  const result = {}
  for (const [key] of TARGET_FUNCTIONS) result[key] = sha256(definitions?.[key] ?? 'missing')
  return result
}

function expectedDigestMap(position) {
  return Object.fromEntries(TARGET_FUNCTIONS.map(([key, , before, after]) => [key, position === 'before' ? before : after]))
}

function sameObject(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

function classifyArchiveState(state, digests) {
  const helperValues = Object.values(state.archiveFunctions ?? {})
  const noArchive = state.archiveSchemaExists !== true && state.archiveTableExists !== true && helperValues.every((value) => value !== true)
  const allArchive = state.archiveSchemaExists === true && state.archiveTableExists === true && helperValues.length === ARCHIVE_FUNCTIONS.length && helperValues.every((value) => value === true)
  if (noArchive && sameObject(digests, expectedDigestMap('before'))) return 'unapplied_expected'
  if (allArchive && sameObject(digests, expectedDigestMap('after'))) return 'applied_consistent'
  return 'drift'
}

function guardInstalled(state) {
  return state.claimGuardHelperExists === true &&
    String(state.claimDefinition ?? '').includes('database_claim_allowed') &&
    String(state.claimDefinition ?? '').includes('r5_recovery_database_halt')
}

function validateHaltedRun(state) {
  if (!state.run || state.run.runId !== ACTIVE_RUN_ID) fail('active revision-4 successor run missing')
  if (Number(state.run.profileRevision) !== 4) fail('active revision-4 profile drifted')
  if (state.run.network !== 'devnet') fail('active revision-4 run is not Devnet')
  if (state.run.status !== 'halted' || state.run.lastError !== 'r5_recovery_database_halt') {
    fail(`R5 successor is not database-guard halted: ${state.run.status}:${state.run.lastError}`)
  }
  if (!guardInstalled(state)) fail('R5 database guard is not installed')
}

async function archiveSecurityState() {
  const rows = await managementQuery(`select jsonb_build_object(
    'rows', (select count(*) from xrpl_phase_archive_v1.terminal_messages),
    'rlsEnabled', (select relrowsecurity from pg_class where oid='xrpl_phase_archive_v1.terminal_messages'::regclass),
    'anonSchemaUsage', has_schema_privilege('anon','xrpl_phase_archive_v1','USAGE'),
    'authenticatedSchemaUsage', has_schema_privilege('authenticated','xrpl_phase_archive_v1','USAGE'),
    'serviceRoleSchemaUsage', has_schema_privilege('service_role','xrpl_phase_archive_v1','USAGE'),
    'anonTableSelect', has_table_privilege('anon','xrpl_phase_archive_v1.terminal_messages','SELECT'),
    'authenticatedTableSelect', has_table_privilege('authenticated','xrpl_phase_archive_v1.terminal_messages','SELECT'),
    'serviceRoleTableSelect', has_table_privilege('service_role','xrpl_phase_archive_v1.terminal_messages','SELECT')
  ) as state;`, true)
  return firstState(rows)
}

function structuralState(state, sourceCommit, plan) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const definitionDigests = digestDefinitions(state.targetDefinitions)
  return {
    schemaVersion: 1,
    purpose: 'r5-terminal-archive-phase-a-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    planDigestSha256: plan.planDigestSha256,
    maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
    archiveClassification: classifyArchiveState(state, definitionDigests),
    archiveSchemaExists: state.archiveSchemaExists === true,
    archiveTableExists: state.archiveTableExists === true,
    archiveFunctions: state.archiveFunctions ?? {},
    targetFunctionDefinitionSha256: definitionDigests,
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
  validateHaltedRun(state)
  const structural = structuralState(state, sourceCommit, plan)
  let archiveSecurity = null
  if (state.archiveTableExists === true) archiveSecurity = await archiveSecurityState()
  return {
    schemaVersion: 1,
    purpose: 'r5-terminal-archive-phase-a-state',
    sourceCommit,
    projectIdentityDigest: structural.projectIdentityDigest,
    plan: plan.digestInput,
    planDigestSha256: plan.planDigestSha256,
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    archiveClassification: structural.archiveClassification,
    archiveSecurity,
    databaseBytes: Number(state.databaseBytes),
    databaseHaltBytes: INTERNAL_DB_HALT,
    databaseHeadroomBytes: INTERNAL_DB_HALT - Number(state.databaseBytes),
    maxMigrationVersion: structural.maxMigrationVersion,
    canonicalCounts: structural.canonicalCounts,
    activeRun: structural.activeRun,
    batchCounts: structural.batchCounts,
    scheduler: state.scheduler,
    schedulerSha256: structural.schedulerSha256,
    productionDatabaseReadOnly: true,
    schemaFunctionMutationAuthorized: false,
    canonicalHistoryRowMutationAuthorized: false,
    terminalTransportBackfillAuthorized: false,
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
  if (state.archiveClassification !== 'unapplied_expected') fail(`Phase A production pre-state is ${state.archiveClassification}, expected unapplied_expected`)
  if (Number(state.databaseBytes) < INTERNAL_DB_HALT) fail('database unexpectedly fell below fixed halt; re-evaluate before Phase A')
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
  if (plan.planDigestSha256 !== authorizedPlan) fail('authorized Phase A plan digest does not match exact staged SQL plan')
  const before = await inspect(sourceCommit, plan)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized Phase A structural state drifted before mutation')
  if (before.archiveClassification !== 'unapplied_expected') fail(`Phase A pre-state is ${before.archiveClassification}`)

  const transaction = [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'lock table public.xrpl_phase_messages in share mode;',
    'lock table public.xrpl_phase_successors in share mode;',
    'lock table public.xrpl_phase_work in share mode;',
    'lock table public.xrpl_phase_reference_rows in share mode;',
    ...plan.files.map(({ path, sql }) => `-- BEGIN EXACT PHASE A FILE ${path}\n${sql}\n-- END EXACT PHASE A FILE ${path}`),
    'commit;',
  ].join('\n')

  if (/\btruncate\b/iu.test(transaction) || /\bvacuum\b/iu.test(transaction) || /\bcron\./iu.test(transaction) || /\bnet\./iu.test(transaction)) {
    fail('assembled Phase A transaction contains forbidden capability')
  }

  await managementQuery(transaction, false)

  const after = await inspect(sourceCommit, plan)
  if (after.archiveClassification !== 'applied_consistent') fail(`Phase A post-state is ${after.archiveClassification}`)
  if (!after.archiveSecurity || Number(after.archiveSecurity.rows) !== 0) fail('Phase A unexpectedly archived terminal transport rows')
  if (after.archiveSecurity.rlsEnabled !== true) fail('terminal archive RLS is not enabled')
  for (const field of ['anonSchemaUsage', 'authenticatedSchemaUsage', 'serviceRoleSchemaUsage', 'anonTableSelect', 'authenticatedTableSelect', 'serviceRoleTableSelect']) {
    if (after.archiveSecurity[field] !== false) fail(`terminal archive private privilege contract failed: ${field}`)
  }
  if (!sameObject(after.canonicalCounts, before.canonicalCounts)) fail('canonical transport/history row counts changed during Phase A')
  if (!sameObject(after.activeRun, before.activeRun)) fail('R5 halted run state changed during Phase A')
  if (!sameObject(after.batchCounts, before.batchCounts)) fail('R5 batch state changed during Phase A')
  if (after.schedulerSha256 !== before.schedulerSha256) fail('scheduler state changed during Phase A')
  if (after.maxMigrationVersion !== before.maxMigrationVersion) fail('production migration head changed during Phase A')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-terminal-archive-phase-a-apply',
    sourceCommit,
    authorizedStateSha256: authorizedState,
    authorizedPlanDigestSha256: authorizedPlan,
    plan: plan.digestInput,
    archiveClassificationBefore: before.archiveClassification,
    archiveClassificationAfter: after.archiveClassification,
    archiveRowsAfter: Number(after.archiveSecurity.rows),
    archiveRlsEnabled: after.archiveSecurity.rlsEnabled === true,
    archivePrivatePrivilegesVerified: true,
    canonicalCountsBefore: before.canonicalCounts,
    canonicalCountsAfter: after.canonicalCounts,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: after.databaseBytes,
    databaseHaltBytes: INTERNAL_DB_HALT,
    activeRunBefore: before.activeRun,
    activeRunAfter: after.activeRun,
    schedulerSha256Before: before.schedulerSha256,
    schedulerSha256After: after.schedulerSha256,
    maxMigrationVersionBefore: before.maxMigrationVersion,
    maxMigrationVersionAfter: after.maxMigrationVersion,
    schemaFunctionMutationPerformed: true,
    canonicalHistoryRowMutationPerformed: false,
    terminalTransportBackfillPerformed: false,
    terminalTransportDeletionPerformed: false,
    physicalCompactionPerformed: false,
    vacuumPerformed: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    r5RearmAuthorized: false,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'prepare') await prepare(options)
else if (command === 'apply') await apply(options)
else fail('command must be prepare or apply')
