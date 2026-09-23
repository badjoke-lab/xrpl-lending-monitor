import { describe, expect, it } from 'vitest'

import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import { buildDbLessCurrentOverlayCheckpoint } from './current-overlay-checkpoint'
import { verifyDbLessCurrentOverlayEquivalence } from './current-overlay-equivalence'
import { DbLessCurrentOverlayReader } from './current-overlay-reader'

const HASH_A = 'A'.repeat(64)
const HASH_B = 'B'.repeat(64)

function projection(options: {
  type: 'vault' | 'loan_broker' | 'loan'
  id: string
  ledger: number
  hash: string
  tombstone?: boolean
  version?: number
}): NormalizedCandidateV1 {
  return {
    semanticClass: 'current-projection',
    canonicalKey: `projection:${options.type}:${options.id.toLowerCase()}`,
    sourceLedgerIndex: options.ledger,
    sourceLedgerHash: options.hash,
    sourceTransactionHash: `TX-${options.ledger}-${options.id}`,
    objectId: options.id,
    relationshipIds: [`id:${options.id}`],
    isTombstone: options.tombstone ?? false,
    value: options.tombstone ? null : { id: options.id, version: options.version ?? 1 },
  }
}

function generations(version = 2) {
  return [
    {
      generationId: 'g1',
      startLedgerIndex: 101,
      endLedgerIndex: 101,
      records: [
        projection({ type: 'vault', id: 'A', ledger: 101, hash: HASH_A, version: 1 }),
        projection({ type: 'loan', id: 'B', ledger: 101, hash: HASH_A, version: 1 }),
      ],
    },
    {
      generationId: 'g2',
      startLedgerIndex: 102,
      endLedgerIndex: 102,
      records: [
        projection({ type: 'vault', id: 'A', ledger: 102, hash: HASH_B, version }),
        projection({ type: 'loan', id: 'B', ledger: 102, hash: HASH_B, tombstone: true }),
      ],
    },
  ]
}

async function readerFor(source = generations()) {
  const checkpoint = await buildDbLessCurrentOverlayCheckpoint({
    epochId: 'epoch-1',
    baseIdentity: 'base-1',
    throughLedgerIndex: 102,
    throughLedgerHash: HASH_B,
    bucketCount: 8,
    generations: source,
  })
  const artifacts = new Map(
    checkpoint.shardArtifacts.map((artifact) => [artifact.key, artifact.bytes] as const),
  )
  return {
    checkpoint,
    reader: new DbLessCurrentOverlayReader({
      manifest: checkpoint.manifest,
      readArtifact: async (key) => artifacts.get(key) ?? null,
    }),
  }
}

describe('D4 Current overlay compaction equivalence', () => {
  it('matches an independently folded source state to checkpoint shards', async () => {
    const source = generations()
    const built = await readerFor(source)
    const result = await verifyDbLessCurrentOverlayEquivalence({
      generations: source,
      reader: built.reader,
    })

    expect(result.equivalent).toBe(true)
    expect(result.generationCount).toBe(2)
    expect(result.sourceEntryCount).toBe(2)
    expect(result.checkpointEntryCount).toBe(2)
    expect(result.sourceTombstoneCount).toBe(1)
    expect(result.checkpointTombstoneCount).toBe(1)
    expect(result.sourceStateSha256).toBe(result.checkpointStateSha256)
  })

  it('fails when a valid checkpoint encodes a different folded state', async () => {
    const source = generations(2)
    const different = generations(3)
    const built = await readerFor(different)

    await expect(verifyDbLessCurrentOverlayEquivalence({
      generations: source,
      reader: built.reader,
    })).rejects.toThrow('not equivalent')
  })

  it('fails when source generation identity does not match the checkpoint', async () => {
    const source = generations()
    const built = await readerFor(source)
    const changed = [
      { ...source[0]!, generationId: 'other-g1' },
      source[1]!,
    ]

    await expect(verifyDbLessCurrentOverlayEquivalence({
      generations: changed,
      reader: built.reader,
    })).rejects.toThrow('generation IDs')
  })
})
