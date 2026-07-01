import { describe, expect, it } from 'vitest'

import type { FetchLike } from '../network/xrpl-rpc'
import {
  LedgerObjectScanError,
  scanLedgerObjects,
  type CurrentObjectFilter,
  type LedgerObjectDecoder,
} from './scan-ledger-objects'

const LEDGER_HASH = 'A'.repeat(64)
const LEDGER_INDEX = 12345

const entryType = {
  vault: 'Vault',
  loan_broker: 'LoanBroker',
  loan: 'Loan',
} as const

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

function object(filter: CurrentObjectFilter, id: string): Record<string, unknown> {
  return {
    data: encodeFixture({ LedgerEntryType: entryType[filter] }),
    index: id,
  }
}

function requestBody(init?: RequestInit): {
  method: string
  params: Array<Record<string, unknown>>
} {
  return JSON.parse(String(init?.body)) as {
    method: string
    params: Array<Record<string, unknown>>
  }
}

describe('scanLedgerObjects', () => {
  it('passes an opaque marker through unchanged until the scan completes', async () => {
    const requests: Array<Record<string, unknown>> = []
    const opaqueMarker = { nested: ['resume', 2], cursor: 'ABC' }
    const fetcher: FetchLike = async (_input, init) => {
      const body = requestBody(init)
      requests.push(body.params[0])
      const marker = body.params[0]?.marker

      if (marker === undefined) {
        return response({
          ledger_hash: LEDGER_HASH,
          ledger_index: LEDGER_INDEX,
          validated: true,
          state: [object('vault', 'VAULT-1')],
          marker: opaqueMarker,
        })
      }

      expect(marker).toEqual(opaqueMarker)
      return response({
        ledger_hash: LEDGER_HASH,
        ledger_index: LEDGER_INDEX,
        validated: true,
        state: [object('vault', 'VAULT-2')],
      })
    }

    const result = await scanLedgerObjects({
      endpoint: 'https://devnet.example',
      timeoutMs: 1000,
      ledgerHash: LEDGER_HASH,
      ledgerIndex: LEDGER_INDEX,
      filter: 'vault',
      fetcher,
      decodeObject: decodeFixture,
      nowMs: (() => {
        let value = 100
        return () => value++
      })(),
    })

    expect(result.objects.map((value) => value.index)).toEqual(['VAULT-1', 'VAULT-2'])
    expect(result.metrics).toEqual({
      pages: 2,
      requests: 2,
      objects: 2,
      elapsedMs: 1,
      requestedObjectsPerPage: 2048,
      responseMode: 'binary',
    })
    expect(requests[0]).toMatchObject({
      ledger_hash: LEDGER_HASH,
      binary: true,
      type: 'vault',
      limit: 2048,
    })
    expect(requests[0]).not.toHaveProperty('marker')
    expect(requests[1]?.marker).toEqual(opaqueMarker)
  })

  it('rejects a response that moves to a different ledger', async () => {
    const fetcher: FetchLike = async () =>
      response({
        ledger_hash: 'B'.repeat(64),
        ledger_index: LEDGER_INDEX + 1,
        validated: true,
        state: [],
      })

    await expect(
      scanLedgerObjects({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: LEDGER_INDEX,
        filter: 'loan',
        fetcher,
        decodeObject: decodeFixture,
      }),
    ).rejects.toMatchObject({
      name: 'LedgerObjectScanError',
      filter: 'loan',
      pagesCompleted: 0,
      objectsRead: 0,
    })
  })

  it('fails closed when a later page fails', async () => {
    let calls = 0
    const fetcher: FetchLike = async () => {
      calls += 1
      if (calls === 1) {
        return response({
          ledger_hash: LEDGER_HASH,
          ledger_index: LEDGER_INDEX,
          validated: true,
          state: [object('loan_broker', 'BROKER-1')],
          marker: 'NEXT',
        })
      }
      throw new Error('second page unavailable')
    }

    let caught: unknown
    try {
      await scanLedgerObjects({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: LEDGER_INDEX,
        filter: 'loan_broker',
        fetcher,
        decodeObject: decodeFixture,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(LedgerObjectScanError)
    expect(caught).toMatchObject({ pagesCompleted: 1, objectsRead: 1 })
  })

  it('fails when the page ceiling is reached while a marker remains', async () => {
    const fetcher: FetchLike = async () =>
      response({
        ledger_hash: LEDGER_HASH,
        ledger_index: LEDGER_INDEX,
        validated: true,
        state: [object('loan', 'LOAN-1')],
        marker: 'MORE',
      })

    await expect(
      scanLedgerObjects({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: LEDGER_INDEX,
        filter: 'loan',
        pageLimit: 1,
        fetcher,
        decodeObject: decodeFixture,
      }),
    ).rejects.toMatchObject({ pagesCompleted: 1, objectsRead: 1 })
  })

  it('fails before looping when the server repeats a marker', async () => {
    const fetcher: FetchLike = async () =>
      response({
        ledger_hash: LEDGER_HASH,
        ledger_index: LEDGER_INDEX,
        validated: true,
        state: [object('vault', 'VAULT-1')],
        marker: { cursor: 'SAME' },
      })

    await expect(
      scanLedgerObjects({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: LEDGER_INDEX,
        filter: 'vault',
        fetcher,
        decodeObject: decodeFixture,
      }),
    ).rejects.toMatchObject({ pagesCompleted: 2, objectsRead: 2 })
  })
})
