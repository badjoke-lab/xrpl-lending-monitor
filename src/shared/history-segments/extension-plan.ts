import {
  assertHistoryBackfillPlan,
  buildHistoryBackfillPlan,
  type HistoryBackfillSegmentPlan,
} from './backfill-plan'
import {
  assertHistorySegmentChainPublication,
  type HistorySegmentChainPublication,
} from './publication'

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/

export interface HistoryExtensionPlan {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  source: {
    chainId: string
    publicationSha256: string
    startLedgerIndex: number
    endLedgerIndex: number
    endLedgerHash: string
    segmentCount: number
    ledgerCount: number
    lastSegmentId: string
  }
  target: {
    ledgerIndex: number
    ledgerHash: string
  }
  extension: {
    startLedgerIndex: number
    endLedgerIndex: number
    ledgerCount: number
    segmentLedgerLimit: number
    checkpointEverySegments: number
    segmentCount: number
    checkpointCount: number
    anchorPreviousSegmentId: string
    anchorPreviousSegmentEndHash: string
    segments: HistoryBackfillSegmentPlan[]
  }
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`)
}

function ledgerHash(value: string, field: string): void {
  if (!LEDGER_HASH.test(value)) throw new Error(`${field} is invalid`)
}

export function assertHistoryExtensionPlan(plan: HistoryExtensionPlan): void {
  if (plan.schemaVersion !== 1 || plan.network !== 'devnet') {
    throw new Error('History extension plan schema is invalid')
  }
  if (!plan.epochId) throw new Error('History extension epoch is required')
  if (!plan.source.chainId || !plan.source.lastSegmentId) throw new Error('History extension source identity is incomplete')
  if (!SHA256.test(plan.source.publicationSha256)) throw new Error('History extension source publication digest is invalid')
  positiveInteger(plan.source.startLedgerIndex, 'source.startLedgerIndex')
  positiveInteger(plan.source.endLedgerIndex, 'source.endLedgerIndex')
  positiveInteger(plan.source.segmentCount, 'source.segmentCount')
  positiveInteger(plan.source.ledgerCount, 'source.ledgerCount')
  ledgerHash(plan.source.endLedgerHash, 'source.endLedgerHash')
  positiveInteger(plan.target.ledgerIndex, 'target.ledgerIndex')
  ledgerHash(plan.target.ledgerHash, 'target.ledgerHash')
  if (plan.target.ledgerIndex <= plan.source.endLedgerIndex) {
    throw new Error('History extension target must be ahead of the source publication terminal')
  }

  const extension = plan.extension
  if (extension.startLedgerIndex !== plan.source.endLedgerIndex + 1) {
    throw new Error('History extension does not start immediately after the source publication terminal')
  }
  if (extension.endLedgerIndex !== plan.target.ledgerIndex) {
    throw new Error('History extension does not end at the fixed target ledger')
  }
  if (extension.anchorPreviousSegmentId !== plan.source.lastSegmentId) {
    throw new Error('History extension predecessor segment does not match the source publication terminal')
  }
  if (extension.anchorPreviousSegmentEndHash !== plan.source.endLedgerHash) {
    throw new Error('History extension predecessor hash does not match the source publication terminal')
  }

  const backfill = {
    schemaVersion: 1 as const,
    network: 'devnet' as const,
    epochId: plan.epochId,
    startLedgerIndex: extension.startLedgerIndex,
    endLedgerIndex: extension.endLedgerIndex,
    ledgerCount: extension.ledgerCount,
    segmentLedgerLimit: extension.segmentLedgerLimit,
    checkpointEverySegments: extension.checkpointEverySegments,
    segmentCount: extension.segmentCount,
    checkpointCount: extension.checkpointCount,
    segments: extension.segments,
  }
  assertHistoryBackfillPlan(backfill)
}

export function buildHistoryExtensionPlan(options: {
  publication: HistorySegmentChainPublication
  targetLedgerIndex: number
  targetLedgerHash: string
  segmentLedgerLimit: number
  checkpointEverySegments: number
}): HistoryExtensionPlan {
  assertHistorySegmentChainPublication(options.publication)
  positiveInteger(options.targetLedgerIndex, 'targetLedgerIndex')
  ledgerHash(options.targetLedgerHash, 'targetLedgerHash')
  if (options.targetLedgerIndex <= options.publication.endLedgerIndex) {
    throw new Error('History extension target must be ahead of the source publication terminal')
  }

  const extensionPlan = buildHistoryBackfillPlan({
    epochId: options.publication.epochId,
    startLedgerIndex: options.publication.endLedgerIndex + 1,
    endLedgerIndex: options.targetLedgerIndex,
    segmentLedgerLimit: options.segmentLedgerLimit,
    checkpointEverySegments: options.checkpointEverySegments,
  })
  const last = options.publication.segments.at(-1)
  if (!last) throw new Error('History extension source publication has no terminal segment')

  const plan: HistoryExtensionPlan = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: options.publication.epochId,
    source: {
      chainId: options.publication.chainId,
      publicationSha256: options.publication.publicationSha256,
      startLedgerIndex: options.publication.startLedgerIndex,
      endLedgerIndex: options.publication.endLedgerIndex,
      endLedgerHash: options.publication.endLedgerHash,
      segmentCount: options.publication.segmentCount,
      ledgerCount: options.publication.ledgerCount,
      lastSegmentId: last.segmentId,
    },
    target: {
      ledgerIndex: options.targetLedgerIndex,
      ledgerHash: options.targetLedgerHash,
    },
    extension: {
      startLedgerIndex: extensionPlan.startLedgerIndex,
      endLedgerIndex: extensionPlan.endLedgerIndex,
      ledgerCount: extensionPlan.ledgerCount,
      segmentLedgerLimit: extensionPlan.segmentLedgerLimit,
      checkpointEverySegments: extensionPlan.checkpointEverySegments,
      segmentCount: extensionPlan.segmentCount,
      checkpointCount: extensionPlan.checkpointCount,
      anchorPreviousSegmentId: last.segmentId,
      anchorPreviousSegmentEndHash: options.publication.endLedgerHash,
      segments: extensionPlan.segments,
    },
  }
  assertHistoryExtensionPlan(plan)
  return plan
}
