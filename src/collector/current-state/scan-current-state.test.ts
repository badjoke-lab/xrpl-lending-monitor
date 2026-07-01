import { describe, expect, it } from 'vitest'

import type { FetchLike } from '../network/xrpl-rpc'
import {
  CurrentStateScanError,
  scanCurrentState,
} from './scan-current-state'
import type { LedgerObjectDecoder } from './scan-ledger-objects'

const LEDGER_HASH = 'A'.repeat(64)
const LEDGER_INDEX = 12345

function response(result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ result, status: 'success' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function encodeFixture(value: Record<string, unknown>): string {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

const decodeFixture: LedgerObjectDecoder = (hex) => {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16)
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

function entry(type: string, id: string): Record<string, unknown> {
  return {
    data: encodeFixture({ LedgerEntryType: type }),
    index: id,
  }
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  const body = JSON.parse(String(init?.body)) as {
    params: Array<Record<string, unknown>>
  }
  return body.params[0] ?? {}
}

describe('scanCurrentState', () => {
  it('classifies all relevant objects from one unfiltered binary marker chain', async () => {
    const requests: Record<string, unknown>[] = []
    const fetcher: FetchLike = async (_input, init) => {
      const params = requestBody(init)
      requests.push(params)
      if (params.marker === undefined) {
        return response({
          ledger_hash: LEDGER_HASH,
          ledger_index: LEDGER_INDEX,
          validated: true,
          state: [
            entry('AccountRoot', 'ACCOUNT-1'),
            entry('Vault', 'VAULT-1'),
            entry('LoanBroker', 'BROKER-1'),
          ],
          marker: 'NEXT',
        })
      }
      return response({
        ledger_hash: LEDGER_HASH,
        ledger_index: LEDGER_INDEX,
        validated: true,
        state: [entry('Loan', 'LOAN-1'), entry('Offer', 'OFFER-1')],
      })
    }

    const result = await scanCurrentState({
      endpoint: 'https://devnet.example',
      timeoutMs: 1000,
      ledgerHash: LEDGER_HASH,
      ledgerIndex: LEDGER_INDEX,
      fetcher,
      decodeObject: decodeFixture,
      nowMs: (() => {
        let value = 100
        return () => value++
      })(),
    })

    expect(result.vaults.map((value) => value.index)).toEqual(['VAULT-1'])
    expect(result.loanBrokers.map((value) => value.index)).toEqual(['BROKER-1'])
    expect(result.loans.map((value) => value.index)).toEqual(['LOAN-1'])
    expect(result.metrics).toEqual({
      pages: 2,
      requests: 2,
      decodedObjects: 5,
      objects: 3,
      elapsedMs: 1,
      requestedObjectsPerPage: 2048,
      responseMode: 'binary',
      byType: {
        vault: { objects: 1 },
        loan_broker: { objects: 1 },
        loan: { objects: 1 },
      },
    })
    expect(requests[0]).toMatchObject({
      ledger_hash: LEDGER_HASH,
      binary: true,
      limit: 2048,
    })
    expect(requests[0]).not.toHaveProperty('type')
    expect(requests[1]?.marker).toBe('NEXT')
  })

  it('rejects duplicate IDs within a relevant object type', async () => {
    const fetcher: FetchLike = async () =>
      response({
        ledger_hash: LEDGER_HASH,
        ledger_index: LEDGER_INDEX,
        validated: true,
        state: [entry('Vault', 'DUPLICATE'), entry('Vault', 'DUPLICATE')],
      })

    await expect(
      scanCurrentState({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: LEDGER_INDEX,
        fetcher,
        decodeObject: decodeFixture,
      }),
    ).rejects.toThrow('Duplicate vault object DUPLICATE')
  })

  it('fails closed with decoded and relevant object counts', async () => {
    const fetcher: FetchLike = async () =>
      response({
        ledger_hash: LEDGER_HASH,
        ledger_index: LEDGER_INDEX,
        validated: true,
        state: [entry('Vault', 'VAULT-1')],
        marker: 'MORE',
      })

    let caught: unknown
    try {
      await scanCurrentState({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: LEDGER_INDEX,
        pageLimitPerType: 1,
        fetcher,
        decodeObject: decodeFixture,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CurrentStateScanError)
    expect(caught).toMatchObject({
      pagesCompleted: 1,
      requestsCompleted: 1,
      decodedObjects: 1,
      relevantObjects: 1,
      lastMarker: 'MORE',
    })
  })
})
