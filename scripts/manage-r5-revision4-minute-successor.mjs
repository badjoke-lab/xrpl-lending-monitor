#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const VERSION = '20260816050000'
const NAME = 'xrpl_r5_revision4_minute_successor_run_binding'
const PREVIOUS_VERSION = '20260816040000'
const SQL_PATH = `ops/production-sql/${VERSION}_${NAME}.sql`
const FORMAL_RUN_ID = 'r5-recovery-selected-revision4-entry'
const FAILED_RUN_ID = 'r5-recovery-selected-revision4-minute-entry'
const TARGET_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const PROFILE_DIGEST = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const QUALIFICATION_KEY = 'r4f-revision4-r5-12-ledger-accounting-v1'
const CONTINUOUS_SIGNATURE = 'public.xrpl_refresh_r5_revision4_continuous_head(text,bigint,text,timestamp with time zone)'
const DEVNET_RPC = 'https://s.devnet.rippletest.net:51234/'
const EXPECTED_FAILURE_MARKER = 'xrpl_r5_revision4_accounting_qualification_run_check'

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
  if (actualSha !== expectedSha) fail('successor SQL drifted from authorization')
  for (const marker of [FORMAL_RUN_ID, FAILED_RUN_ID, TARGET_RUN_ID, 'active_boundary_drift_requires_operator', 'provider_snapshot_stale', 'monthly_invocation_halt', 'claimResourceGuardsStillRequired', 'mainnetDisabled']) {
    if (!sql.includes(marker)) fail(`successor SQL missing marker:${marker}`)
  }
  for (const forbidden of [
    /\btruncate\b/iu,
    /\bdelete\s+from\b/iu,
    /\bdrop\s+(?:table|schema)\b/iu,
    /\bcron\.schedule\b/iu,
    /\bcron\.unschedule\b/iu,
    /\bupdate\s+(?:public\.|xrpl_r5_v1\.)?(?:xrpl_phase_|recovery_runs|recovery_batches)/iu,
    /\binsert\s+into\s+xrpl_r5_v1\.(?:recovery_runs|recovery_batches)/iu,
  ]) if (forbidden.test(sql)) fail(`successor SQL contains forbidden mutation:${forbidden}`)
  return { sql, actualSha }
}

function inspectionQuery() {
  return `with formal_run as (
    select to_jsonb(r) value from xrpl_r5_v1.recovery_runs r where r.run_id='${FORMAL_RUN_ID}'
  ), failed_run as (
    select to_jsonb(r) value from xrpl_r5_v1.recovery_runs r where r.run_id='${FAILED_RUN_ID}'
  ), target_run as (
    select to_jsonb(r) value from xrpl_r5_v1.recovery_runs r where r.run_id='${TARGET_RUN_ID}'
  ), formal_checkpoint as (
    select to_jsonb(c) value from xrpl_r5_v1.active_checkpoints c
    join xrpl_r5_v1.recovery_runs r on r.checkpoint_id=c.checkpoint_id where r.run_id='${FORMAL_RUN_ID}'
  ), runtime_state as (
    select to_jsonb(r) value from public.xrpl_collector_runtime r where r.profile_id='supabase-devnet'
  ) select jsonb_build_object(
    'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
    'targetMigrationRows',(select count(*) from supabase_migrations.schema_migrations where version::text='${VERSION}'),
    'targetMigrationRecords',coalesce((select jsonb_agg(jsonb_build_object('version',version::text,'statements',statements,'name',name)) from supabase_migrations.schema_migrations where version::text='${VERSION}'),'[]'::jsonb),
    'continuousDefinition',pg_get_functiondef('${CONTINUOUS_SIGNATURE}'::regprocedure),
    'formalRun',coalesce((select value from formal_run),'null'::jsonb),
    'failedRun',coalesce((select value from failed_run),'null'::jsonb),
    'targetRun',coalesce((select value from target_run),'null'::jsonb),
    'formalCheckpoint',coalesce((select value from formal_checkpoint),'null'::jsonb),
    'formalEvidence',(select to_jsonb(e) from xrpl_r5_v1.revision4_accounting_qualification_evidence e where e.qualification_key='${QUALIFICATION_KEY}'),
    'failedBatches',coalesce((select jsonb_agg(to_jsonb(b) order by b.batch_sequence,b.batch_id) from xrpl_r5_v1.recovery_batches b where b.run_id='${FAILED_RUN_ID}'),'[]'::jsonb),
    'targetBatchCount',(select count(*) from xrpl_r5_v1.recovery_batches where run_id='${TARGET_RUN_ID}'),
    'runtime',coalesce((select value from runtime_state),'null'::jsonb),
    'canonicalWatermark',(select jsonb_build_object('ledgerIndex',ledger_index,'ledgerHash',ledger_hash,'workId',work_id,'network',network,'epochId',epoch_id,'baseIdentity',base_identity) from public.xrpl_phase_watermarks where profile_id='supabase-devnet'),
    'pendingCount',(select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='pending'),
    'leasedMessageCount',(select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='leased'),
    'retryMessageCount',(select count(*) from public.xrpl_phase_messages where profile_id='supabase-devnet' and status='retry'),
    'pendingMessages',coalesce((select jsonb_agg(to_jsonb(m) order by m.available_at,m.created_at,m.message_id) from public.xrpl_phase_messages m where m.profile_id='supabase-devnet' and m.status='pending'),'[]'::jsonb),
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
  return Boolean(record && String(record.version) === VERSION && record.name === NAME && Array.isArray(record.statements) && record.statements.length === 1 && record.statements[0] === `exact-${NAME} sha256:${sqlSha}`)
}

function formalRunValid(run) {
  return Boolean(run
    && run.run_id === FORMAL_RUN_ID
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
    && /^[a-f0-9]{64}$/u.test(String(run.last_accounting_digest ?? ''))
    && run.completed_at == null)
}

function checkpointValid(checkpoint, run) {
  return Boolean(checkpoint && run
    && checkpoint.checkpoint_id === run.checkpoint_id
    && checkpoint.state_digest === run.checkpoint_state_digest
    && checkpoint.profile_id === run.profile_id
    && Number(checkpoint.profile_revision) === 4
    && checkpoint.profile_identity_digest === PROFILE_DIGEST
    && checkpoint.selection_digest === run.selection_digest
    && checkpoint.source_profile_id === 'supabase-devnet'
    && checkpoint.network === 'devnet'
    && checkpoint.epoch_id === 'supabase-r4c2c-v1'
    && checkpoint.base_identity === run.base_identity)
}

function failedRunValid(run, batches) {
  if (!run || !Array.isArray(batches) || batches.length !== 1) return false
  const batch = batches[0]
  return Boolean(
    run.run_id === FAILED_RUN_ID
    && run.profile_id === 'supabase_free_postgres_pgcron_edge'
    && Number(run.profile_revision) === 4
    && run.profile_identity_digest === PROFILE_DIGEST
    && /^[a-f0-9]{64}$/u.test(String(run.selection_digest ?? ''))
    && run.source_profile_id === 'supabase-devnet'
    && run.network === 'devnet'
    && run.epoch_id === 'supabase-r4c2c-v1'
    && run.status === 'halted'
    && Number(run.completed_batches) === 0
    && Number(run.committed_ledgers) === 0
    && run.last_accounting_digest == null
    && run.completed_at == null
    && String(run.last_error ?? '').includes(EXPECTED_FAILURE_MARKER)
    && batch.run_id === FAILED_RUN_ID
    && batch.status === 'halted'
    && batch.origin === 'r5_executor'
    && Number(batch.batch_sequence) === 1
    && Number(batch.attempt_count) === 1
    && Number(batch.ledger_count) === 12
    && Number(batch.start_ledger_index) === Number(run.current_watermark_ledger_index) + 1
    && Number(batch.end_ledger_index) === Number(batch.start_ledger_index) + 11
    && batch.expected_parent_hash === run.current_watermark_ledger_hash
    && batch.lease_owner == null
    && batch.lease_expires_at == null
    && batch.finalized_egress_upper_bound_bytes == null
    && batch.accounting_digest == null
    && batch.final_ledger_hash == null
    && batch.final_work_id == null
    && batch.works_digest == null
    && batch.rows_digest == null
    && String(batch.error_message ?? '').includes(EXPECTED_FAILURE_MARKER)
  )
}

function formalEvidenceValid(evidence, formalRun) {
  return Boolean(evidence
    && evidence.qualification_key === QUALIFICATION_KEY
    && evidence.run_id === FORMAL_RUN_ID
    && evidence.batch_sequence === 1
    && Number(evidence.ledger_count) === 12
    && evidence.profile_revision === 4
    && evidence.profile_identity_digest === PROFILE_DIGEST
    && evidence.selection_digest === formalRun?.selection_digest)
}

function runtimeQuiescent(runtime) {
  return Boolean(runtime
    && runtime.profile_id === 'supabase-devnet'
    && runtime.network === 'devnet'
    && runtime.status === 'stopped'
    && runtime.lease_owner == null
    && runtime.lease_expires_at == null
    && runtime.last_error == null
    && Number(runtime.consecutive_failures) === 0)
}

function targetRunValid(run, formalRun, canonical, headFloor = null) {
  if (!run || !formalRun || !canonical) return false
  const start = Number(run.start_watermark_ledger_index)
  const current = Number(run.current_watermark_ledger_index)
  const head = Number(run.initial_validated_head_ledger_index)
  return Boolean(
    run.run_id === TARGET_RUN_ID
    && run.checkpoint_id === formalRun.checkpoint_id
    && run.checkpoint_state_digest === formalRun.checkpoint_state_digest
    && run.profile_id === formalRun.profile_id
    && Number(run.profile_revision) === 4
    && run.profile_identity_digest === PROFILE_DIGEST
    && run.selection_digest === formalRun.selection_digest
    && run.source_profile_id === 'supabase-devnet'
    && run.network === 'devnet'
    && run.epoch_id === 'supabase-r4c2c-v1'
    && run.base_identity === formalRun.base_identity
    && ['prepared', 'caught_up'].includes(run.status)
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
    && head >= start)
}

function classify(state, sqlSha, sourceCommit) {
  const definition = String(state.continuousDefinition ?? '')
  const records = Array.isArray(state.targetMigrationRecords) ? state.targetMigrationRecords : []
  const failedBatches = Array.isArray(state.failedBatches) ? state.failedBatches : []
  const formalOk = formalRunValid(state.formalRun)
  const checkpointOk = checkpointValid(state.formalCheckpoint, state.formalRun)
  const failedOk = failedRunValid(state.failedRun, failedBatches)
  const evidenceOk = formalEvidenceValid(state.formalEvidence, state.formalRun)
  const oldGuard = definition.includes(FORMAL_RUN_ID) && definition.includes(FAILED_RUN_ID) && !definition.includes(TARGET_RUN_ID)
  const successorGuard = definition.includes(FORMAL_RUN_ID) && !definition.includes(FAILED_RUN_ID) && definition.includes(TARGET_RUN_ID)
  const safety = ['active_boundary_drift_requires_operator','provider_snapshot_stale','monthly_invocation_halt','claimResourceGuardsStillRequired','mainnetDisabled'].every((marker) => definition.includes(marker))
  const targetAbsent = state.targetRun == null && Number(state.targetBatchCount) === 0
  const targetMigrationRows = Number(state.targetMigrationRows)
  const exactHistory = targetMigrationRows === 1 && migrationRecordMatches(records[0], sqlSha)
  const canonicalLedger = Number(state.canonicalWatermark?.ledgerIndex)
  const immutableChecks = {
    formalRunValid: formalOk,
    formalCheckpointValid: checkpointOk,
    failedRunAndBatchExact: failedOk,
    formalQualificationEvidenceExact: evidenceOk,
    continuousSafetyMarkersPresent: safety,
    canonicalLedgerSafeInteger: Number.isSafeInteger(canonicalLedger),
    canonicalNetworkDevnet: state.canonicalWatermark?.network === 'devnet',
    canonicalEpochExact: state.canonicalWatermark?.epochId === 'supabase-r4c2c-v1',
    canonicalBaseIdentityExact: state.canonicalWatermark?.baseIdentity === state.formalRun?.base_identity,
  }
  const immutableOk = Object.values(immutableChecks).every(Boolean)

  let classification = 'inconsistent'
  let reason = 'state does not match reviewed successor lifecycle'
  if (immutableOk
    && String(state.maxMigrationVersion) === PREVIOUS_VERSION
    && targetMigrationRows === 0
    && oldGuard
    && targetAbsent) {
    classification = 'unapplied_expected'
    reason = 'failed minute run is immutable, successor is absent, and current continuous-head admission still names the failed run'
  } else if (immutableOk
    && String(state.maxMigrationVersion) === VERSION
    && exactHistory
    && successorGuard
    && targetRunValid(state.targetRun, state.formalRun, state.canonicalWatermark)) {
    classification = 'applied_consistent'
    reason = 'failed minute run is preserved while the successor starts at the exact quiescent canonical boundary'
  }

  const stable = {
    schemaVersion: 1,
    purpose: 'r5-revision4-minute-successor-state',
    sourceCommit,
    projectIdentityDigest: sha256(requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)),
    sqlSha256: sqlSha,
    classification,
    maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
    targetMigrationRows,
    formalRun: state.formalRun,
    formalRunDigest: sha256(JSON.stringify(state.formalRun ?? null)),
    formalCheckpoint: state.formalCheckpoint,
    failedRun: state.failedRun,
    failedRunDigest: sha256(JSON.stringify(state.failedRun ?? null)),
    failedBatches,
    failedBatchesDigest: sha256(JSON.stringify(failedBatches)),
    formalEvidence: state.formalEvidence,
    formalEvidenceDigest: sha256(JSON.stringify(state.formalEvidence ?? null)),
    targetRun: state.targetRun,
    targetBatchCount: Number(state.targetBatchCount),
    runtime: state.runtime,
    runtimeQuiescent: runtimeQuiescent(state.runtime),
    canonicalWatermark: state.canonicalWatermark,
    pendingCount: Number(state.pendingCount),
    leasedMessageCount: Number(state.leasedMessageCount),
    retryMessageCount: Number(state.retryMessageCount),
    pendingMessages: state.pendingMessages,
    inflightWorkCount: Number(state.inflightWorkCount),
    databaseBytes: Number(state.databaseBytes),
    immutableChecks,
    oldGuardPresent: oldGuard,
    successorGuardPresent: successorGuard,
    mainnetDisabled: true,
    failedRunMutationAuthorized: false,
    failedBatchMutationAuthorized: false,
    formalRunMutationAuthorized: false,
    formalEvidenceMutationAuthorized: false,
    publicReaderMutationAuthorized: false,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }
  return { ...stable, classificationReason: reason, stateSha256: sha256(JSON.stringify(stable)), targetMigrationRecords: records }
}

async function readDevnetHead() {
  const response = await fetch(DEVNET_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
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
    const replay = { schemaVersion: 1, purpose: 'r5-revision4-minute-successor-apply', sourceCommit, replayed: true, mutationPerformed: false, before, after: before, mainnetDisabled: true }
    await writeOutput(options.output, replay)
    process.stdout.write(`${JSON.stringify(replay)}\n`)
    return
  }
  if (before.classification !== 'unapplied_expected') {
    const failure = { schemaVersion: 1, purpose: 'r5-revision4-minute-successor-prestate-failure', sourceCommit, mutationPerformed: false, before, mainnetDisabled: true }
    await writeOutput(options.output, failure)
    fail(`successor pre-state is ${before.classification}`)
  }
  if (!runtimeQuiescent(before.runtime)) fail('collector runtime is not quiescent before successor transaction')
  if (before.leasedMessageCount !== 0 || before.retryMessageCount !== 0 || before.pendingCount !== 1) fail('phase queue is not drainable before successor transaction')

  const head = await readDevnetHead()
  const marker = `exact-${NAME} sha256:${actualSha}`
  const drainOwner = `r5-minute2-${Date.now()}`
  const formalBefore = JSON.stringify(before.formalRun)
  const failedRunBefore = JSON.stringify(before.failedRun)
  const failedBatchesBefore = JSON.stringify(before.failedBatches)
  const formalEvidenceBefore = JSON.stringify(before.formalEvidence)
  const statement = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\nselect public.xrpl_drain_r5_checkpoint_boundary('${drainOwner}',statement_timestamp()) as boundary_drain;\n${sql}\ninsert into supabase_migrations.schema_migrations(version,statements,name) values ('${VERSION}',array['${marker}']::text[],'${NAME}');\nselect public.xrpl_prepare_r5_revision4_active_recovery('${TARGET_RUN_ID}',r.checkpoint_id,r.checkpoint_state_digest,${head.index},'${head.hash}',statement_timestamp()) as prepared from xrpl_r5_v1.recovery_runs r where r.run_id='${FORMAL_RUN_ID}';\ncommit;`
  await managementQuery(statement, false)

  const after = classify(parseState(await managementQuery(inspectionQuery(), true)), actualSha, sourceCommit)
  if (after.classification !== 'applied_consistent') fail(`successor post-state is ${after.classification}`)
  if (!targetRunValid(after.targetRun, after.formalRun, after.canonicalWatermark, head.index)) fail('successor run did not bind the fresh Devnet head')
  if (JSON.stringify(after.formalRun) !== formalBefore) fail('formal run changed during successor rollover')
  if (JSON.stringify(after.failedRun) !== failedRunBefore) fail('failed minute run changed during successor rollover')
  if (JSON.stringify(after.failedBatches) !== failedBatchesBefore) fail('failed minute batch evidence changed during successor rollover')
  if (JSON.stringify(after.formalEvidence) !== formalEvidenceBefore) fail('formal qualification evidence changed during successor rollover')
  if (after.leasedMessageCount !== 0 || after.retryMessageCount !== 0 || after.pendingCount !== 1 || after.inflightWorkCount !== 0) fail('successor transaction did not end at a clean scan boundary')
  const pending = Array.isArray(after.pendingMessages) ? after.pendingMessages[0] : null
  if (!pending || pending.phase !== 'scan') fail('successor transaction did not preserve one pending scan')

  const result = {
    schemaVersion: 1,
    purpose: 'r5-revision4-minute-successor-apply',
    sourceCommit,
    replayed: false,
    mutationPerformed: true,
    mutationScope: 'existing commit/finalize boundary drain, exact continuous-head run-id replacement, exact migration-history marker, and fresh zero-progress successor run',
    devnetHead: head,
    before,
    after,
    formalRunPreservedExactly: true,
    failedMinuteRunPreservedExactly: true,
    failedMinuteBatchesPreservedExactly: true,
    formalEvidencePreservedExactly: true,
    failedMinuteRunRemovedFromContinuousHeadAdmission: true,
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
