import { afterEach, describe, expect, it, vi } from 'vitest'

import { XrplJsonRpcClient, XrplRpcError } from './xrpl-rpc'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('XrplJsonRpcClient', () => {
  it('binds the default Worker fetch implementation to globalThis', async () => {
    const fetchSpy = vi.fn(async function (this: unknown) {
      expect(this).toBe(globalThis)
      return new Response(JSON.stringify({
        result: {
          info: {
            build_version: '3.2.0',
          },
        },
        status: 'success',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const client = new XrplJsonRpcClient({
      endpoint: 'https://devnet.example/',
      timeoutMs: 1000,
    })

    const result = await client.call<{ info: { build_version: string } }>('server_info')

    expect(result.info.build_version).toBe('3.2.0')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not import the Worker socket fallback in Node for non-standard HTTPS ports', async () => {
    const fetchError = new Error('transient Node fetch failure')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(fetchError))
    vi.stubGlobal('WebSocketPair', undefined)

    const client = new XrplJsonRpcClient({
      endpoint: 'https://clio.devnet.rippletest.net:51234/',
      timeoutMs: 1000,
    })

    await expect(client.call('ledger', { ledger_index: 3_800_886 })).rejects.toMatchObject<XrplRpcError>({
      name: 'XrplRpcError',
      code: 'network_error',
      message: 'transient Node fetch failure',
      details: fetchError,
    })
  })
})
