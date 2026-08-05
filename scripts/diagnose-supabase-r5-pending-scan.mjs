import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('invalid project ref')
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) throw new Error('access token unavailable')
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
const sourceCommit = process.env.GITHUB_SHA ?? ''
if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) throw new Error('invalid run id')
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('invalid commit')

const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const failedBurstRunId = 30966882019
const failedBatchId = 'r5-batch-v1-r5-recovery-selected-revision3-entry-00000238'
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const output = 'supabase-r5-pending-scan-diagnostic'

function parse(text) {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 2000) } }
}
function rows(body) {
  for (const value of [body, body?.result, body?.data, body?.rows, body?.result?.rows]) {
    if (Array.isArray(value)) return value
  }
  throw new Error('query response contains no rows')
}
function object(value, name) {
  const parsed = typeof value === 'string' ? parse(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${name} invalid`)
  return parsed
}
function code(value) {
  return `\`${String(value ?? 'null').replaceAll('`', "'")}\``
}
async function query(sql, parameters) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql, parameters, read_only: true }),
    signal: AbortSignal.timeout(30000),
  })
  const body = parse(await response.text())
  if (!response.ok) throw new Error(`query failed ${response.status}: ${JSON.stringify(body).slice(0, 2000)}`)
  return rows(body)
}

const sql = `
with scheduler as (
  select count(*) filter (where status='pending')::int pending_count,
         count(*) filter (where status='leased')::int leased_count,
         count(*) filter (where status='retry')::int retry_count
  from public.xrpl_phase_messages where profile_id='supabase-devnet'
), inflight as (
  select count(*)::int work_count from public.xrpl_phase_work
  where profile_id='supabase-devnet' and status in ('planned','staged','committing','finalizing')
)
select jsonb_build_object(
  'purpose','r5-memory-halt-read-only-diagnostic',
  'failedBurstRunId',$3::bigint,
  'recoverySummary',public.xrpl_read_r5_active_recovery($1::text),
  'batchSummary',public.xrpl_read_r5_active_recovery_batch($1::text,$2::text),
  'rawRun',(select to_jsonb(r) from xrpl_r5_v1.recovery_runs r where r.run_id=$1::text),
  'rawBatch',(select to_jsonb(b) from xrpl_r5_v1.recovery_batches b where b.run_id=$1::text and b.batch_id=$2::text),
  'batchSet',(select jsonb_build_object(
    'completedCount',count(*) filter(where status='completed'),
    'haltedCount',count(*) filter(where status='halted'),
    'leasedCount',count(*) filter(where status='leased'),
    'maximumSequence',max(batch_sequence),
    'lastCompletedEnd',max(end_ledger_index) filter(where status='completed'))
    from xrpl_r5_v1.recovery_batches where run_id=$1::text),
  'physicalWatermark',(select to_jsonb(w) from public.xrpl_phase_watermarks w where profile_id='supabase-devnet'),
  'stream',(select to_jsonb(s) from public.xrpl_phase_streams s where profile_id='supabase-devnet'),
  'scheduler',(select jsonb_build_object('pendingCount',pending_count,'leasedCount',leased_count,'retryCount',retry_count) from scheduler),
  'inflightWorkCount',(select work_count from inflight),
  'committedWorksInFailedRange',(select count(*)::int from public.xrpl_phase_work w
    where w.profile_id='supabase-devnet' and w.status='committed'
      and w.start_ledger_index >= (select start_ledger_index from xrpl_r5_v1.recovery_batches where run_id=$1::text and batch_id=$2::text)
      and w.scanned_end_ledger_index <= (select end_ledger_index from xrpl_r5_v1.recovery_batches where run_id=$1::text and batch_id=$2::text))
) diagnostic`

const result = await query(sql, [recoveryRunId, failedBatchId, failedBurstRunId])
if (result.length !== 1) throw new Error(`unexpected rows:${result.length}`)
const diagnostic = object(result[0].diagnostic, 'diagnostic')
const recovery = object(diagnostic.recoverySummary, 'recovery')
const run = object(diagnostic.rawRun, 'run')
const batch = object(diagnostic.rawBatch, 'batch')
const watermark = object(diagnostic.physicalWatermark, 'watermark')
const scheduler = object(diagnostic.scheduler, 'scheduler')
const batchSet = object(diagnostic.batchSet, 'batchSet')
const recoveryWatermark = object(recovery.currentWatermark, 'recovery watermark')
const checks = {
  readOnly: true,
  exactRun: recovery.runId === recoveryRunId && run.run_id === recoveryRunId,
  exactBatch: batch.batch_id === failedBatchId && Number(batch.batch_sequence) === 238,
  memoryHaltRecorded: batch.status === 'halted' && String(batch.error_message ?? '').includes('memory_upper_bound_halt') && String(run.last_error ?? '').includes('memory_upper_bound_halt'),
  noBatchCommit: batch.final_ledger_hash === null && batch.final_work_id === null && batch.works_digest === null && batch.rows_digest === null && batch.accounting_digest === null,
  noCommittedWorksInFailedRange: Number(diagnostic.committedWorksInFailedRange) === 0,
  recoveryAndPhysicalParity: Number(recoveryWatermark.ledgerIndex) === Number(watermark.ledger_index) && recoveryWatermark.ledgerHash === watermark.ledger_hash && recoveryWatermark.workId === watermark.work_id,
  oneHaltedBatch: Number(batchSet.haltedCount) === 1,
  noLeasedRecoveryBatch: Number(batchSet.leasedCount) === 0,
  noLeasedOrRetryMessages: Number(scheduler.leasedCount) === 0 && Number(scheduler.retryCount) === 0,
  publicReaderUnchanged: recovery.checks?.publicReaderUnchanged === true,
  mainnetDisabled: recovery.checks?.mainnetDisabled === true,
  stabilizationUnauthorized: recovery.checks?.stabilizationAuthorized === false,
  soakUnauthorized: recovery.checks?.soakAuthorized === false,
}
const evidence = { ...diagnostic, sourceRunId, sourceCommit, verifiedAt: new Date().toISOString(), checks }
await mkdir(output, { recursive: true })
await writeFile(`${output}/diagnostic.json`, `${JSON.stringify(evidence, null, 2)}\n`)
const mismatches = Object.entries(checks).filter(([,v]) => v !== true).map(([k]) => k)
const markdown = `## R5 memory halt read-only diagnostic

- run: ${code(sourceRunId)}
- commit: ${code(sourceCommit)}
- failed burst run: ${code(failedBurstRunId)}
- recovery status: ${code(recovery.status)}
- completed batches: ${code(recovery.completedBatches)}
- committed ledgers: ${code(recovery.committedLedgers)}
- recovery watermark: ${code(recoveryWatermark.ledgerIndex)} / ${code(recoveryWatermark.ledgerHash)}
- physical watermark: ${code(watermark.ledger_index)} / ${code(watermark.ledger_hash)}
- failed batch ID: ${code(failedBatchId)}
- batch status: ${code(batch.status)}
- batch range: ${code(batch.start_ledger_index)}-${code(batch.end_ledger_index)}
- batch ledger count: ${code(batch.ledger_count)}
- batch attempt count: ${code(batch.attempt_count)}
- batch error: ${code(batch.error_message)}
- reserved egress bytes: ${code(batch.reserved_egress_upper_bound_bytes)}
- finalized egress bytes: ${code(batch.finalized_egress_upper_bound_bytes)}
- committed works in failed range: ${code(diagnostic.committedWorksInFailedRange)}
- halted batch count: ${code(batchSet.haltedCount)}
- leased recovery batch count: ${code(batchSet.leasedCount)}
- pending messages: ${code(scheduler.pendingCount)}
- leased messages: ${code(scheduler.leasedCount)}
- retry messages: ${code(scheduler.retryCount)}
- in-flight work: ${code(diagnostic.inflightWorkCount)}
- mismatched checks: ${code(mismatches.length ? mismatches.join(',') : 'none')}
- read-only: ${code(true)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(false)}
- soak authorized: ${code(false)}
`
await writeFile(`${output}/diagnostic.md`, markdown)
process.stdout.write(markdown)
