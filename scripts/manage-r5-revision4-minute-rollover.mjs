#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const VERSION = '20260816020000'
const NAME = 'xrpl_r5_revision4_minute_run_binding'
const PREVIOUS_VERSION = '20260815211500'
const SQL_PATH = `supabase/migrations/${VERSION}_${NAME}.sql`
const SOURCE_RUN_ID = 'r5-recovery-selected-revision4-entry'
const TARGET_RUN_ID = 'r5-recovery-selected-revision4-minute-entry'
const PROFILE_DIGEST = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const CONTINUOUS_SIGNATURE = 'public.xrpl_refresh_r5_revision4_continuous_head(text,bigint,text,timestamp with time zone)'
const DEVNET_RPC = 'https://s.devnet.rippletest.net:51234/'

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
    signal: AbortSignal.timeout(150_000),
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
  if (actualSha !== expectedSha) fail('rollover SQL drifted from authorization')
  const required = [
    SOURCE_RUN_ID,
    TARGET_RUN_ID,
    'active_boundary_drift_requires_operator',
    'provider_snapshot_stale',
    'monthly_invocation_halt',
    'claimResourceGuardsStillRequired',
    'mainnetDisabled',
  ]
  for (const marker of required) if (!sql.includes(marker)) fail(`rollover SQL missing marker:${marker}`)
  for (const forbidden of [
    /\btruncate\b/iu,
    /\bdelete\s+from\b/iu,
    /\bdrop\s+(?:table|schema)\b/iu,
    /\bcron\.schedule\b/iu,
    /\bcron\.unschedule\b/iu,
    /\bupdate\s+(?:public\.|xrpl_r5_v1\.)?(?:xrpl_phase_|recovery_runs|recovery_batches)/iu,
  ]) if (forbidden.test(sql)) fail(`rollover SQL contains forbidden mutation:${forbidden}`)
  return { sql, actualSha }
}

function inspectionQuery() {
  return `with source_run as (
    select to_jsonb(r) value from xrpl_r5_v1.recovery_runs r where r.run_id='${SOURCE_RUN_ID}'
  ), target_run as (
    select to_jsonb(r) value from xrpl_r5_v1.recovery_runs r where r.run_id='${TARGET_RUN_ID}'
  ), source_checkpoint as (
    select to_jsonb(c) value
      from xrpl_r5_v1.active_checkpoints c
      join xrpl_r5_v1.recovery_runs r on r.checkpoint_id=c.checkpoint_id
     where r.run_id='${SOURCE_RUN_ID}'
  ), runtime_state as (
    select to_jsonb(r) value from public.xrpl_collector_runtime r where r.profile_id='supabase-devnet'
  )
  select jsonb_build_object(
    'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
    'targetMigrationRows',(select count(*) from supabase_migrations.schema_migrations where version::text='${VERSION}'),
    'targetMigrationRecords',coalesce((select jsonb_agg(jsonb_build_object('version',version::text,'statements',statements,'name',name)) from supabase_migrations.schema_migrations where version::text='${VERSION}'),'[]'::jsonb),
    'continuousDefinition',pg_get_functiondef('${CONTINUOUS_SIGNATURE}'::regprocedure),
    'sourceRun',coalesce((select value from source_run),'null'::jsonb),
    'targetRun',coalesce((select value from target_run),'null'::jsonb),
    'sourceCheckpoint',coalesce((select value from source_checkpoint),'null'::jsonb),
    'sourceActiveBatchCount',(select count(*) from xrpl_r5_v1.recovery_batches where run_id='${SOURCE_RUN_ID}' and status in ('leased','halted')),
    'targetActiveBatchCount',(select count(*) from xrpl_r5_v1.recovery_batches where run_id='${TARGET_RUN_ID}' and status in ('leased','halted')),
    'targetBatchCount',(select count(*) from xrpl_r5_v1.recovery_batches where run_id='${TARGET_RUN_ID}'),
    'runtime',coalesce((select value from runtime_state),'null'::jsonb),
    'canonicalWatermark',(select jsonb_build_object('ledgerIndex',ledger_index,'ledgerHash',ledger_hash,'workId',work_id,'network',network,'epochId',epoch_id,'baseIdentity',base_identity) from public.xrpl_phase_watermarks where profile_id='supabase-devnet'),
    'pendingCount',(select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='pending'),
    'leasedMessageCount',(select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='leased'),
    'retryMessageCount',(select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='retry'),
    'inflightWorkCount',(select count(*) from public.xrpl_phase_work where profile_id='supabase-devnet' and status in ('planned','staged','committing','finalizing')),
    'databaseBytes',pg_database_size(current_database())
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

function sourceRunValid(run, authorizedWatermark) {
  return Boolean(
    run
    && run.run_id === SOURCE_RUN_ID
    && run.profile_id === 'supabase_free_postgres_pgcron_edge'
    && Number(run.profile_revision) === 4
    && run.profile_identity_digest === PROFILE_DIGEST
    && /^[a-f0-9]{64}$/u.test(String(run.selection_digest ?? ''))
    && run.source_profile_id === 'supabase-devnet'
    && run.network === 'devnet'
    && run.epoch_id === 'supabase-r4c2c-v1'
    && run.status === 'running'
    && run.last_error == null
    && Number(run.completed_batches) >= 1
    && Number(run.committed_ledgers) >= 1
    && Number(run.current_watermark_ledger_index) === authorizedWatermark
    && /^[a-f0-9]{64}$/u.test(String(run.last_accounting_digest ?? ''))
    && run.started_at != null
    && run.completed_at == null
  )
}

function checkpointValid(checkpoint, sourceRun) {
  return Boolean(
    checkpoint
    && sourceRun
    && checkpoint.checkpoint_id === sourceRun.checkpoint_id
    && checkpoint.state_digest === sourceRun.checkpoint_state_digest
    && checkpoint.profile_id === sourceRun.profile_id
    && Number(checkpoint.profile_revision) === 4
    && checkpoint.profile_identity_digest === PROFILE_DIGEST
    && checkpoint.selection_digest === sourceRun.selection_digest
    && checkpoint.source_profile_id === 'supabase-devnet'
    && checkpoint.network === 'devnet'
    && checkpoint.epoch_id === 'supabase-r4c2c-v1'
    && checkpoint.base_identity === sourceRun.base_identity
  )
}

function runtimeQuiescent(runtime) {
  return Boolean(
    runtime
    && runtime.profile_id === 'supabase-devnet'
    && runtime.network === 'devnet'
    && runtime.status === 'stopped'
    && runtime.lease_owner == null
    && runtime.lease_expires_at == null
    && runtime.last_error == null
    && Number(runtime.consecutive_failures) === 0
  )
}

function targetRunValid(run, sourceRun, canonical, headFloor = null) {
  if (!run || !sourceRun || !canonical) return false
  const start = Number(run.start_watermark_ledger_index)
  const current = Number(run.current_watermark_ledger_index)
  const head = Number(run.initial_validated_head_ledger_index)
  return Boolean(
    run.run_id === TARGET_RUN_ID
    && run.checkpoint_id === sourceRun.checkpoint_id
    && run.checkpoint_state_digest === sourceRun.checkpoint_state_digest
    && run.profile_id === sourceRun.profile_id
    && Number(run.profile_revision) === 4
    && run.profile_identity_digest === PROFILE_DIGEST
    && run.selection_digest === sourceRun.selection_digest
    && run.source_profile_id === 'supabase-devnet'
    && run.network === 'devnet'
    && run.epoch_id === 'supabase-r4c2c-v1'
    && run.base_identity === sourceRun.base_identity
    && ['prepared','running','caught_up'].includes(run.status)
    && run.last_error == null
    && Number.isSafeInteger(start)
    && start === Number(canonical.ledgerIndex)
    && current === start
    && run.start_watermark_ledger_hash === canonical.ledgerHash
    && run.start_watermark_work_id === canonical.workId
    && run.current_watermark_ledger_hash === canonical.ledgerHash
    && run.current_watermark_work_id === canonical.workId
    && Number(run.completed_batches) === 0
    && Number(run.committed_ledgers) === 0
    && run.last_accounting_digest == null
    && (headFloor == null || head >= headFloor)
    && head >= start
  )
}

function classify(state, sqlSha, sourceCommit, authorizedWatermark, activeFloor) {
  const migrationRows = Number(state.targetMigrationRows)
  const records = Array.isArray(state.targetMigrationRecords) ? state.targetMigrationRecords : []
  const canonicalLedger = Number(state.canonicalWatermark?.ledgerIndex)
  const sourceOk = sourceRunValid(state.sourceRun, authorizedWatermark)
  const checkpointOk = checkpointValid(state.sourceCheckpoint, state.sourceRun)
  const common = sourceOk
    && checkpointOk
    && Number(state.sourceActiveBatchCount) === 0
    && runtimeQuiescent(state.runtime)
    && Number(state.pendingCount) === 1
    && Number(state.leasedMessageCount) === 0
    && Number(state.retryMessageCount) === 0
    && Number(state.inflightWorkCount) === 0
    && Number.isSafeInteger(canonicalLedger)
    && canonicalLedger >= activeFloor
    && canonicalLedger > authorizedWatermark
    && state.canonicalWatermark?.network === 'devnet'
    && state.canonicalWatermark?.epochId === 'supabase-r4c2c-v1'
    && state.canonicalWatermark?.baseIdentity === state.sourceRun?.base_identity
  const definition = String(state.continuousDefinition ?? '')
  const oldGuardPresent = definition.includes(`p_run_id <> '${SOURCE_RUN_ID}'`)
  const dualGuardPresent = definition.includes(SOURCE_RUN_ID) && definition.includes(TARGET_RUN_ID)
  const safetyMarkersPresent = [
    'active_boundary_drift_requires_operator',
    'provider_snapshot_stale',
    'monthly_invocation_halt',
    'claimResourceGuardsStillRequired',
    'mainnetDisabled',
  ].every((marker) => definition.includes(marker))
  const targetAbsent = state.targetRun == null && Number(state.targetBatchCount) === 0 && Number(state.targetActiveBatchCount) === 0
  const exactHistory = migrationRows === 1 && migrationRecordMatches(records[0], sqlSha)

  let classification = 'inconsistent'
  let reason = 'state does not match a reviewed minute-run rollover lifecycle'
  if (common && String(state.maxMigrationVersion) === PREVIOUS_VERSION && migrationRows === 0 && oldGuardPresent && safetyMarkersPresent && targetAbsent) {
    classification = 'unapplied_expected'
    reason = 'old qualified run is preserved, target run is absent, collector is quiescent, and canonical has advanced beyond the retained run'
  } else if (common && String(state.maxMigrationVersion) === VERSION && exactHistory && dualGuardPresent && safetyMarkersPresent && targetRunValid(state.targetRun, state.sourceRun, state.canonicalWatermark)) {
    classification = 'applied_consistent'
    reason = 'dual run binding is registered and the zero-progress minute run starts exactly at the quiescent canonical boundary'
  }

  const stable = {
    schemaVersion: 1,
    purpose: 'r5-revision4-minute-run-rollover-state',
    sourceCommit,
    projectIdentityDigest: sha256(requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)),
    sqlSha256: sqlSha,
    classification,
    maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
    targetMigrationRows: migrationRows,
    sourceRun: state.sourceRun,
    targetRun: state.targetRun,
    sourceCheckpointDigest: String(state.sourceCheckpoint?.state_digest ?? ''),
    sourceActiveBatchCount: Number(state.sourceActiveBatchCount),
    targetBatchCount: Number(state.targetBatchCount),
    targetActiveBatchCount: Number(state.targetActiveBatchCount),
    runtime: state.runtime,
    canonicalWatermark: state.canonicalWatermark,
    pendingCount: Number(state.pendingCount),
    leasedMessageCount: Number(state.leasedMessageCount),
    retryMessageCount: Number(state.retryMessageCount),
    inflightWorkCount: Number(state.inflightWorkCount),
    authorizedSourceWatermark: authorizedWatermark,
    authorizedActiveFloor: activeFloor,
    databaseBytes: Number(state.databaseBytes),
    mainnetDisabled: true,
    publicReaderMutationAuthorized: false,
    oldRunRewriteAuthorized: false,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }
  return { ...stable, classificationReason: reason, stateSha256: sha256(JSON.stringify(stable)), targetMigrationRecords: records }
}

async function readDevnetHead() {
  const response = await fetch(DEVNET_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'server_info', params: [{ api_version: 2 }] }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) fail(`Devnet server_info failed:${response.status}`)
  const body = await response.json()
  const ledger = body?.result?.info?.validated_ledger
  const index = Number(ledger?.seq)
  const hash = String(ledger?.hash ?? '').toUpperCase()
  if (!Number.isSafeInteger(index) || index <= 0 || !/^[A-F0-9]{64}$/u.test(hash)) fail('Devnet validated head invalid')
  return { index, hash }
}

async function writeOutput(output, value) {
  if (!output) return
  const path = resolve(output)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function audit(options) {
  const sourceCommit = options['source-commit']
  const expectedSha = options['expected-sha']
  const authorizedWatermark = Number(options['source-watermark'])
  const activeFloor = Number(options['active-floor'])
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('source commit invalid')
  if (!Number.isSafeInteger(authorizedWatermark) || authorizedWatermark <= 0) fail('source watermark invalid')
  if (!Number.isSafeInteger(activeFloor) || activeFloor < authorizedWatermark) fail('active floor invalid')
  const { actualSha } = await loadSql(expectedSha)
  const result = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit, authorizedWatermark, activeFloor)
  await writeOutput(options.output, result)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

async function apply(options) {
  const sourceCommit = options['source-commit']
  const expectedSha = options['expected-sha']
  const authorizedWatermark = Number(options['source-watermark'])
  const activeFloor = Number(options['active-floor'])
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('source commit invalid')
  if (!Number.isSafeInteger(authorizedWatermark) || authorizedWatermark <= 0) fail('source watermark invalid')
  if (!Number.isSafeInteger(activeFloor) || activeFloor < authorizedWatermark) fail('active floor invalid')
  const { sql, actualSha } = await loadSql(expectedSha)
  const before = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit, authorizedWatermark, activeFloor)
  if (before.classification === 'applied_consistent') {
    const replay = { schemaVersion: 1, purpose: 'r5-revision4-minute-run-rollover-apply', sourceCommit, replayed: true, mutationPerformed: false, before, after: before, mainnetDisabled: true }
    await writeOutput(options.output, replay)
    process.stdout.write(`${JSON.stringify(replay)}\n`)
    return
  }
  if (before.classification !== 'unapplied_expected') fail(`production rollover pre-state is ${before.classification}`)

  const head = await readDevnetHead()
  if (head.index < Number(before.canonicalWatermark?.ledgerIndex)) fail('Devnet head behind canonical watermark')
  const marker = `exact-${NAME} sha256:${actualSha}`
  const escapedSql = sql.replaceAll('$rollover$', '$rollover_tag$')
  const statement = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\n${escapedSql}\ninsert into supabase_migrations.schema_migrations(version,statements,name) values ('${VERSION}',array['${marker}']::text[],'${NAME}');\nselect public.xrpl_prepare_r5_revision4_active_recovery('${TARGET_RUN_ID}',r.checkpoint_id,r.checkpoint_state_digest,${head.index},'${head.hash}',statement_timestamp()) as prepared from xrpl_r5_v1.recovery_runs r where r.run_id='${SOURCE_RUN_ID}';\ncommit;`
  await managementQuery(statement, false)

  const after = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit, authorizedWatermark, activeFloor)
  if (after.classification !== 'applied_consistent') fail(`production rollover post-state is ${after.classification}`)
  if (!targetRunValid(after.targetRun, after.sourceRun, after.canonicalWatermark, head.index)) fail('target run did not bind the authorized fresh Devnet head')
  if (JSON.stringify(after.sourceRun) !== JSON.stringify(before.sourceRun)) fail('source qualification run changed during rollover')

  const result = {
    schemaVersion: 1,
    purpose: 'r5-revision4-minute-run-rollover-apply',
    sourceCommit,
    replayed: false,
    mutationPerformed: true,
    mutationScope: 'continuous-head exact run-id binding, exact migration-history marker, and new zero-progress revision-4 minute run',
    devnetHead: head,
    before,
    after,
    sourceRunPreservedExactly: true,
    schedulerMutationPerformed: false,
    publicReaderMutationPerformed: false,
    mainnetDisabled: true,
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
