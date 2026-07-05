import { describe, expect, it } from 'vitest'

import type { LoanCurrentProjection } from '../../domain/lending/current-projections'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { listBaseOverlayLoans } from './base-overlay-loan-reader'
import type { ReleaseCurrentStateSource } from './release-current-state'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-loan-test',
  epochId: 'epoch-loan-test',
  ledgerIndex: 100,
  ledgerHash: 'BASE',
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'A'.repeat(64),
  vaultCount: 1,
  loanBrokerCount: 1,
  loanCount: 100,
  objectCount: 102,
  shardCount: 10,
  compressedBytes: 0,
  completedAt: '2026-07-05T00:00:00.000Z',
}

function loan(id: string): LoanCurrentProjection {
  return {
    kind: 'loan',
    id,
    loanBrokerId: 'B'.repeat(64),
    borrower: 'rBorrower',
    loanSequence: 1,
    loanOriginationFee: '0',
    loanServiceFee: '0',
    latePaymentFee: '0',
    closePaymentFee: '0',
    overpaymentFeeRate: 0,
    interestRate: 0,
    lateInterestRate: 0,
    closeInterestRate: 0,
    overpaymentInterestRate: 0,
    startDate: 10,
    paymentInterval: 1000,
    gracePeriod: 100,
    previousPaymentDueDate: 10,
    nextPaymentDueDate: 1000,
    paymentRemaining: 10,
    principalOutstanding: '1000',
    totalValueOutstanding: '1000',
    managementFeeOutstanding: '0',
    periodicPayment: '100',
    loanScale: null,
    onLedgerStatus: 'active',
    supportsOverpayment: true,
    flags: 0,
    dataHex: null,
    previousTxHash: 'C'.repeat(64),
    previousLedgerIndex: 100,
    raw: { LedgerEntryType: 'Loan', index: id },
  }
}

function record(projection: LoanCurrentProjection): ReleaseNativeDataRecord {
  return {
    schemaVersion: 1,
    segmentId: 'segment-test',
    sourcePage: 1,
    id: projection.id,
    kind: 'loan',
    valueSha256: '0'.repeat(64),
    value: { __readModelProjection: projection },
  }
}

function database(): D1Database {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = []
      const statement = {
        bind(...values: unknown[]) {
          bindings = values
          return statement
        },
        async first<T>() {
          if (sql.includes('FROM current_state_overlay_state')) {
            return {
              network: 'devnet',
              epoch_id: snapshot.epochId,
              base_snapshot_id: snapshot.id,
              base_ledger_index: snapshot.ledgerIndex,
              base_ledger_hash: snapshot.ledgerHash,
              overlay_ledger_index: 100,
              overlay_ledger_hash: 'BASE',
              updated_at: '2026-07-05T00:01:00.000Z',
            } as T
          }
          return null
        },
        async all<T>() {
          void bindings
          return { results: [] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

function releaseSource(onList: () => void): ReleaseCurrentStateSource {
  const projection = loan('1'.repeat(64))
  return {
    kind: 'release',
    db: database(),
    readModel: { updatedAt: snapshot.completedAt } as ReleaseCurrentStateSource['readModel'],
    opened: {
      manifest: {
        schemaVersion: 1,
        snapshotId: snapshot.id,
        epochId: snapshot.epochId,
        releaseTag: 'test',
        ledgerIndex: snapshot.ledgerIndex,
        ledgerHash: snapshot.ledgerHash,
        complete: true,
        pageSize: 100,
        lookupPrefixLength: 1,
        counts: { vaults: 1, loanBrokers: 1, loans: 100 },
        pageCounts: { vaults: 1, loanBrokers: 1, loans: 10 },
        manifestSha256: snapshot.manifestSha256,
      },
      reader: {
        async listObjects() {
          onList()
          return {
            items: [record(projection)],
            nextCursor: 'next-raw-page',
            complete: false,
            assetReads: 1,
          }
        },
        async getObject() {
          throw new Error('relationship lookup should not run for a filtered-out raw page')
        },
      },
    },
  } as ReleaseCurrentStateSource
}

describe('base plus overlay loan list reader', () => {
  it('bounds a selective filter to one raw page and returns a continuation cursor', async () => {
    let listCalls = 0
    const storage = releaseSource(() => {
      listCalls += 1
      if (listCalls > 1) throw new Error('selective filter scanned more than one raw page')
    })

    const result = await listBaseOverlayLoans(database(), storage, snapshot, {
      limit: 5,
      sort: 'id_asc',
      onLedgerStatus: 'active',
      scheduleStatus: 'payment_due',
      evaluatedAtRippleTime: 100,
    })

    expect(listCalls).toBe(1)
    expect(result.data).toEqual([])
    expect(result.nextCursor).not.toBeNull()
    expect(result.loanShardsRead).toBe(1)
  })
})
