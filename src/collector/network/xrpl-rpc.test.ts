import { afterEach, describe, expect, it, vi } from 'vitest'

import { XrplJsonRpcClient } from './xrpl-rpc'

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
})
