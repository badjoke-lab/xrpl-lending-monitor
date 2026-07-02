import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from '../repositories/core-api-repository'
import type { ListCurrentLoanBrokersResult } from '../repositories/current-state-loan-broker-reader'
import { serializeAvailableLoanBrokerCollection } from './core-api'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 123,
  ledgerHash: 'SNAPSHOT',
  objectPrefix: 'current/snapshot-1',
  manifestKey: 'current/snapshot-1/manifest.json',
  manifestSha256: 'a'.repeat(64),
  vaultCount: 1,
  loanBrokerCount: 1,
  loanCount: 0,
  objectCount: 2,
  shardCount: 1,
  compressedBytes: 100,
  completedAt: '2026-07-02T00:00:00.000Z',
}

const result: ListCurrentLoanBrokersResult = {
  data: [
    {
      broker: {
        kind: 'loan_broker',
        id: 'B'.repeat(64),
        vaultId: 'A'.repeat(64),
        owner: 'rBrokerOwner',
        account: 'rBrokerAccount',
        sequence: 1,
        loanSequence: 2,
        managementFeeRate: 250,
        ownerCount: 1,
        debtTotal: '5000000',
        debtMaximum: '10000000',
        coverAvailable: '600000',
        coverRateMinimum: 10000,
        coverRateLiquidation: 15000,
        flags: 0,
        dataHex: 'BCDE',
        previousTxHash: 'F'.repeat(64),
        previousLedgerIndex: 122,
        raw: { LedgerEntryType: 'LoanBroker' },
      },
      vault: {
        kind: 'vault',
        id: 'A'.repeat(64),
        owner: 'rVaultOwner',
        account: 'rVaultAccount',
        asset: { type: 'xrp', key: 'XRP', symbol: 'XRP', scale: 6 },
        assetsTotal: '10000000',
        assetsAvailable: '7500000',
        assetsMaximum: '20000000',
        lossUnrealized: '0',
        shareMptId: 'C'.repeat(48),
        domainId: null,
        withdrawalPolicy: 0,
        scale: 6,
        flags: 0,
        dataHex: 'ABCD',
        previousTxHash: 'E'.repeat(64),
        previousLedgerIndex: 121,
        raw: { LedgerEntryType: 'Vault' },
      },
    },
  ],
  nextCursor: null,
  brokerShardsRead: 1,
  relationShardsRead: 1,
  objectsExamined: 1,
}

describe('Loan Broker API serialization', () => {
  it('keeps the Vault asset and exact cover calculations together', () => {
    const response = serializeAvailableLoanBrokerCollection({
      epoch: null,
      snapshot,
      result,
      page: { limit: 25 },
      sort: 'id_asc',
    })

    expect(response.data[0]).toMatchObject({
      asset: { key: 'XRP' },
      debt_total: '5000000',
      debt_maximum: '10000000',
      cover_available: '600000',
      related_vault: { id: 'A'.repeat(64), asset: { key: 'XRP' } },
      derived: {
        debt_utilization_bps: 5000,
        required_minimum_cover: '500000',
        cover_surplus: '100000',
        cover_ratio_bps: 12000,
        provenance: 'derived',
      },
      provenance: {
        object: 'direct',
        asset: 'direct',
        relationship: 'direct',
        derived: 'derived',
      },
    })
    expect(response.page).toMatchObject({
      broker_shards_read: 1,
      relation_shards_read: 1,
      objects_examined: 1,
    })
  })
})
