import { describe, expect, it } from 'vitest'

import {
  LatestValidatedLedgerHeadError,
  readLatestValidatedLedgerHead,
} from './read-latest-validated-head'
import type { FetchLike } from '../network/xrpl-rpc'

const HASH = 'A'.repeat(64)

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('latest validated ledger head reader', () => {
  it('reads one validated server_info head', async () => {
    const fetcher: FetchLike = async () => response({
      result: {
        status: 'success',
        info: {
          validated_ledger: {
            seq: 123,
            hash: HASH.toLowerCase(),
            age: 2,
          },
        },
      },
    })

    await expect(readLatestValidatedLedgerHead({
      endpoints: ['https://primary.example'],
      timeoutMs: 1_000,
      fetcher,
    })).resolves.toEqual({
      endpoint: 'https://primary.example',
      ledgerIndex: 123,
      ledgerHash: HASH,
      ageSeconds: 2,
    })
  })

  it('falls back to the next endpoint after an RPC failure', async () => {
    const calls: string[] = []
    const fetcher: FetchLike = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('primary')) return response({ result: { status: 'error', error: 'down' } })
      return response({
        result: {
          status: 'success',
          info: {
            validated_ledger: {
              seq: 124,
              hash: HASH,
              age: 1,
            },
          },
        },
      })
    }

    const head = await readLatestValidatedLedgerHead({
      endpoints: ['https://primary.example', 'https://fallback.example'],
      timeoutMs: 1_000,
      fetcher,
    })

    expect(calls).toEqual(['https://primary.example', 'https://fallback.example'])
    expect(head.endpoint).toBe('https://fallback.example')
    expect(head.ledgerIndex).toBe(124)
  })

  it('falls back when the first validated head is too old', async () => {
    const calls: string[] = []
    const fetcher: FetchLike = async (input) => {
      const url = String(input)
      calls.push(url)
      return response({
        result: {
          status: 'success',
          info: {
            validated_ledger: {
              seq: url.includes('primary') ? 123 : 124,
              hash: HASH,
              age: url.includes('primary') ? 45 : 2,
            },
          },
        },
      })
    }

    const head = await readLatestValidatedLedgerHead({
      endpoints: ['https://primary.example', 'https://fallback.example'],
      timeoutMs: 1_000,
      maxAgeSeconds: 30,
      fetcher,
    })

    expect(calls).toEqual(['https://primary.example', 'https://fallback.example'])
    expect(head.endpoint).toBe('https://fallback.example')
    expect(head.ledgerIndex).toBe(124)
    expect(head.ageSeconds).toBe(2)
  })

  it('fails closed when every validated head is too old', async () => {
    const fetcher: FetchLike = async () => response({
      result: {
        status: 'success',
        info: {
          validated_ledger: {
            seq: 123,
            hash: HASH,
            age: 45,
          },
        },
      },
    })

    await expect(readLatestValidatedLedgerHead({
      endpoints: ['https://primary.example', 'https://fallback.example'],
      timeoutMs: 1_000,
      maxAgeSeconds: 30,
      fetcher,
    })).rejects.toBeInstanceOf(LatestValidatedLedgerHeadError)
  })

  it('fails closed when every endpoint is invalid', async () => {
    const fetcher: FetchLike = async () => response({
      result: {
        status: 'success',
        info: {
          validated_ledger: {
            seq: 123,
            hash: 'bad',
            age: 1,
          },
        },
      },
    })

    await expect(readLatestValidatedLedgerHead({
      endpoints: ['https://primary.example', 'https://fallback.example'],
      timeoutMs: 1_000,
      fetcher,
    })).rejects.toBeInstanceOf(LatestValidatedLedgerHeadError)
  })
})
