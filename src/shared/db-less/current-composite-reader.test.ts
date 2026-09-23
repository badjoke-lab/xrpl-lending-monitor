import { describe, expect, it } from 'vitest'

import type { NormalizedCandidateV1, PortableJsonValue } from '../portable-collector-payload'
import {
  DbLessCompositeCurrentReader,
  type DbLessBaseCurrentReaderV1,
  type DbLessBaseCurrentRecordV1,
} from './current-composite-reader'
import { buildDbLessCurrentOverlayCheckpoint } from './current-overlay-checkpoint'
import { DbLessCurrentOverlayReader } from './current-overlay-reader'

const HASH = 'A'.repeat(64)

function projection(options: {
  id: string
  tombstone?: boolean
  value?: PortableJsonValue
}): NormalizedCandidateV1 {
  return {
    semanticClass: 'current-projection',
    canonicalKey: `projection:vault:${options.id.toLowerCase()}`,
    sourceLedgerIndex: 101,
    sourceLedgerHash: HASH,
    sourceTransactionHash: `TX-${options.id}`,
    objectId: options.id,
    relationshipIds: [],
    isTombstone: options.tombstone ?? false,
    value: options.tombstone ? null : (options.value ?? { id: options.id, source: 'overlay' }),
  }
}

class FakeBase implements DbLessBaseCurrentReaderV1 {
  readonly records: DbLessBaseCurrentRecordV1[]
  getCalls = 0
  listCalls = 0

  constructor(records: DbLessBaseCurrentRecordV1[]) {
    this.records = records
  }

  async get(_type: 'vault' | 'loan_broker' | 'loan', objectId: string) {
    this.getCalls += 1
    return {
      item: this.records.find((item) => item.objectId === objectId) ?? null,
      assetReads: 1,
    }
  }

  async list(
    _type: 'vault' | 'loan_broker' | 'loan',
    options: { limit: number; cursor?: string; maxAssetReads: number },
  ) {
    this.listCalls += 1
    if (options.maxAssetReads < 1) {
      return {
        items: [],
        nextCursor: options.cursor ?? '0',
        complete: false,
        assetReads: 0,
      }
    }
    const offset = options.cursor ? Number(options.cursor) : 0
    const items = this.records.slice(offset, offset + options.limit)
    const next = offset + items.length
    return {
      items,
      nextCursor: next >= this.records.length ? null : String(next),
      complete: next >= this.records.length,
      assetReads: 1,
    }
  }
}

async function fixture() {
  const checkpoint = await buildDbLessCurrentOverlayCheckpoint({
    epochId: 'epoch-1',
    baseIdentity: 'base-1',
    throughLedgerIndex: 101,
    throughLedgerHash: HASH,
    bucketCount: 8,
    generations: [{
      generationId: 'g1',
      startLedgerIndex: 101,
      endLedgerIndex: 101,
      records: [
        projection({ id: 'B', value: { id: 'B', version: 2 } }),
        projection({ id: 'C', tombstone: true }),
        projection({ id: 'D', value: { id: 'D', created: true } }),
      ],
    }],
  })
  const artifacts = new Map(
    checkpoint.shardArtifacts.map((artifact) => [artifact.key, artifact.bytes] as const),
  )
  const overlay = new DbLessCurrentOverlayReader({
    manifest: checkpoint.manifest,
    readArtifact: async (key) => artifacts.get(key) ?? null,
  })
  const base = new FakeBase([
    { objectId: 'A', value: { id: 'A', version: 1 } },
    { objectId: 'B', value: { id: 'B', version: 1 } },
    { objectId: 'C', value: { id: 'C', version: 1 } },
  ])
  return {
    base,
    reader: new DbLessCompositeCurrentReader({ overlay, base }),
  }
}

describe('D4 bounded base + overlay Current reader', () => {
  it('uses an overlay upsert without reading the base', async () => {
    const { base, reader } = await fixture()
    const result = await reader.get('vault', 'B')

    expect(result.item).toEqual({
      objectType: 'vault',
      objectId: 'B',
      value: { id: 'B', version: 2 },
      source: 'overlay',
    })
    expect(result.baseAssetReads).toBe(0)
    expect(base.getCalls).toBe(0)
    expect(result.overlayShardReads).toBeLessThanOrEqual(1)
  })

  it('uses an overlay tombstone to hide the base without reading it', async () => {
    const { base, reader } = await fixture()
    const result = await reader.get('vault', 'C')

    expect(result.item).toBeNull()
    expect(result.baseAssetReads).toBe(0)
    expect(base.getCalls).toBe(0)
  })

  it('falls back to the bounded base reader when the overlay has no mutation', async () => {
    const { base, reader } = await fixture()
    const result = await reader.get('vault', 'A')

    expect(result.item).toEqual({
      objectType: 'vault',
      objectId: 'A',
      value: { id: 'A', version: 1 },
      source: 'base',
    })
    expect(result.baseAssetReads).toBe(1)
    expect(base.getCalls).toBe(1)
    expect(result.overlayShardReads).toBeLessThanOrEqual(1)
  })

  it('lists overlay upserts first and suppresses shadowed or tombstoned base rows', async () => {
    const { reader } = await fixture()
    const collected: string[] = []
    let cursor: string | undefined
    let complete = false
    let calls = 0

    while (!complete) {
      const page = await reader.list('vault', {
        limit: 2,
        cursor,
        maxOverlayShardReads: 2,
        maxBaseAssetReads: 2,
        maxShadowChecks: 3,
      })
      expect(page.overlayShardReads).toBeLessThanOrEqual(2)
      expect(page.baseAssetReads).toBeLessThanOrEqual(2)
      expect(page.shadowChecks).toBeLessThanOrEqual(3)
      collected.push(...page.items.map((item) => item.objectId))
      cursor = page.nextCursor ?? undefined
      complete = page.complete
      calls += 1
      expect(calls).toBeLessThan(10)
    }

    expect(new Set(collected)).toEqual(new Set(['A', 'B', 'D']))
    expect(collected).toHaveLength(3)
  })

  it('returns a resumable base-phase cursor when the shadow-check budget is exhausted', async () => {
    const { reader } = await fixture()

    let cursor: string | undefined
    let page = await reader.list('vault', {
      limit: 100,
      maxOverlayShardReads: 8,
      maxBaseAssetReads: 8,
      maxShadowChecks: 1,
    })
    expect(page.complete).toBe(false)
    expect(page.nextCursor).not.toBeNull()
    cursor = page.nextCursor ?? undefined

    const ids = [...page.items.map((item) => item.objectId)]
    let calls = 0
    while (!page.complete) {
      page = await reader.list('vault', {
        limit: 100,
        cursor,
        maxOverlayShardReads: 8,
        maxBaseAssetReads: 8,
        maxShadowChecks: 1,
      })
      ids.push(...page.items.map((item) => item.objectId))
      cursor = page.nextCursor ?? undefined
      calls += 1
      expect(calls).toBeLessThan(10)
    }

    expect(new Set(ids)).toEqual(new Set(['A', 'B', 'D']))
  })
})
