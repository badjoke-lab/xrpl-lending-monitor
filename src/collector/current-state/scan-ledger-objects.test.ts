import { describe, expect, it } from 'vitest'

import type { FetchLike } from '../network/xrpl-rpc'
import { scanCurrentState } from './scan-current-state'
import {
  LedgerObjectScanError,
  scanLedgerObjects,
  type CurrentObjectFilter,
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

function object(filter: CurrentObjectFilter, id: string): Record<string, unknown> {
  return {
    LedgerEntryType: entryType[filter],
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
      nowMs: (() => {
        let value = 100
        return () => value++
      })(),
    })

    expect(result.objects.map((value) => value.index)).toEqual(['VAULT-1', 'VAULT-2'])
    expect(result.metrics).toEqual({ pages: 2, requests: 2, objects: 2, elapsedMs: 1 })
    expect(requests[0]).toMatchObject({
      ledger_hash: LEDGER_HASH,
      binary: false,
      type: 'vault',
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
      }),
    ).rejects.toMatchObject({
      name: 'LedgerObjectScanError',
      filter: 'loan',
      pagesCompleted: 0,
      objectsRead: 0,
    })
  })

  it('fails closed when a later page fails and exposes only failure metrics', async () => {
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
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(LedgerObjectScanError)
    expect(caught).toMatchObject({
      pagesCompleted: 1,
      objectsRead: 1,
    })
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
      }),
    ).rejects.toMatchObject({
      pagesCompleted: 1,
      objectsRead: 1,
    })
  })
})

describe('scanCurrentState', () => {
  it('returns all three object types from one fixed validated ledger', async () => {
    const fetcher: FetchLike = async (_input, init) => {
      const params = requestBody(init).params[0]
      const filter = params?.type as CurrentObjectFilter
      return response({
        ledger_hash: LEDGER_HASH,
        ledger_index: LEDGER_INDEX,
        validated: true,
        state: [object(filter, `${filter}-1`)],
      })
    }

    const result = await scanCurrentState({
      endpoint: 'https://devnet.example',
      timeoutMs: 1000,
      ledgerHash: LEDGER_HASH,
      ledgerIndex: LEDGER_INDEX,
      fetcher,
      nowMs: (() => {
        let value = 0
        return () => value++
      })(),
    })

    expect(result.vaults).toHaveLength(1)
    expect(result.loanBrokers).toHaveLength(1)
    expect(result.loans).toHaveLength(1)
    expect(result.metrics).toMatchObject({
      pages: 3,
      requests: 3,
      objects: 3,
    })
  })

  it('rejects duplicate object IDs within one type', async () => {
    const fetcher: FetchLike = async (_input, init) => {
      const filter = requestBody(init).params[0]?.type as CurrentObjectFilter
      return response({
        ledger_hash: LEDGER_HASH,
        ledger_index: LEDGER_INDEX,
        validated: true,
        state:
          filter === 'vault'
            ? [object(filter, 'DUPLICATE'), object(filter, 'DUPLICATE')]
            : [object(filter, `${filter}-1`)],
      })
    }

    await expect(
      scanCurrentState({
        endpoint: 'https://devnet.example',
        timeoutMs: 1000,
        ledgerHash: LEDGER_HASH,
        ledgerIndex: LEDGER_INDEX,
        fetcher,
      }),
    ).rejects.toThrow('Duplicate vault object DUPLICATE')
  })
})
