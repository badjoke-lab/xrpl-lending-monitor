import { describe, expect, it } from 'vitest'

import {
  coalesceLatestOverlayMutations,
  type SourcedOverlayMutation,
} from './coalesced-overlay-mutations'

function sourced(options: {
  objectId: string
  ledgerIndex: number
  transactionIndex: number
  operation?: 'upsert' | 'deleted'
}): SourcedOverlayMutation {
  const operation = options.operation ?? 'upsert'
  return {
    mutation: operation === 'upsert'
      ? {
          operation,
          objectType: 'loan',
          objectId: options.objectId,
          projectionJson: JSON.stringify({ ledger: options.ledgerIndex, tx: options.transactionIndex }),
        }
      : {
          operation,
          objectType: 'loan',
          objectId: options.objectId,
        },
    ledgerIndex: options.ledgerIndex,
    ledgerHash: `${options.ledgerIndex}`.padStart(64, '0'),
    transactionHash: `${options.ledgerIndex}-${options.transactionIndex}`,
    transactionIndex: options.transactionIndex,
    updatedAt: '2026-07-11T00:00:00.000Z',
  }
}

describe('coalesceLatestOverlayMutations', () => {
  it('keeps one latest mutation per object across a window', () => {
    const entries = [
      sourced({ objectId: 'A', ledgerIndex: 100, transactionIndex: 1 }),
      sourced({ objectId: 'B', ledgerIndex: 100, transactionIndex: 2 }),
      sourced({ objectId: 'A', ledgerIndex: 101, transactionIndex: 0 }),
    ]

    const result = coalesceLatestOverlayMutations(entries)

    expect(result).toHaveLength(2)
    expect(result.map((entry) => entry.mutation.objectId)).toEqual(['B', 'A'])
    expect(result.at(-1)?.ledgerIndex).toBe(101)
  })

  it('keeps the later transaction in the same ledger', () => {
    const result = coalesceLatestOverlayMutations([
      sourced({ objectId: 'A', ledgerIndex: 100, transactionIndex: 8 }),
      sourced({ objectId: 'A', ledgerIndex: 100, transactionIndex: 3 }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.transactionIndex).toBe(8)
  })

  it('keeps a later deletion as the final current-state mutation', () => {
    const result = coalesceLatestOverlayMutations([
      sourced({ objectId: 'A', ledgerIndex: 100, transactionIndex: 1 }),
      sourced({ objectId: 'A', ledgerIndex: 102, transactionIndex: 4, operation: 'deleted' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.mutation.operation).toBe('deleted')
    expect(result[0]?.ledgerIndex).toBe(102)
  })
})
