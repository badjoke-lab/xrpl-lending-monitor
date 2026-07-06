import { describe, expect, it } from 'vitest'

import {
  compareReplacementMutationPosition,
  prepareReplacementMutation,
  replacementReadKind,
} from './replacement-read-model'

const HASH_A = 'A'.repeat(64)
const HASH_B = 'B'.repeat(64)
const HASH_C = 'C'.repeat(64)

function envelope(mutation: Record<string, unknown>) {
  return {
    ledgerIndex: 100,
    ledgerHash: HASH_A,
    transactionHash: HASH_B,
    transactionIndex: 2,
    mutation,
  }
}

describe('replacement current-state read-model mutations', () => {
  it('maps overlay object types to read-model kinds', () => {
    expect(replacementReadKind('vault')).toBe('vault')
    expect(replacementReadKind('loan_broker')).toBe('loan-broker')
    expect(replacementReadKind('loan')).toBe('loan')
  })

  it('prepares a canonical upsert mutation', () => {
    const projectionJson = JSON.stringify({ id: HASH_C, kind: 'loan_broker', vaultId: HASH_A })
    expect(prepareReplacementMutation(envelope({
      operation: 'upsert',
      objectType: 'loan_broker',
      objectId: HASH_C,
      projectionJson,
    }))).toEqual({
      operation: 'upsert',
      readKind: 'loan-broker',
      objectId: HASH_C,
      projectionJson,
      ledgerIndex: 100,
      ledgerHash: HASH_A,
      transactionHash: HASH_B,
      transactionIndex: 2,
    })
  })

  it('prepares a deletion without projection payload', () => {
    expect(prepareReplacementMutation(envelope({
      operation: 'deleted',
      objectType: 'loan',
      objectId: HASH_C,
    }))).toMatchObject({
      operation: 'deleted',
      readKind: 'loan',
      objectId: HASH_C,
      projectionJson: null,
    })
  })

  it('rejects projection identity and kind mismatches', () => {
    expect(() => prepareReplacementMutation(envelope({
      operation: 'upsert',
      objectType: 'vault',
      objectId: HASH_C,
      projectionJson: JSON.stringify({ id: HASH_A, kind: 'vault' }),
    }))).toThrow('projection id does not match')

    expect(() => prepareReplacementMutation(envelope({
      operation: 'upsert',
      objectType: 'vault',
      objectId: HASH_C,
      projectionJson: JSON.stringify({ id: HASH_C, kind: 'loan' }),
    }))).toThrow('projection kind does not match')
  })

  it('orders ledger position before transaction position', () => {
    expect(compareReplacementMutationPosition(
      { ledgerIndex: 100, transactionIndex: 2 },
      { ledgerIndex: 100, transactionIndex: 3 },
    )).toBeLessThan(0)
    expect(compareReplacementMutationPosition(
      { ledgerIndex: 101, transactionIndex: 0 },
      { ledgerIndex: 100, transactionIndex: 99 },
    )).toBeGreaterThan(0)
  })
})
