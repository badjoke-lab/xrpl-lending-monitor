import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getCurrentLoanBrokerById,
  listCurrentLoanBrokers,
} from './d1-current-loan-broker-reader'

interface QueryResponse {
  all?: unknown[]
  first?: unknown
}

function fakeDatabase(responses: QueryResponse[]) {
  const queue = [...responses]
  const prepared: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      const record = { sql, values: [] as unknown[] }
      prepared.push(record)
      const response = queue.shift() ?? {}
      const statement = {
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async all<T>() {
          return { results: (response.all ?? []) as T[] }
        },
        async first<T>() {
          return (response.first ?? null) as T | null
        },
      }
      return statement
    },
  }
  return { db: db as unknown as D1Database, prepared }
}

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1', epochId: 'epoch-1', ledgerIndex: 123, ledgerHash: 'A'.repeat(64),
  objectPrefix: '', manifestKey: null, manifestSha256: 'b'.repeat(64),
  vaultCount: 1, loanBrokerCount: 2, loanCount: 0, objectCount: 3,
  shardCount: 1, compressedBytes: 200, completedAt: '2026-07-03T00:00:00.000Z',
}

function brokerProjection(id: string, vaultId: string) {
  return {
    kind: 'loan_broker', id, vaultId, owner: 'rBrokerOwner', account: 'rBroker',
    sequence: 1, loanSequence: 2, managementFeeRate: null, ownerCount: 1,
    debtTotal: '50', debtMaximum: '100', coverAvailable: '25',
    coverRateMinimum: 10000, coverRateLiquidation: 15000,
    flags: 0, dataHex: null, previousTxHash: 'E'.repeat(64), previousLedgerIndex: 122,
  }
}

function vaultProjection(id: string) {
  return {
    kind: 'vault', id, owner: 'rVaultOwner', account: 'rVault',
    asset: { kind: 'xrp', key: 'XRP', currency: 'XRP', issuer: null, issuanceId: null, displayCode: 'XRP' },
    assetsTotal: '100', assetsAvailable: '80', assetsMaximum: null, lossUnrealized: '0',
    shareMptId: 'A'.repeat(48), domainId: null, withdrawalPolicy: 0, scale: 6,
    flags: 0, dataHex: null, previousTxHash: 'F'.repeat(64), previousLedgerIndex: 121,
  }
}

function row(brokerId: string, vaultId: string) {
  return {
    object_id: brokerId,
    broker_projection_json: JSON.stringify(brokerProjection(brokerId, vaultId)),
    broker_raw_json: JSON.stringify({ LedgerEntryType: 'LoanBroker', index: brokerId }),
    vault_projection_json: JSON.stringify(vaultProjection(vaultId)),
    vault_raw_json: JSON.stringify({ LedgerEntryType: 'Vault', index: vaultId }),
  }
}

describe('D1 current-state Loan Broker reader', () => {
  it('paginates Broker rows and resolves the Vault in the same snapshot query', async () => {
    const vaultId = `${'1'.repeat(63)}1`
    const firstId = `${'8'.repeat(63)}1`
    const secondId = `${'8'.repeat(63)}2`
    const { db, prepared } = fakeDatabase([{ all: [row(firstId, vaultId), row(secondId, vaultId)] }])

    const result = await listCurrentLoanBrokers(db, snapshot, { limit: 1, query: 'rBroker' })

    expect(result.data[0]?.broker.id).toBe(firstId)
    expect(result.data[0]?.vault.id).toBe(vaultId)
    expect(result.nextCursor).toBeTruthy()
    expect(result.brokerShardsRead).toBe(0)
    expect(result.relationShardsRead).toBe(0)
    expect(prepared[0]?.sql).toContain('JOIN current_state_d1_vaults')
    expect(prepared[0]?.values).toEqual([snapshot.id, '%rBroker%', 2])
  })

  it('loads Broker detail with its same-snapshot Vault', async () => {
    const vaultId = `${'2'.repeat(63)}1`
    const brokerId = `${'9'.repeat(63)}1`
    const { db, prepared } = fakeDatabase([{ first: row(brokerId, vaultId) }])

    const result = await getCurrentLoanBrokerById(db, snapshot, brokerId.toLowerCase())

    expect(result?.broker.id).toBe(brokerId)
    expect(result?.vault.id).toBe(vaultId)
    expect(prepared[0]?.values).toEqual([snapshot.id, brokerId])
  })
})
