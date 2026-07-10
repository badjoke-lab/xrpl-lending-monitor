import { describe, expect, it } from 'vitest'

import type { HistoryExtensionPlan } from './extension-plan'
import { assertHistoryExtensionShardPlan, buildHistoryExtensionShardPlan } from './extension-shards'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)

function extensionPlan(): HistoryExtensionPlan {
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-99',
    source: {
      chainId: 'canonical-devnet-100-109', publicationSha256: 'a'.repeat(64),
      startLedgerIndex: 100, endLedgerIndex: 109, endLedgerHash: A,
      segmentCount: 1, ledgerCount: 10, lastSegmentId: 'devnet-99-100-109',
    },
    target: { ledgerIndex: 121, ledgerHash: B },
    extension: {
      startLedgerIndex: 110, endLedgerIndex: 121, ledgerCount: 12,
      segmentLedgerLimit: 2, checkpointEverySegments: 2,
      segmentCount: 6, checkpointCount: 3,
      anchorPreviousSegmentId: 'devnet-99-100-109', anchorPreviousSegmentEndHash: A,
      segments: Array.from({ length: 6 }, (_, index) => {
        const start = 110 + index * 2
        return {
          ordinal: index + 1,
          segmentId: `devnet-99-${start}-${start + 1}`,
          startLedgerIndex: start,
          endLedgerIndex: start + 1,
          ledgerCount: 2,
          checkpointAfter: (index + 1) % 2 === 0,
        }
      }),
    },
  }
}

describe('history extension shard plan', () => {
  it('partitions the frozen extension into contiguous shards without changing segment descriptors', () => {
    const plan = extensionPlan()
    const shards = buildHistoryExtensionShardPlan({ extensionPlan: plan, segmentsPerShard: 2 })
    expect(shards.shardCount).toBe(3)
    expect(shards.shards.map((shard) => ({
      ordinal: shard.ordinal,
      start: shard.startLedgerIndex,
      end: shard.endLedgerIndex,
      anchorLedger: shard.anchorPreviousLedgerIndex,
      anchorSegment: shard.anchorPreviousSegmentId,
    }))).toEqual([
      { ordinal: 1, start: 110, end: 113, anchorLedger: 109, anchorSegment: 'devnet-99-100-109' },
      { ordinal: 2, start: 114, end: 117, anchorLedger: 113, anchorSegment: 'devnet-99-112-113' },
      { ordinal: 3, start: 118, end: 121, anchorLedger: 117, anchorSegment: 'devnet-99-116-117' },
    ])
    expect(shards.shards.flatMap((shard) => shard.segments)).toEqual(plan.extension.segments)
    expect(() => assertHistoryExtensionShardPlan({ extensionPlan: plan, shardPlan: shards })).not.toThrow()
  })

  it('allows a final partial shard', () => {
    const shards = buildHistoryExtensionShardPlan({ extensionPlan: extensionPlan(), segmentsPerShard: 4 })
    expect(shards.shards.map((shard) => shard.segmentCount)).toEqual([4, 2])
  })

  it('rejects shard plans that omit frozen segments', () => {
    const plan = extensionPlan()
    const shards = buildHistoryExtensionShardPlan({ extensionPlan: plan, segmentsPerShard: 2 })
    shards.shards[1]!.segments = shards.shards[1]!.segments.slice(1)
    shards.shards[1]!.segmentCount = 1
    expect(() => assertHistoryExtensionShardPlan({ extensionPlan: plan, shardPlan: shards }))
      .toThrow()
  })
})
