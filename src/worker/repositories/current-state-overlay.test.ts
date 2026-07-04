import { describe, expect, it } from 'vitest'

import {
  advanceCurrentStateOverlayWatermark,
  applyCurrentStateOverlayMutation,
  assertCurrentStateOverlayBase,
  initializeCurrentStateOverlay,
  type CurrentStateOverlayBaseIdentity,
} from './current-state-overlay'

interface FakeStateRow {
  network: string
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  overlay_ledger_index: number
  overlay_ledger_hash: string
  updated_at: string
}

interface FakeObjectRow {
  operation: 'upsert' | 'deleted'
  projection_json: string | null
  source_ledger_index: number
  source_ledger_hash: string
  source_transaction_hash: string
  source_transaction_index: number
}

class FakeOverlayDatabase {
  state: FakeStateRow | null = null
  object: FakeObjectRow | null = null
  objectWrites = 0

  prepare(sql: string) {
    const database = this
    let values: unknown[] = []
    return {
      bind(...bound: unknown[]) {
        values = bound
        return this
      },
      async first() {
        if (sql.includes('FROM current_state_overlay_state')) return database.state
        if (sql.includes('FROM current_state_overlay_objects')) return database.object
        throw new Error(`Unexpected first SQL: ${sql}`)
      },
      async run() {
        if (sql.includes('INSERT INTO current_state_overlay_state')) {
          if (!database.state) {
            database.state = {
              network: String(values[0]),
              epoch_id: String(values[1]),
              base_snapshot_id: String(values[2]),
              base_ledger_index: Number(values[3]),
              base_ledger_hash: String(values[4]),
              overlay_ledger_index: Number(values[3]),
              overlay_ledger_hash: String(values[4]),
              updated_at: String(values[5]),
            }
            return { success: true, meta: { changes: 1 } }
          }
          return { success: true, meta: { changes: 0 } }
        }

        if (sql.includes('INSERT INTO current_state_overlay_objects')) {
          const incoming: FakeObjectRow = {
            operation: values[5] as FakeObjectRow['operation'],
            projection_json: values[6] as string | null,
            source_ledger_index: Number(values[14]),
            source_ledger_hash: String(values[15]),
            source_transaction_hash: String(values[16]),
            source_transaction_index: Number(values[17]),
          }
          const existing = database.object
          const isNewer = !existing ||
            incoming.source_ledger_index > existing.source_ledger_index ||
            (
              incoming.source_ledger_index === existing.source_ledger_index &&
              incoming.source_transaction_index > existing.source_transaction_index
            )
          if (isNewer) {
            database.object = incoming
            database.objectWrites += 1
            return { success: true, meta: { changes: 1 } }
          }
          return { success: true, meta: { changes: 0 } }
        }

        if (sql.includes('UPDATE current_state_overlay_state')) {
          if (!database.state) return { success: true, meta: { changes: 0 } }
          const matches =
            database.state.network === values[3] &&
            database.state.epoch_id === values[4] &&
            database.state.base_snapshot_id === values[5] &&
            database.state.base_ledger_index === values[6] &&
            database.state.base_ledger_hash === values[7] &&
            database.state.overlay_ledger_index === values[8] &&
            database.state.overlay_ledger_hash === values[9]
          if (!matches) return { success: true, meta: { changes: 0 } }
          database.state.overlay_ledger_index = Number(values[0])
          database.state.overlay_ledger_hash = String(values[1])
          database.state.updated_at = String(values[2])
          return { success: true, meta: { changes: 1 } }
        }

        throw new Error(`Unexpected run SQL: ${sql}`)
      },
    }
  }
}

const base: CurrentStateOverlayBaseIdentity = {
  network: 'devnet',
  epochId: 'devnet-3371675',
  baseSnapshotId: 'devnet-3371675-0ba2ed766c19',
  baseLedgerIndex: 3371675,
  baseLedgerHash: 'BASE_HASH',
}

function source(ledgerIndex: number, transactionIndex: number, transactionHash: string) {
  return {
    ledgerIndex,
    ledgerHash: `LEDGER_${ledgerIndex}`,
    transactionHash,
    transactionIndex,
    updatedAt: `2026-07-04T13:${String(transactionIndex).padStart(2, '0')}:00.000Z`,
  }
}

function database(): { fake: FakeOverlayDatabase; db: D1Database } {
  const fake = new FakeOverlayDatabase()
  return { fake, db: fake as unknown as D1Database }
}

describe('current-state D1 overlay foundation', () => {
  it('initializes the watermark at the base ledger and fails closed on base mismatch', async () => {
    const { db } = database()

    const initialized = await initializeCurrentStateOverlay({
      db,
      base,
      initializedAt: '2026-07-04T13:00:00.000Z',
    })

    expect(initialized.overlayLedgerIndex).toBe(base.baseLedgerIndex)
    expect(initialized.overlayLedgerHash).toBe(base.baseLedgerHash)

    await expect(
      assertCurrentStateOverlayBase({
        db,
        base: { ...base, baseLedgerHash: 'WRONG_HASH' },
      }),
    ).rejects.toThrow('base identity mismatch')
  })

  it('stores one canonical overlay row, treats exact replay as idempotent, and rejects same-position conflict', async () => {
    const { fake, db } = database()
    await initializeCurrentStateOverlay({
      db,
      base,
      initializedAt: '2026-07-04T13:00:00.000Z',
    })

    const mutation = {
      operation: 'upsert' as const,
      objectType: 'loan' as const,
      objectId: 'LOAN_A',
      projectionJson: '{"id":"LOAN_A","paymentRemaining":9}',
      relationships: {
        borrower: 'rBorrower',
        loanBrokerId: 'BROKER_A',
        onLedgerStatus: 'active' as const,
      },
    }

    await expect(
      applyCurrentStateOverlayMutation({
        db,
        base,
        mutation,
        source: source(3371676, 1, 'TX_A'),
      }),
    ).resolves.toBe('applied')

    await expect(
      applyCurrentStateOverlayMutation({
        db,
        base,
        mutation,
        source: source(3371676, 1, 'TX_A'),
      }),
    ).resolves.toBe('replayed')

    expect(fake.objectWrites).toBe(1)

    await expect(
      applyCurrentStateOverlayMutation({
        db,
        base,
        mutation: { ...mutation, projectionJson: '{"id":"LOAN_A","paymentRemaining":8}' },
        source: source(3371676, 1, 'TX_CONFLICT'),
      }),
    ).rejects.toThrow('Conflicting current-state overlay mutation')
  })

  it('replaces an upsert with a later deletion tombstone and ignores stale mutations', async () => {
    const { fake, db } = database()
    await initializeCurrentStateOverlay({
      db,
      base,
      initializedAt: '2026-07-04T13:00:00.000Z',
    })

    await applyCurrentStateOverlayMutation({
      db,
      base,
      mutation: {
        operation: 'upsert',
        objectType: 'loan',
        objectId: 'LOAN_B',
        projectionJson: '{"id":"LOAN_B"}',
      },
      source: source(3371676, 1, 'TX_CREATE'),
    })

    await expect(
      applyCurrentStateOverlayMutation({
        db,
        base,
        mutation: {
          operation: 'deleted',
          objectType: 'loan',
          objectId: 'LOAN_B',
        },
        source: source(3371677, 0, 'TX_DELETE'),
      }),
    ).resolves.toBe('applied')

    expect(fake.object?.operation).toBe('deleted')
    expect(fake.object?.projection_json).toBeNull()

    await expect(
      applyCurrentStateOverlayMutation({
        db,
        base,
        mutation: {
          operation: 'upsert',
          objectType: 'loan',
          objectId: 'LOAN_B',
          projectionJson: '{"id":"LOAN_B","stale":true}',
        },
        source: source(3371676, 2, 'TX_STALE'),
      }),
    ).resolves.toBe('stale')

    expect(fake.object?.operation).toBe('deleted')
  })

  it('advances the overlay watermark with compare-and-set semantics and replays safely', async () => {
    const { db } = database()
    await initializeCurrentStateOverlay({
      db,
      base,
      initializedAt: '2026-07-04T13:00:00.000Z',
    })

    const advance = {
      db,
      base,
      expectedPreviousLedgerIndex: base.baseLedgerIndex,
      expectedPreviousLedgerHash: base.baseLedgerHash,
      nextLedgerIndex: 3371676,
      nextLedgerHash: 'LEDGER_3371676',
      advancedAt: '2026-07-04T13:01:00.000Z',
    }

    await expect(advanceCurrentStateOverlayWatermark(advance)).resolves.toBe('advanced')
    await expect(advanceCurrentStateOverlayWatermark(advance)).resolves.toBe('replayed')

    await expect(
      advanceCurrentStateOverlayWatermark({
        ...advance,
        nextLedgerIndex: 3371677,
        nextLedgerHash: 'LEDGER_3371677',
      }),
    ).rejects.toThrow('watermark changed before advancement')
  })
})
