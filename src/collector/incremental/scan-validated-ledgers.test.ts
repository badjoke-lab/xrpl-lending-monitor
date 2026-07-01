import { describe, expect, it, vi } from 'vitest'

import type { ValidatedLedgerRead } from './read-validated-ledger'
import { scanValidatedLedgerRange } from './scan-validated-ledgers'

function ledger(options: {
  index: number
  hash: string
  parentHash: string
  types?: string[]
}): ValidatedLedgerRead {
  return {
    endpoint: 'https://devnet.example',
    ledgerIndex: options.index,
    ledgerHash: options.hash,
    parentHash: options.parentHash,
    closeTime: 1000 + options.index,
    transactions: (options.types ?? []).map((transactionType, transactionIndex) => ({
      hash: `${options.index}-${transactionIndex}`,
      transactionType,
      account: 'rAccount',
      sequence: transactionIndex,
      fee: '10',
      result: 'tesSUCCESS',
      transactionIndex,
      transaction: { TransactionType: transactionType },
      metadata: { TransactionResult: 'tesSUCCESS', TransactionIndex: transactionIndex },
    })),
  }
}

describe('scanValidatedLedgerRange', () => {
  it('reads a bounded contiguous range and keeps only recognized protocol transactions', async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce(
        ledger({
          index: 11,
          hash: 'B'.repeat(64),
          parentHash: 'A'.repeat(64),
          types: ['Payment', 'LoanPay'],
        }),
      )
      .mockResolvedValueOnce(
        ledger({
          index: 12,
          hash: 'C'.repeat(64),
          parentHash: 'B'.repeat(64),
          types: ['VaultSet', 'OfferCreate'],
        }),
      )

    const result = await scanValidatedLedgerRange({
      endpoint: 'https://devnet.example',
      timeoutMs: 1_000,
      startLedgerIndex: 11,
      latestValidatedLedger: 14,
      maxLedgers: 2,
      expectedPreviousHash: 'A'.repeat(64),
      reader,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(130),
    })

    expect(result.endLedgerIndex).toBe(12)
    expect(result.completeToLatest).toBe(false)
    expect(result.ledgers.map((item) => item.ledgerIndex)).toEqual([11, 12])
    expect(result.ledgers[0]?.lendingTransactions.map((item) => item.transactionType)).toEqual([
      'LoanPay',
    ])
    expect(result.ledgers[1]?.lendingTransactions.map((item) => item.transactionType)).toEqual([
      'VaultSet',
    ])
    expect(result.metrics).toEqual({
      ledgers: 2,
      inspectedTransactions: 4,
      lendingTransactions: 2,
      elapsedMs: 30,
    })
  })

  it('returns an empty complete result when the cursor is already current', async () => {
    const reader = vi.fn()
    const result = await scanValidatedLedgerRange({
      endpoint: 'https://devnet.example',
      timeoutMs: 1_000,
      startLedgerIndex: 21,
      latestValidatedLedger: 20,
      maxLedgers: 5,
      expectedPreviousHash: 'A'.repeat(64),
      reader,
      now: () => 100,
    })

    expect(result.ledgers).toEqual([])
    expect(result.completeToLatest).toBe(true)
    expect(reader).not.toHaveBeenCalled()
  })

  it('rejects the first ledger when it does not extend the committed hash', async () => {
    await expect(
      scanValidatedLedgerRange({
        endpoint: 'https://devnet.example',
        timeoutMs: 1_000,
        startLedgerIndex: 31,
        latestValidatedLedger: 31,
        maxLedgers: 1,
        expectedPreviousHash: 'A'.repeat(64),
        reader: vi.fn().mockResolvedValue(
          ledger({
            index: 31,
            hash: 'C'.repeat(64),
            parentHash: 'B'.repeat(64),
          }),
        ),
      }),
    ).rejects.toThrow('parent hash does not match the prior ledger')
  })

  it('stops the batch when a later ledger breaks continuity', async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce(
        ledger({ index: 41, hash: 'B'.repeat(64), parentHash: 'A'.repeat(64) }),
      )
      .mockResolvedValueOnce(
        ledger({ index: 42, hash: 'D'.repeat(64), parentHash: 'C'.repeat(64) }),
      )

    await expect(
      scanValidatedLedgerRange({
        endpoint: 'https://devnet.example',
        timeoutMs: 1_000,
        startLedgerIndex: 41,
        latestValidatedLedger: 42,
        maxLedgers: 2,
        expectedPreviousHash: 'A'.repeat(64),
        reader,
      }),
    ).rejects.toThrow('Ledger 42 parent hash does not match')
  })
})
