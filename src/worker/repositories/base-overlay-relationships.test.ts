import { describe, expect, it } from 'vitest'

import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { getBaseOverlayLoanBrokerById } from './base-overlay-loan-broker-reader'
import { getBaseOverlayLoanById } from './base-overlay-loan-reader'
import type { ReleaseCurrentStateSource } from './release-current-state'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 100,
  ledgerHash: 'BASE',
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'A'.repeat(64),
  vaultCount: 1,
  loanBrokerCount: 1,
  loanCount: 1,
  objectCount: 3,
  shardCount: 1,
  compressedBytes: 0,
  completedAt: '2026-07-04T00:00:00.000Z',
}

function vault(id: string, owner = `r${id}`): VaultCurrentProjection {
  return {
    kind: 'vault',
    id,
    owner,
    account: `${owner}-account`,
    asset: { kind: 'xrp', key: 'XRP', currency: 'XRP', issuer: null, issuanceId: null, displayCode: 'XRP' },
    assetsTotal: '100',
    assetsAvailable: '90',
    assetsMaximum: null,
    lossUnrealized: '0',
    shareMptId: 'B'.repeat(48),
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: 'C'.repeat(64),
    previousLedgerIndex: 100,
    raw: { LedgerEntryType: 'Vault', index: id },
  }
}

function broker(id: string, vaultId: string): LoanBrokerCurrentProjection {
  return {
    kind: 'loan_broker',
    id,
    vaultId,
    owner: `rOwner${id}`,
    account: `rAccount${id}`,
    sequence: 1,
    loanSequence: 1,
    managementFeeRate: null,
    ownerCount: 1,
    debtTotal: '10',
    debtMaximum: null,
    coverAvailable: '5',
    coverRateMinimum: 1000,
    coverRateLiquidation: 2000,
    flags: 0,
    dataHex: null,
    previousTxHash: 'D'.repeat(64),
    previousLedgerIndex: 100,
    raw: { LedgerEntryType: 'LoanBroker', index: id },
  }
}

function loan(id: string, loanBrokerId: string): LoanCurrentProjection {
  return {
    kind: 'loan',
    id,
    loanBrokerId,
    borrower: `rBorrower${id}`,
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
    startDate: 1,
    paymentInterval: 60,
    gracePeriod: 30,
    previousPaymentDueDate: 1,
    nextPaymentDueDate: 100,
    paymentRemaining: 1,
    principalOutstanding: '10',
    totalValueOutstanding: '10',
    managementFeeOutstanding: '0',
    periodicPayment: '10',
    loanScale: null,
    onLedgerStatus: 'active',
    supportsOverpayment: false,
    flags: 0,
    dataHex: null,
    previousTxHash: 'E'.repeat(64),
    previousLedgerIndex: 100,
    raw: { LedgerEntryType: 'Loan', index: id },
  }
}

type Projection = VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection

function kindOf(projection: Projection): ReadModelKind {
  if (projection.kind === 'loan_broker') return 'loan-broker'
  return projection.kind
}

function record(projection: Projection): ReleaseNativeDataRecord {
  return {
    schemaVersion: 1,
    segmentId: 'read-model',
    sourcePage: 0,
    id: projection.id,
    kind: kindOf(projection),
    valueSha256: '0'.repeat(64),
    value: { __readModelProjection: projection } as unknown as Record<string, unknown>,
  }
}

function source(baseItems: Projection[]): ReleaseCurrentStateSource {
  return {
    kind: 'release',
    db: {} as D1Database,
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
        counts: { vaults: 1, loanBrokers: 1, loans: 1 },
        pageCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
        manifestSha256: snapshot.manifestSha256,
      },
      reader: {
        async listObjects(kind, options, predicate) {
          const items = baseItems
            .filter((item) => kindOf(item) === kind)
            .map(record)
            .filter((item) => predicate ? predicate(item) : true)
            .slice(0, options.limit)
          return { items, nextCursor: null, assetReads: 1 }
        },
        async getObject(objectId) {
          const item = baseItems.find((candidate) => candidate.id === objectId)
          return { item: item ? record(item) : null, complete: true, assetReads: 1 }
        },
      },
    },
  } as ReleaseCurrentStateSource
}

interface OverlayRow {
  object_id: string
  object_type: 'vault' | 'loan_broker' | 'loan'
  operation: 'upsert' | 'deleted'
  projection_json: string | null
}

function database(rows: OverlayRow[]): D1Database {
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
              overlay_ledger_index: 105,
              overlay_ledger_hash: 'OVERLAY',
              updated_at: '2026-07-04T00:01:00.000Z',
            } as T
          }
          const objectType = bindings[2]
          const objectId = bindings[3]
          return (rows.find((row) => row.object_type === objectType && row.object_id === objectId) ?? null) as T | null
        },
        async all<T>() {
          const objectType = bindings[2]
          if (sql.includes('object_id IN')) {
            const ids = new Set(bindings.slice(3))
            return { results: rows.filter((row) => row.object_type === objectType && ids.has(row.object_id)) as T[] }
          }
          return { results: rows.filter((row) => row.object_type === objectType && row.operation === 'upsert') as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('base plus overlay relationship resolution', () => {
  it('uses overlay-updated and overlay-created related objects', async () => {
    const base = source([vault('V1'), broker('B1', 'V1'), loan('L1', 'B1')])
    const db = database([
      { object_type: 'vault', object_id: 'V2', operation: 'upsert', projection_json: JSON.stringify(vault('V2', 'rOverlayVault')) },
      { object_type: 'loan_broker', object_id: 'B1', operation: 'upsert', projection_json: JSON.stringify(broker('B1', 'V2')) },
      { object_type: 'loan_broker', object_id: 'B2', operation: 'upsert', projection_json: JSON.stringify(broker('B2', 'V2')) },
      { object_type: 'loan', object_id: 'L2', operation: 'upsert', projection_json: JSON.stringify(loan('L2', 'B2')) },
    ])

    await expect(getBaseOverlayLoanBrokerById(db, base, snapshot, 'B1'))
      .resolves.toMatchObject({ broker: { id: 'B1', vaultId: 'V2' }, vault: { id: 'V2', owner: 'rOverlayVault' } })
    await expect(getBaseOverlayLoanById(db, base, snapshot, 'L1', 50))
      .resolves.toMatchObject({ loan: { id: 'L1' }, broker: { id: 'B1', vaultId: 'V2' }, vault: { id: 'V2' } })
    await expect(getBaseOverlayLoanById(db, base, snapshot, 'L2', 50))
      .resolves.toMatchObject({ loan: { id: 'L2', loanBrokerId: 'B2' }, broker: { id: 'B2' }, vault: { id: 'V2' } })
  })

  it('fails closed when a related current object is tombstoned', async () => {
    const base = source([vault('V1'), broker('B1', 'V1'), loan('L1', 'B1')])
    const db = database([
      { object_type: 'loan_broker', object_id: 'B1', operation: 'deleted', projection_json: null },
    ])

    await expect(getBaseOverlayLoanById(db, base, snapshot, 'L1', 50))
      .rejects.toThrow('Loan Broker relationship is missing')
  })
})
