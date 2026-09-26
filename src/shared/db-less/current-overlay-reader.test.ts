import { describe, expect, it } from 'vitest'

import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import { buildDbLessCurrentOverlayCheckpoint } from './current-overlay-checkpoint'
import { DbLessCurrentOverlayReader } from './current-overlay-reader'
import { buildDbLessCurrentProjectionCanonicalKey } from './current-projection-identity'

const HASH = 'A'.repeat(64)

function projection(options: {
  id: string
  ledger?: number
  tombstone?: boolean
}): NormalizedCandidateV1 {
  const ledger = options.ledger ?? 101
  return {
    semanticClass: 'current-projection',
    canonicalKey: buildDbLessCurrentProjectionCanonicalKey('vault', options.id),
    sourceLedgerIndex: ledger,
    sourceLedgerHash: HASH,
    sourceTransactionHash: `TX-${ledger}-${options.id}`,
    objectId: options.id,
    relationshipIds: [`owner:${options.id}`],
    isTombstone: options.tombstone ?? false,
    value: options.tombstone ? null : { id: options.id, ledger },
  }
}

async function fixture(options: {
  bucketCount?: number
  values?: NormalizedCandidateV1[]
} = {}) {
  const values = options.values ?? [
    projection({ id: 'A1' }),
    projection({ id: 'B2', tombstone: true }),
  ]
  const checkpoint = await buildDbLessCurrentOverlayCheckpoint({
    epochId: 'epoch-1',
    baseIdentity: 'base-1',
    throughLedgerIndex: 101,
    throughLedgerHash: HASH,
    bucketCount: options.bucketCount ?? 8,
    generations: [{
      generationId: 'g1',
      startLedgerIndex: 101,
      endLedgerIndex: 101,
      records: values,
    }],
  })
  const artifacts = new Map(
    checkpoint.shardArtifacts.map((artifact) => [artifact.key, artifact.bytes] as const),
  )
  let reads = 0
  const reader = new DbLessCurrentOverlayReader({
    manifest: checkpoint.manifest,
    readArtifact: async (key) => {
      reads += 1
      return artifacts.get(key) ?? null
    },
  })
  return { checkpoint, artifacts, reader, reads: () => reads }
}

describe('D4 bounded Current overlay reader', () => {
  it('preserves the D3 canonical key for uppercase object IDs', async () => {
    const built = await fixture({
      values: [projection({ id: 'ABCDEF012345' })],
    })

    const found = await built.reader.get('vault', 'ABCDEF012345')
    expect(found.item?.canonicalKey).toBe('projection:vault:ABCDEF012345')
    expect(found.item?.objectId).toBe('ABCDEF012345')
  })

  it('resolves an exact overlay object with at most one shard read', async () => {
    const built = await fixture()

    const found = await built.reader.get('vault', 'A1')
    expect(found.item).toMatchObject({
      objectId: 'A1',
      isTombstone: false,
      value: { id: 'A1', ledger: 101 },
    })
    expect(found.shardReads).toBeLessThanOrEqual(1)
    expect(built.reads()).toBeLessThanOrEqual(1)

    const tombstone = await built.reader.get('vault', 'B2')
    expect(tombstone.item).toMatchObject({
      objectId: 'B2',
      isTombstone: true,
      value: null,
    })
    expect(tombstone.shardReads).toBeLessThanOrEqual(1)
  })

  it('bounds list traversal by shard reads and resumes with a stable cursor', async () => {
    const values = Array.from({ length: 40 }, (_, index) =>
      projection({ id: `OBJ-${String(index).padStart(3, '0')}` }))
    const built = await fixture({ bucketCount: 8, values })
    expect(built.checkpoint.manifest.shards.length).toBeGreaterThan(1)

    const seen: string[] = []
    let cursor: string | undefined
    let complete = false
    let calls = 0

    while (!complete) {
      const page = await built.reader.list('vault', {
        limit: 100,
        cursor,
        maxShardReads: 1,
      })
      expect(page.shardReads).toBeLessThanOrEqual(1)
      seen.push(...page.items.map((item) => item.objectId))
      cursor = page.nextCursor ?? undefined
      complete = page.complete
      calls += 1
      expect(calls).toBeLessThanOrEqual(8)
    }

    expect(new Set(seen).size).toBe(values.length)
    expect(seen).toHaveLength(values.length)
  })

  it('can omit tombstones without changing the bounded traversal contract', async () => {
    const built = await fixture()
    const page = await built.reader.list('vault', {
      limit: 100,
      maxShardReads: 8,
      includeTombstones: false,
    })

    expect(page.items.map((item) => item.objectId)).toEqual(['A1'])
    expect(page.shardReads).toBeLessThanOrEqual(8)
  })

  it('rejects a tampered shard before returning data', async () => {
    const built = await fixture({ bucketCount: 1 })
    const descriptor = built.checkpoint.manifest.shards[0]!
    built.artifacts.set(
      descriptor.key,
      new TextEncoder().encode('{"tampered":true}\n'),
    )

    const fresh = new DbLessCurrentOverlayReader({
      manifest: built.checkpoint.manifest,
      readArtifact: async (key) => built.artifacts.get(key) ?? null,
    })

    await expect(fresh.get('vault', 'A1')).rejects.toThrow(
      /Missing or invalid|SHA-256 mismatch/,
    )
  })
})
