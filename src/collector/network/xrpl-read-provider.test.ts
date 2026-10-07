import { describe, expect, it, vi } from 'vitest'

import { XrplRpcError } from './xrpl-rpc'
import {
  DirectXrplReadProvider,
  XrplToReadProvider,
} from './xrpl-read-provider'

describe('XRPL read providers', () => {
  it('keeps the direct provider request shape unchanged', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({
        method: 'server_info',
        params: [{ counters: false, api_version: 2 }],
      })
      return new Response(JSON.stringify({
        result: {
          info: {
            build_version: '3.2.0',
          },
        },
      }), { status: 200 })
    })

    const provider = new DirectXrplReadProvider({
      endpoint: 'https://direct.example/',
      timeoutMs: 1000,
      fetcher,
    })

    const result = await provider.call<{ info: { build_version: string } }>(
      'server_info',
      { counters: false },
    )

    expect(provider.kind).toBe('direct')
    expect(result.info.build_version).toBe('3.2.0')
  })

  it('uses the XRPL.to envelope, User-Agent, and API key without exposing it in the body', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('user-agent')).toBe('xrpl-lending-monitor-shadow/1.0')
      expect(headers.get('x-api-key')).toBe('xrpl_secret_value')

      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({
        method: 'ledger',
        params: {
          ledger_index: 123,
          transactions: true,
          expand: true,
        },
      })
      expect(String(init?.body)).not.toContain('xrpl_secret_value')

      return new Response(JSON.stringify({
        success: true,
        method: 'ledger',
        result: {
          ledger_index: 123,
          validated: true,
          ledger: {},
        },
      }), { status: 200 })
    })

    const provider = new XrplToReadProvider({
      endpoint: 'https://api.xrpl.to/v1/testnet/rpc',
      timeoutMs: 1000,
      apiKey: ' xrpl_secret_value ',
      userAgent: 'xrpl-lending-monitor-shadow/1.0',
      fetcher,
    })

    const result = await provider.call<Record<string, unknown>>('ledger', {
      ledger_index: 123,
      transactions: true,
      expand: true,
    })

    expect(provider.kind).toBe('xrplto')
    expect(result.ledger_index).toBe(123)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('maps HTTP 429 to a consistent rate_limited error with Retry-After evidence', async () => {
    const provider = new XrplToReadProvider({
      endpoint: 'https://api.xrpl.to/v1/testnet/rpc',
      timeoutMs: 1000,
      apiKey: 'xrpl_secret_value',
      userAgent: 'xrpl-lending-monitor-shadow/1.0',
      fetcher: vi.fn(async () => new Response('rate limited', {
        status: 429,
        headers: {
          'retry-after': '2',
        },
      })),
    })

    await expect(provider.call('ledger', { ledger_index: 123 })).rejects.toMatchObject<XrplRpcError>({
      name: 'XrplRpcError',
      code: 'rate_limited',
      details: {
        status: 429,
        retryAfter: '2',
      },
    })
  })

  it('rejects an empty User-Agent before any request is made', () => {
    expect(() => new XrplToReadProvider({
      endpoint: 'https://api.xrpl.to/v1/testnet/rpc',
      timeoutMs: 1000,
      userAgent: '   ',
    })).toThrow('XRPL.to provider requires a descriptive User-Agent')
  })
})
