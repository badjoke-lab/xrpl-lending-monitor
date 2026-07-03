import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from './core-api-repository'
import { getCurrentLoanById, listCurrentLoans } from './d1-current-loan-reader'

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
  vaultCount: 1, loanBrokerCount: 1, loanCount: 2, objectCount: 4,
  shardCount: 1, compressedBytes: 300, completedAt: '2026-07-03T00:00:00.000Z',
}

function vaultProjection(id: string) {
  return {
    kind: 'vault', id, owner: 'rVaultOwner', account: 'rVault',
    asset: { kind: 'xrp', key: 'XRP', currency: 'XRP', issuer: null, issuanceId: null, displayCode: 'XRP' },
    assetsTotal: '100', assetsAvailable: '80', assetsMaximum: null, lossUnrealized: '0',
    shareMptId: 'A'.repeat(48), domainId: null, withdrawalPolicy: 0, scale: 6,
    flags: 0, dataHex: null, previousTxHash: 'F'.repeat(64), previousLedgerIndex: 120,
  }
}

function brokerProjection(id: string, vaultId: string) {
  return {
    kind: 'loan_broker', id, vaultId, owner: 'rBrokerOwner', account: 'rBroker',
    sequence: 1, loanSequence: 3, managementFeeRate: null, ownerCount: 2,
    debtTotal: '50', debtMaximum: '100', coverAvailable: '25',
    coverRateMinimum: 10000, coverRateLiquidation: 15000,
    flags: 0, dataHex: null, previousTxHash: 'E'.repeat(64), previousLedgerIndex: 121,
  }
}

function loanProjection(id: string, brokerId: string, complete = false) {
  return {
    kind: 'loan', id, loanBrokerId: brokerId, borrower: complete ? 'rBorrowerTwo' : 'rBorrowerOne',
    loanSequence: complete ? 2 : 1, loanOriginationFee: '0', loanServiceFee: '0',
    latePaymentFee: '0', closePaymentFee: '0', overpaymentFeeRate: 0,
    interestRate: 1000, lateInterestRate: 2000, closeInterestRate: 0,
    overpaymentInterestRate: 0, startDate: 500, paymentInterval: 100,
    gracePeriod: 60, previousPaymentDueDate: 900,
    nextPaymentDueDate: complete ? null : 1000, paymentRemaining: complete ? 0 : 2,
    principalOutstanding: complete ? '0' : '10000',
    totalValueOutstanding: complete ? '0' : '10500', managementFeeOutstanding: '100',
    periodicPayment: '1000', loanScale: null, onLedgerStatus: 'active',
    supportsOverpayment: false, flags: 0, dataHex: null,
    previousTxHash: 'D'.repeat(64), previousLedgerIndex: 122,
  }
}

function row(loanId: string, brokerId: string, vaultId: string, complete = false) {
  return {
    object_id: loanId,
    loan_projection_json: JSON.stringify(loanProjection(loanId, brokerId, complete)),
    loan_raw_json: JSON.stringify({ LedgerEntryType: 'Loan', index: loanId }),
    broker_projection_json: JSON.stringify(brokerProjection(brokerId, vaultId)),
    broker_raw_json: JSON.stringify({ LedgerEntryType: 'LoanBroker', index: brokerId }),
    vault_projection_json: JSON.stringify(vaultProjection(vaultId)),
    vault_raw_json: JSON.stringify({ LedgerEntryType: 'Vault', index: vaultId }),
  }
}

describe('D1 current-state Loan reader', () => {
  it('resolves Loan, Broker, and Vault in one snapshot-scoped query', async () => {
    const vaultId = `${'1'.repeat(63)}1`
    const brokerId = `${'8'.repeat(63)}1`
    const firstId = `${'9'.repeat(63)}1`
    const secondId = `${'A'.repeat(63)}2`
    const { db, prepared } = fakeDatabase([{ all: [row(firstId, brokerId, vaultId), row(secondId, brokerId, vaultId, true)] }])

    const result = await listCurrentLoans(db, snapshot, { limit: 1, evaluatedAtRippleTime: 900 })

    expect(result.data[0]?.loan.id).toBe(firstId)
    expect(result.data[0]?.broker.id).toBe(brokerId)
    expect(result.data[0]?.vault.id).toBe(vaultId)
    expect(result.data[0]?.schedule.status).toBe('current')
    expect(result.nextCursor).toBeTruthy()
    expect(prepared[0]?.sql).toContain('JOIN current_state_d1_loan_brokers')
    expect(prepared[0]?.sql).toContain('JOIN current_state_d1_vaults')
  })

  it('uses exact due and grace boundaries for schedule filters', async () => {
    const vaultId = `${'2'.repeat(63)}1`
    const brokerId = `${'7'.repeat(63)}1`
    const loanId = `${'9'.repeat(63)}2`
    const dueDb = fakeDatabase([{ all: [row(loanId, brokerId, vaultId)] }]).db
    const due = await listCurrentLoans(dueDb, snapshot, {
      limit: 10,
      evaluatedAtRippleTime: 1000,
      scheduleStatus: 'payment_due',
    })
    expect(due.data.map((record) => record.loan.id)).toEqual([loanId])

    const eligibleDb = fakeDatabase([{ all: [row(loanId, brokerId, vaultId)] }]).db
    const eligible = await listCurrentLoans(eligibleDb, snapshot, {
      limit: 10,
      evaluatedAtRippleTime: 1060,
      scheduleStatus: 'default_eligible',
    })
    expect(eligible.data.map((record) => record.loan.id)).toEqual([loanId])
  })

  it('loads detail and evaluates a completed Loan without inventing a due date', async () => {
    const vaultId = `${'3'.repeat(63)}1`
    const brokerId = `${'6'.repeat(63)}1`
    const loanId = `${'B'.repeat(63)}1`
    const { db, prepared } = fakeDatabase([{ first: row(loanId, brokerId, vaultId, true) }])

    const result = await getCurrentLoanById(db, snapshot, loanId.toLowerCase(), 1060)

    expect(result?.schedule.status).toBe('complete')
    expect(result?.schedule.nextPaymentDueRippleTime).toBeNull()
    expect(prepared[0]?.values).toEqual([snapshot.id, loanId])
  })
})
