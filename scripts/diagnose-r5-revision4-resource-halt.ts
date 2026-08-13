import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { isLendingTransactionType } from '../src/collector/incremental/lending-transaction-types.ts'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from '../src/collector/incremental/read-validated-ledger.ts'
import {
  buildPortableXrplNormalizedWork,
  portableReferenceRowsFromChunk,
} from '../src/collector/history-segments/portable-xrpl-normalization.ts'
import { buildPortableCollectorWorkId } from '../src/shared/portable-collector-planner.ts'
import { canonicalPortableJson } from '../src/shared/portable-collector-reference-store.ts'
import {
  resolveSupabaseRevision4R5CompletionFixedPoint,
} from '../src/shared/supabase-revision4-r5-runtime-accounting.ts'
import {
  SUPABASE_REVISION4_FIXED_GUARDS,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from '../src/shared/supabase-revision4-directional-egress-contract.ts'

const RUN_ID = 'r5-recovery-selected-revision4-entry'
const ENDPOINT = 'https://s.devnet.rippletest.net:51234/'
const LEASE_SECONDS = 55
const EARLY_RSS_HALT_BYTES = 200 * 1024 * 1024
const MAX_CLAIM_RESPONSE_BYTES = 64 * 1024
const COMPLETION_RESPONSE_RESERVE_BYTES = 4 * 1024
const TEXT_ENCODER = new TextEncoder()

function bytes(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength
}

function integer(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) throw new Error(`${name} invalid`)
  return Number(parsed)
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} invalid`)
  return value
}

function hash(value: unknown, name: string): string {
  const normalized = stringValue(value, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(normalized)) throw new Error(`${name} invalid`)
  return normalized
}

async function sha256Hex(value: string): Promise<string> {
  const data = TEXT_ENCODER.encode(value)
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')
}

function stripSha256(value: string, name: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${name} invalid`)
  return value.slice('sha256:'.length)
}

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const outputPath = process.argv[2] ?? 'r5-revision4-resource-halt-diagnostic/diagnostic.json'
if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID invalid')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN unavailable')

const managementEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

function rows(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    for (const candidate of [record.result, record.data, record.rows]) {
      if (Array.isArray(candidate)) return candidate as Array<Record<string, unknown>>
    }
    for (const container of [record.result, record.data]) {
      if (container && typeof container === 'object') {
        const nested = container as Record<string, unknown>
        if (Array.isArray(nested.rows)) return nested.rows as Array<Record<string, unknown>>
      }
    }
  }
  throw new Error('Management API response contains no rows')
}

async function query(sql: string, parameters: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(managementEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql, parameters, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Management API read failed (${response.status}):${text.slice(0, 1000)}`)
  return rows(JSON.parse(text) as unknown)
}

const stateRows = await query(
  `select to_jsonb(r) as run,
          (select to_jsonb(b)
             from xrpl_r5_v1.recovery_batches b
            where b.run_id = r.run_id
            order by b.batch_sequence desc, b.batch_id desc
            limit 1) as batch
     from xrpl_r5_v1.recovery_runs r
    where r.run_id = $1::text`,
  [RUN_ID],
)
if (stateRows.length !== 1) throw new Error(`expected one R5 run, found ${stateRows.length}`)
const run = stateRows[0]!.run as Record<string, unknown>
const batch = stateRows[0]!.batch as Record<string, unknown>
if (!run || !batch) throw new Error('halted R5 run/batch missing')

if (
  run.status !== 'halted'
  || run.last_error !== 'revision4_resource_halt'
  || integer(run.profile_revision, 'run.profile_revision') !== 4
  || run.profile_identity_digest !== SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  || integer(run.completed_batches, 'run.completed_batches') !== 0
  || integer(run.committed_ledgers, 'run.committed_ledgers') !== 0
  || run.last_accounting_digest !== null
) throw new Error('R5 run is not the zero-progress revision4 resource halt')

const ledgerCount = integer(batch.ledger_count, 'batch.ledger_count')
const startLedgerIndex = integer(batch.start_ledger_index, 'batch.start_ledger_index')
const endLedgerIndex = integer(batch.end_ledger_index, 'batch.end_ledger_index')
const batchSequence = integer(batch.batch_sequence, 'batch.batch_sequence')
const batchId = stringValue(batch.batch_id, 'batch.batch_id')
const expectedParentHash = hash(batch.expected_parent_hash, 'batch.expected_parent_hash')
const reservedEgressBytes = integer(batch.reserved_egress_upper_bound_bytes, 'batch.reserved_egress_upper_bound_bytes')
const priorEgress31dBytes = integer(batch.prior_conservative_egress_31d_bytes, 'batch.prior_conservative_egress_31d_bytes')
const projectedInvocations31d = integer(batch.projected_invocations_31d, 'batch.projected_invocations_31d')
const baseIdentity = stringValue(run.base_identity, 'run.base_identity')
const network = stringValue(run.network, 'run.network')
const epochId = stringValue(run.epoch_id, 'run.epoch_id')
if (
  batch.status !== 'halted'
  || batch.error_message !== 'revision4_resource_halt'
  || ledgerCount !== 12
  || endLedgerIndex !== startLedgerIndex + ledgerCount - 1
  || batch.accounting_digest !== null
  || batch.finalized_egress_upper_bound_bytes !== null
  || batch.failure_reservation_retained !== false
  || network !== 'devnet'
  || epochId !== 'supabase-r4c2c-v1'
) throw new Error('halted batch shape changed')

let xrplRequestBytes = 0
let xrplRequestCount = 0
let xrplResponseBytes = 0
let xrplResponseCount = 0

async function rpc(method: string, params: Record<string, unknown>, maxBytes: number): Promise<Record<string, unknown>> {
  const body = JSON.stringify({ method, params: [{ ...params, api_version: 2 }] })
  xrplRequestBytes += bytes(body)
  xrplRequestCount += 1
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  xrplResponseBytes += bytes(text)
  xrplResponseCount += 1
  if (bytes(text) > maxBytes) throw new Error(`${method} response exceeds production cap`)
  if (!response.ok) throw new Error(`${method} failed:${response.status}`)
  const payload = JSON.parse(text) as { result?: Record<string, unknown> }
  if (!payload.result || typeof payload.result.error === 'string') {
    throw new Error(`${method} returned XRPL error`)
  }
  return payload.result
}

// Production R5 performs one server_info request before the exact ledger range.
await rpc('server_info', {}, 256 * 1024)

const ledgers: ValidatedLedgerRead[] = []
for (let ledgerIndex = startLedgerIndex; ledgerIndex <= endLedgerIndex; ledgerIndex += 1) {
  const result = await rpc('ledger', {
    ledger_index: ledgerIndex,
    transactions: true,
    expand: true,
    owner_funds: false,
  }, 1024 * 1024)
  const parsed = parseValidatedLedgerResult({
    endpoint: ENDPOINT,
    requestedLedgerIndex: ledgerIndex,
    result,
  })
  ledgers.push({
    ...parsed,
    ledgerHash: parsed.ledgerHash.toUpperCase(),
    parentHash: parsed.parentHash.toUpperCase(),
    transactions: parsed.transactions.map((transaction) => ({
      ...transaction,
      hash: transaction.hash.toUpperCase(),
    })),
  })
}

let continuityHash = expectedParentHash
for (const [offset, ledger] of ledgers.entries()) {
  const expectedIndex = startLedgerIndex + offset
  if (ledger.ledgerIndex !== expectedIndex || ledger.parentHash !== continuityHash) {
    throw new Error(`historical continuity failed at ${expectedIndex}`)
  }
  continuityHash = ledger.ledgerHash
}

type Scan = {
  endpoint: string
  startLedgerIndex: number
  endLedgerIndex: number
  latestValidatedLedger: number
  completeToLatest: boolean
  ledgers: Array<ValidatedLedgerRead & { lendingTransactions: ValidatedLedgerRead['transactions'] }>
  metrics: { ledgers: number; inspectedTransactions: number; lendingTransactions: number; elapsedMs: number }
}

function oneLedgerScan(ledger: ValidatedLedgerRead): Scan {
  const lendingTransactions = ledger.transactions.filter((transaction) =>
    isLendingTransactionType(transaction.transactionType),
  )
  return {
    endpoint: ENDPOINT,
    startLedgerIndex: ledger.ledgerIndex,
    endLedgerIndex: ledger.ledgerIndex,
    latestValidatedLedger: ledger.ledgerIndex,
    completeToLatest: true,
    ledgers: [{ ...ledger, lendingTransactions }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: ledger.transactions.length,
      lendingTransactions: lendingTransactions.length,
      elapsedMs: 0,
    },
  }
}

const works: Record<string, unknown>[] = []
let payloadBytes = 0
let previousLedgerIndex = startLedgerIndex - 1
continuityHash = expectedParentHash
for (const ledger of ledgers) {
  const workId = buildPortableCollectorWorkId({
    network: 'devnet',
    epochId: 'supabase-r4c2c-v1',
    baseIdentity,
    previousLedgerIndex,
    expectedParentHash: continuityHash,
  })
  const normalized = await buildPortableXrplNormalizedWork({
    scan: oneLedgerScan(ledger) as never,
    workId,
    network: 'devnet',
    epochId: 'supabase-r4c2c-v1',
    baseIdentity,
    previousLedgerIndex,
    expectedParentHash: continuityHash,
  })
  const chunks = await Promise.all(normalized.chunks.map(async (built) => {
    payloadBytes += bytes(built.encodedJson)
    const referenceRowsJson = canonicalPortableJson(portableReferenceRowsFromChunk(built.chunk))
    return {
      chunkIndex: built.chunk.chunkIndex,
      totalChunks: built.chunk.totalChunks,
      payloadJson: built.encodedJson,
      chunkDigest: stripSha256(built.chunk.chunkDigest, 'chunkDigest'),
      encodedDigest: await sha256Hex(built.encodedJson),
      byteCount: bytes(built.encodedJson),
      recordCount: built.chunk.records.length,
      referenceRowsJson,
      referenceRowsDigest: await sha256Hex(referenceRowsJson),
    }
  }))
  works.push({
    workId,
    previousLedgerIndex,
    startLedgerIndex: ledger.ledgerIndex,
    scannedEndLedgerIndex: ledger.ledgerIndex,
    expectedParentHash: continuityHash,
    finalLedgerHash: ledger.ledgerHash,
    planJson: canonicalPortableJson({
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'supabase-r4c2c-v1',
      baseIdentity,
      previousLedgerIndex,
      expectedParentHash: continuityHash,
      plannedEndLedgerIndex: ledger.ledgerIndex,
    }),
    semanticCountsJson: normalized.semanticCountsJson,
    payloadDigest: stripSha256(normalized.payload.digest, 'payloadDigest'),
    chunks,
  })
  previousLedgerIndex = ledger.ledgerIndex
  continuityHash = ledger.ledgerHash
}

const worksJson = canonicalPortableJson(works)
const worksDigest = await sha256Hex(worksJson)
const canonicalJsonBytes = bytes(worksJson)
const owner = `r5-recovery-${'0'.repeat(8)}-${'0'.repeat(4)}-${'0'.repeat(4)}-${'0'.repeat(4)}-${'0'.repeat(12)}`
const claimRequestBody = JSON.stringify({
  p_run_id: RUN_ID,
  p_owner: owner,
  p_now: '2026-08-13T09:15:40.000Z',
  p_lease_seconds: LEASE_SECONDS,
})
const invokerRequestBody = JSON.stringify({
  source: 'github_actions',
  run_id: RUN_ID,
  scheduler_source: 'pg_cron',
  minute_execution_id: '00000000-0000-0000-0000-000000000000',
  minute_batch_ordinal: 1,
  qualification_override: false,
})

const observedHead = {
  index: integer(batch.observed_head_ledger_index, 'batch.observed_head_ledger_index'),
  hash: hash(batch.observed_head_ledger_hash, 'batch.observed_head_ledger_hash'),
}

async function resolveBound(options: { claimResponseBytes: number; allocatorReserveBytes: number }) {
  let invokerResponseBytes = 0
  let result: Awaited<ReturnType<typeof resolveSupabaseRevision4R5CompletionFixedPoint>> | null = null
  let successBytes = 0
  for (let iteration = 1; iteration <= 32; iteration += 1) {
    const resolved = await resolveSupabaseRevision4R5CompletionFixedPoint({
      observationId: `r5.rev4.${batchId}`,
      attemptId: `r5.rev4.${batchId}.attempt.${batchSequence}`,
      observedAt: '2026-08-13T09:15:42.000Z',
      invokerRequestBytes: bytes(invokerRequestBody),
      invokerRequestCount: 1,
      xrplRequestBytes,
      xrplRequestCount,
      xrplResponseBytes,
      xrplResponseCount,
      databaseRequestBytesBeforeCompletion: bytes(claimRequestBody),
      databaseRequestCountBeforeCompletion: 1,
      databaseResponseBytes: options.claimResponseBytes + COMPLETION_RESPONSE_RESERVE_BYTES,
      databaseResponseCount: 2,
      invokerResponseBytes,
      invokerResponseCount: 1,
      canonicalJsonBytes,
      payloadBytes,
      normalizedObjectOverheadBytes: canonicalJsonBytes,
      allocatorReserveBytes: options.allocatorReserveBytes,
      unexplainedDirectionalDeltaReserveBytes: 0,
    }, ({ accountingJson, accountingDigest, finalizedEgressUpperBoundBytes }) => ({
      p_run_id: RUN_ID,
      p_batch_id: batchId,
      p_owner: owner,
      p_completed_at: '2026-08-13T09:15:42.000Z',
      p_works_json: worksJson,
      p_works_digest: worksDigest,
      p_accounting_json: accountingJson,
      p_accounting_digest: accountingDigest,
      p_finalized_egress_upper_bound_bytes: finalizedEgressUpperBoundBytes,
      p_fetch_milliseconds: 0,
      p_normalize_milliseconds: 0,
      p_edge_wall_milliseconds: 0,
    }))
    const accounting = resolved.accountingEvidence.accounting
    const candidate = {
      ok: true,
      claimed: true,
      runId: RUN_ID,
      batchId,
      batchSequence,
      startLedgerIndex,
      endLedgerIndex,
      ledgerCount,
      validatedHead: observedHead,
      fetchMilliseconds: 0,
      normalizeMilliseconds: 0,
      edgeWallMilliseconds: 0,
      memoryHighWaterBytes: options.allocatorReserveBytes,
      memorySampleCount: 6,
      worksDigest,
      accountingDigest: resolved.accountingEvidence.accountingDigest,
      accountingProfileRevision: 4,
      finalizedEgressUpperBoundBytes: accounting.rollingBillableEgressUpperBoundBytes,
      projectedConservativeEgress31dBytes:
        priorEgress31dBytes + accounting.rollingBillableEgressUpperBoundBytes,
      projectedInvocations31d,
      completionAcknowledged: true,
      activeMutationCommitted: true,
      boundaries: {
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationNotStarted: true,
        soakNotStarted: true,
      },
    }
    successBytes = bytes(JSON.stringify(candidate))
    if (successBytes === invokerResponseBytes) {
      result = resolved
      break
    }
    invokerResponseBytes = successBytes
  }
  if (!result) throw new Error('diagnostic fixed point did not converge')
  return { result, successBytes }
}

// Egress lower bound: omit the unknown claim-response body while retaining the
// production completion-response reserve and all framing/counts that must exist.
const lower = await resolveBound({ claimResponseBytes: 0, allocatorReserveBytes: 0 })
// Memory upper bound while the executor can still reach revision4_resource_halt:
// use the maximum allowed claim response and an RSS allocator reserve one byte
// below the separate 200 MiB early halt.
const upper = await resolveBound({
  claimResponseBytes: MAX_CLAIM_RESPONSE_BYTES,
  allocatorReserveBytes: EARLY_RSS_HALT_BYTES - 1,
})

const egressLowerBytes = lower.result.accountingEvidence.accounting.rollingBillableEgressUpperBoundBytes
const egressUpperBytes = upper.result.accountingEvidence.accounting.rollingBillableEgressUpperBoundBytes
const memoryUpperBeforeEarlyRssHalt = upper.result.accountingEvidence.accounting.memoryTransportUpperBoundBytes
const projectEgressHeadroomBeforeBatch = SUPABASE_REVISION4_FIXED_GUARDS.projectEgressHalt31dBytes - priorEgress31dBytes
const batchEgressProven = egressLowerBytes >= reservedEgressBytes
const memoryHaltPossible = memoryUpperBeforeEarlyRssHalt >= SUPABASE_REVISION4_FIXED_GUARDS.projectMemoryHaltBytes
const projectEgressHaltPossible = egressUpperBytes >= projectEgressHeadroomBeforeBatch
let classification = 'ambiguous'
if (batchEgressProven) classification = 'batch_egress_proven'
else if (!memoryHaltPossible && !projectEgressHaltPossible && egressUpperBytes < reservedEgressBytes) {
  classification = 'no_resource_halt_reproduced'
} else if (!memoryHaltPossible && !projectEgressHaltPossible) {
  classification = 'batch_egress_possible_claim_response_unknown'
} else if (memoryHaltPossible && egressUpperBytes < reservedEgressBytes && !projectEgressHaltPossible) {
  classification = 'memory_possible'
}

const evidence = {
  schemaVersion: 1,
  purpose: 'r5-revision4-resource-halt-read-only-reproduction',
  sourceCommit: process.env.GITHUB_SHA ?? null,
  runId: RUN_ID,
  batchId,
  range: { startLedgerIndex, endLedgerIndex, ledgerCount, expectedParentHash },
  historicalLedgerContinuityVerified: true,
  normalizedWorks: works.length,
  payloadBytes,
  canonicalJsonBytes,
  xrplTransport: {
    requestCount: xrplRequestCount,
    requestBytes: xrplRequestBytes,
    responseCount: xrplResponseCount,
    responseBytes: xrplResponseBytes,
  },
  guards: {
    reservedEgressBytes,
    projectMemoryHaltBytes: SUPABASE_REVISION4_FIXED_GUARDS.projectMemoryHaltBytes,
    earlyRssHaltBytes: EARLY_RSS_HALT_BYTES,
    projectEgressHalt31dBytes: SUPABASE_REVISION4_FIXED_GUARDS.projectEgressHalt31dBytes,
    priorEgress31dBytes,
    projectEgressHeadroomBeforeBatch,
  },
  bounds: {
    egressLowerBytes,
    egressUpperBytes,
    memoryUpperBeforeEarlyRssHalt,
    lowerCompletionRequestBytes: lower.result.completionRequestBytes,
    upperCompletionRequestBytes: upper.result.completionRequestBytes,
    lowerSuccessResponseBytes: lower.successBytes,
    upperSuccessResponseBytes: upper.successBytes,
  },
  verdict: {
    classification,
    batchEgressProven,
    memoryHaltPossible,
    projectEgressHaltPossible,
  },
  safety: {
    productionDatabaseReadOnly: true,
    noRunMutation: true,
    noBatchMutation: true,
    noPublicReaderMutation: true,
    mainnetDisabled: true,
  },
  evidenceDigest: '',
  generatedAt: new Date().toISOString(),
}
const canonicalForDigest = JSON.stringify({ ...evidence, evidenceDigest: '' })
evidence.evidenceDigest = createHash('sha256').update(canonicalForDigest).digest('hex')
await mkdir(outputPath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify(evidence))
