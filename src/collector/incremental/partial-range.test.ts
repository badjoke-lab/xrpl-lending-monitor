import { describe, expect, it } from 'vitest'

import { scanValidatedLedgerRange, type LedgerReader } from './scan-validated-ledgers'

describe('partial incremental range', () => {
  it('stops before the next read and returns only the contiguous prefix', async () => {
    const reader: LedgerReader = async ({ endpoint, ledgerIndex }) => ({
      endpoint,
      ledgerIndex,
      ledgerHash: `HASH_${ledgerIndex}`,
      parentHash: ledgerIndex === 11 ? 'HASH_10' : `HASH_${ledgerIndex - 1}`,
      closeTime: 1000 + ledgerIndex,
      transactions: [],
    })

    const result = await scanValidatedLedgerRange({
      endpoint: 'https://devnet.example',
      timeoutMs: 1000,
      startLedgerIndex: 11,
      latestValidatedLedger: 15,
      maxLedgers: 5,
      expectedPreviousHash: 'HASH_10',
      reader,
      shouldContinue: (_nextLedgerIndex, ledgersRead) => ledgersRead < 2,
    })

    expect(result.ledgers.map((item) => item.ledgerIndex)).toEqual([11, 12])
    expect(result.endLedgerIndex).toBe(12)
    expect(result.completeToLatest).toBe(false)
  })
})
