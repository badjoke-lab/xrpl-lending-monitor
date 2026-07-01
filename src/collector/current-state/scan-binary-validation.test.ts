import { describe, expect, it } from 'vitest'

import type { FetchLike } from '../network/xrpl-rpc'
import { scanLedgerObjects } from './scan-ledger-objects'

const LEDGER_HASH = 'A'.repeat(64)

function response(state: unknown[]): Response {
  return new Response(
    JSON.stringify({
      status: 'success',
      result: {
        ledger_hash: LEDGER_HASH,
        ledger_index: 123,
        validated: true,
        state,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('binary ledger object validation', () => {
  it('rejects malformed hexadecimal before decoding', async () => {
    const fetcher: FetchLike = async () =>
      response([{ data: 'NOT-HEX', index: 'VAULT-1' }])

    await expect(
      scanLedgerObjects({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: 123,
        filter: 'vault',
        fetcher,
      }),
    ).rejects.toMatchObject({
      name: 'LedgerObjectScanError',
      pagesCompleted: 0,
      objectsRead: 0,
    })
  })

  it('rejects a decoded ledger entry of the wrong type', async () => {
    const fetcher: FetchLike = async () =>
      response([{ data: '00', index: 'VAULT-1' }])

    await expect(
      scanLedgerObjects({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: 123,
        filter: 'vault',
        fetcher,
        decodeObject: () => ({ LedgerEntryType: 'Loan' }),
      }),
    ).rejects.toThrow('expected Vault, received Loan')
  })
})
