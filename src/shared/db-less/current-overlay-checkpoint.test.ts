import { describe, expect, it } from 'vitest'

import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import { buildDbLessCurrentOverlayCheckpoint } from './current-overlay-checkpoint'

const HASH_A = 'A'.repeat(64)
const HASH_B = 'B'.repeat(64)
const HASH_C = 'C'.repeat(64)

function projection(options: {
  type: 'vault' | 'loan_broker' | 'loan'
  id: string
  ledger: number
  ledgerHash: string
  tombstone?: boolean
  value?: Record<string, unknown>
  relationships?: string[]
}): NormalizedCandidateV1 {
  return {
    semanticClass: 'current-projection',
    canonicalKey: buildDbLessCurrentProjectionCanonicalKey(options.type, options.id),
    sourceLedgerIndex: options.ledger,
    sourceLedgerHash: options.ledgerHash,
    sourceTransactionHash: `TX-${options.ledger}-${options.id}`,
    objectId: options.id,
    relationshipIds: options.relationships ?? [],
    isTombstone: options.tombstone ?? false,
    value: options.tombstone ? null : (options.value ?? { id: options.id }),
  }
}

function generations(records101: NormalizedCandidateV1[], records102: NormalizedCandidateV1[]) {
  return [
    {
      generationId: 'g1',
      startLedgerIndex: 101,
      endLedgerIndex: 101,
      records: records101,
    },
    {
      generationId: 'g2',
      startLedgerIndex: 102,
      endLedgerIndex: 102,
      records: records102,
    },
  ]
}

async function shardRecords(
  built: Awaited<ReturnType<typeof buildDbLessCurrentOverlayCheckpoint>>,
): Promise<unknown[]> {
  return built.shardArtifacts.flatMap((artifact) => {
    const decoded = JSON.parse(new TextDecoder().decode(artifact.bytes)) as { records: unknown[] }
    return decoded.records
  })
}

describe('D4 Current overlay checkpoint', () => {
  it('coalesces later generations and preserves tombstones', async () => {
    const built = await buildDbLessCurrentOverlayCheckpoint({
      epochId: 'epoch-1',
      baseIdentity: 'base-1',
      throughLedgerIndex: 102,
      throughLedgerHash: HASH_C,
      bucketCount: 8,
      generations: generations(
        [
          projection({
            type: 'vault',
            id: 'A1',
            ledger: 101,
            ledgerHash: HASH_A,
            value: { version: 1 },
            relationships: ['owner:rONE', 'account:rONE'],
          }),
        ],
        [
          projection({
            type: 'vault',
            id: 'A1',
            ledger: 102,
            ledgerHash: HASH_B,
            tombstone: true,
            relationships: ['owner:rONE'],
          }),
        ],
      ),
    })

    expect(built.manifest.entryCount).toBe(1)
    expect(built.manifest.tombstoneCount).toBe(1)
    expect(built.manifest.generationCount).toBe(2)
    expect(built.manifest.sourceGenerationIds).toEqual(['g1', 'g2'])

    const records = await shardRecords(built) as Array<{
      sourceLedgerIndex: number
      isTombstone: boolean
      value: unknown
    }>
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      sourceLedgerIndex: 102,
      isTombstone: true,
      value: null,
    })
  })

  it('is deterministic when record order inside a generation changes', async () => {
    const first = projection({
      type: 'vault',
      id: 'A1',
      ledger: 101,
      ledgerHash: HASH_A,
      relationships: ['owner:rA'],
    })
    const second = projection({
      type: 'loan',
      id: 'B2',
      ledger: 101,
      ledgerHash: HASH_A,
      relationships: ['borrower:rB'],
    })

    const left = await buildDbLessCurrentOverlayCheckpoint({
      epochId: 'epoch-1',
      baseIdentity: 'base-1',
      throughLedgerIndex: 101,
      throughLedgerHash: HASH_A,
      bucketCount: 8,
      generations: [{
        generationId: 'g1',
        startLedgerIndex: 101,
        endLedgerIndex: 101,
        records: [first, second],
      }],
    })
    const right = await buildDbLessCurrentOverlayCheckpoint({
      epochId: 'epoch-1',
      baseIdentity: 'base-1',
      throughLedgerIndex: 101,
      throughLedgerHash: HASH_A,
      bucketCount: 8,
      generations: [{
        generationId: 'g1',
        startLedgerIndex: 101,
        endLedgerIndex: 101,
        records: [second, first],
      }],
    })

    expect(right.manifestArtifact.sha256).toBe(left.manifestArtifact.sha256)
    expect(
      right.shardArtifacts.map((artifact) => [artifact.key, artifact.sha256]),
    ).toEqual(
      left.shardArtifacts.map((artifact) => [artifact.key, artifact.sha256]),
    )
  })

  it('fails closed when one deterministic bucket exceeds its record guard', async () => {
    await expect(buildDbLessCurrentOverlayCheckpoint({
      epochId: 'epoch-1',
      baseIdentity: 'base-1',
      throughLedgerIndex: 101,
      throughLedgerHash: HASH_A,
      bucketCount: 1,
      maxRecordsPerShard: 1,
      generations: [{
        generationId: 'g1',
        startLedgerIndex: 101,
        endLedgerIndex: 101,
        records: [
          projection({ type: 'vault', id: 'A1', ledger: 101, ledgerHash: HASH_A }),
          projection({ type: 'loan', id: 'B2', ledger: 101, ledgerHash: HASH_A }),
        ],
      }],
    })).rejects.toThrow('record guard')
  })

  it('rejects non-current records and non-contiguous generation ranges', async () => {
    const invalid: NormalizedCandidateV1 = {
      ...projection({ type: 'vault', id: 'A1', ledger: 101, ledgerHash: HASH_A }),
      semanticClass: 'object-change',
    }

    await expect(buildDbLessCurrentOverlayCheckpoint({
      epochId: 'epoch-1',
      baseIdentity: 'base-1',
      throughLedgerIndex: 101,
      throughLedgerHash: HASH_A,
      generations: [{
        generationId: 'g1',
        startLedgerIndex: 101,
        endLedgerIndex: 101,
        records: [invalid],
      }],
    })).rejects.toThrow('only current-projection')

    await expect(buildDbLessCurrentOverlayCheckpoint({
      epochId: 'epoch-1',
      baseIdentity: 'base-1',
      throughLedgerIndex: 103,
      throughLedgerHash: HASH_C,
      generations: [
        {
          generationId: 'g1',
          startLedgerIndex: 101,
          endLedgerIndex: 101,
          records: [],
        },
        {
          generationId: 'g2',
          startLedgerIndex: 103,
          endLedgerIndex: 103,
          records: [],
        },
      ],
    })).rejects.toThrow('contiguous')
  })
})
