import { describe, expect, it } from 'vitest'

import { readValidatedLedger } from './read-validated-ledger'

function fetcherWith(result: Record<string, unknown>) {
  return async () =>
    new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
}

describe('readValidatedLedger', () => {
  it('parses API v2 expanded transactions in canonical order', async () => {
    const result = await readValidatedLedger({
      endpoint: 'https://devnet.example',
      ledgerIndex: 101,
      timeoutMs: 1_000,
      fetcher: fetcherWith({
        validated: true,
        ledger_index: 101,
        ledger_hash: 'A'.repeat(64),
        ledger: {
          parent_hash: 'B'.repeat(64),
          close_time: 1000,
          transactions: [
            {
              hash: '2'.repeat(64),
              tx_json: {
                TransactionType: 'LoanPay',
                Account: 'rSecond',
                Sequence: 2,
                Fee: '12',
              },
              meta: { TransactionResult: 'tesSUCCESS', TransactionIndex: 2 },
            },
            {
              hash: '1'.repeat(64),
              tx_json: {
                TransactionType: 'Payment',
                Account: 'rFirst',
                Sequence: 1,
                Fee: '10',
              },
              meta: { TransactionResult: 'tesSUCCESS', TransactionIndex: 1 },
            },
          ],
        },
      }),
    })

    expect(result).toMatchObject({
      ledgerIndex: 101,
      ledgerHash: 'A'.repeat(64),
      parentHash: 'B'.repeat(64),
      closeTime: 1000,
    })
    expect(result.transactions.map((transaction) => transaction.hash)).toEqual([
      '1'.repeat(64),
      '2'.repeat(64),
    ])
    expect(result.transactions[1]).toMatchObject({
      transactionType: 'LoanPay',
      account: 'rSecond',
      sequence: 2,
      fee: '12',
      result: 'tesSUCCESS',
      transactionIndex: 2,
    })
  })

  it('accepts legacy expanded transaction and ledger field names', async () => {
    const result = await readValidatedLedger({
      endpoint: 'https://devnet.example',
      ledgerIndex: 102,
      timeoutMs: 1_000,
      fetcher: fetcherWith({
        ledger: {
          validated: true,
          seqNum: '102',
          hash: 'C'.repeat(64),
          parentHash: 'D'.repeat(64),
          closeTime: 1001,
          transactions: [
            {
              hash: '3'.repeat(64),
              TransactionType: 'LoanSet',
              Account: 'rLegacy',
              Sequence: '3',
              Fee: 15,
              metaData: { TransactionResult: 'tecFAILED', TransactionIndex: 0 },
            },
          ],
        },
      }),
    })

    expect(result.transactions[0]).toMatchObject({
      transactionType: 'LoanSet',
      account: 'rLegacy',
      sequence: 3,
      fee: '15',
      result: 'tecFAILED',
    })
  })

  it('rejects a response that is not explicitly validated', async () => {
    await expect(
      readValidatedLedger({
        endpoint: 'https://devnet.example',
        ledgerIndex: 103,
        timeoutMs: 1_000,
        fetcher: fetcherWith({
          validated: false,
          ledger: { ledger_index: 103, transactions: [] },
        }),
      }),
    ).rejects.toThrow('is not validated')
  })

  it('rejects a ledger index mismatch', async () => {
    await expect(
      readValidatedLedger({
        endpoint: 'https://devnet.example',
        ledgerIndex: 104,
        timeoutMs: 1_000,
        fetcher: fetcherWith({
          validated: true,
          ledger_index: 105,
          ledger_hash: 'E'.repeat(64),
          ledger: {
            parent_hash: 'F'.repeat(64),
            close_time: 1002,
            transactions: [],
          },
        }),
      }),
    ).rejects.toThrow('Requested ledger 104 but received 105')
  })
})
