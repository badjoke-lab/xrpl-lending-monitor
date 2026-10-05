import { describe, expect, it } from 'vitest'

import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import type { DbLessCompositeCurrentLookupResultV1 } from './current-composite-reader'
import {
  DbLessFreshExactCurrentReader,
  type DbLessCheckpointExactReaderV1,
} from './current-fresh-exact-reader'
import type { DbLessCurrentOverlayGenerationV1 } from './current-overlay-checkpoint'
import { buildDbLessCurrentProjectionCanonicalKey } from './current-projection-identity'

const HASH = 'A'.repeat(64)

function mutation(options: {
  type?: 'vault' | 'loan_broker' | 'loan'
  id: string
  ledger: number
  tombstone?: boolean
  value?: Record<string, unknown>
}): NormalizedCandidateV1 {
  const type = options.type ?? 'vault'
  return {
    semanticClass: 'current-projection',
    canonicalKey: buildDbLessCurrentProjectionCanonicalKey(type, options.id),
    sourceLedgerIndex: options.ledger,
    sourceLedgerHash: HASH,
    sourceTransactionHash: `TX-${options.ledger}-${options.id}`,
    objectId: options.id,
    relationshipIds: [],
    isTombstone: options.tombstone ?? false,
    value: options.tombstone
      ? null
      : (options.value ?? { id: options.id, ledger: options.ledger }),
  }
}

function generation(
  id: string,
  start: number,
  end: number,
  records: NormalizedCandidateV1[],
): DbLessCurrentOverlayGenerationV1 {
  return { generationId: id, startLedgerIndex: start, endLedgerIndex: end, records }
}

function checkpoint(options: {
  result?: DbLessCompositeCurrentLookupResultV1
  onGet?: () => void
} = {}): DbLessCheckpointExactReaderV1 {
  return {
    async get() {
      options.onGet?.()
      return options.result ?? {
        item: null,
        overlayShardReads: 1,
        baseAssetReads: 2,
      }
    },
  }
}

describe('D5 fresh exact Current reader', () => {
  it('uses a sparse D3 tail upsert before the D4+D2 checkpoint reader', async () => {
    let checkpointReads = 0
    const reader = new DbLessFreshExactCurrentReader({
      checkpoint: checkpoint({ onGet: () => { checkpointReads += 1 } }),
      checkpointThroughLedgerIndex: 100,
      currentThroughLedgerIndex: 120,
      tailGenerations: [
        generation('g1', 110, 110, [
          mutation({ id: 'A1', ledger: 110, value: { id: 'A1', source: 'tail' } }),
        ]),
      ],
    })

    const result = await reader.get('vault', 'A1')
    expect(result.item).toMatchObject({
      objectId: 'A1',
      source: 'tail',
      sourceLedgerIndex: 110,
      value: { id: 'A1', source: 'tail' },
    })
    expect(result.tailMutationHit).toBe(true)
    expect(checkpointReads).toBe(0)
  })

  it('treats a sparse D3 tail tombstone as authoritative deletion', async () => {
    let checkpointReads = 0
    const reader = new DbLessFreshExactCurrentReader({
      checkpoint: checkpoint({
        onGet: () => { checkpointReads += 1 },
        result: {
          item: {
            objectType: 'vault',
            objectId: 'A1',
            value: { id: 'A1', source: 'checkpoint' },
            source: 'overlay',
          },
          overlayShardReads: 1,
          baseAssetReads: 0,
        },
      }),
      checkpointThroughLedgerIndex: 100,
      currentThroughLedgerIndex: 120,
      tailGenerations: [
        generation('g1', 115, 115, [
          mutation({ id: 'A1', ledger: 115, tombstone: true }),
        ]),
      ],
    })

    const result = await reader.get('vault', 'A1')
    expect(result.item).toBeNull()
    expect(result.tailMutationHit).toBe(true)
    expect(checkpointReads).toBe(0)
  })

  it('falls back to the verified D4+D2 checkpoint when the sparse tail has no matching object', async () => {
    const reader = new DbLessFreshExactCurrentReader({
      checkpoint: checkpoint({
        result: {
          item: {
            objectType: 'vault',
            objectId: 'A1',
            value: { id: 'A1', source: 'checkpoint' },
            source: 'base',
          },
          overlayShardReads: 1,
          baseAssetReads: 2,
        },
      }),
      checkpointThroughLedgerIndex: 100,
      currentThroughLedgerIndex: 120,
      tailGenerations: [
        generation('g1', 110, 110, [mutation({ id: 'B1', ledger: 110 })]),
      ],
    })

    const result = await reader.get('vault', 'A1')
    expect(result.item).toMatchObject({
      objectId: 'A1',
      source: 'base',
      sourceLedgerIndex: null,
    })
    expect(result.tailMutationHit).toBe(false)
    expect(result.checkpointOverlayShardReads).toBe(1)
    expect(result.baseAssetReads).toBe(2)
  })

  it('keeps the latest mutation for one object across sparse generations', async () => {
    const reader = new DbLessFreshExactCurrentReader({
      checkpoint: checkpoint(),
      checkpointThroughLedgerIndex: 100,
      currentThroughLedgerIndex: 130,
      tailGenerations: [
        generation('g1', 110, 110, [mutation({ id: 'A1', ledger: 110 })]),
        generation('g2', 125, 125, [
          mutation({ id: 'A1', ledger: 125, value: { id: 'A1', version: 2 } }),
        ]),
      ],
    })

    const result = await reader.get('vault', 'A1')
    expect(result.item).toMatchObject({
      source: 'tail',
      sourceLedgerIndex: 125,
      value: { id: 'A1', version: 2 },
    })
  })

  it('rejects a sparse tail generation that overlaps the D4 checkpoint boundary', () => {
    expect(() => new DbLessFreshExactCurrentReader({
      checkpoint: checkpoint(),
      checkpointThroughLedgerIndex: 100,
      currentThroughLedgerIndex: 120,
      tailGenerations: [
        generation('g1', 100, 101, [mutation({ id: 'A1', ledger: 101 })]),
      ],
    })).toThrow('tail generation boundaries')
  })
})
