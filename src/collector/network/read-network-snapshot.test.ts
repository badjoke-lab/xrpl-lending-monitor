import { describe, expect, it } from 'vitest'

import {
  LENDING_PROTOCOL_ID,
  SINGLE_ASSET_VAULT_ID,
} from '../../domain/network/amendments'
import { readNetworkSnapshot } from './read-network-snapshot'
import type { FetchLike } from './xrpl-rpc'

function jsonResponse(result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ result, status: 'success' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function successfulFetcher(failedEndpoint?: string): FetchLike {
  return async (input, init) => {
    const endpoint = String(input)
    if (endpoint === failedEndpoint) throw new Error('endpoint unavailable')

    const body = JSON.parse(String(init?.body)) as {
      method: string
      params: Array<Record<string, unknown>>
    }

    if (body.method === 'server_info') {
      return jsonResponse({
        info: {
          build_version: '3.2.0',
          server_state: 'full',
          complete_ledgers: '1-12345',
          validated_ledger: {
            age: 2,
            hash: 'ABCDEF',
            seq: 12345,
          },
        },
      })
    }

    if (body.method === 'feature') {
      const id = String(body.params[0]?.feature)
      const name = id === LENDING_PROTOCOL_ID ? 'LendingProtocol' : 'SingleAssetVault'
      return jsonResponse({
        [id]: {
          enabled: true,
          supported: true,
          name,
        },
      })
    }

    return jsonResponse({})
  }
}

describe('readNetworkSnapshot', () => {
  it('parses one consistent endpoint snapshot', async () => {
    const snapshot = await readNetworkSnapshot({
      endpoints: ['https://primary.example'],
      timeoutMs: 1000,
      fetcher: successfulFetcher(),
      now: () => new Date('2026-07-01T00:00:00.000Z'),
    })

    expect(snapshot).toMatchObject({
      endpoint: 'https://primary.example',
      serverVersion: '3.2.0',
      serverState: 'full',
      validatedLedger: {
        index: 12345,
        hash: 'ABCDEF',
        ageSeconds: 2,
      },
      amendments: {
        lendingProtocol: {
          id: LENDING_PROTOCOL_ID,
          enabled: true,
          supported: true,
        },
        singleAssetVault: {
          id: SINGLE_ASSET_VAULT_ID,
          enabled: true,
          supported: true,
        },
      },
    })
  })

  it('serializes snapshot RPC calls for socket-constrained runtimes', async () => {
    const baseFetcher = successfulFetcher()
    let inFlight = 0
    let maxInFlight = 0
    const methods: string[] = []

    const fetcher: FetchLike = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string }
      methods.push(body.method)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)

      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return await baseFetcher(input, init)
      } finally {
        inFlight -= 1
      }
    }

    await readNetworkSnapshot({
      endpoints: ['https://primary.example'],
      timeoutMs: 1000,
      fetcher,
    })

    expect(methods).toEqual(['server_info', 'feature', 'feature'])
    expect(maxInFlight).toBe(1)
  })

  it('falls back as a whole snapshot when the primary endpoint fails', async () => {
    const snapshot = await readNetworkSnapshot({
      endpoints: ['https://primary.example', 'https://fallback.example'],
      timeoutMs: 1000,
      fetcher: successfulFetcher('https://primary.example'),
    })

    expect(snapshot.endpoint).toBe('https://fallback.example')
  })

  it('rejects a server response without a validated ledger', async () => {
    const fetcher: FetchLike = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string }
      if (body.method === 'server_info') {
        return jsonResponse({ info: { build_version: '3.2.0' } })
      }
      return jsonResponse({})
    }

    await expect(
      readNetworkSnapshot({
        endpoints: ['https://primary.example'],
        timeoutMs: 1000,
        fetcher,
      }),
    ).rejects.toMatchObject({
      name: 'NetworkSnapshotError',
    })
  })
})
