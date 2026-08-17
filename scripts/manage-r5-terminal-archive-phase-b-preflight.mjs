#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const INTERNAL_DB_HALT = 400_000_000

const CURRENT_R5 = [
  ['claimRevision4', 'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)', '7496a3a2459396a2edaef74588e42b666df50dd384a45d7a2d1f702b7a7884a7'],
  ['completeRevision4', 'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)', 'a7114afea201a32bd90c3f6ee08ae666e033e83bcc99384eb2a5b4a415f814b7'],
  ['prepareRevision4', 'public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone)', '2795e4abe98f2dea95adb8a937446e824e85b3708b6aaeca2d2047a16dff3d5c'],
  ['rebindRevision4', 'public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_s(text,timestamp with time zone)', '58fd34452ac805724d21b6137d4545b23e5ddeb1cfafdaab346cb5f6a4964beb'],
]

const LEGACY_SURFACE = [
  ['claimRevision3', 'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)', '29c6b538a6468ad4f4392b7b0fc5a65789520c446d9f711a4772c6724dbd2d1f'],
  ['completeRevision3', 'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)', '35a5cbc1b92b46acd0593a5f13a5a633c411c59ec64a39815f12f68687e24cf8'],
  ['checkpointDrain', 'public.xrpl_drain_r5_checkpoint_boundary(text,timestamp with time zone)', '65e159a8645d54ef8f6138b9b9c039abf0bbd0f3e0f9f6b2a1859d3b76bc25f5'],
  ['sevenClassEpoch', 'public.xrpl_ensure_remote_seven_class_epoch(timestamp with time zone)', '64e140782fc9fac5e5949bca5bd5a279255a5f34be5c31ab6b26622ecd86f427'],
]

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'` }

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

function functionObject(entries) {
  return entries.map(([key, signature]) => `${sqlLiteral(key)}, jsonb_build_object(
      'definition', pg_get_functiondef(${sqlLiteral(signature)}::regprocedure),
      'serviceRoleExecute', has_function_privilege('service_role', ${sqlLiteral(signature)}::regprocedure, 'EXECUTE'),
      'anonExecute', has_function_privilege('anon', ${sqlLiteral(signature)}::regprocedure, 'EXECUTE'),
      'authenticatedExecute', has_function_privilege('authenticated', ${sqlLiteral(signature)}::regprocedure, 'EXECUTE')
    )`).join(',\n      ')
}

function inspectionSql() {
  return `with cutoff as (
    select now() - interval '24 hours' as ts
  ), eligible as (
    select m.message_id
    from public.xrpl_phase_messages m, cutoff c
    where m.status='completed' and m.completed_at < c.ts
  )
  select jsonb_build_object(
    'observedAt', now(),
    'databaseBytes', pg_database_size(current_database()),
    'maxMigrationVersion', (select max(version::text) from supabase_migrations.schema_migrations),
    'archive', jsonb_build_object(
      'tableExists', to_regclass('xrpl_phase_archive_v1.terminal_messages') is not null,
      'rows', (select count(*) from xrpl_phase_archive_v1.terminal_messages),
      'rlsEnabled', (select relrowsecurity from pg_class where oid='xrpl_phase_archive_v1.terminal_messages'::regclass),
      'serviceRoleSelect', has_table_privilege('service_role','xrpl_phase_archive_v1.terminal_messages','SELECT')
    ),
    'candidates', jsonb_build_object(
      'cutoff', (select ts from cutoff),
      'messages', (select count(*) from eligible),
      'currentEdges', (select count(*) from public.xrpl_phase_successors s join eligible e on e.message_id=s.current_message_id),
      'roots', (select count(*) from eligible e where not exists (select 1 from public.xrpl_phase_successors s where s.successor_message_id=e.message_id)),
      'eligibleToRetained', (select count(*) from public.xrpl_phase_successors s join eligible e on e.message_id=s.current_message_id left join eligible se on se.message_id=s.successor_message_id where se.message_id is null),
      'retainedToEligible', (select count(*) from public.xrpl_phase_successors s join eligible e on e.message_id=s.successor_message_id left join eligible ce on ce.message_id=s.current_message_id where ce.message_id is null)
    ),
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
      'network', network,
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
    ) from cron.job where jobname='xrpl-lending-monitor-minute'), 'null'::jsonb),
    'currentR5', jsonb_build_object(${functionObject(CURRENT_R5)}),
    'legacySurface', jsonb_build_object(${functionObject(LEGACY_SURFACE)})
  ) as state;`
}

function digestFunctionMap(object, expectedEntries) {
  const out = {}
  for (const [key] of expectedEntries) out[key] = sha256(object?.[key]?.definition ?? 'missing')
  return out
}

function expectedMap(entries) { return Object.fromEntries(entries.map(([key, , expected]) => [key, expected])) }
function sameObject(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

function validateRun(state) {
  const run = state.run
  if (!run || run.runId !== ACTIVE_RUN_ID) fail('active revision-4 successor run missing')
  if (run.status !== 'halted' || run.lastError !== 'r5_recovery_database_halt') fail(`R5 is not database-guard halted: ${run.status}:${run.lastError}`)
  if (Number(run.profileRevision) !== 4 || run.network !== 'devnet') fail('active R5 identity drifted')
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const state = firstState(await managementQuery(inspectionSql()))
validateRun(state)

const currentDigests = digestFunctionMap(state.currentR5, CURRENT_R5)
const legacyDigests = digestFunctionMap(state.legacySurface, LEGACY_SURFACE)
if (!sameObject(currentDigests, expectedMap(CURRENT_R5))) fail('current revision-4 archive compatibility function drift detected')
if (!sameObject(legacyDigests, expectedMap(LEGACY_SURFACE))) fail('legacy transport consumer definition drift detected')

const candidates = state.candidates ?? {}
const candidateCount = Number(candidates.messages ?? 0)
const currentEdges = Number(candidates.currentEdges ?? -1)
const retainedToEligible = Number(candidates.retainedToEligible ?? -1)
const eligibleToRetained = Number(candidates.eligibleToRetained ?? -1)
const graphSafe = candidateCount > 0 && currentEdges === candidateCount && retainedToEligible === 0 && eligibleToRetained >= 1
const archiveInstalled = state.archive?.tableExists === true && state.archive?.rlsEnabled === true && state.archive?.serviceRoleSelect === false
const legacyExecutable = LEGACY_SURFACE.filter(([key]) => {
  const item = state.legacySurface?.[key]
  return item?.serviceRoleExecute === true || item?.anonExecute === true || item?.authenticatedExecute === true
}).map(([key]) => key)
const legacyRetirementRequired = legacyExecutable.length > 0

const evidence = {
  schemaVersion: 1,
  purpose: 'r5-terminal-archive-phase-b-preflight',
  sourceCommit,
  observedAt: state.observedAt,
  databaseBytes: Number(state.databaseBytes),
  databaseHaltBytes: INTERNAL_DB_HALT,
  databaseHeadroomBytes: INTERNAL_DB_HALT - Number(state.databaseBytes),
  maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
  archive: state.archive,
  candidates,
  canonicalCounts: state.canonicalCounts,
  activeRun: state.run,
  batchCounts: state.batchCounts,
  scheduler: state.scheduler,
  schedulerSha256: sha256(JSON.stringify(state.scheduler ?? null)),
  currentR5DefinitionSha256: currentDigests,
  legacySurfaceDefinitionSha256: legacyDigests,
  legacyExecutable,
  gates: {
    archiveInstalled,
    activeR5DatabaseGuardHalted: true,
    currentR5ArchiveCompatible: true,
    candidateGraphSafe: graphSafe,
    legacyRetirementRequired,
    readyForLegacyRetirement: archiveInstalled && graphSafe,
    readyForPhaseBDataMutation: archiveInstalled && graphSafe && !legacyRetirementRequired,
  },
  productionDatabaseReadOnly: true,
  terminalTransportMutationAuthorized: false,
  legacyConsumerRetirementAuthorized: false,
  physicalCompactionAuthorized: false,
  schedulerMutationAuthorized: false,
  deploymentAuthorized: false,
  publicReaderMutationAuthorized: false,
  mainnetDisabled: true,
  stabilizationAuthorized: false,
  soakAuthorized: false,
  r5RearmAuthorized: false,
}

if (!evidence.gates.archiveInstalled) fail('Phase A archive contract is not installed/private')
if (!evidence.gates.candidateGraphSafe) fail(`Phase B candidate graph is not safely drainable: ${JSON.stringify(candidates)}`)
if (!evidence.gates.readyForLegacyRetirement) fail('Phase B legacy retirement preconditions are not satisfied')

await writeJson(options.output, evidence)
process.stdout.write(`${JSON.stringify(evidence)}\n`)
