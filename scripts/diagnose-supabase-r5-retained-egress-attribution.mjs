import { mkdir, writeFile } from 'node:fs/promises'

import { summarizeR5RecoveryEgressAttribution } from '../src/shared/r5-retained-egress-attribution.ts'

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
const output = 'supabase-r5-retained-egress-attribution'
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

function nullableInteger(value, name) {
  return value === null || value === undefined ? null : integer(value, name)
}

function ratio(value) {
  return value === null ? null : Number(value.toFixed(6))
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
    signal: AbortSignal.timeout(90_000),
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
    'status', a.status,
    'effectiveBytes', case
      when a.status = 'succeeded'
        then coalesce(
          a.finalized_egress_upper_bound_bytes,
          a.reserved_egress_upper_bound_bytes
        )
      else a.reserved_egress_upper_bound_bytes
    end
  ) order by a.started_at, a.session_id, a.attempt_id), '[]'::jsonb) as value
  from observed
  join xrpl_resource_guard_v2.attempts a
    on a.started_at >= observed.value - interval '31 days'
   and a.started_at <= observed.value
), legacy as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'effectiveBytes', t.conservative_tick_egress_upper_bound_bytes
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
    'ledgerCount', b.ledger_count,
    'startLedgerIndex', b.start_ledger_index,
    'endLedgerIndex', b.end_ledger_index,
    'claimedAt', b.claimed_at,
    'completedAt', b.completed_at,
    'reservedBytes', b.reserved_egress_upper_bound_bytes,
    'finalizedBytes', b.finalized_egress_upper_bound_bytes,
    'effectiveBytes', case
      when b.status = 'completed'
        then b.finalized_egress_upper_bound_bytes
      else b.reserved_egress_upper_bound_bytes
    end,
    'retainedPayloadBytes', (
      select coalesce(sum(c.byte_count), 0)::bigint
      from public.xrpl_phase_work w
      join public.xrpl_phase_payload_chunks c on c.work_id = w.work_id
      where w.profile_id = 'supabase-devnet'
        and w.start_ledger_index between b.start_ledger_index and b.end_ledger_index
    ),
    'retainedPayloadChunkCount', (
      select count(*)::bigint
      from public.xrpl_phase_work w
      join public.xrpl_phase_payload_chunks c on c.work_id = w.work_id
      where w.profile_id = 'supabase-devnet'
        and w.start_ledger_index between b.start_ledger_index and b.end_ledger_index
    ),
    'retainedNormalizedRecordCount', (
      select count(*)::bigint
      from public.xrpl_phase_work w
      join public.xrpl_phase_reference_rows r on r.work_id = w.work_id
      where w.profile_id = 'supabase-devnet'
        and w.start_ledger_index between b.start_ledger_index and b.end_ledger_index
    ),
    'retainedRelationshipCount', (
      select coalesce(sum(jsonb_array_length(r.relationship_ids)), 0)::bigint
      from public.xrpl_phase_work w
      join public.xrpl_phase_reference_rows r on r.work_id = w.work_id
      where w.profile_id = 'supabase-devnet'
        and w.start_ledger_index between b.start_ledger_index and b.end_ledger_index
    ),
    'retainedInspectedTransactionCount', (
      select coalesce(sum(
        case
          when r.value_json is null then 0
          else (r.value_json::jsonb->>'inspectedTransactions')::bigint
        end
      ), 0)::bigint
      from public.xrpl_phase_work w
      join public.xrpl_phase_reference_rows r on r.work_id = w.work_id
      where w.profile_id = 'supabase-devnet'
        and w.start_ledger_index between b.start_ledger_index and b.end_ledger_index
        and r.semantic_class = 'validated-ledger'
    )
  ) order by b.batch_sequence), '[]'::jsonb) as value
  from observed
  join xrpl_r5_v1.recovery_batches b
    on b.run_id = $1::text
   and b.claimed_at >= observed.value - interval '31 days'
   and b.claimed_at <= observed.value
)
select jsonb_build_object(
  'purpose', 'r5-retained-egress-attribution-read-only-v1',
  'observedAt', (select value from observed),
  'reader', public.xrpl_read_r5_active_recovery($1::text),
  'attempts', (select value from attempts),
  'legacyTicks', (select value from legacy),
  'recoveryBatches', (select value from recovery),
  'databaseBytes', pg_database_size(current_database())::bigint
) as diagnostic;
`

await mkdir(output, { recursive: true })
let retained = false
try {
  const queryRows = await query(sql, [recoveryRunId])
  if (queryRows.length !== 1) {
    throw new Error(`unexpected row count ${queryRows.length}`)
  }

  const diagnostic = object(queryRows[0].diagnostic, 'diagnostic')
  const reader = object(diagnostic.reader, 'reader')
  const checks = object(reader.checks, 'reader.checks')
  const attempts = list(diagnostic.attempts, 'attempts')
  const legacyTicks = list(diagnostic.legacyTicks, 'legacyTicks')
  const recoveryBatches = list(diagnostic.recoveryBatches, 'recoveryBatches')

  const attemptBytes = attempts.reduce(
    (total, row, index) =>
      total + integer(row.effectiveBytes, `attempts.${index}.effectiveBytes`),
    0,
  )
  const legacyBytes = legacyTicks.reduce(
    (total, row, index) =>
      total + integer(row.effectiveBytes, `legacy.${index}.effectiveBytes`),
    0,
  )
  const steadyBytes = Math.max(attemptBytes, legacyBytes)

  const attributionInputs = recoveryBatches.map((row, index) => ({
    batchId: String(row.batchId ?? ''),
    status: String(row.status ?? ''),
    ledgerCount: integer(row.ledgerCount, `recovery.${index}.ledgerCount`),
    reservedBytes: integer(row.reservedBytes, `recovery.${index}.reservedBytes`),
    finalizedBytes: nullableInteger(
      row.finalizedBytes,
      `recovery.${index}.finalizedBytes`,
    ),
    effectiveBytes: integer(row.effectiveBytes, `recovery.${index}.effectiveBytes`),
  }))
  const recoveryAttribution = summarizeR5RecoveryEgressAttribution(
    attributionInputs,
  )
  const recoveryBytes = recoveryAttribution.effectiveBytes
  const priorBytes = steadyBytes + recoveryBytes

  const retainedStats = recoveryBatches.reduce(
    (totals, row, index) => ({
      payloadBytes:
        totals.payloadBytes +
        integer(row.retainedPayloadBytes, `recovery.${index}.retainedPayloadBytes`),
      payloadChunkCount:
        totals.payloadChunkCount +
        integer(
          row.retainedPayloadChunkCount,
          `recovery.${index}.retainedPayloadChunkCount`,
        ),
      normalizedRecordCount:
        totals.normalizedRecordCount +
        integer(
          row.retainedNormalizedRecordCount,
          `recovery.${index}.retainedNormalizedRecordCount`,
        ),
      relationshipCount:
        totals.relationshipCount +
        integer(
          row.retainedRelationshipCount,
          `recovery.${index}.retainedRelationshipCount`,
        ),
      inspectedTransactionCount:
        totals.inspectedTransactionCount +
        integer(
          row.retainedInspectedTransactionCount,
          `recovery.${index}.retainedInspectedTransactionCount`,
        ),
    }),
    {
      payloadBytes: 0,
      payloadChunkCount: 0,
      normalizedRecordCount: 0,
      relationshipCount: 0,
      inspectedTransactionCount: 0,
    },
  )

  const completedBatchCount =
    recoveryAttribution.completedExecutorBatchCount +
    recoveryAttribution.adoptedBatchCount
  const committedLedgerCount =
    recoveryAttribution.executorLedgerCount + recoveryAttribution.adoptedLedgerCount
  const diagnosticChecks = {
    readOnly: true,
    exactRecoveryRun: reader.runId === recoveryRunId,
    cleanHaltedBoundary:
      reader.status === 'halted' &&
      reader.lastError === 'r5_recovery_monthly_egress_halt' &&
      integer(reader.activeBatchCount, 'reader.activeBatchCount') === 0 &&
      integer(reader.noncommittedWorkCount, 'reader.noncommittedWorkCount') === 0,
    recoveryAttributionReconciles: recoveryAttribution.reconciled,
    completedBatchCountReconciles:
      completedBatchCount === integer(reader.completedBatches, 'reader.completedBatches'),
    committedLedgerCountReconciles:
      committedLedgerCount === integer(reader.committedLedgers, 'reader.committedLedgers'),
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
    observedAt: diagnostic.observedAt,
    reader,
    databaseBytes: integer(diagnostic.databaseBytes, 'databaseBytes'),
    rollingSources: {
      attemptBytes,
      legacyBytes,
      selectedSteadyBytes: steadyBytes,
      recoveryBytes,
      priorConservativeBytes: priorBytes,
      selectedSteadySource:
        attemptBytes >= legacyBytes ? 'attempts' : 'legacy_ticks',
      legacyShadowedBytes:
        attemptBytes >= legacyBytes ? legacyBytes : attemptBytes,
    },
    recoveryAttribution: {
      ...recoveryAttribution,
      deterministicFloorShareOfExecutorBytes: ratio(
        recoveryAttribution.deterministicFloorShareOfExecutorBytes,
      ),
    },
    retainedStats,
    unavailableExactInputs: [
      'per-batch XRPL request bytes',
      'per-batch XRPL response bytes',
      'per-batch claim RPC request bytes',
      'per-batch claim RPC response bytes',
      'per-batch total metadata node count',
      'original accounting JSON (only its digest is retained)',
    ],
    interpretation: {
      deterministicFloorIncludes:
        '2 MiB completion request reserve, 16 KiB failure request reserve, two 64 KiB database response reserves, 128 KiB function response reserve, request-count overheads, and the 64 KiB fixed tick overhead',
      unretainedConservativeBytesMeaning:
        'four times the aggregate actual pre-completion network and claim-RPC wire bytes not separable by direction from retained data',
      retainedPayloadBytesAreContextOnly:
        'payload bytes are retained in phase tables but were covered by the fixed completion request reserve rather than added separately to finalized egress',
      providerEgressClaimed: false,
    },
    contributions: {
      recoveryBatches: recoveryBatches.map((row, index) => ({
        ...row,
        attribution: recoveryAttribution.batches[index],
      })),
    },
    diagnosticChecks,
    failedChecks,
  }

  await writeFile(
    `${output}/attribution.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )

  const floorPercent = recoveryAttribution.deterministicFloorShareOfExecutorBytes === null
    ? 'n/a'
    : `${(
      recoveryAttribution.deterministicFloorShareOfExecutorBytes * 100
    ).toFixed(2)}%`
  const markdown = [
    '## R5 retained egress attribution — read-only',
    '',
    `- diagnostic run: ${code(sourceRunId)}`,
    `- source commit: ${code(sourceCommit)}`,
    `- observed at: ${code(diagnostic.observedAt)}`,
    `- recovery status/error: ${code(`${reader.status}/${reader.lastError}`)}`,
    `- completed executor batches: ${code(recoveryAttribution.completedExecutorBatchCount)}`,
    `- adopted zero-egress batches: ${code(recoveryAttribution.adoptedBatchCount)}`,
    `- full-reservation recovery batches: ${code(recoveryAttribution.fullReservationBatchCount)}`,
    `- executor/adopted ledgers: ${code(`${recoveryAttribution.executorLedgerCount}/${recoveryAttribution.adoptedLedgerCount}`)}`,
    `- recovery conservative bytes: ${code(recoveryBytes)}`,
    `- deterministic conservative floor: ${code(recoveryAttribution.deterministicConservativeFloorBytes)}`,
    `- unretained variable conservative bytes: ${code(recoveryAttribution.unretainedConservativeBytes)}`,
    `- full reservation bytes: ${code(recoveryAttribution.fullReservationBytes)}`,
    `- deterministic floor share of executor bytes: ${code(floorPercent)}`,
    `- retained normalized payload bytes: ${code(retainedStats.payloadBytes)}`,
    `- retained chunks/records/relationships: ${code(`${retainedStats.payloadChunkCount}/${retainedStats.normalizedRecordCount}/${retainedStats.relationshipCount}`)}`,
    `- retained inspected transactions: ${code(retainedStats.inspectedTransactionCount)}`,
    `- selected steady/recovery/prior bytes: ${code(`${steadyBytes}/${recoveryBytes}/${priorBytes}`)}`,
    `- exact per-direction wire attribution available: ${code(false)}`,
    `- provider-reported egress claimed: ${code(false)}`,
    `- failed diagnostic checks: ${code(failedChecks.join(',') || 'none')}`,
    `- public reader unchanged: ${code(checks.publicReaderUnchanged)}`,
    `- Mainnet disabled: ${code(checks.mainnetDisabled)}`,
    `- stabilization authorized: ${code(checks.stabilizationAuthorized)}`,
    `- soak authorized: ${code(checks.soakAuthorized)}`,
    '',
  ].join('\n')
  await writeFile(`${output}/attribution.md`, markdown)
  retained = true
  process.stdout.write(markdown)

  if (failedChecks.length > 0) {
    throw new Error(`diagnostic boundary failed: ${failedChecks.join(',')}`)
  }
} catch (error) {
  if (!retained) {
    const reason = error instanceof Error ? error.message : String(error)
    await writeFile(
      `${output}/attribution.json`,
      `${JSON.stringify({
        purpose: 'r5-retained-egress-attribution-read-only-v1',
        sourceRunId,
        sourceCommit,
        reason,
        readOnly: true,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      }, null, 2)}\n`,
    )
    await writeFile(
      `${output}/attribution.md`,
      [
        '## R5 retained egress attribution — read-only',
        '',
        `- diagnostic run: ${code(sourceRunId)}`,
        `- query failure: ${code(reason)}`,
        `- read-only: ${code(true)}`,
        '',
      ].join('\n'),
    )
  }
  throw error
}
