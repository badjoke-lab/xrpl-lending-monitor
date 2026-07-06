import {
  assertHistorySegmentManifest,
  type HistorySegmentManifest,
} from './manifest'

export interface CompletedHistorySegment {
  segmentId: string
  startLedgerIndex: number
  endLedgerIndex: number
  endLedgerHash: string
  manifestSha256: string
}

export interface HistorySegmentCheckpoint {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  rangeStartLedgerIndex: number
  rangeEndLedgerIndex: number
  nextLedgerIndex: number
  anchorPreviousSegmentId: string | null
  anchorPreviousSegmentEndHash: string | null
  previousSegmentId: string | null
  previousSegmentEndHash: string | null
  completedSegments: CompletedHistorySegment[]
}

export interface CreateHistorySegmentCheckpointOptions {
  network: 'devnet'
  epochId: string
  rangeStartLedgerIndex: number
  rangeEndLedgerIndex: number
  previousSegmentId: string | null
  previousSegmentEndHash: string | null
}

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[A-Fa-f0-9]{64}$/

function safeLedgerIndex(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function pairedIdentity(id: string | null, hash: string | null, field: string): void {
  if ((id === null) !== (hash === null)) {
    throw new Error(`${field} segment ID and hash must be both present or both null`)
  }
  if (id !== null && id.length === 0) throw new Error(`${field} segment ID must be non-empty`)
  if (hash !== null && !LEDGER_HASH.test(hash)) {
    throw new Error(`${field} segment hash must be a 64-character uppercase hexadecimal hash`)
  }
}

export function createHistorySegmentCheckpoint(
  options: CreateHistorySegmentCheckpointOptions,
): HistorySegmentCheckpoint {
  const checkpoint: HistorySegmentCheckpoint = {
    schemaVersion: 1,
    network: options.network,
    epochId: options.epochId,
    rangeStartLedgerIndex: options.rangeStartLedgerIndex,
    rangeEndLedgerIndex: options.rangeEndLedgerIndex,
    nextLedgerIndex: options.rangeStartLedgerIndex,
    anchorPreviousSegmentId: options.previousSegmentId,
    anchorPreviousSegmentEndHash: options.previousSegmentEndHash,
    previousSegmentId: options.previousSegmentId,
    previousSegmentEndHash: options.previousSegmentEndHash,
    completedSegments: [],
  }
  assertHistorySegmentCheckpoint(checkpoint)
  return checkpoint
}

export function assertHistorySegmentCheckpoint(checkpoint: HistorySegmentCheckpoint): void {
  if (checkpoint.schemaVersion !== 1) throw new Error('Unsupported history segment checkpoint schema version')
  if (checkpoint.network !== 'devnet') throw new Error('History segment checkpoint network must be devnet')
  if (checkpoint.epochId.length === 0) throw new Error('History segment checkpoint epochId must be non-empty')

  safeLedgerIndex(checkpoint.rangeStartLedgerIndex, 'rangeStartLedgerIndex')
  safeLedgerIndex(checkpoint.rangeEndLedgerIndex, 'rangeEndLedgerIndex')
  safeLedgerIndex(checkpoint.nextLedgerIndex, 'nextLedgerIndex')
  if (checkpoint.rangeEndLedgerIndex < checkpoint.rangeStartLedgerIndex) {
    throw new Error('History segment checkpoint range end precedes range start')
  }
  if (
    checkpoint.nextLedgerIndex < checkpoint.rangeStartLedgerIndex
    || checkpoint.nextLedgerIndex > checkpoint.rangeEndLedgerIndex + 1
  ) {
    throw new Error('History segment checkpoint next ledger is outside the requested range boundary')
  }

  pairedIdentity(
    checkpoint.anchorPreviousSegmentId,
    checkpoint.anchorPreviousSegmentEndHash,
    'Anchor previous',
  )
  pairedIdentity(checkpoint.previousSegmentId, checkpoint.previousSegmentEndHash, 'Previous')

  const seenIds = new Set<string>()
  let expectedStart = checkpoint.rangeStartLedgerIndex
  for (const segment of checkpoint.completedSegments) {
    if (segment.segmentId.length === 0) throw new Error('Completed history segment ID must be non-empty')
    if (seenIds.has(segment.segmentId)) throw new Error(`Duplicate completed history segment ID: ${segment.segmentId}`)
    seenIds.add(segment.segmentId)
    safeLedgerIndex(segment.startLedgerIndex, 'completedSegment.startLedgerIndex')
    safeLedgerIndex(segment.endLedgerIndex, 'completedSegment.endLedgerIndex')
    if (segment.startLedgerIndex !== expectedStart) {
      throw new Error('Completed history segment ranges are not contiguous')
    }
    if (segment.endLedgerIndex < segment.startLedgerIndex) {
      throw new Error('Completed history segment end precedes start')
    }
    if (segment.endLedgerIndex > checkpoint.rangeEndLedgerIndex) {
      throw new Error('Completed history segment exceeds the requested checkpoint range')
    }
    if (!LEDGER_HASH.test(segment.endLedgerHash)) {
      throw new Error('Completed history segment end hash is invalid')
    }
    if (!SHA256.test(segment.manifestSha256)) {
      throw new Error('Completed history segment manifest digest is invalid')
    }
    expectedStart = segment.endLedgerIndex + 1
  }

  if (checkpoint.nextLedgerIndex !== expectedStart) {
    throw new Error('History segment checkpoint next ledger does not follow completed coverage')
  }

  const last = checkpoint.completedSegments.at(-1)
  if (last) {
    if (checkpoint.previousSegmentId !== last.segmentId) {
      throw new Error('History segment checkpoint previous segment ID does not match completed coverage')
    }
    if (checkpoint.previousSegmentEndHash !== last.endLedgerHash) {
      throw new Error('History segment checkpoint previous segment hash does not match completed coverage')
    }
  } else {
    if (checkpoint.previousSegmentId !== checkpoint.anchorPreviousSegmentId) {
      throw new Error('Empty history segment checkpoint previous segment ID does not match its anchor')
    }
    if (checkpoint.previousSegmentEndHash !== checkpoint.anchorPreviousSegmentEndHash) {
      throw new Error('Empty history segment checkpoint previous segment hash does not match its anchor')
    }
  }
}

export function advanceHistorySegmentCheckpoint(options: {
  checkpoint: HistorySegmentCheckpoint
  manifest: HistorySegmentManifest
  manifestSha256: string
}): HistorySegmentCheckpoint {
  assertHistorySegmentCheckpoint(options.checkpoint)
  assertHistorySegmentManifest(options.manifest)
  if (!SHA256.test(options.manifestSha256)) {
    throw new Error('History segment manifest digest must be a 64-character hexadecimal SHA-256 digest')
  }
  if (options.manifest.network !== options.checkpoint.network) {
    throw new Error('History segment network does not match checkpoint')
  }
  if (options.manifest.epochId !== options.checkpoint.epochId) {
    throw new Error('History segment epoch does not match checkpoint')
  }
  if (options.manifest.startLedgerIndex !== options.checkpoint.nextLedgerIndex) {
    throw new Error('History segment does not start at checkpoint next ledger')
  }
  if (options.manifest.endLedgerIndex > options.checkpoint.rangeEndLedgerIndex) {
    throw new Error('History segment exceeds checkpoint range end')
  }
  if (options.manifest.previousSegmentId !== options.checkpoint.previousSegmentId) {
    throw new Error('History segment previous ID does not match checkpoint')
  }
  if (options.manifest.previousSegmentEndHash !== options.checkpoint.previousSegmentEndHash) {
    throw new Error('History segment previous hash does not match checkpoint')
  }
  if (options.checkpoint.completedSegments.some((segment) => segment.segmentId === options.manifest.segmentId)) {
    throw new Error(`History segment ID has already been checkpointed: ${options.manifest.segmentId}`)
  }

  const next: HistorySegmentCheckpoint = {
    ...options.checkpoint,
    nextLedgerIndex: options.manifest.endLedgerIndex + 1,
    previousSegmentId: options.manifest.segmentId,
    previousSegmentEndHash: options.manifest.endLedgerHash,
    completedSegments: [
      ...options.checkpoint.completedSegments,
      {
        segmentId: options.manifest.segmentId,
        startLedgerIndex: options.manifest.startLedgerIndex,
        endLedgerIndex: options.manifest.endLedgerIndex,
        endLedgerHash: options.manifest.endLedgerHash,
        manifestSha256: options.manifestSha256,
      },
    ],
  }
  assertHistorySegmentCheckpoint(next)
  return next
}

export function historySegmentCheckpointComplete(checkpoint: HistorySegmentCheckpoint): boolean {
  assertHistorySegmentCheckpoint(checkpoint)
  return checkpoint.nextLedgerIndex === checkpoint.rangeEndLedgerIndex + 1
}
