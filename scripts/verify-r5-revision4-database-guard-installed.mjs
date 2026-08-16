#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const PROFILE_IDENTITY = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const DATABASE_HALT_BYTES = 400_000_000
const CLAIM_SIGNATURE = 'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
const HELPER_SIGNATURE = 'xrpl_r5_v1.database_claim_allowed(bigint)'

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
    signal: AbortSignal.timeout(60_000),
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
async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}
function query() {
  return `select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'claimDefinition', pg_get_functiondef('${CLAIM_SIGNATURE}'::regprocedure),
    'helperExists', to_regprocedure('${HELPER_SIGNATURE}') is not null,
    'helperDefinition', case when to_regprocedure('${HELPER_SIGNATURE}') is null then null else pg_get_functiondef('${HELPER_SIGNATURE}'::regprocedure) end,
    'serviceRoleCanExecuteHelper', case when to_regprocedure('${HELPER_SIGNATURE}') is null then null else has_function_privilege('service_role','${HELPER_SIGNATURE}','EXECUTE') end,
    'run', coalesce((select jsonb_build_object(
      'runId',run_id,'status',status,'lastError',last_error,'profileRevision',profile_revision,
      'profileIdentityDigest',profile_identity_digest,'network',network,'epochId',epoch_id,
      'completedBatches',completed_batches,'committedLedgers',committed_ledgers,
      'watermarkLedgerIndex',current_watermark_ledger_index,'updatedAt',updated_at
    ) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),'null'::jsonb),
    'batchCounts',(select jsonb_build_object(
      'total',count(*),'leased',count(*) filter(where status='leased'),
      'halted',count(*) filter(where status='halted'),'committed',count(*) filter(where status='committed')
    ) from xrpl_r5_v1.recovery_batches where run_id='${ACTIVE_RUN_ID}'),
    'scheduler',coalesce((select jsonb_build_object(
      'count',count(*),'jobId',min(jobid),'schedule',min(schedule),'active',bool_and(active),
      'commandSha256',encode(extensions.digest(min(command)::text,'sha256'),'hex')
    ) from cron.job where jobname='xrpl-lending-monitor-minute'),'null'::jsonb)
  ) as state;`
}
function validate(state) {
  const claim = String(state.claimDefinition ?? '')
  const helper = String(state.helperDefinition ?? '')
  if (state.helperExists !== true) fail('database guard helper is absent')
  if (state.serviceRoleCanExecuteHelper !== false) fail('database guard helper is not private from service_role')
  if (!helper.includes('p_database_bytes < 400000000')) fail('database guard helper threshold definition mismatch')
  if (!claim.includes('v_database_bytes := pg_database_size(current_database())')) fail('live claim lacks database measurement')
  if (!claim.includes('database_claim_allowed(v_database_bytes)')) fail('live claim lacks database helper call')
  if (!claim.includes("last_error = 'r5_recovery_database_halt'")) fail('live claim lacks database halt state')
  const measure = claim.indexOf('v_database_bytes := pg_database_size(current_database())')
  const caughtUp = claim.indexOf('if p_validated_head_ledger_index < v_watermark.ledger_index then')
  const leased = claim.indexOf('select * into v_existing')
  if (measure < 0 || caughtUp < 0 || leased < 0 || measure >= caughtUp || measure >= leased) fail('database guard ordering mismatch')
  if (!state.run || state.run.runId !== ACTIVE_RUN_ID) fail('active successor missing')
  if (Number(state.run.profileRevision) !== 4 || state.run.profileIdentityDigest !== PROFILE_IDENTITY || state.run.network !== 'devnet' || state.run.epochId !== 'supabase-r4c2c-v1') fail('active successor identity drifted')
  if (!state.scheduler || Number(state.scheduler.count) !== 1 || state.scheduler.schedule !== '* * * * *' || state.scheduler.active !== true || !/^[a-f0-9]{64}$/u.test(String(state.scheduler.commandSha256 ?? ''))) fail('one-minute scheduler drifted')
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const deadline = Date.now() + 150_000
let state
while (Date.now() <= deadline) {
  state = firstState(await managementQuery(query()))
  validate(state)
  if (state.run.status === 'halted' && state.run.lastError === 'r5_recovery_database_halt') break
  if (state.run.lastError != null && state.run.lastError !== 'r5_recovery_database_halt') fail(`unexpected run error: ${state.run.status}:${state.run.lastError}`)
  await new Promise((resolve) => setTimeout(resolve, 10_000))
}
if (state.run.status !== 'halted' || state.run.lastError !== 'r5_recovery_database_halt') fail(`database guard installed but natural halt not observed: ${state.run.status}:${state.run.lastError}`)
const evidence = {
  schemaVersion: 1,
  purpose: 'r5-revision4-database-guard-post-apply-readonly-verification',
  sourceCommit,
  databaseBytes: Number(state.databaseBytes),
  databaseHaltBytes: DATABASE_HALT_BYTES,
  databaseHeadroomBytes: DATABASE_HALT_BYTES - Number(state.databaseBytes),
  guardInstalled: true,
  helperDefinitionSha256: sha256(state.helperDefinition),
  claimDefinitionSha256: sha256(state.claimDefinition),
  helperPrivateFromServiceRole: state.serviceRoleCanExecuteHelper === false,
  run: state.run,
  batchCounts: state.batchCounts,
  scheduler: state.scheduler,
  naturalDatabaseHaltObserved: true,
  productionDatabaseReadOnly: true,
  manualClaimInvoked: false,
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
