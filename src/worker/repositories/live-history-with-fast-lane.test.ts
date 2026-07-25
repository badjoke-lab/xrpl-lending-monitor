import { describe, expect, it } from 'vitest'

import { encodeFastLaneHistoryBundle } from './fast-lane-history-codec'
import type { FastLaneHistoryBundle } from './fast-lane-history-window'
import { listLiveObjectHistoryAfterBoundary } from './live-history-with-fast-lane'

const OBJECT_ID = 'A'.repeat(64)
const TRANSACTION_HASH = 'B'.repeat(64)

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
    endLedgerHash: 'C'.repeat(64),
    createdAt: '2026-07-25T00:00:00.000Z',
    protocolEvents: [],
    objectChanges: [objectChange('Account', 0), objectChange('OwnerNode', 0)],
    loanLifecycle: [],
    archivedObjects: [],
    balanceHistory: [],
  }
}

async function database(): Promise<{ db: D1Database, canonicalQueries: () => number }> {
  const encoded = await encodeFastLaneHistoryBundle(bundle())
  let canonicalQueryCount = 0
  const db = {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement
        },
        async all<T>() {
          if (sql.includes('FROM fast_lane_history_windows')) {
            return { results: [{ bundle_json: encoded }] as T[] }
          }
          if (sql.includes('FROM object_changes')) {
            canonicalQueryCount += 1
            return { results: [] as T[] }
          }
          return { results: [] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
  return { db, canonicalQueries: () => canonicalQueryCount }
}

describe('live object history with fast-lane bundles', () => {
  it('does not scan canonical object_changes when fast-lane history fills the page', async () => {
    const { db, canonicalQueries } = await database()

    const changes = await listLiveObjectHistoryAfterBoundary(
      db,
      'Vault',
      OBJECT_ID,
      100,
      { limit: 2 },
    )

    expect(changes).toHaveLength(2)
    expect(changes.map((change) => change.fieldName)).toEqual(['Account', 'OwnerNode'])
    expect(canonicalQueries()).toBe(0)
  })
})
