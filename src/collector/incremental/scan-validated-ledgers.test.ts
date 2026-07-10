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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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

  it('starts one bounded read window concurrently and emits ordered contiguous output', async () => {
    const reads = new Map([
      [11, deferred<ValidatedLedgerRead>()],
      [12, deferred<ValidatedLedgerRead>()],
      [13, deferred<ValidatedLedgerRead>()],
      [14, deferred<ValidatedLedgerRead>()],
    ])
    const reader = vi.fn(({ ledgerIndex }: { ledgerIndex: number }) => {
      const read = reads.get(ledgerIndex)
      if (!read) throw new Error(`unexpected ledger ${ledgerIndex}`)
      return read.promise
    })

    const scan = scanValidatedLedgerRange({
      endpoint: 'wss://devnet.example',
      timeoutMs: 1_000,
      startLedgerIndex: 11,
      latestValidatedLedger: 14,
      maxLedgers: 4,
      readWindowSize: 4,
      expectedPreviousHash: 'A'.repeat(64),
      reader,
    })

    expect(reader).toHaveBeenCalledTimes(4)
    expect(reader.mock.calls.map(([request]) => request.ledgerIndex)).toEqual([11, 12, 13, 14])

    reads.get(13)?.resolve(ledger({ index: 13, hash: 'D'.repeat(64), parentHash: 'C'.repeat(64) }))
    reads.get(11)?.resolve(ledger({ index: 11, hash: 'B'.repeat(64), parentHash: 'A'.repeat(64) }))
    reads.get(14)?.resolve(ledger({ index: 14, hash: 'E'.repeat(64), parentHash: 'D'.repeat(64) }))
    reads.get(12)?.resolve(ledger({ index: 12, hash: 'C'.repeat(64), parentHash: 'B'.repeat(64) }))

    const result = await scan
    expect(result.ledgers.map((item) => item.ledgerIndex)).toEqual([11, 12, 13, 14])
    expect(result.endLedgerIndex).toBe(14)
    expect(result.completeToLatest).toBe(true)
  })

  it('rejects the whole read window when one reader fails', async () => {
    const reader = vi.fn(async ({ ledgerIndex }: { ledgerIndex: number }) => {
      if (ledgerIndex === 12) throw new Error('ledger 12 failed')
      return ledger({
        index: ledgerIndex,
        hash: `${ledgerIndex}`.padStart(64, '0'),
        parentHash: `${ledgerIndex - 1}`.padStart(64, '0'),
      })
    })

    await expect(scanValidatedLedgerRange({
      endpoint: 'wss://devnet.example',
      timeoutMs: 1_000,
      startLedgerIndex: 11,
      latestValidatedLedger: 14,
      maxLedgers: 4,
      readWindowSize: 4,
      expectedPreviousHash: '10'.padStart(64, '0'),
      reader,
    })).rejects.toThrow('ledger 12 failed')
    expect(reader).toHaveBeenCalledTimes(4)
  })

  it('stops only between windows when the execution boundary closes', async () => {
    const reader = vi.fn(async ({ ledgerIndex }: { ledgerIndex: number }) => ledger({
      index: ledgerIndex,
      hash: `${ledgerIndex}`.padStart(64, '0'),
      parentHash: `${ledgerIndex - 1}`.padStart(64, '0'),
    }))
    const shouldContinue = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)

    const result = await scanValidatedLedgerRange({
      endpoint: 'wss://devnet.example',
      timeoutMs: 1_000,
      startLedgerIndex: 11,
      latestValidatedLedger: 14,
      maxLedgers: 4,
      readWindowSize: 2,
      expectedPreviousHash: '10'.padStart(64, '0'),
      reader,
      shouldContinue,
    })

    expect(reader.mock.calls.map(([request]) => request.ledgerIndex)).toEqual([11, 12])
    expect(result.ledgers.map((item) => item.ledgerIndex)).toEqual([11, 12])
    expect(result.completeToLatest).toBe(false)
    expect(shouldContinue).toHaveBeenNthCalledWith(1, 11, 0)
    expect(shouldContinue).toHaveBeenNthCalledWith(2, 13, 2)
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

  it('rejects a wrong ledger identity inside a read window', async () => {
    const reader = vi.fn(async ({ ledgerIndex }: { ledgerIndex: number }) => ledger({
      index: ledgerIndex === 42 ? 43 : ledgerIndex,
      hash: ledgerIndex === 41 ? 'B'.repeat(64) : 'C'.repeat(64),
      parentHash: ledgerIndex === 41 ? 'A'.repeat(64) : 'B'.repeat(64),
    }))

    await expect(scanValidatedLedgerRange({
      endpoint: 'wss://devnet.example',
      timeoutMs: 1_000,
      startLedgerIndex: 41,
      latestValidatedLedger: 42,
      maxLedgers: 2,
      readWindowSize: 2,
      expectedPreviousHash: 'A'.repeat(64),
      reader,
    })).rejects.toThrow('Incremental reader returned ledger 43 for 42')
  })

  it('rejects a later ledger when a window breaks continuity', async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce(
        ledger({ index: 51, hash: 'B'.repeat(64), parentHash: 'A'.repeat(64) }),
      )
      .mockResolvedValueOnce(
        ledger({ index: 52, hash: 'D'.repeat(64), parentHash: 'C'.repeat(64) }),
      )

    await expect(
      scanValidatedLedgerRange({
        endpoint: 'wss://devnet.example',
        timeoutMs: 1_000,
        startLedgerIndex: 51,
        latestValidatedLedger: 52,
        maxLedgers: 2,
        readWindowSize: 2,
        expectedPreviousHash: 'A'.repeat(64),
        reader,
      }),
    ).rejects.toThrow('Ledger 52 parent hash does not match')
  })
})
