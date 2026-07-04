import { describe, expect, it } from 'vitest'

import { resolveIncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import type { IncrementalLedgerRead, IncrementalScanResult } from './scan-validated-ledgers'
import { IncrementalWorkBudgetError, selectIncrementalCommitPrefix } from './incremental-work-budget'

function ledger(index: number, transactionCount = 0): IncrementalLedgerRead {
  return {
    endpoint: 'https://devnet.example',
    ledgerIndex: index,
    ledgerHash: `HASH_${index}`,
    parentHash: `HASH_${index - 1}`,
    closeTime: 1000 + index,
    transactions: Array.from({ length: transactionCount }, (_, transactionIndex) => ({
      hash: `TX_${index}_${transactionIndex}`,
      transactionType: 'AccountSet',
      account: null,
      sequence: null,
      fee: null,
      result: 'tesSUCCESS',
      transactionIndex,
      transaction: { TransactionType: 'AccountSet' },
      metadata: { TransactionResult: 'tesSUCCESS', TransactionIndex: transactionIndex, AffectedNodes: [] },
    })),
    lendingTransactions: [],
  }
}

function scan(ledgers: IncrementalLedgerRead[]): IncrementalScanResult {
  return {
    endpoint: 'https://devnet.example',
    startLedgerIndex: ledgers[0]?.ledgerIndex ?? 1,
    endLedgerIndex: ledgers.at(-1)?.ledgerIndex ?? null,
    latestValidatedLedger: ledgers.at(-1)?.ledgerIndex ?? 1,
    completeToLatest: true,
    ledgers,
    metrics: {
      ledgers: ledgers.length,
      inspectedTransactions: ledgers.reduce((total, item) => total + item.transactions.length, 0),
      lendingTransactions: 0,
      elapsedMs: 10,
    },
  }
}

describe('incremental work budget', () => {
  it('selects the largest contiguous prefix that fits the row budget', () => {
    const config = {
      ...resolveIncrementalRuntimeConfig({}),
      maxRowsPerRun: 10,
      maxStatementsPerRun: 20,
    }
    const result = selectIncrementalCommitPrefix({
      scan: scan([ledger(11), ledger(12), ledger(13)]),
      epochId: 'epoch-1',
      config,
    })
    expect(result.scan.ledgers.map((item) => item.ledgerIndex)).toEqual([11, 12])
    expect(result.scan.completeToLatest).toBe(false)
    expect(result.estimate.estimatedRows).toBe(10)
  })

  it('fails closed when the first ledger exceeds a hard per-ledger limit', () => {
    const config = {
      ...resolveIncrementalRuntimeConfig({}),
      maxTransactionsPerLedger: 5,
    }
    expect(() => selectIncrementalCommitPrefix({
      scan: scan([ledger(11, 6)]),
      epochId: 'epoch-1',
      config,
    })).toThrow(IncrementalWorkBudgetError)
  })
})
