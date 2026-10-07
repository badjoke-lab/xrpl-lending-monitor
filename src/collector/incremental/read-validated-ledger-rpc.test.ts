import { describe, expect, it } from 'vitest'

import type { XrplReadProvider } from '../network/xrpl-read-provider'
import { readValidatedLedgerFromProvider } from './read-validated-ledger-rpc'

function provider(kind: 'direct' | 'xrplto'): XrplReadProvider {
  return {
    kind,
    endpoint: `https://${kind}.example/rpc`,
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      expect(method).toBe('ledger')
      expect(params).toEqual({
        ledger_index: 123,
        transactions: true,
        expand: true,
        owner_funds: false,
      })

      return {
        validated: true,
        ledger_index: 123,
        ledger_hash: 'A'.repeat(64),
        ledger: {
          ledger_index: 123,
          parent_hash: 'B'.repeat(64),
          close_time: 900,
          transactions: [
            {
              hash: 'C'.repeat(64),
              tx_json: {
                TransactionType: 'Payment',
                Account: 'rExample',
                Sequence: 7,
                Fee: '12',
              },
              meta: {
                TransactionResult: 'tesSUCCESS',
                TransactionIndex: 0,
              },
            },
          ],
        },
      } as T
    },
  }
}

describe('readValidatedLedgerFromProvider', () => {
  it.each(['direct', 'xrplto'] as const)(
    'normalizes %s provider responses through the same canonical parser',
    async (kind) => {
      const result = await readValidatedLedgerFromProvider({
        provider: provider(kind),
        ledgerIndex: 123,
      })

      expect(result).toEqual({
        endpoint: `https://${kind}.example/rpc`,
        ledgerIndex: 123,
        ledgerHash: 'A'.repeat(64),
        parentHash: 'B'.repeat(64),
        closeTime: 900,
        transactions: [
          {
            hash: 'C'.repeat(64),
            transactionType: 'Payment',
            account: 'rExample',
            sequence: 7,
            fee: '12',
            result: 'tesSUCCESS',
            transactionIndex: 0,
            transaction: {
              TransactionType: 'Payment',
              Account: 'rExample',
              Sequence: 7,
              Fee: '12',
            },
            metadata: {
              TransactionResult: 'tesSUCCESS',
              TransactionIndex: 0,
            },
          },
        ],
      })
    },
  )
})
