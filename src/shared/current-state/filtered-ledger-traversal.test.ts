import { describe, expect, it } from 'vitest'

import {
  streamFilteredLendingLedgerObjects,
  type LendingLedgerEntryType,
} from './filtered-ledger-traversal'

const LEDGER_HASH = 'A'.repeat(64)

function id(value: number): string {
  return value.toString(16).toUpperCase().padStart(64, '0')
}

function page(entryType: LendingLedgerEntryType, values: number[], marker?: unknown) {
  return {
    ledger_hash: LEDGER_HASH,
    ledger_index: 123,
    validated: true,
    state: values.map((value) => ({
      data: value.toString(16).padStart(2, '0'),
      index: id(value),
    })),
    ...(marker === undefined ? {} : { marker }),
    entryType,
  }
}

describe('streamFilteredLendingLedgerObjects', () => {
  it('exhausts Vault, LoanBroker, and Loan markers independently at one fixed ledger', async () => {
    const calls: Record<string, unknown>[] = []
    const pages = new Map<string, unknown[]>([
      ['Vault', [page('Vault', [1], 'vault-next'), page('Vault', [2])]],
      ['LoanBroker', [page('LoanBroker', [3])]],
      ['Loan', [page('Loan', [4, 5])]],
    ])
    const emitted: string[] = []

    const result = await streamFilteredLendingLedgerObjects({
      ledger: { ledgerIndex: 123, ledgerHash: LEDGER_HASH },
      objectLimitPerPage: 2048,
      pageLimitPerType: 10,
      async callLedgerData(params) {
        calls.push(params)
        const type = String(params.type)
        const queue = pages.get(type)
        if (!queue?.length) throw new Error(`unexpected request for ${type}`)
        return queue.shift()!
      },
      decodeBinary(binaryHex) {
        const value = Number.parseInt(binaryHex, 16)
        const entryType = value <= 2 ? 'Vault' : value === 3 ? 'LoanBroker' : 'Loan'
        return { LedgerEntryType: entryType, Flags: 0 }
      },
      async onPage(value) {
        emitted.push(`${value.entryType}:${value.typePage}:${value.records.length}`)
      },
    })

    expect(calls.map((call) => ({
      type: call.type,
      marker: call.marker ?? null,
      ledger_hash: call.ledger_hash,
      binary: call.binary,
      limit: call.limit,
    }))).toEqual([
      { type: 'Vault', marker: null, ledger_hash: LEDGER_HASH, binary: true, limit: 2048 },
      { type: 'Vault', marker: 'vault-next', ledger_hash: LEDGER_HASH, binary: true, limit: 2048 },
      { type: 'LoanBroker', marker: null, ledger_hash: LEDGER_HASH, binary: true, limit: 2048 },
      { type: 'Loan', marker: null, ledger_hash: LEDGER_HASH, binary: true, limit: 2048 },
    ])
    expect(emitted).toEqual(['Vault:1:1', 'Vault:2:1', 'LoanBroker:1:1', 'Loan:1:2'])
    expect(result).toEqual({
      sourcePages: 4,
      pagesByType: { Vault: 2, LoanBroker: 1, Loan: 1 },
      decodedObjectCount: 5,
      relevantObjectCount: 5,
      counts: { vaults: 2, loanBrokers: 1, loans: 2 },
      complete: true,
    })
  })

  it('fails closed when a filtered response moves to another ledger', async () => {
    await expect(streamFilteredLendingLedgerObjects({
      ledger: { ledgerIndex: 123, ledgerHash: LEDGER_HASH },
      objectLimitPerPage: 2048,
      pageLimitPerType: 10,
      async callLedgerData() {
        return { ...page('Vault', [1]), ledger_index: 124 }
      },
      decodeBinary() {
        return { LedgerEntryType: 'Vault' }
      },
      async onPage() {},
    })).rejects.toThrow('moved during Vault traversal')
  })

  it('fails closed when xrpld returns the wrong ledger entry type', async () => {
    await expect(streamFilteredLendingLedgerObjects({
      ledger: { ledgerIndex: 123, ledgerHash: LEDGER_HASH },
      objectLimitPerPage: 2048,
      pageLimitPerType: 10,
      async callLedgerData() {
        return page('Vault', [1])
      },
      decodeBinary() {
        return { LedgerEntryType: 'Loan' }
      },
      async onPage() {},
    })).rejects.toThrow('type filter Vault returned Loan')
  })

  it('fails closed on repeated marker before exhaustion', async () => {
    await expect(streamFilteredLendingLedgerObjects({
      ledger: { ledgerIndex: 123, ledgerHash: LEDGER_HASH },
      objectLimitPerPage: 2048,
      pageLimitPerType: 10,
      async callLedgerData() {
        return page('Vault', [], 'same-marker')
      },
      decodeBinary() {
        return { LedgerEntryType: 'Vault' }
      },
      async onPage() {},
    })).rejects.toThrow('repeated marker for Vault')
  })

  it('never converts a page limit into a partial successful snapshot', async () => {
    let calls = 0
    await expect(streamFilteredLendingLedgerObjects({
      ledger: { ledgerIndex: 123, ledgerHash: LEDGER_HASH },
      objectLimitPerPage: 2048,
      pageLimitPerType: 1,
      async callLedgerData() {
        calls += 1
        return page('Vault', [], 'next')
      },
      decodeBinary() {
        return { LedgerEntryType: 'Vault' }
      },
      async onPage() {},
    })).rejects.toThrow('exceeded page limit 1 before marker exhaustion')
    expect(calls).toBe(1)
  })
})
