import { describe, expect, it } from 'vitest'

import type { Bindings } from '../env'
import { encodeFastLaneHistoryBundle } from '../repositories/fast-lane-history-codec'
import type { FastLaneHistoryBundle } from '../repositories/fast-lane-history-window'
import { handleHybridTransactionDetail } from './hybrid-transaction-detail'

const HASH = 'A'.repeat(64)

function bundle(): FastLaneHistoryBundle {
  return {
    schemaVersion: 1,
    epochId: 'devnet-epoch-1',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    endLedgerHash: 'B'.repeat(64),
    createdAt: '2026-07-24T14:10:00.000Z',
    protocolEvents: [{
      eventHash: HASH,
      epochId: 'devnet-epoch-1',
      ledgerIndex: 101,
      eventIndex: 1,
      closeTime: 800_000_000,
      eventType: 'LoanPay',
      resultCode: 'tesSUCCESS',
      payloadRetained: false,
      sourceJson: null,
      metadataJson: null,
      createdAt: '2026-07-24T14:10:00.000Z',
    }],
    objectChanges: [{
      transactionHash: HASH,
      epochId: 'devnet-epoch-1',
      ledgerIndex: 101,
      transactionIndex: 1,
      transactionType: 'LoanPay',
      resultCode: 'tesSUCCESS',
      closeTime: 800_000_000,
      nodeIndex: 0,
      objectType: 'Loan',
      objectId: 'C'.repeat(64),
      action: 'modified',
      fieldName: 'TotalValueOutstanding',
      beforeJson: '100',
      afterJson: '90',
      valueType: 'string',
      unsupportedField: false,
      vaultId: null,
      loanBrokerId: 'D'.repeat(64),
      loanId: 'C'.repeat(64),
      account: null,
      owner: null,
      borrower: 'rBorrower',
      assetKey: 'XRP',
      mptIssuanceId: null,
      createdAt: '2026-07-24T14:10:00.000Z',
    }],
    loanLifecycle: [],
    archivedObjects: [],
    balanceHistory: [],
  }
}

async function database(): Promise<D1Database> {
  const encoded = await encodeFastLaneHistoryBundle(bundle())
  return {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement
        },
        async first<T>() {
          if (sql.includes('FROM protocol_events')) return null
          if (sql.includes('FROM fast_lane_shadow_windows')) {
            return { bundle_json: encoded } as T
          }
          return null
        },
        async all<T>() {
          if (sql.includes('FROM object_changes')) return { results: [] as T[] }
          return { results: [] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('hybrid transaction detail route', () => {
  it('serves a recent transaction from bounded fast-lane history', async () => {
    const response = await handleHybridTransactionDetail(
      new Request(`https://example.test/api/transactions/${HASH.toLowerCase()}`),
      { DB: await database() } as Bindings,
    )

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({
      found: true,
      transaction_hash: HASH,
      event: { transaction_hash: HASH, transaction_type: 'LoanPay' },
      object_changes: [{ transaction_hash: HASH, object_type: 'Loan' }],
    })
  })

  it('does not intercept non-transaction routes', async () => {
    await expect(handleHybridTransactionDetail(
      new Request('https://example.test/api/overview'),
      { DB: await database() } as Bindings,
    )).resolves.toBeNull()
  })
})
