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
const failedEgressDiagnosticRunId = 31033390052
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
    'sessionId', a.session_id,
    'attemptId', a.attempt_id,
    'status', a.status,
    'startedAt', a.started_at,
    'finalizedAt', a.finalized_at,
    'reservedBytes', a.reserved_egress_upper_bound_bytes,
    'finalizedBytes', a.finalized_egress_upper_bound_bytes,
    'effectiveBytes', case
      when a.status = 'succeeded'
        then coalesce(
          a.finalized_egress_upper_bound_bytes,
          a.reserved_egress_upper_bound_bytes
        )
      else a.reserved_egress_upper_bound_bytes
    end,
    'sessionStatus', s.status,
    'sessionResourceGuardStatus', s.resource_guard_status,
    'errorMessage', a.error_message
  ) order by a.started_at, a.session_id, a.attempt_id), '[]'::jsonb) as value
  from observed
  join xrpl_resource_guard_v2.attempts a
    on a.started_at >= observed.value - interval '31 days'
   and a.started_at <= observed.value
  left join xrpl_steady_v1.sessions s on s.session_id = a.session_id
), legacy as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', t.session_id,
    'tickId', t.tick_id,
    'recordedAt', t.recorded_at,
    'effectiveBytes', t.conservative_tick_egress_upper_bound_bytes,
    'allowed', t.allowed
  ) order by t.recorded_at, t.session_id, t.tick_id), '[]'::jsonb) as value
  from observed
  join xrpl_resource_guard_v2.tick_accounting t
    on t.recorded_at >= observed.value - interval '31 days'
   and t.recorded_at <= observed.value
), recovery as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'batchId', b.batch_id,
    'batchSequence', b.batch_sequence,
    'status', b.status,
    'claimedAt', b.claimed_at,
    'completedAt', b.completed_at,
    'reservedBytes', b.reserved_egress_upper_bound_bytes,
    'finalizedBytes', b.finalized_egress_upper_bound_bytes,
    'effectiveBytes', case
      when b.status = 'completed'
        then b.finalized_egress_upper_bound_bytes
      else b.reserved_egress_upper_bound_bytes
    end,
    'errorMessage', b.error_message
  ) order by b.claimed_at, b.batch_sequence), '[]'::jsonb) as value
  from observed
  join xrpl_r5_v1.recovery_batches b
    on b.run_id = $1::text
   and b.claimed_at >= observed.value - interval '31 days'
   and b.claimed_at <= observed.value
)
select jsonb_build_object(
  'purpose', 'r5-egress-halt-breakdown-read-only-v2',
  'observedAt', (select value from observed),
  'failedBurstRunId', $2::bigint,
  'healthDiagnosticRunId', $3::bigint,
  'failedEgressDiagnosticRunId', $4::bigint,
  'reader', public.xrpl_read_r5_active_recovery($1::text),
  'rawRun', (
    select to_jsonb(r)
    from xrpl_r5_v1.recovery_runs r
    where r.run_id = $1::text
  ),
  'attempts', (select value from attempts),
  'legacyTicks', (select value from legacy),
  'recoveryBatches', (select value from recovery),
  'databaseBytes', pg_database_size(current_database())::bigint
) as diagnostic;
`

function contribution(row, source, timeField) {
  const startedAtMilliseconds = instant(row[timeField], `${source}.${timeField}`)
  return {
    ...row,
    source,
    effectiveBytes: integer(row.effectiveBytes, `${source}.effectiveBytes`),
    startedAtMilliseconds,
    expiresAtMilliseconds: startedAtMilliseconds + windowMilliseconds,
  }
}

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

function group(contributions, field) {
  const grouped = new Map()
  for (const row of contributions) {
    const key = String(row[field] ?? 'null')
    const current = grouped.get(key) ?? {
      value: key,
      count: 0,
      effectiveBytes: 0,
      reservedBytes: 0,
      finalizedBytes: 0,
    }
    current.count += 1
    current.effectiveBytes += row.effectiveBytes
    current.reservedBytes += Number(row.reservedBytes ?? 0)
    current.finalizedBytes += Number(row.finalizedBytes ?? 0)
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((left, right) =>
    left.value.localeCompare(right.value),
  )
}

function serializeContribution(row) {
  const serialized = { ...row }
  delete serialized.startedAtMilliseconds
  delete serialized.expiresAtMilliseconds
  return {
    ...serialized,
    expiresAt: new Date(row.expiresAtMilliseconds).toISOString(),
  }
}

await mkdir(output, { recursive: true })
let retained = false
try {
  const queryRows = await query(sql, [
    recoveryRunId,
    failedBurstRunId,
    healthDiagnosticRunId,
    failedEgressDiagnosticRunId,
  ])
  if (queryRows.length !== 1) {
    throw new Error(`unexpected row count ${queryRows.length}`)
  }

  const diagnostic = object(queryRows[0].diagnostic, 'diagnostic')
  const reader = object(diagnostic.reader, 'reader')
  const rawRun = object(diagnostic.rawRun, 'rawRun')
  const checks = object(reader.checks, 'reader.checks')
  const observedAtMilliseconds = instant(diagnostic.observedAt, 'observedAt')
  const attemptContributions = list(diagnostic.attempts, 'attempts').map(
    (row) => contribution(row, 'attempt', 'startedAt'),
  )
  const legacyContributions = list(diagnostic.legacyTicks, 'legacyTicks').map(
    (row) => contribution(row, 'legacy', 'recordedAt'),
  )
  const recoveryContributions = list(
    diagnostic.recoveryBatches,
    'recoveryBatches',
  ).map((row) => contribution(row, 'recovery', 'claimedAt'))

  function totalsAt(evaluatedAtMilliseconds) {
    const attemptBytes = sumActive(
      attemptContributions,
      evaluatedAtMilliseconds,
    )
    const legacyBytes = sumActive(
      legacyContributions,
      evaluatedAtMilliseconds,
    )
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

  const current = totalsAt(observedAtMilliseconds)
  const releaseSchedule = [
    ...new Set(
      [
        ...attemptContributions,
        ...legacyContributions,
        ...recoveryContributions,
      ].map((row) => row.expiresAtMilliseconds + 1_000),
    ),
  ]
    .filter((value) => value > observedAtMilliseconds)
    .sort((left, right) => left - right)
    .map((candidate) => totalsAt(candidate))
  const firstSafe =
    releaseSchedule.find((entry) => entry.claimAllowed) ?? null
  const openAttempts = attemptContributions.filter(
    (row) => row.status === 'open',
  )
  const failedOrDeferredAttempts = attemptContributions.filter((row) =>
    ['failed', 'deferred'].includes(row.status),
  )
  const noncompletedRecovery = recoveryContributions.filter(
    (row) => row.status !== 'completed',
  )
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
    failedEgressDiagnosticRunId,
    observedAt: diagnostic.observedAt,
    reader,
    rawRun,
    databaseBytes: integer(diagnostic.databaseBytes, 'databaseBytes'),
    thresholds: {
      haltBytes,
      reservationBytes,
      strictClaimCondition: 'priorBytes + reservationBytes < haltBytes',
      windowDays: 31,
      attemptFormula: 'succeeded_finalized_else_reserved',
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
      openAttemptEffectiveBytes: openAttempts.reduce(
        (total, row) => total + row.effectiveBytes,
        0,
      ),
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
    releaseSchedule: releaseSchedule.slice(0, 512),
    releaseCandidateCount: releaseSchedule.length,
    contributions: {
      attempts: attemptContributions.map(serializeContribution),
      legacyTicks: legacyContributions.map(serializeContribution),
      recoveryBatches: recoveryContributions.map(serializeContribution),
    },
    diagnosticChecks,
    failedChecks,
  }
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
    '## R5 monthly egress halt read-only breakdown V2',
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
    `- attempt groups (count/effective): ${code(attemptGroupsText || 'none')}`,
    `- recovery groups (count/effective): ${code(recoveryGroupsText || 'none')}`,
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
  retained = true
  process.stdout.write(markdown)

  if (failedChecks.length > 0) {
    throw new Error(`diagnostic boundary failed: ${failedChecks.join(',')}`)
  }
} catch (error) {
  if (!retained) {
    const reason = error instanceof Error ? error.message : String(error)
    await writeFile(
      `${output}/diagnostic.json`,
      `${JSON.stringify(
        {
          purpose: 'r5-egress-halt-breakdown-read-only-v2',
          sourceRunId,
          sourceCommit,
          reason,
          readOnly: true,
          fixedHaltBytes: haltBytes,
          fixedReservationBytes: reservationBytes,
          publicReaderUnchanged: true,
          mainnetDisabled: true,
          stabilizationAuthorized: false,
          soakAuthorized: false,
        },
        null,
        2,
      )}\n`,
    )
    await writeFile(
      `${output}/diagnostic.md`,
      [
        '## R5 monthly egress halt read-only breakdown V2',
        '',
        `- diagnostic run: ${code(sourceRunId)}`,
        `- query failure: ${code(reason)}`,
        `- fixed halt bytes: ${code(haltBytes)}`,
        `- fixed reservation bytes: ${code(reservationBytes)}`,
        `- read-only: ${code(true)}`,
        '',
      ].join('\n'),
    )
  }
  throw error
}
