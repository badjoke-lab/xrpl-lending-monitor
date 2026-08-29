import {
  buildNormalizedCollectorPayload,
  buildNormalizedPayloadChunks,
  type BuiltNormalizedPayloadChunkV1,
  type NormalizedCollectorPayloadV1,
  type SemanticCountsV1,
} from '../../shared/portable-collector-payload'
import { canonicalPortableJson } from '../../shared/portable-collector-reference-store'
import type { IncrementalScanResult } from '../incremental/scan-validated-ledgers'
import { buildPortableXrplNormalizedWork } from './portable-xrpl-normalization'

export interface DeferredHistoryCountsV1 {
  protocolEvents: number
  objectChanges: number
  loanLifecycleEvents: number
  archivedObjects: number
  balanceHistory: number
  totalRecords: number
}

export interface PortableCurrentStateNormalizedWorkV1 {
  payload: NormalizedCollectorPayloadV1
  chunks: BuiltNormalizedPayloadChunkV1[]
  semanticCountsJson: string
  deferredHistoryCounts: DeferredHistoryCountsV1
  deferredHistoryCountsJson: string
}

function deferredHistoryCounts(counts: SemanticCountsV1): DeferredHistoryCountsV1 {
  const deferred = {
    protocolEvents: counts.protocolEvents,
    objectChanges: counts.objectChanges,
    loanLifecycleEvents: counts.loanLifecycleEvents,
    archivedObjects: counts.archivedObjects,
    balanceHistory: counts.balanceHistory,
  }
  return {
    ...deferred,
    totalRecords: Object.values(deferred).reduce((total, count) => total + count, 0),
  }
}

/**
 * Build the persistence payload required to advance only the public current-state
 * projection. The validated-ledger witness and current-projection mutations are
 * retained; history semantic classes are intentionally deferred.
 *
 * This function does not authorize a production split by itself. Callers must
 * commit this payload behind a current-state watermark that is independent from
 * the history watermark. Advancing the history watermark with this payload is a
 * contract violation.
 *
 * The first implementation reuses the proven seven-class derivation and filters
 * only at the persistence boundary. That deliberately prioritizes semantic parity
 * over CPU optimization; a later change may derive the current projection
 * directly after parity fixtures prove equivalence.
 */
export async function buildPortableCurrentStateNormalizedWork(options: {
  scan: IncrementalScanResult
  workId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  expectedParentHash: string
}): Promise<PortableCurrentStateNormalizedWorkV1> {
  const complete = await buildPortableXrplNormalizedWork(options)
  const source = complete.payload
  const payload = await buildNormalizedCollectorPayload({
    workId: source.workId,
    network: source.network,
    epochId: source.epochId,
    baseIdentity: source.baseIdentity,
    previousLedgerIndex: source.previousLedgerIndex,
    expectedParentHash: source.expectedParentHash,
    startLedgerIndex: source.startLedgerIndex,
    endLedgerIndex: source.endLedgerIndex,
    finalLedgerHash: source.finalLedgerHash,
    ledgers: source.ledgers,
    protocolEvents: [],
    objectChanges: [],
    loanLifecycleEvents: [],
    archivedObjects: [],
    balanceHistory: [],
    currentProjectionMutations: source.currentProjectionMutations,
  })
  const deferred = deferredHistoryCounts(source.semanticCounts)

  return {
    payload,
    chunks: await buildNormalizedPayloadChunks(payload),
    semanticCountsJson: canonicalPortableJson(payload.semanticCounts),
    deferredHistoryCounts: deferred,
    deferredHistoryCountsJson: canonicalPortableJson(deferred),
  }
}
