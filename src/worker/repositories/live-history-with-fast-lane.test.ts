import { describe, expect, it } from 'vitest'

import { encodeFastLaneHistoryBundle } from './fast-lane-history-codec'
import type { FastLaneHistoryBundle } from './fast-lane-history-window'
import {
  listLiveArchivedObjectsAfterBoundary,
  listLiveBalanceHistoryAfterBoundary,
  listLiveLoanLifecycleAfterBoundary,
  listLiveObjectHistoryAfterBoundary,
} from './live-history-with-fast-lane'

const OBJECT_ID = 'A'.repeat(64)
const TRANSACTION_HASH = 'B'.repeat(64)
const LOAN_ID = 'C'.repeat(64)
const ARCHIVED_ID = 'D'.repeat(64)
const SUBJECT_ID = 'E'.repeat(64)

function objectChange(fieldName: string, nodeIndex: number) {
  return {
    transactionHash: TRANSACTION_HASH,
    epochId: 'devnet-epoch-1',
    ledgerIndex: 101,
    transactionIndex: 0,
    transactionType: 'VaultCreate',
    resultCode: 'tesSUCCESS',
    closeTime: 800_000_000,
    nodeIndex,
    objectType: 'Vault',
    objectId: OBJECT_ID,
    action: 'created' as const,
    fieldName,
    beforeJson: null,
    afterJson: fieldName,
    valueType: 'string',
    unsupportedField: false,
    vaultId: OBJECT_ID,
    loanBrokerId: null,
    loanId: null,
    account: 'rAccount',
    owner: 'rOwner',
    borrower: null,
    assetKey: null,
    mptIssuanceId: null,
    createdAt: '2026-07-25T00:00:00.000Z',
  }
}

function bundle(): FastLaneHistoryBundle {
  return {
    schemaVersion: 1,
    epochId: 'devnet-epoch-1',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    endLedgerHash: 'F'.repeat(64),
    createdAt: '2026-07-25T00:00:00.000Z',
    protocolEvents: [],
    objectChanges: [
      objectChange('Account', 0),
      objectChange('OwnerNode', 0),
    ],
    loanLifecycle: [{
      loanId: LOAN_ID,
      epochId: 'devnet-epoch-1',
      transactionHash: '1'.repeat(64),
      ledgerIndex: 101,
      transactionIndex: 0,
      closeTime: 800_000_000,
      eventType: 'created',
      transactionType: 'LoanSet',
      resultCode: 'tesSUCCESS',
      statusBefore: 'none',
      statusAfter: 'active',
      principalBefore: null,
      principalAfter: '100',
      totalValueBefore: null,
      totalValueAfter: '100',
      paymentRemainingBefore: null,
      paymentRemainingAfter: 1,
      detailsJson: {},
      createdAt: '2026-07-25T00:00:00.000Z',
    }],
    archivedObjects: [{
      epochId: 'devnet-epoch-1',
      objectType: 'LoanBroker',
      objectId: ARCHIVED_ID,
      deletionTransactionHash: '2'.repeat(64),
      deletionLedgerIndex: 101,
      deletionTransactionIndex: 0,
      deletionCloseTime: 800_000_000,
      deletionReason: 'loan_broker_delete',
      finalStateJson: {},
      vaultId: null,
      loanBrokerId: ARCHIVED_ID,
      loanId: null,
      owner: null,
      account: null,
      borrower: null,
      assetKey: null,
      archivedAt: '2026-07-25T00:00:00.000Z',
    }],
    balanceHistory: [{
      epochId: 'devnet-epoch-1',
      subjectType: 'LoanBroker',
      subjectId: SUBJECT_ID,
      transactionHash: '3'.repeat(64),
      ledgerIndex: 101,
      transactionIndex: 0,
      closeTime: 800_000_000,
      metricType: 'debt_total',
      assetKey: null,
      beforeValue: '0',
      afterValue: '100',
      formula: null,
      sourceFieldsJson: {},
      createdAt: '2026-07-25T00:00:00.000Z',
    }],
  }
}

async function database(): Promise<{
  db: D1Database
  canonicalQueries: () => number
  lookupQueries: () => number
}> {
  const encoded = await encodeFastLaneHistoryBundle(bundle())
  let canonicalQueryCount = 0
  let lookupQueryCount = 0

  const db = {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement
        },
        async all<T>() {
          if (sql.includes('object_lookup_json')) {
            lookupQueryCount += 1
            return {
              results: [{ bundle_json: encoded }] as T[],
            }
          }
          if (
            sql.includes('FROM object_changes')
            || sql.includes('FROM loan_lifecycle_events')
            || sql.includes('FROM archived_objects')
            || sql.includes('FROM balance_history')
          ) {
            canonicalQueryCount += 1
          }
          return { results: [] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database

  return {
    db,
    canonicalQueries: () => canonicalQueryCount,
    lookupQueries: () => lookupQueryCount,
  }
}

describe('live history with fast-lane bundles', () => {
  it('decodes only matching object windows and skips canonical reads when full', async () => {
    const { db, canonicalQueries } = await database()

    const changes = await listLiveObjectHistoryAfterBoundary(
      db,
      'Vault',
      OBJECT_ID,
      100,
      { limit: 2 },
    )

    expect(changes).toHaveLength(2)
    expect(changes.map((change) => change.fieldName)).toEqual([
      'Account',
      'OwnerNode',
    ])
    expect(canonicalQueries()).toBe(0)
  })

  it('uses lookup-limited windows for lifecycle, archive, and balance', async () => {
    const { db, lookupQueries } = await database()

    const lifecycle = await listLiveLoanLifecycleAfterBoundary(
      db,
      LOAN_ID,
      100,
      { limit: 100 },
    )
    const archives = await listLiveArchivedObjectsAfterBoundary(
      db,
      100,
      {
        limit: 100,
        objectType: 'LoanBroker',
        query: ARCHIVED_ID,
      },
    )
    const balances = await listLiveBalanceHistoryAfterBoundary(
      db,
      100,
      {
        limit: 100,
        metricType: 'debt_total',
        subjectType: 'LoanBroker',
        subjectId: SUBJECT_ID,
      },
    )

    expect(lifecycle.map((item) => item.loanId)).toEqual([
      LOAN_ID,
    ])
    expect(archives.map((item) => item.objectId)).toEqual([
      ARCHIVED_ID,
    ])
    expect(balances.map((item) => item.subjectId)).toEqual([
      SUBJECT_ID,
    ])
    expect(lookupQueries()).toBe(3)
  })
})
