import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
const sourceCommit = process.env.GITHUB_SHA ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('invalid project ref')
if (accessToken.length < 20) throw new Error('access token unavailable')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) throw new Error('invalid run id')
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('invalid commit')

const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const failedBurstRunId = 31030990054
const output = 'supabase-r5-health-change-diagnostic'
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const expected = {
  found: true,
  schemaVersion: 1,
  purpose: 'r5-supabase-active-recovery-summary',
  runId: recoveryRunId,
  profileId: 'supabase_free_postgres_pgcron_edge',
  profileRevision: 3,
  profileIdentityDigest:
    '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
  selectionDigest:
    '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
  sourceProfileId: 'supabase-devnet',
  network: 'devnet',
  epochId: 'supabase-r4c2c-v1',
  batchSize: 24,
  lastError: null,
}
const expectedTrueChecks = [
  'exactRevision3Identity',
  'exactSelectionBound',
  'checkpointDigestBound',
  'checkpointDescendantChainProved',
  'headNotBehindStart',
  'lagArithmeticExact',
  'publicReaderUnchanged',
  'mainnetDisabled',
]

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2_000) }
  }
}

function rows(body) {
  for (const candidate of [body, body?.result, body?.data, body?.rows, body?.result?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
  throw new Error('query response contains no rows')
}

function object(value, name) {
  const parsed = typeof value === 'string' ? parse(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} invalid`)
  }
  return parsed
}

function list(value, name) {
  const parsed = typeof value === 'string' ? parse(value) : value
  if (!Array.isArray(parsed)) throw new Error(`${name} invalid`)
  return parsed
}

function code(value) {
  return `\`${String(value ?? 'null').replaceAll('`', "'")}\``
}

async function query(sql, parameters) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql, parameters, read_only: true }),
    signal: AbortSignal.timeout(60_000),
  })
  const body = parse(await response.text())
  if (!response.ok) {
    throw new Error(`query failed ${response.status}: ${JSON.stringify(body).slice(0, 2_000)}`)
  }
  return rows(body)
}

const sql = `
select jsonb_build_object(
  'purpose', 'r5-health-change-read-only-diagnostic-v1',
  'failedBurstRunId', $2::bigint,
  'reader', public.xrpl_read_r5_active_recovery($1::text),
  'rawRun', (
    select to_jsonb(run)
    from xrpl_r5_v1.recovery_runs run
    where run.run_id = $1::text
  ),
  'physicalWatermark', (
    select to_jsonb(watermark)
    from public.xrpl_phase_watermarks watermark
    where watermark.profile_id = 'supabase-devnet'
  ),
  'activeBatches', (
    select coalesce(jsonb_agg(to_jsonb(batch) order by batch.batch_sequence), '[]'::jsonb)
    from xrpl_r5_v1.recovery_batches batch
    where batch.run_id = $1::text
      and batch.status in ('leased', 'halted')
  ),
  'recentBatches', (
    select coalesce(jsonb_agg(to_jsonb(batch) order by batch.batch_sequence), '[]'::jsonb)
    from (
      select *
      from xrpl_r5_v1.recovery_batches
      where run_id = $1::text
      order by batch_sequence desc
      limit 24
    ) batch
  ),
  'noncommittedWork', (
    select coalesce(jsonb_agg(to_jsonb(work) order by work.work_id), '[]'::jsonb)
    from public.xrpl_phase_work work
    where work.profile_id = 'supabase-devnet'
      and work.status <> 'committed'
  ),
  'nonterminalMessages', (
    select coalesce(jsonb_agg(to_jsonb(message) order by message.message_id), '[]'::jsonb)
    from public.xrpl_phase_messages message
    where message.profile_id = 'supabase-devnet'
      and message.status <> 'committed'
  ),
  'databaseBytes', pg_database_size(current_database())::bigint
) as diagnostic;
`

await mkdir(output, { recursive: true })
const result = await query(sql, [recoveryRunId, failedBurstRunId])
if (result.length !== 1) throw new Error(`unexpected row count ${result.length}`)
const diagnostic = object(result[0].diagnostic, 'diagnostic')
const reader = object(diagnostic.reader, 'reader')
const rawRun = object(diagnostic.rawRun, 'rawRun')
const checks = object(reader.checks, 'reader.checks')
const activeBatches = list(diagnostic.activeBatches, 'activeBatches')
const recentBatches = list(diagnostic.recentBatches, 'recentBatches')
const noncommittedWork = list(diagnostic.noncommittedWork, 'noncommittedWork')
const nonterminalMessages = list(diagnostic.nonterminalMessages, 'nonterminalMessages')

const mismatches = []
for (const [field, expectedValue] of Object.entries(expected)) {
  if (reader[field] !== expectedValue) {
    mismatches.push({ field, expected: expectedValue, actual: reader[field] ?? null })
  }
}
if (!['prepared', 'running', 'caught_up'].includes(reader.status)) {
  mismatches.push({
    field: 'status',
    expected: ['prepared', 'running', 'caught_up'],
    actual: reader.status ?? null,
  })
}
for (const field of expectedTrueChecks) {
  if (checks[field] !== true) {
    mismatches.push({ field: `checks.${field}`, expected: true, actual: checks[field] ?? null })
  }
}
for (const [field, expectedValue] of [
  ['stabilizationAuthorized', false],
  ['soakAuthorized', false],
]) {
  if (checks[field] !== expectedValue) {
    mismatches.push({ field: `checks.${field}`, expected: expectedValue, actual: checks[field] ?? null })
  }
}

const evidence = {
  ...diagnostic,
  sourceRunId,
  sourceCommit,
  reader,
  rawRun,
  activeBatches,
  recentBatches,
  noncommittedWork,
  nonterminalMessages,
  mismatches,
  diagnosticChecks: {
    readOnly: true,
    exactRecoveryRun: reader.runId === recoveryRunId && rawRun.run_id === recoveryRunId,
    exactFailedBurst: diagnostic.failedBurstRunId === failedBurstRunId,
    publicReaderUnchanged: checks.publicReaderUnchanged === true,
    mainnetDisabled: checks.mainnetDisabled === true,
    stabilizationUnauthorized: checks.stabilizationAuthorized === false,
    soakUnauthorized: checks.soakAuthorized === false,
  },
}
await writeFile(`${output}/diagnostic.json`, `${JSON.stringify(evidence, null, 2)}\n`)

const recentErrors = recentBatches
  .filter((batch) => batch.error_message !== null && batch.error_message !== undefined)
  .map((batch) => `${batch.batch_sequence}:${batch.status}:${batch.error_message}`)
const markdown = [
  '## R5 health-change read-only diagnostic',
  '',
  `- diagnostic run: ${code(sourceRunId)}`,
  `- source commit: ${code(sourceCommit)}`,
  `- failed burst run: ${code(failedBurstRunId)}`,
  `- recovery status: ${code(reader.status)}`,
  `- reader last error: ${code(reader.lastError)}`,
  `- raw run last error: ${code(rawRun.last_error)}`,
  `- completed batches: ${code(reader.completedBatches)}`,
  `- committed ledgers: ${code(reader.committedLedgers)}`,
  `- recovery watermark: ${code(reader.currentWatermark?.ledgerIndex)}`,
  `- physical watermark: ${code(diagnostic.physicalWatermark?.ledger_index)}`,
  `- active batches: ${code(activeBatches.length)}`,
  `- noncommitted work: ${code(noncommittedWork.length)}`,
  `- nonterminal messages: ${code(nonterminalMessages.length)}`,
  `- identity/health mismatches: ${code(mismatches.length)}`,
  `- mismatch fields: ${code(mismatches.map((item) => item.field).join(',') || 'none')}`,
  `- recent batch errors: ${code(recentErrors.join(' | ') || 'none')}`,
  `- database bytes: ${code(diagnostic.databaseBytes)}`,
  `- read-only: ${code(true)}`,
  `- public reader unchanged: ${code(checks.publicReaderUnchanged)}`,
  `- Mainnet disabled: ${code(checks.mainnetDisabled)}`,
  `- stabilization authorized: ${code(checks.stabilizationAuthorized)}`,
  `- soak authorized: ${code(checks.soakAuthorized)}`,
  '',
].join('\n')
await writeFile(`${output}/diagnostic.md`, markdown)
process.stdout.write(markdown)

const failedChecks = Object.entries(evidence.diagnosticChecks)
  .filter(([, passed]) => passed !== true)
  .map(([name]) => name)
if (failedChecks.length > 0) {
  throw new Error(`diagnostic boundary failed: ${failedChecks.join(',')}`)
}
