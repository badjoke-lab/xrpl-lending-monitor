import { describe, expect, it } from 'vitest'

import {
  advanceCurrentStateOverlayWatermark,
  applyCurrentStateOverlayMutation,
  assertCurrentStateOverlayBase,
  initializeCurrentStateOverlay,
  type CurrentStateOverlayBaseIdentity,
} from './current-state-overlay'

const base: CurrentStateOverlayBaseIdentity = {
  network: 'devnet',
  epochId: 'epoch-1',
  baseSnapshotId: 'snapshot-1',
  baseLedgerIndex: 100,
  baseLedgerHash: 'BASE',
}

const stateRow = {
  network: 'devnet',
  epoch_id: 'epoch-1',
  base_snapshot_id: 'snapshot-1',
  base_ledger_index: 100,
  base_ledger_hash: 'BASE',
  overlay_ledger_index: 100,
  overlay_ledger_hash: 'BASE',
  updated_at: '2026-07-04T13:00:00.000Z',
}

const upsertRow = {
  operation: 'upsert',
  projection_json: '{"id":"LOAN_A"}',
  source_ledger_index: 101,
  source_ledger_hash: 'L101',
  source_transaction_hash: 'TX_A',
  source_transaction_index: 1,
}

function scriptedDatabase(rows: Array<Record<string, unknown> | null>, changes: number[] = []) {
  const pendingRows = [...rows]
  const pendingChanges = [...changes]
  const runs: string[] = []
  const db = {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement
        },
        async first<T>() {
          return (pendingRows.shift() ?? null) as T | null
        },
        async run() {
          runs.push(sql)
          return { success: true, meta: { changes: pendingChanges.shift() ?? 1 } }
        },
      }
      return statement
    },
  }
  return { db: db as unknown as D1Database, runs }
}

function source(ledgerIndex: number, transactionIndex: number, transactionHash: string) {
  return {
    ledgerIndex,
    ledgerHash: `L${ledgerIndex}`,
    transactionHash,
    transactionIndex,
    updatedAt: '2026-07-04T13:01:00.000Z',
  }
}

describe('current-state overlay repository', () => {
  it('initializes at the base ledger and rejects mismatched base identity', async () => {
    const initialized = scriptedDatabase([stateRow]).db
    await expect(
      initializeCurrentStateOverlay({
        db: initialized,
        base,
        initializedAt: stateRow.updated_at,
      }),
    ).resolves.toMatchObject({ overlayLedgerIndex: 100, overlayLedgerHash: 'BASE' })

    const mismatched = scriptedDatabase([stateRow]).db
    await expect(
      assertCurrentStateOverlayBase({
        db: mismatched,
        base: { ...base, baseLedgerHash: 'WRONG' },
      }),
    ).rejects.toThrow('base identity mismatch')
  })

  it('applies one upsert and treats exact replay as idempotent', async () => {
    const first = scriptedDatabase([stateRow, null, upsertRow])
    await expect(
      applyCurrentStateOverlayMutation({
        db: first.db,
        base,
        mutation: {
          operation: 'upsert',
          objectType: 'loan',
          objectId: 'LOAN_A',
          projectionJson: upsertRow.projection_json,
        },
        source: source(101, 1, 'TX_A'),
      }),
    ).resolves.toBe('applied')
    expect(first.runs).toHaveLength(1)

    const replay = scriptedDatabase([stateRow, upsertRow])
    await expect(
      applyCurrentStateOverlayMutation({
        db: replay.db,
        base,
        mutation: {
          operation: 'upsert',
          objectType: 'loan',
          objectId: 'LOAN_A',
          projectionJson: upsertRow.projection_json,
        },
        source: source(101, 1, 'TX_A'),
      }),
    ).resolves.toBe('replayed')
    expect(replay.runs).toHaveLength(0)
  })

  it('stores a later deletion tombstone and ignores an older mutation', async () => {
    const tombstone = {
      operation: 'deleted',
      projection_json: null,
      source_ledger_index: 102,
      source_ledger_hash: 'L102',
      source_transaction_hash: 'TX_DELETE',
      source_transaction_index: 0,
    }
    const deleted = scriptedDatabase([stateRow, upsertRow, tombstone])
    await expect(
      applyCurrentStateOverlayMutation({
        db: deleted.db,
        base,
        mutation: { operation: 'deleted', objectType: 'loan', objectId: 'LOAN_A' },
        source: source(102, 0, 'TX_DELETE'),
      }),
    ).resolves.toBe('applied')

    const stale = scriptedDatabase([stateRow, tombstone])
    await expect(
      applyCurrentStateOverlayMutation({
        db: stale.db,
        base,
        mutation: {
          operation: 'upsert',
          objectType: 'loan',
          objectId: 'LOAN_A',
          projectionJson: '{"id":"LOAN_A","stale":true}',
        },
        source: source(101, 2, 'TX_STALE'),
      }),
    ).resolves.toBe('stale')
    expect(stale.runs).toHaveLength(0)
  })

  it('advances the watermark with compare-and-set semantics', async () => {
    const database = scriptedDatabase([stateRow], [1]).db
    await expect(
      advanceCurrentStateOverlayWatermark({
        db: database,
        base,
        expectedPreviousLedgerIndex: 100,
        expectedPreviousLedgerHash: 'BASE',
        nextLedgerIndex: 101,
        nextLedgerHash: 'L101',
        advancedAt: '2026-07-04T13:01:00.000Z',
      }),
    ).resolves.toBe('advanced')
  })
})
