import { parseValidatedLedgerResult } from '../collector/incremental/validated-ledger-parser'
import type { IncrementalScanResult } from '../collector/incremental/scan-validated-ledgers'
import { buildPortableXrplNormalizedWork } from '../collector/history-segments/portable-xrpl-normalization'
import { canonicalPortableJson } from './portable-collector-reference-store'
import {
  buildSupabaseRevision4DirectionalAccountingEvidence,
  SupabaseRevision4DirectionalMeter,
  utf8ByteLength,
  type SupabaseRevision4DirectionalAccountingEvidence,
  type SupabaseRevision4MeterObservation,
} from './supabase-revision4-directional-meter'

export interface SupabaseRevision4OfflineShadowFixture {
  schemaVersion: 1
  observationId: string
  attemptId: string
  observedAt: string
  sourceRunId: number
  sourceCommit: string
  network: string
  epochId: string
  baseIdentity: string
  workId: string
  previousLedgerIndex: number
  expectedParentHash: string
  unexplainedDirectionalDeltaReserveBytes: number
  normalizedObjectOverheadPerRecordBytes: number
  allocatorReserveBytes: number
  bodies: {
    invokerRequest: string
    edgeToEdgeRequest: string
    edgeToEdgeResponse: string
    serverInfoRequest: string
    serverInfoResponse: string
    databaseResponse: string
    invokerResponse: string
  }
  framingReserveBytes: {
    invokerRequest: number
    edgeToEdgeRequest: number
    edgeToEdgeResponse: number
    xrplRequest: number
    xrplResponse: number
    databaseRequest: number
    databaseResponse: number
    invokerResponse: number
  }
  ledgers: Array<{
    requestBody: string
    responseBody: string
  }>
}

export interface SupabaseRevision4OfflineShadowResult {
  schemaVersion: 1
  mode: 'offline_source_shaped_shadow'
  accountingEvidence: SupabaseRevision4DirectionalAccountingEvidence
  persistenceRpcRequestBody: string
  persistenceRpcRequestBytes: number
  fixedPointIterations: number
  normalizedWork: {
    startLedgerIndex: number
    endLedgerIndex: number
    ledgerCount: number
    inspectedTransactions: number
    lendingTransactions: number
    recordCount: number
    chunkCount: number
    payloadBytes: number
    payloadDigest: string
    semanticCountsJson: string
  }
  checks: {
    sourceResponsesParsed: true
    parentHashContinuity: true
    portableNormalizationBuilt: true
    persistenceRequestFixedPoint: true
    noNetworkRequestIssued: true
    noDatabaseRequestIssued: true
    recoveryMutationCommitted: false
    publicReaderUnchanged: true
    mainnetDisabled: true
    stabilizationAuthorized: false
    soakAuthorized: false
  }
}

function safeInteger(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer of at least ${minimum}`)
  }
  return value
}

function exactString(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be non-empty`)
  }
  return value
}

function parseJsonObject(value: string, name: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function replaceDatabaseRequestObservation(
  observations: readonly SupabaseRevision4MeterObservation[],
  bodyBytes: number,
): SupabaseRevision4MeterObservation[] {
  let replaced = false
  const result = observations.map((observation) => {
    if (observation.operationId !== 'edge.database.request.persist') {
      return { ...observation }
    }
    replaced = true
    return { ...observation, bodyBytes }
  })
  if (!replaced) throw new Error('database request placeholder unavailable')
  return result
}

function buildScan(fixture: SupabaseRevision4OfflineShadowFixture): IncrementalScanResult {
  if (fixture.ledgers.length < 1) throw new Error('fixture must contain at least one ledger')
  const parsedLedgers = fixture.ledgers.map((entry, index) => {
    const response = parseJsonObject(entry.responseBody, `ledgers[${index}].responseBody`)
    const result = response.result
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error(`ledgers[${index}].responseBody.result must be an object`)
    }
    const requestedLedgerIndex = fixture.previousLedgerIndex + index + 1
    const ledger = parseValidatedLedgerResult({
      endpoint: 'offline://r4f-g2c',
      requestedLedgerIndex,
      result: result as Record<string, unknown>,
    })
    return {
      ...ledger,
      lendingTransactions: ledger.transactions.filter((transaction) =>
        ['LoanSet', 'LoanPay', 'LoanManage', 'LoanDelete'].includes(
          transaction.transactionType,
        ),
      ),
    }
  })

  let expectedParentHash = fixture.expectedParentHash
  for (const ledger of parsedLedgers) {
    if (ledger.parentHash !== expectedParentHash) {
      throw new Error(`ledger ${ledger.ledgerIndex} parent hash mismatch`)
    }
    expectedParentHash = ledger.ledgerHash
  }

  return {
    endpoint: 'offline://r4f-g2c',
    startLedgerIndex: parsedLedgers[0]!.ledgerIndex,
    endLedgerIndex: parsedLedgers.at(-1)!.ledgerIndex,
    latestValidatedLedger: parsedLedgers.at(-1)!.ledgerIndex,
    completeToLatest: true,
    ledgers: parsedLedgers,
    metrics: {
      ledgers: parsedLedgers.length,
      inspectedTransactions: parsedLedgers.reduce(
        (sum, ledger) => sum + ledger.transactions.length,
        0,
      ),
      lendingTransactions: parsedLedgers.reduce(
        (sum, ledger) => sum + ledger.lendingTransactions.length,
        0,
      ),
      elapsedMs: 0,
    },
  }
}

export async function runSupabaseRevision4OfflineShadow(
  fixture: SupabaseRevision4OfflineShadowFixture,
): Promise<SupabaseRevision4OfflineShadowResult> {
  if (fixture.schemaVersion !== 1) throw new Error('schemaVersion must be 1')
  safeInteger(fixture.sourceRunId, 'sourceRunId', 1)
  if (!/^[a-f0-9]{40}$/u.test(fixture.sourceCommit)) {
    throw new Error('sourceCommit must be a 40-character lowercase SHA')
  }
  safeInteger(fixture.previousLedgerIndex, 'previousLedgerIndex')
  safeInteger(
    fixture.unexplainedDirectionalDeltaReserveBytes,
    'unexplainedDirectionalDeltaReserveBytes',
  )
  safeInteger(
    fixture.normalizedObjectOverheadPerRecordBytes,
    'normalizedObjectOverheadPerRecordBytes',
  )
  safeInteger(fixture.allocatorReserveBytes, 'allocatorReserveBytes')
  exactString(fixture.expectedParentHash, 'expectedParentHash')

  const scan = buildScan(fixture)
  const normalized = await buildPortableXrplNormalizedWork({
    scan,
    workId: fixture.workId,
    network: fixture.network,
    epochId: fixture.epochId,
    baseIdentity: fixture.baseIdentity,
    previousLedgerIndex: fixture.previousLedgerIndex,
    expectedParentHash: fixture.expectedParentHash,
  })
  const payloadBytes = normalized.chunks.reduce(
    (sum, chunk) => sum + chunk.encoded.byteLength,
    0,
  )
  const recordCount = normalized.payload.semanticCounts.totalRecords

  const meter = new SupabaseRevision4DirectionalMeter()
  meter.recordUtf8({
    operationId: 'invoker.edge.request.shadow',
    boundaryId: 'invoker_to_edge_request',
    body: fixture.bodies.invokerRequest,
    framingReserveBytes: fixture.framingReserveBytes.invokerRequest,
  })
  meter.recordUtf8({
    operationId: 'edge.edge.request.shadow-worker',
    boundaryId: 'edge_to_edge_request',
    body: fixture.bodies.edgeToEdgeRequest,
    framingReserveBytes: fixture.framingReserveBytes.edgeToEdgeRequest,
  })
  meter.recordUtf8({
    operationId: 'edge.edge.response.shadow-worker',
    boundaryId: 'edge_to_edge_response',
    body: fixture.bodies.edgeToEdgeResponse,
    framingReserveBytes: fixture.framingReserveBytes.edgeToEdgeResponse,
  })
  meter.recordUtf8({
    operationId: 'edge.xrpl.request.server-info',
    boundaryId: 'edge_to_xrpl_request',
    body: fixture.bodies.serverInfoRequest,
    framingReserveBytes: fixture.framingReserveBytes.xrplRequest,
  })
  meter.recordUtf8({
    operationId: 'xrpl.edge.response.server-info',
    boundaryId: 'xrpl_to_edge_response',
    body: fixture.bodies.serverInfoResponse,
    framingReserveBytes: fixture.framingReserveBytes.xrplResponse,
  })
  fixture.ledgers.forEach((entry, index) => {
    const ledgerIndex = fixture.previousLedgerIndex + index + 1
    meter.recordUtf8({
      operationId: `edge.xrpl.request.ledger.${ledgerIndex}`,
      boundaryId: 'edge_to_xrpl_request',
      body: entry.requestBody,
      framingReserveBytes: fixture.framingReserveBytes.xrplRequest,
    })
    meter.recordUtf8({
      operationId: `xrpl.edge.response.ledger.${ledgerIndex}`,
      boundaryId: 'xrpl_to_edge_response',
      body: entry.responseBody,
      framingReserveBytes: fixture.framingReserveBytes.xrplResponse,
    })
  })
  meter.recordBytes({
    operationId: 'edge.database.request.persist',
    boundaryId: 'edge_to_database_request',
    bodyBytes: 0,
    framingReserveBytes: fixture.framingReserveBytes.databaseRequest,
  })
  meter.recordUtf8({
    operationId: 'database.edge.response.persist',
    boundaryId: 'database_to_edge_response',
    body: fixture.bodies.databaseResponse,
    framingReserveBytes: fixture.framingReserveBytes.databaseResponse,
  })
  meter.recordUtf8({
    operationId: 'edge.invoker.response.shadow',
    boundaryId: 'edge_to_invoker_response',
    body: fixture.bodies.invokerResponse,
    framingReserveBytes: fixture.framingReserveBytes.invokerResponse,
  })

  const baseObservations = meter.snapshot()
  let databaseRequestBytes = 0
  let canonicalJsonBytes = 0
  for (let iteration = 1; iteration <= 32; iteration += 1) {
    const accountingEvidence =
      await buildSupabaseRevision4DirectionalAccountingEvidence({
        schemaVersion: 1,
        observationId: fixture.observationId,
        attemptId: fixture.attemptId,
        observedAt: fixture.observedAt,
        disposition: 'shadow_completed',
        observations: replaceDatabaseRequestObservation(
          baseObservations,
          databaseRequestBytes,
        ),
        memorySupplemental: {
          canonicalJsonBytes,
          payloadBytes,
          normalizedObjectOverheadBytes:
            recordCount * fixture.normalizedObjectOverheadPerRecordBytes,
          allocatorReserveBytes: fixture.allocatorReserveBytes,
        },
        unexplainedDirectionalDeltaReserveBytes:
          fixture.unexplainedDirectionalDeltaReserveBytes,
        recoveryMutationCommitted: false,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      })
    const persistenceRpcRequestBody = canonicalPortableJson({
      p_accounting_digest: accountingEvidence.accountingDigest,
      p_accounting_json: accountingEvidence.accountingJson,
      p_source_commit: fixture.sourceCommit,
      p_source_run_id: fixture.sourceRunId,
    })
    const nextDatabaseRequestBytes = utf8ByteLength(persistenceRpcRequestBody)
    const nextCanonicalJsonBytes = utf8ByteLength(accountingEvidence.accountingJson)

    if (
      nextDatabaseRequestBytes === databaseRequestBytes &&
      nextCanonicalJsonBytes === canonicalJsonBytes
    ) {
      return {
        schemaVersion: 1,
        mode: 'offline_source_shaped_shadow',
        accountingEvidence,
        persistenceRpcRequestBody,
        persistenceRpcRequestBytes: nextDatabaseRequestBytes,
        fixedPointIterations: iteration,
        normalizedWork: {
          startLedgerIndex: scan.startLedgerIndex,
          endLedgerIndex: scan.endLedgerIndex!,
          ledgerCount: scan.metrics.ledgers,
          inspectedTransactions: scan.metrics.inspectedTransactions,
          lendingTransactions: scan.metrics.lendingTransactions,
          recordCount,
          chunkCount: normalized.chunks.length,
          payloadBytes,
          payloadDigest: normalized.payload.digest,
          semanticCountsJson: normalized.semanticCountsJson,
        },
        checks: {
          sourceResponsesParsed: true,
          parentHashContinuity: true,
          portableNormalizationBuilt: true,
          persistenceRequestFixedPoint: true,
          noNetworkRequestIssued: true,
          noDatabaseRequestIssued: true,
          recoveryMutationCommitted: false,
          publicReaderUnchanged: true,
          mainnetDisabled: true,
          stabilizationAuthorized: false,
          soakAuthorized: false,
        },
      }
    }

    databaseRequestBytes = nextDatabaseRequestBytes
    canonicalJsonBytes = nextCanonicalJsonBytes
  }

  throw new Error('persistence request byte fixed point did not converge')
}
