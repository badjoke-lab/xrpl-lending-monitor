import type { HistoryBackfillSegmentPlan } from './backfill-plan'
import { assertHistoryExtensionPlan, type HistoryExtensionPlan } from './extension-plan'

export interface HistoryExtensionShard {
  ordinal: number
  startSegmentOrdinal: number
  endSegmentOrdinal: number
  segmentCount: number
  startLedgerIndex: number
  endLedgerIndex: number
  ledgerCount: number
  anchorPreviousLedgerIndex: number
  anchorPreviousSegmentId: string
  segments: HistoryBackfillSegmentPlan[]
}

export interface HistoryExtensionShardPlan {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  sourcePublicationSha256: string
  sourceEndLedgerIndex: number
  sourceEndLedgerHash: string
  targetLedgerIndex: number
  targetLedgerHash: string
  extensionSegmentCount: number
  segmentsPerShard: number
  shardCount: number
  shards: HistoryExtensionShard[]
}

export function assertHistoryExtensionShardPlan(options: {
  extensionPlan: HistoryExtensionPlan
  shardPlan: HistoryExtensionShardPlan
}): void {
  const { extensionPlan, shardPlan } = options
  assertHistoryExtensionPlan(extensionPlan)
  if (shardPlan.schemaVersion !== 1 || shardPlan.network !== 'devnet') throw new Error('History extension shard plan schema is invalid')
  if (shardPlan.epochId !== extensionPlan.epochId) throw new Error('History extension shard plan epoch mismatch')
  if (shardPlan.sourcePublicationSha256 !== extensionPlan.source.publicationSha256) throw new Error('History extension shard plan source publication mismatch')
  if (shardPlan.sourceEndLedgerIndex !== extensionPlan.source.endLedgerIndex || shardPlan.sourceEndLedgerHash !== extensionPlan.source.endLedgerHash) throw new Error('History extension shard plan source terminal mismatch')
  if (shardPlan.targetLedgerIndex !== extensionPlan.target.ledgerIndex || shardPlan.targetLedgerHash !== extensionPlan.target.ledgerHash) throw new Error('History extension shard plan target mismatch')
  if (!Number.isSafeInteger(shardPlan.segmentsPerShard) || shardPlan.segmentsPerShard < 1) throw new Error('segmentsPerShard must be positive')
  if (shardPlan.shardCount !== shardPlan.shards.length) throw new Error('History extension shard count mismatch')
  if (shardPlan.extensionSegmentCount !== extensionPlan.extension.segmentCount) throw new Error('History extension segment count mismatch')

  const flattened: HistoryBackfillSegmentPlan[] = []
  let expectedShardOrdinal = 1
  for (const shard of shardPlan.shards) {
    if (shard.ordinal !== expectedShardOrdinal) throw new Error('History extension shard ordinals are not contiguous')
    if (shard.segmentCount !== shard.segments.length || shard.segmentCount < 1) throw new Error('History extension shard segment count mismatch')
    if (shard.segments[0]!.ordinal !== shard.startSegmentOrdinal || shard.segments.at(-1)!.ordinal !== shard.endSegmentOrdinal) throw new Error('History extension shard segment ordinal boundary mismatch')
    if (shard.startLedgerIndex !== shard.segments[0]!.startLedgerIndex || shard.endLedgerIndex !== shard.segments.at(-1)!.endLedgerIndex) throw new Error('History extension shard ledger boundary mismatch')
    const expectedLedgerCount = shard.endLedgerIndex - shard.startLedgerIndex + 1
    if (shard.ledgerCount !== expectedLedgerCount) throw new Error('History extension shard ledger count mismatch')
    if (shard.anchorPreviousLedgerIndex !== shard.startLedgerIndex - 1) throw new Error('History extension shard anchor ledger mismatch')
    const expectedPreviousId = shard.startSegmentOrdinal === 1
      ? extensionPlan.source.lastSegmentId
      : extensionPlan.extension.segments[shard.startSegmentOrdinal - 2]!.segmentId
    if (shard.anchorPreviousSegmentId !== expectedPreviousId) throw new Error('History extension shard anchor segment mismatch')
    flattened.push(...shard.segments)
    expectedShardOrdinal += 1
  }

  if (JSON.stringify(flattened) !== JSON.stringify(extensionPlan.extension.segments)) {
    throw new Error('History extension shard plan does not exactly cover the frozen extension segments')
  }
}

export function buildHistoryExtensionShardPlan(options: {
  extensionPlan: HistoryExtensionPlan
  segmentsPerShard: number
}): HistoryExtensionShardPlan {
  assertHistoryExtensionPlan(options.extensionPlan)
  if (!Number.isSafeInteger(options.segmentsPerShard) || options.segmentsPerShard < 1) throw new Error('segmentsPerShard must be positive')
  const extensionPlan = options.extensionPlan
  const shards: HistoryExtensionShard[] = []
  for (let offset = 0; offset < extensionPlan.extension.segments.length; offset += options.segmentsPerShard) {
    const segments = extensionPlan.extension.segments.slice(offset, offset + options.segmentsPerShard)
    const first = segments[0]!
    const last = segments.at(-1)!
    const startSegmentOrdinal = first.ordinal
    shards.push({
      ordinal: shards.length + 1,
      startSegmentOrdinal,
      endSegmentOrdinal: last.ordinal,
      segmentCount: segments.length,
      startLedgerIndex: first.startLedgerIndex,
      endLedgerIndex: last.endLedgerIndex,
      ledgerCount: last.endLedgerIndex - first.startLedgerIndex + 1,
      anchorPreviousLedgerIndex: first.startLedgerIndex - 1,
      anchorPreviousSegmentId: startSegmentOrdinal === 1
        ? extensionPlan.source.lastSegmentId
        : extensionPlan.extension.segments[startSegmentOrdinal - 2]!.segmentId,
      segments,
    })
  }
  const shardPlan: HistoryExtensionShardPlan = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: extensionPlan.epochId,
    sourcePublicationSha256: extensionPlan.source.publicationSha256,
    sourceEndLedgerIndex: extensionPlan.source.endLedgerIndex,
    sourceEndLedgerHash: extensionPlan.source.endLedgerHash,
    targetLedgerIndex: extensionPlan.target.ledgerIndex,
    targetLedgerHash: extensionPlan.target.ledgerHash,
    extensionSegmentCount: extensionPlan.extension.segmentCount,
    segmentsPerShard: options.segmentsPerShard,
    shardCount: shards.length,
    shards,
  }
  assertHistoryExtensionShardPlan({ extensionPlan, shardPlan })
  return shardPlan
}
