import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  fastIsNewer,
  type PositionedCurrentRow,
  usableFastSupersedes,
} from './three-layer-fast-read'

const snapshot = {
  ledgerIndex: 100,
} as ActiveSnapshotRecord

function row(overrides: Partial<PositionedCurrentRow> = {}): PositionedCurrentRow {
  return {
    object_id: 'A'.repeat(64),
    operation: 'upsert',
    projection_json: JSON.stringify({
      kind: 'vault',
      id: 'A'.repeat(64),
    }),
    source_ledger_index: 110,
    source_transaction_index: 2,
    ...overrides,
  }
}

describe('three-layer source precedence', () => {
  it('orders rows by ledger index then transaction index', () => {
    expect(fastIsNewer(row(), row({ source_ledger_index: 109, source_transaction_index: 99 }), snapshot))
      .toBe(true)
    expect(fastIsNewer(row(), row({ source_ledger_index: 110, source_transaction_index: 1 }), snapshot))
      .toBe(true)
    expect(fastIsNewer(row(), row({ source_ledger_index: 110, source_transaction_index: 2 }), snapshot))
      .toBe(false)
    expect(fastIsNewer(row(), row({ source_ledger_index: 111, source_transaction_index: 0 }), snapshot))
      .toBe(false)
  })

  it('lets a newer tombstone suppress canonical state', () => {
    expect(usableFastSupersedes({
      fast: row({ operation: 'deleted', projection_json: null }),
      overlay: row({ source_ledger_index: 109 }),
      snapshot,
      kind: 'vault',
    })).toBe(true)
  })

  it('does not let an invalid fast upsert suppress canonical state', () => {
    expect(usableFastSupersedes({
      fast: row({ projection_json: JSON.stringify({ kind: 'vault', id: 'B'.repeat(64) }) }),
      overlay: row({ source_ledger_index: 109 }),
      snapshot,
      kind: 'vault',
    })).toBe(false)
  })
})
