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
const failedBurstRunId = 30925522885
const failedBurstBefore = {
  completedBatches: 99,
  committedLedgers: 2062,
  watermarkLedgerIndex: 4135369,
  watermarkLedgerHash:
    'F52B2BC40D3F433A7B525DE3F56E05FE62E7EB6DDB1C39690A1AA95FFA31ED0B',
  watermarkWorkId:
    'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4135369:A88F8D479B7E920CE073681550D090860147C9683B0BE6341E59FE2881042AF6',
}
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
), batch_counts as (
  select
    count(*)::integer as total_count,
    count(*) filter (where status = 'completed')::integer as completed_count,
    count(*) filter (where status = 'halted')::integer as halted_count,
    count(*) filter (where status = 'leased')::integer as leased_count,
    max(batch_sequence)::bigint as maximum_sequence,
    coalesce(sum(ledger_count) filter (where status = 'completed'), 0)::bigint
      as completed_ledger_count
  from xrpl_r5_v1.recovery_batches
  where run_id = $1::text
), post_failure_batches_ordered as (
  select
    batch_id,
    batch_sequence,
    status::text as status,
    origin,
    start_ledger_index,
    end_ledger_index,
    ledger_count,
    attempt_count,
    expected_parent_hash,
    final_ledger_hash,
    final_work_id,
    error_message,
    lag(end_ledger_index) over (order by batch_sequence) as prior_end_ledger_index
  from xrpl_r5_v1.recovery_batches
  where run_id = $1::text
    and batch_sequence > $3::bigint
), post_failure_batch_summary as (
  select
    count(*)::integer as row_count,
    count(*) filter (where status = 'completed')::integer as completed_count,
    count(*) filter (where status = 'halted')::integer as halted_count,
    count(*) filter (where origin = 'r5_executor')::integer as executor_count,
    count(*) filter (where origin = 'adopted_active_descendant')::integer
      as adoption_count,
    coalesce(sum(ledger_count), 0)::bigint as ledger_count,
    min(batch_sequence)::bigint as minimum_sequence,
    max(batch_sequence)::bigint as maximum_sequence,
    coalesce(bool_and(
      case
        when batch_sequence = $3::bigint + 1 then
          start_ledger_index = $4::bigint + 1
        else
          start_ledger_index = prior_end_ledger_index + 1
      end
      and end_ledger_index = start_ledger_index + ledger_count - 1
    ), true) as contiguous
  from post_failure_batches_ordered
), post_failure_batches as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'batchId', batch_id,
    'batchSequence', batch_sequence,
    'status', status,
    'origin', origin,
    'startLedgerIndex', start_ledger_index,
    'endLedgerIndex', end_ledger_index,
    'ledgerCount', ledger_count,
    'attemptCount', attempt_count,
    'expectedParentHash', expected_parent_hash,
    'finalLedgerHash', final_ledger_hash,
    'finalWorkId', final_work_id,
    'errorMessage', error_message
  ) order by batch_sequence), '[]'::jsonb) as rows
  from post_failure_batches_ordered
), adoption_counts as (
  select
    count(*)::integer as total_count,
    max(adoption_sequence)::bigint as maximum_sequence,
    coalesce(sum(ledger_count), 0)::bigint as adopted_ledger_count
  from xrpl_r5_v1.recovery_adoptions
  where run_id = $1::text
), post_failure_adoptions as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'adoptionSequence', adoption_sequence,
    'startLedgerIndex', start_ledger_index,
    'endLedgerIndex', end_ledger_index,
    'ledgerCount', ledger_count,
    'firstBatchSequence', first_batch_sequence,
    'adoptedBatchCount', adopted_batch_count,
    'adoptedAt', adopted_at
  ) order by adoption_sequence), '[]'::jsonb) as rows
  from xrpl_r5_v1.recovery_adoptions
  where run_id = $1::text
    and first_batch_sequence > $3::bigint
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
  'schemaVersion', 2,
  'purpose', 'r5-burst-final-parity-read-only-diagnostic',
  'recoveryRunId', $1::text,
  'failedBatchId', $2::text,
  'failedBurstRunId', $5::bigint,
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
  'batchSummary', (
    select jsonb_build_object(
      'totalCount', total_count,
      'completedCount', completed_count,
      'haltedCount', halted_count,
      'leasedCount', leased_count,
      'maximumSequence', maximum_sequence,
      'completedLedgerCount', completed_ledger_count
    )
    from batch_counts
  ),
  'postFailureBatchSummary', (
    select jsonb_build_object(
      'rowCount', row_count,
      'completedCount', completed_count,
      'haltedCount', halted_count,
      'executorCount', executor_count,
      'adoptionCount', adoption_count,
      'ledgerCount', ledger_count,
      'minimumSequence', minimum_sequence,
      'maximumSequence', maximum_sequence,
      'contiguous', contiguous
    )
    from post_failure_batch_summary
  ),
  'postFailureBatches', (select rows from post_failure_batches),
  'adoptionSummary', (
    select jsonb_build_object(
      'totalCount', total_count,
      'maximumSequence', maximum_sequence,
      'adoptedLedgerCount', adopted_ledger_count
    )
    from adoption_counts
  ),
  'postFailureAdoptions', (select rows from post_failure_adoptions),
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

const rows = await managementQuery(query, [
  recoveryRunId,
  failedBatchId,
  failedBurstBefore.completedBatches,
  failedBurstBefore.watermarkLedgerIndex,
  failedBurstRunId,
])
if (rows.length !== 1) throw new Error(`diagnostic query returned ${rows.length} rows`)
const raw = object(rows[0]?.diagnostic, 'diagnostic')
const recovery = object(raw.recovery, 'diagnostic.recovery')
const watermark = object(raw.watermark, 'diagnostic.watermark')
const scheduler = object(raw.scheduler, 'diagnostic.scheduler')
const stream = object(raw.stream, 'diagnostic.stream')
const batchSummary = object(raw.batchSummary, 'diagnostic.batchSummary')
const postFailureBatchSummary = object(
  raw.postFailureBatchSummary,
  'diagnostic.postFailureBatchSummary',
)
const adoptionSummary = object(raw.adoptionSummary, 'diagnostic.adoptionSummary')
const completionFunction = object(
  raw.completionFunction,
  'diagnostic.completionFunction',
)
const pendingMessages = Array.isArray(raw.pendingMessages) ? raw.pendingMessages : []
const postFailureBatches = Array.isArray(raw.postFailureBatches)
  ? raw.postFailureBatches
  : []
const postFailureAdoptions = Array.isArray(raw.postFailureAdoptions)
  ? raw.postFailureAdoptions
  : []
const pending = pendingMessages.length === 1
  ? object(pendingMessages[0], 'diagnostic.pendingMessage')
  : null
const currentWatermark = object(
  recovery.currentWatermark,
  'diagnostic.recovery.currentWatermark',
)

const completedBatchAdvance =
  Number(recovery.completedBatches) - failedBurstBefore.completedBatches
const committedLedgerAdvance =
  Number(recovery.committedLedgers) - failedBurstBefore.committedLedgers
const watermarkLedgerAdvance =
  Number(currentWatermark.ledgerIndex) - failedBurstBefore.watermarkLedgerIndex

const checks = {
  readOnly: true,
  exactRecoveryRun: recovery.runId === recoveryRunId,
  failedBurstBeforeSnapshotBound:
    failedBurstBefore.watermarkLedgerHash
      === 'F52B2BC40D3F433A7B525DE3F56E05FE62E7EB6DDB1C39690A1AA95FFA31ED0B'
    && failedBurstBefore.watermarkWorkId.endsWith(
      ':4135369:A88F8D479B7E920CE073681550D090860147C9683B0BE6341E59FE2881042AF6',
    ),
  recoveryAdvancedFromFailedBurst:
    completedBatchAdvance > 0
      && committedLedgerAdvance > 0
      && watermarkLedgerAdvance > 0,
  recoveryCounterAndWatermarkAdvanceMatch:
    committedLedgerAdvance === watermarkLedgerAdvance,
  postFailureBatchCountMatchesRecoveryAdvance:
    Number(postFailureBatchSummary.rowCount) === completedBatchAdvance,
  postFailureLedgerCountMatchesRecoveryAdvance:
    Number(postFailureBatchSummary.ledgerCount) === committedLedgerAdvance,
  postFailureBatchesAllCompleted:
    Number(postFailureBatchSummary.completedCount)
      === Number(postFailureBatchSummary.rowCount)
      && Number(postFailureBatchSummary.haltedCount) === 0,
  postFailureBatchesContiguous: postFailureBatchSummary.contiguous === true,
  batchSummaryMatchesRecovery:
    Number(batchSummary.completedCount) === Number(recovery.completedBatches)
      && Number(batchSummary.completedLedgerCount) === Number(recovery.committedLedgers)
      && Number(batchSummary.maximumSequence) === Number(recovery.completedBatches),
  noHaltedOrLeasedRecoveryBatches:
    Number(batchSummary.haltedCount) === 0
      && Number(batchSummary.leasedCount) === 0,
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
  schemaVersion: 2,
  purpose: 'r5-burst-final-parity-read-only-diagnostic',
  verifiedAt: new Date().toISOString(),
  sourceRunId,
  sourceCommit,
  recoveryRunId,
  failedBurstRunId,
  failedBurstBefore,
  computedAdvance: {
    completedBatchAdvance,
    committedLedgerAdvance,
    watermarkLedgerAdvance,
  },
  recovery,
  failedBatch: raw.failedBatch,
  watermark,
  stream,
  scheduler,
  inflightWorkCount: Number(raw.inflightWorkCount),
  pendingMessages,
  batchSummary,
  postFailureBatchSummary,
  postFailureBatches,
  adoptionSummary,
  postFailureAdoptions,
  completionFunction,
  checks,
}

await mkdir(evidenceDirectory, { recursive: true })
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

const mismatchNames = Object.entries(checks)
  .filter(([name, value]) =>
    ![
      'readOnly',
      'publicReaderUnchanged',
      'mainnetDisabled',
      'stabilizationAuthorized',
      'soakAuthorized',
    ].includes(name) && value !== true,
  )
  .map(([name]) => name)

const markdown = `## R5 burst final parity read-only diagnostic

- run: ${code(sourceRunId)}
- commit: ${code(sourceCommit)}
- failed burst run: ${code(failedBurstRunId)}
- recovery run ID: ${code(recoveryRunId)}
- recovery status: ${code(recovery.status)}
- failed burst before completed batches: ${code(failedBurstBefore.completedBatches)}
- failed burst before committed ledgers: ${code(failedBurstBefore.committedLedgers)}
- failed burst before watermark: ${code(failedBurstBefore.watermarkLedgerIndex)} / ${code(failedBurstBefore.watermarkLedgerHash)}
- completed batches now: ${code(recovery.completedBatches)}
- committed ledgers now: ${code(recovery.committedLedgers)}
- recovery watermark now: ${code(currentWatermark.ledgerIndex)} / ${code(currentWatermark.ledgerHash)}
- physical watermark now: ${code(watermark.ledgerIndex)} / ${code(watermark.ledgerHash)}
- completed batch advance: ${code(completedBatchAdvance)}
- committed ledger advance: ${code(committedLedgerAdvance)}
- watermark ledger advance: ${code(watermarkLedgerAdvance)}
- post-failure batch rows: ${code(postFailureBatchSummary.rowCount)}
- post-failure completed rows: ${code(postFailureBatchSummary.completedCount)}
- post-failure halted rows: ${code(postFailureBatchSummary.haltedCount)}
- post-failure executor rows: ${code(postFailureBatchSummary.executorCount)}
- post-failure adoption rows: ${code(postFailureBatchSummary.adoptionCount)}
- post-failure batch ledger total: ${code(postFailureBatchSummary.ledgerCount)}
- post-failure batch range contiguous: ${code(postFailureBatchSummary.contiguous)}
- total adoption rows: ${code(adoptionSummary.totalCount)}
- maximum adoption sequence: ${code(adoptionSummary.maximumSequence)}
- post-failure adoption rows: ${code(postFailureAdoptions.length)}
- pending message count: ${code(scheduler.pendingCount)}
- leased message count: ${code(scheduler.leasedCount)}
- retry message count: ${code(scheduler.retryCount)}
- in-flight work count: ${code(raw.inflightWorkCount)}
- pending phase: ${code(pending?.phase)}
- pending expected previous ledger: ${code(pending?.expectedPreviousLedgerIndex)}
- mismatched parity checks: ${code(mismatchNames.length === 0 ? 'none' : mismatchNames.join(','))}
- read-only: ${code(true)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}
`

await writeFile(markdownPath, markdown, 'utf8')
process.stdout.write(markdown)
