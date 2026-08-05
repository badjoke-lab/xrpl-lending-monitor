import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
const sourceCommit = process.env.GITHUB_SHA ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('invalid project ref')
if (accessToken.length < 20) throw new Error('access token unavailable')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) {
  throw new Error('invalid run id')
}
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('invalid commit')

const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const failedBurstRunId = 31030990054
const healthDiagnosticRunId = 31032129918
const haltBytes = 4_294_967_296
const reservationBytes = 134_217_728
const windowMilliseconds = 31 * 24 * 60 * 60 * 1000
const output = 'supabase-r5-egress-halt-diagnostic'
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2_000) }
  }
}

function rows(body) {
  for (const candidate of [
    body,
    body?.result,
    body?.data,
    body?.rows,
    body?.result?.rows,
  ]) {
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

function integer(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} invalid`)
  }
  return parsed
}

function instant(value, name) {
  const parsed = Date.parse(String(value ?? ''))
  if (!Number.isFinite(parsed)) throw new Error(`${name} invalid`)
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
    throw new Error(
      `query failed ${response.status}: ${JSON.stringify(body).slice(0, 2_000)}`,
    )
  }
  return rows(body)
}

const sql = `
with observed as (
  select clock_timestamp() as value
), attempts as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', attempt.session_id,
    'attemptId', attempt.attempt_id,
    'status', attempt.status,
    'startedAt', attempt.started_at,
    'finalizedAt', attempt.finalized_at,
    'reservedBytes', attempt.reserved_egress_upper_bound_bytes,
    'finalizedBytes', attempt.finalized_egress_upper_bound_bytes,
    'effectiveBytes', xrpl_resource_guard_v2.attempt_effective_egress(
      attempt.status,
      attempt.reserved_egress_upper_bound_bytes,
      coalesce(
        attempt.finalized_egress_upper_bound_bytes,
        attempt.reserved_egress_upper_bound_bytes
      )
    ),
    'tickId', attempt.tick_id,
    'errorMessage', attempt.error_message,
    'sessionStatus', session.status,
    'sessionResourceGuardStatus', session.resource_guard_status
  ) order by attempt.started_at, attempt.session_id, attempt.attempt_id), '[]'::jsonb) as value
  from observed
  join xrpl_resource_guard_v2.attempts attempt
    on attempt.started_at >= observed.value - interval '31 days'
   and attempt.started_at <= observed.value
  left join xrpl_steady_v1.sessions session
    on session.session_id = attempt.session_id
), legacy as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', accounting.session_id,
    'tickId', accounting.tick_id,
    'recordedAt', accounting.recorded_at,
    'effectiveBytes', accounting.conservative_tick_egress_upper_bound_bytes,
    'allowed', accounting.allowed
  ) order by accounting.recorded_at, accounting.session_id, accounting.tick_id), '[]'::jsonb) as value
  from observed
  join xrpl_resource_guard_v2.tick_accounting accounting
    on accounting.recorded_at >= observed.value - interval '31 days'
   and accounting.recorded_at <= observed.value
), recovery as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'batchId', batch.batch_id,
    'batchSequence', batch.batch_sequence,
    'status', batch.status,
    'claimedAt', batch.claimed_at,
    'completedAt', batch.completed_at,
    'reservedBytes', batch.reserved_egress_upper_bound_bytes,
    'finalizedBytes', batch.finalized_egress_upper_bound_bytes,
    'effectiveBytes', case
      when batch.status = 'completed'
        then batch.finalized_egress_upper_bound_bytes
      else batch.reserved_egress_upper_bound_bytes
    end,
    'errorMessage', batch.error_message
  ) order by batch.claimed_at, batch.batch_sequence), '[]'::jsonb) as value
  from observed
  join xrpl_r5_v1.recovery_batches batch
    on batch.run_id = $1::text
   and batch.claimed_at >= observed.value - interval '31 days'
   and batch.claimed_at <= observed.value
), provider as (
  select to_jsonb(snapshot) as value
  from xrpl_resource_guard_v1.external_snapshots snapshot
  order by snapshot.observed_at desc, snapshot.snapshot_id desc
  limit 1
)
select jsonb_build_object(
  'purpose', 'r5-egress-halt-breakdown-read-only-v1',
  'observedAt', (select value from observed),
  'failedBurstRunId', $2::bigint,
  'healthDiagnosticRunId', $3::bigint,
  'reader', public.xrpl_read_r5_active_recovery($1::text),
  'rawRun', (
    select to_jsonb(run)
    from xrpl_r5_v1.recovery_runs run
    where run.run_id = $1::text
  ),
  'attempts', (select value from attempts),
  'legacyTicks', (select value from legacy),
  'recoveryBatches', (select value from recovery),
  'latestProviderSnapshot', (select value from provider),
  'databaseBytes', pg_database_size(current_database())::bigint
) as diagnostic;
`

const result = await query(sql, [
  recoveryRunId,
  failedBurstRunId,
  healthDiagnosticRunId,
])
if (result.length !== 1) throw new Error(`unexpected row count ${result.length}`)
const diagnostic = object(result[0].diagnostic, 'diagnostic')
const reader = object(diagnostic.reader, 'reader')
const rawRun = object(diagnostic.rawRun, 'rawRun')
const attempts = list(diagnostic.attempts, 'attempts')
const legacyTicks = list(diagnostic.legacyTicks, 'legacyTicks')
const recoveryBatches = list(diagnostic.recoveryBatches, 'recoveryBatches')
const observedAtMilliseconds = instant(diagnostic.observedAt, 'observedAt')

function contribution(row, source, timeField) {
  const effectiveBytes = integer(row.effectiveBytes, `${source}.effectiveBytes`)
  const startedAtMilliseconds = instant(row[timeField], `${source}.${timeField}`)
  return {
    ...row,
    source,
    effectiveBytes,
    startedAtMilliseconds,
    expiresAtMilliseconds: startedAtMilliseconds + windowMilliseconds,
  }
}

const attemptContributions = attempts.map((row) =>
  contribution(row, 'attempt', 'startedAt'),
)
const legacyContributions = legacyTicks.map((row) =>
  contribution(row, 'legacy', 'recordedAt'),
)
const recoveryContributions = recoveryBatches.map((row) =>
  contribution(row, 'recovery', 'claimedAt'),
)

function sumActive(contributions, evaluatedAtMilliseconds) {
  const lower = evaluatedAtMilliseconds - windowMilliseconds
  return contributions
    .filter(
      (row) =>
        row.startedAtMilliseconds >= lower &&
        row.startedAtMilliseconds <= evaluatedAtMilliseconds,
    )
    .reduce((total, row) => total + row.effectiveBytes, 0)
}

function totalsAt(evaluatedAtMilliseconds) {
  const attemptBytes = sumActive(attemptContributions, evaluatedAtMilliseconds)
  const legacyBytes = sumActive(legacyContributions, evaluatedAtMilliseconds)
  const steadyBytes = Math.max(attemptBytes, legacyBytes)
  const recoveryBytes = sumActive(
    recoveryContributions,
    evaluatedAtMilliseconds,
  )
  const priorBytes = steadyBytes + recoveryBytes
  const projectedBytes = priorBytes + reservationBytes
  return {
    evaluatedAt: new Date(evaluatedAtMilliseconds).toISOString(),
    attemptBytes,
    legacyBytes,
    steadyBytes,
    recoveryBytes,
    priorBytes,
    projectedBytes,
    headroomBeforeReservationBytes: haltBytes - priorBytes,
    headroomAfterReservationBytes: haltBytes - projectedBytes,
    claimAllowed: projectedBytes < haltBytes,
  }
}

function group(rows, field) {
  const grouped = new Map()
  for (const row of rows) {
    const key = String(row[field] ?? 'null')
    const current = grouped.get(key) ?? {
      value: key,
      count: 0,
      effectiveBytes: 0,
      reservedBytes: 0,
      finalizedBytes: 0,
      earliestAt: null,
      latestAt: null,
    }
    const at = row.startedAtMilliseconds
    current.count += 1
    current.effectiveBytes += row.effectiveBytes
    current.reservedBytes += Number(row.reservedBytes ?? 0)
    current.finalizedBytes += Number(row.finalizedBytes ?? 0)
    current.earliestAt =
      current.earliestAt === null ? at : Math.min(current.earliestAt, at)
    current.latestAt =
      current.latestAt === null ? at : Math.max(current.latestAt, at)
    grouped.set(key, current)
  }
  return [...grouped.values()]
    .sort((left, right) => left.value.localeCompare(right.value))
    .map((entry) => ({
      ...entry,
      earliestAt:
        entry.earliestAt === null
          ? null
          : new Date(entry.earliestAt).toISOString(),
      latestAt:
        entry.latestAt === null ? null : new Date(entry.latestAt).toISOString(),
    }))
}

const current = totalsAt(observedAtMilliseconds)
const expirationCandidates = [
  ...attemptContributions,
  ...legacyContributions,
  ...recoveryContributions,
]
  .map((row) => row.expiresAtMilliseconds + 1_000)
  .filter((value) => value > observedAtMilliseconds)
const uniqueCandidates = [...new Set(expirationCandidates)].sort(
  (left, right) => left - right,
)
const releaseSchedule = uniqueCandidates.map((candidate) => totalsAt(candidate))
const firstSafe = releaseSchedule.find((entry) => entry.claimAllowed) ?? null
const fullReservationAttempts = attemptContributions.filter(
  (row) => row.status !== 'succeeded',
)
const openAttempts = fullReservationAttempts.filter((row) => row.status === 'open')
const failedOrDeferredAttempts = fullReservationAttempts.filter((row) =>
  ['failed', 'deferred'].includes(row.status),
)
const noncompletedRecovery = recoveryContributions.filter(
  (row) => row.status !== 'completed',
)

const checks = object(reader.checks, 'reader.checks')
const diagnosticChecks = {
  readOnly: true,
  exactRecoveryRun:
    reader.runId === recoveryRunId && rawRun.run_id === recoveryRunId,
  exactHalt:
    reader.status === 'halted' &&
    reader.lastError === 'r5_recovery_monthly_egress_halt' &&
    rawRun.last_error === 'r5_recovery_monthly_egress_halt',
  recomputedHaltMatches: current.projectedBytes >= haltBytes,
  fixedHaltRetained: haltBytes === 4_294_967_296,
  fixedReservationRetained: reservationBytes === 134_217_728,
  publicReaderUnchanged: checks.publicReaderUnchanged === true,
  mainnetDisabled: checks.mainnetDisabled === true,
  stabilizationUnauthorized: checks.stabilizationAuthorized === false,
  soakUnauthorized: checks.soakAuthorized === false,
}
const failedChecks = Object.entries(diagnosticChecks)
  .filter(([, passed]) => passed !== true)
  .map(([name]) => name)

const evidence = {
  purpose: diagnostic.purpose,
  sourceRunId,
  sourceCommit,
  failedBurstRunId,
  healthDiagnosticRunId,
  observedAt: diagnostic.observedAt,
  reader,
  rawRun,
  databaseBytes: integer(diagnostic.databaseBytes, 'databaseBytes'),
  latestProviderSnapshot: diagnostic.latestProviderSnapshot ?? null,
  thresholds: {
    haltBytes,
    reservationBytes,
    strictClaimCondition: 'priorBytes + reservationBytes < haltBytes',
    windowDays: 31,
  },
  current,
  attemptStatusGroups: group(attemptContributions, 'status'),
  recoveryStatusGroups: group(recoveryContributions, 'status'),
  legacySummary: {
    count: legacyContributions.length,
    effectiveBytes: legacyContributions.reduce(
      (total, row) => total + row.effectiveBytes,
      0,
    ),
  },
  fullReservationClassification: {
    openAttemptCount: openAttempts.length,
    failedOrDeferredAttemptCount: failedOrDeferredAttempts.length,
    failedOrDeferredEffectiveBytes: failedOrDeferredAttempts.reduce(
      (total, row) => total + row.effectiveBytes,
      0,
    ),
    noncompletedRecoveryCount: noncompletedRecovery.length,
    noncompletedRecoveryEffectiveBytes: noncompletedRecovery.reduce(
      (total, row) => total + row.effectiveBytes,
      0,
    ),
  },
  firstSafeAssumingNoNewContributions: firstSafe,
  releaseSchedule: releaseSchedule.slice(0, 256),
  releaseCandidateCount: releaseSchedule.length,
  contributions: {
    attempts: attemptContributions.map(({ startedAtMilliseconds, expiresAtMilliseconds, ...row }) => ({
      ...row,
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    })),
    legacyTicks: legacyContributions.map(({ startedAtMilliseconds, expiresAtMilliseconds, ...row }) => ({
      ...row,
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    })),
    recoveryBatches: recoveryContributions.map(({ startedAtMilliseconds, expiresAtMilliseconds, ...row }) => ({
      ...row,
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    })),
  },
  diagnosticChecks,
  failedChecks,
}

await mkdir(output, { recursive: true })
await writeFile(
  `${output}/diagnostic.json`,
  `${JSON.stringify(evidence, null, 2)}\n`,
)

const attemptGroupsText = evidence.attemptStatusGroups
  .map((entry) => `${entry.value}:${entry.count}/${entry.effectiveBytes}`)
  .join(',')
const recoveryGroupsText = evidence.recoveryStatusGroups
  .map((entry) => `${entry.value}:${entry.count}/${entry.effectiveBytes}`)
  .join(',')
const markdown = [
  '## R5 monthly egress halt read-only breakdown',
  '',
  `- diagnostic run: ${code(sourceRunId)}`,
  `- source commit: ${code(sourceCommit)}`,
  `- failed burst run: ${code(failedBurstRunId)}`,
  `- recovery status/error: ${code(`${reader.status}/${reader.lastError}`)}`,
  `- observed at: ${code(diagnostic.observedAt)}`,
  `- attempt conservative bytes: ${code(current.attemptBytes)}`,
  `- legacy tick conservative bytes: ${code(current.legacyBytes)}`,
  `- steady conservative bytes (max): ${code(current.steadyBytes)}`,
  `- R5 recovery conservative bytes: ${code(current.recoveryBytes)}`,
  `- prior conservative bytes: ${code(current.priorBytes)}`,
  `- one new reservation: ${code(reservationBytes)}`,
  `- projected conservative bytes: ${code(current.projectedBytes)}`,
  `- fixed halt bytes: ${code(haltBytes)}`,
  `- headroom after reservation: ${code(current.headroomAfterReservationBytes)}`,
  `- claim allowed now: ${code(current.claimAllowed)}`,
  `- attempt status groups (count/effective bytes): ${code(attemptGroupsText || 'none')}`,
  `- recovery status groups (count/effective bytes): ${code(recoveryGroupsText || 'none')}`,
  `- open attempts: ${code(openAttempts.length)}`,
  `- failed/deferred attempts: ${code(failedOrDeferredAttempts.length)}`,
  `- noncompleted recovery batches: ${code(noncompletedRecovery.length)}`,
  `- first safe time assuming no new contributions: ${code(firstSafe?.evaluatedAt ?? 'not found')}`,
  `- first safe projected bytes: ${code(firstSafe?.projectedBytes ?? 'not found')}`,
  `- release candidates evaluated: ${code(releaseSchedule.length)}`,
  `- database bytes: ${code(evidence.databaseBytes)}`,
  `- failed diagnostic checks: ${code(failedChecks.join(',') || 'none')}`,
  `- public reader unchanged: ${code(checks.publicReaderUnchanged)}`,
  `- Mainnet disabled: ${code(checks.mainnetDisabled)}`,
  `- stabilization authorized: ${code(checks.stabilizationAuthorized)}`,
  `- soak authorized: ${code(checks.soakAuthorized)}`,
  '',
].join('\n')
await writeFile(`${output}/diagnostic.md`, markdown)
process.stdout.write(markdown)

if (failedChecks.length > 0) {
  throw new Error(`diagnostic boundary failed: ${failedChecks.join(',')}`)
}
