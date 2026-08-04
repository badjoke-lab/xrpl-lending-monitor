import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')

const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) {
  throw new Error('GITHUB_RUN_ID must be a positive integer')
}
const sourceCommit = process.env.GITHUB_SHA ?? ''
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error('GITHUB_SHA must be an exact lowercase commit SHA')
}

const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const failedBatchId =
  'r5-batch-v1-r5-recovery-selected-revision3-entry-00000087'
const managementEndpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const evidenceDirectory = 'supabase-r5-pending-scan-diagnostic'
const evidencePath = `${evidenceDirectory}/diagnostic.json`
const markdownPath = `${evidenceDirectory}/diagnostic.md`

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2_000) }
  }
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [
      body.result,
      body.data,
      body.rows,
      body.result?.rows,
      body.data?.rows,
    ]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  throw new Error('Management API query response does not contain rows')
}

async function managementQuery(query, parameters) {
  const response = await fetch(managementEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, parameters, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new Error(
      `Supabase Management query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`,
    )
  }
  return rowsFromResponse(body)
}

function object(value, name) {
  let parsed = value
  if (typeof parsed === 'string') parsed = parseJson(parsed)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be an object`)
  }
  return parsed
}

function code(value) {
  const rendered = value === undefined || value === null ? 'null' : String(value)
  return `\`${rendered.replaceAll('`', "'")}\``
}

const query = `
with pending_messages as (
  select
    message_id,
    status::text as status,
    phase::text as phase,
    attempt_count,
    payload,
    available_at,
    lease_owner,
    lease_expires_at
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet'
    and status = 'pending'
  order by message_id
), scheduler_counts as (
  select
    count(*) filter (where status = 'pending')::integer as pending_count,
    count(*) filter (where status = 'leased')::integer as leased_count,
    count(*) filter (where status = 'retry')::integer as retry_count
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet'
), inflight as (
  select count(*)::integer as work_count
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
    and status in ('planned', 'staged', 'committing', 'finalizing')
), completion_function as (
  select to_regprocedure(
    'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
  ) as signature
), completion_definition as (
  select
    signature is not null as found,
    case
      when signature is null then null
      else position(
        'v_pending_scan.attempt_count <> 0'
        in pg_get_functiondef(signature)
      ) > 0
    end as attempt_count_guard_present,
    case
      when signature is null then null
      else position(
        'r5_recovery_batch_completion_pending_scan_invalid'
        in pg_get_functiondef(signature)
      ) > 0
    end as pending_scan_guard_present
  from completion_function
)
select jsonb_build_object(
  'schemaVersion', 1,
  'purpose', 'r5-pending-scan-read-only-diagnostic',
  'recoveryRunId', $1::text,
  'failedBatchId', $2::text,
  'recovery', public.xrpl_read_r5_active_recovery($1::text),
  'failedBatch', public.xrpl_read_r5_active_recovery_batch($1::text, $2::text),
  'watermark', (
    select jsonb_build_object(
      'ledgerIndex', ledger_index,
      'ledgerHash', ledger_hash,
      'workId', work_id,
      'network', network,
      'epochId', epoch_id,
      'baseIdentity', base_identity
    )
    from public.xrpl_phase_watermarks
    where profile_id = 'supabase-devnet'
  ),
  'stream', (
    select jsonb_build_object(
      'status', status,
      'network', network,
      'epochId', epoch_id,
      'baseIdentity', base_identity,
      'lastErrorClassification', last_error_classification,
      'lastErrorMessage', last_error_message
    )
    from public.xrpl_phase_streams
    where profile_id = 'supabase-devnet'
  ),
  'scheduler', (
    select jsonb_build_object(
      'pendingCount', pending_count,
      'leasedCount', leased_count,
      'retryCount', retry_count
    )
    from scheduler_counts
  ),
  'inflightWorkCount', (select work_count from inflight),
  'pendingMessages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'messageId', message_id,
      'status', status,
      'phase', phase,
      'attemptCount', attempt_count,
      'expectedPreviousLedgerIndex', payload->>'expectedPreviousLedgerIndex',
      'expectedPreviousLedgerHash', upper(payload->>'expectedPreviousLedgerHash'),
      'epochId', payload->>'epochId',
      'baseIdentity', payload->>'baseIdentity',
      'availableAt', available_at,
      'leaseOwnerPresent', lease_owner is not null,
      'leaseExpiresAt', lease_expires_at
    ) order by message_id)
    from pending_messages
  ), '[]'::jsonb),
  'completionFunction', (
    select jsonb_build_object(
      'found', found,
      'attemptCountGuardPresent', attempt_count_guard_present,
      'pendingScanGuardPresent', pending_scan_guard_present
    )
    from completion_definition
  )
) as diagnostic
`

const rows = await managementQuery(query, [recoveryRunId, failedBatchId])
if (rows.length !== 1) throw new Error(`diagnostic query returned ${rows.length} rows`)
const raw = object(rows[0]?.diagnostic, 'diagnostic')
const recovery = object(raw.recovery, 'diagnostic.recovery')
const watermark = object(raw.watermark, 'diagnostic.watermark')
const scheduler = object(raw.scheduler, 'diagnostic.scheduler')
const stream = object(raw.stream, 'diagnostic.stream')
const completionFunction = object(
  raw.completionFunction,
  'diagnostic.completionFunction',
)
const pendingMessages = Array.isArray(raw.pendingMessages) ? raw.pendingMessages : []
const pending = pendingMessages.length === 1
  ? object(pendingMessages[0], 'diagnostic.pendingMessage')
  : null
const currentWatermark = object(
  recovery.currentWatermark,
  'diagnostic.recovery.currentWatermark',
)

const checks = {
  readOnly: true,
  exactRecoveryRun: recovery.runId === recoveryRunId,
  physicalAndRecoveryWatermarkMatch:
    Number(watermark.ledgerIndex) === Number(currentWatermark.ledgerIndex)
    && String(watermark.ledgerHash).toUpperCase()
      === String(currentWatermark.ledgerHash).toUpperCase()
    && watermark.workId === currentWatermark.workId,
  exactlyOnePendingMessage:
    Number(scheduler.pendingCount) === 1 && pendingMessages.length === 1,
  noLeasedOrRetryMessages:
    Number(scheduler.leasedCount) === 0 && Number(scheduler.retryCount) === 0,
  noInflightWork: Number(raw.inflightWorkCount) === 0,
  pendingPhaseIsScan: pending?.phase === 'scan',
  pendingIndexMatchesWatermark:
    Number(pending?.expectedPreviousLedgerIndex) === Number(watermark.ledgerIndex),
  pendingHashMatchesWatermark:
    String(pending?.expectedPreviousLedgerHash ?? '').toUpperCase()
      === String(watermark.ledgerHash).toUpperCase(),
  pendingEpochMatches:
    pending?.epochId === recovery.epochId && pending?.epochId === watermark.epochId,
  pendingBaseIdentityMatches:
    pending?.baseIdentity === recovery.baseIdentity
      && pending?.baseIdentity === watermark.baseIdentity,
  streamIdentityMatches:
    stream.status === 'active'
      && stream.network === recovery.network
      && stream.epochId === recovery.epochId
      && stream.baseIdentity === recovery.baseIdentity,
  completionAttemptCountGuardRemoved:
    completionFunction.found === true
      && completionFunction.attemptCountGuardPresent === false,
  completionPendingScanGuardPresent:
    completionFunction.pendingScanGuardPresent === true,
  publicReaderUnchanged: recovery.checks?.publicReaderUnchanged === true,
  mainnetDisabled: recovery.checks?.mainnetDisabled === true,
  stabilizationAuthorized: recovery.checks?.stabilizationAuthorized === true,
  soakAuthorized: recovery.checks?.soakAuthorized === true,
}

const evidence = {
  schemaVersion: 1,
  purpose: 'r5-pending-scan-read-only-diagnostic',
  verifiedAt: new Date().toISOString(),
  sourceRunId,
  sourceCommit,
  recoveryRunId,
  failedBatchId,
  recovery,
  failedBatch: raw.failedBatch,
  watermark,
  stream,
  scheduler,
  inflightWorkCount: Number(raw.inflightWorkCount),
  pendingMessages,
  completionFunction,
  checks,
}

await mkdir(evidenceDirectory, { recursive: true })
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

const mismatchNames = Object.entries(checks)
  .filter(([name, value]) =>
    !['readOnly', 'publicReaderUnchanged', 'mainnetDisabled', 'stabilizationAuthorized', 'soakAuthorized'].includes(name)
    && value !== true,
  )
  .map(([name]) => name)

const markdown = `## R5 pending scan read-only diagnostic

- run: ${code(sourceRunId)}
- commit: ${code(sourceCommit)}
- recovery run ID: ${code(recoveryRunId)}
- failed batch ID: ${code(failedBatchId)}
- recovery status: ${code(recovery.status)}
- completed batches: ${code(recovery.completedBatches)}
- committed ledgers: ${code(recovery.committedLedgers)}
- recovery watermark: ${code(currentWatermark.ledgerIndex)} / ${code(currentWatermark.ledgerHash)}
- physical watermark: ${code(watermark.ledgerIndex)} / ${code(watermark.ledgerHash)}
- failed batch status: ${code(raw.failedBatch?.status)}
- pending message count: ${code(scheduler.pendingCount)}
- leased message count: ${code(scheduler.leasedCount)}
- retry message count: ${code(scheduler.retryCount)}
- in-flight work count: ${code(raw.inflightWorkCount)}
- pending phase: ${code(pending?.phase)}
- pending attempt count: ${code(pending?.attemptCount)}
- pending expected previous ledger: ${code(pending?.expectedPreviousLedgerIndex)}
- pending expected previous hash: ${code(pending?.expectedPreviousLedgerHash)}
- pending epoch: ${code(pending?.epochId)}
- pending base identity: ${code(pending?.baseIdentity)}
- completion attempt-count guard present: ${code(completionFunction.attemptCountGuardPresent)}
- completion pending-scan guard present: ${code(completionFunction.pendingScanGuardPresent)}
- mismatched completion checks: ${code(mismatchNames.length === 0 ? 'none' : mismatchNames.join(','))}
- read-only: ${code(true)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}
`

await writeFile(markdownPath, markdown, 'utf8')
process.stdout.write(markdown)
