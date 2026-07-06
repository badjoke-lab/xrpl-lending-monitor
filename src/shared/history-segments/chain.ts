import {
  assertAdjacentHistorySegments,
  assertHistorySegmentManifest,
  type HistorySegmentManifest,
} from './manifest'

export interface HistorySegmentChainExpectation {
  network: 'devnet'
  epochId: string
  startLedgerIndex: number
  startParentHash: string
  previousSegmentId: string | null
  previousSegmentEndHash: string | null
  endLedgerIndex?: number
  endLedgerHash?: string
}

export interface HistorySegmentChainSummary {
  segmentCount: number
  ledgerCount: number
  startLedgerIndex: number
  startLedgerHash: string
  startParentHash: string
  endLedgerIndex: number
  endLedgerHash: string
}

export function assertHistorySegmentChain(
  manifests: readonly HistorySegmentManifest[],
  expectation: HistorySegmentChainExpectation,
): HistorySegmentChainSummary {
  if (manifests.length === 0) throw new Error('History segment chain must contain at least one segment')

  const seenSegmentIds = new Set<string>()
  for (const manifest of manifests) {
    assertHistorySegmentManifest(manifest)
    if (seenSegmentIds.has(manifest.segmentId)) {
      throw new Error(`Duplicate history segment ID: ${manifest.segmentId}`)
    }
    seenSegmentIds.add(manifest.segmentId)
  }

  const first = manifests[0]
  const last = manifests.at(-1)
  if (!first || !last) throw new Error('History segment chain boundaries are unavailable')

  if (first.network !== expectation.network) {
    throw new Error('History segment chain network does not match the expected anchor')
  }
  if (first.epochId !== expectation.epochId) {
    throw new Error('History segment chain epoch does not match the expected anchor')
  }
  if (first.startLedgerIndex !== expectation.startLedgerIndex) {
    throw new Error('History segment chain start ledger does not match the expected anchor')
  }
  if (first.startParentHash !== expectation.startParentHash) {
    throw new Error('History segment chain start parent hash does not match the expected anchor')
  }
  if (first.previousSegmentId !== expectation.previousSegmentId) {
    throw new Error('History segment chain previous segment ID does not match the expected anchor')
  }
  if (first.previousSegmentEndHash !== expectation.previousSegmentEndHash) {
    throw new Error('History segment chain previous segment hash does not match the expected anchor')
  }

  for (let index = 1; index < manifests.length; index += 1) {
    const previous = manifests[index - 1]
    const next = manifests[index]
    if (!previous || !next) throw new Error('History segment chain sequence is incomplete')
    assertAdjacentHistorySegments(previous, next)
  }

  if (expectation.endLedgerIndex !== undefined && last.endLedgerIndex !== expectation.endLedgerIndex) {
    throw new Error('History segment chain end ledger does not match the expected terminal boundary')
  }
  if (expectation.endLedgerHash !== undefined && last.endLedgerHash !== expectation.endLedgerHash) {
    throw new Error('History segment chain end hash does not match the expected terminal boundary')
  }

  return {
    segmentCount: manifests.length,
    ledgerCount: manifests.reduce((total, manifest) => total + manifest.ledgerCount, 0),
    startLedgerIndex: first.startLedgerIndex,
    startLedgerHash: first.startLedgerHash,
    startParentHash: first.startParentHash,
    endLedgerIndex: last.endLedgerIndex,
    endLedgerHash: last.endLedgerHash,
  }
}
