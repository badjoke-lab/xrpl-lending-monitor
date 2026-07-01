import { describe, expect, it } from 'vitest'

import { resolveRuntimeConfig } from './runtime-config'

const validEnvironment = {
  APP_NETWORK: 'devnet',
  MAINNET_ENABLED: 'false',
  XRPL_DEVNET_RPC_URL: 'https://s.devnet.rippletest.net:51234',
}

describe('resolveRuntimeConfig', () => {
  it('accepts the approved Devnet configuration with bounded defaults', () => {
    expect(resolveRuntimeConfig(validEnvironment)).toEqual({
      network: 'devnet',
      mainnetEnabled: false,
      xrplRpcUrls: ['https://s.devnet.rippletest.net:51234/'],
      rpcTimeoutMs: 8000,
      staleAfterSeconds: 30,
    })
  })

  it('accepts a distinct HTTPS fallback and explicit limits', () => {
    const config = resolveRuntimeConfig({
      ...validEnvironment,
      XRPL_DEVNET_RPC_FALLBACK_URL: 'https://fallback.example/rpc',
      XRPL_RPC_TIMEOUT_MS: '5000',
      NETWORK_STATUS_STALE_AFTER_SECONDS: '45',
    })

    expect(config.xrplRpcUrls).toEqual([
      'https://s.devnet.rippletest.net:51234/',
      'https://fallback.example/rpc',
    ])
    expect(config.rpcTimeoutMs).toBe(5000)
    expect(config.staleAfterSeconds).toBe(45)
  })

  it('deduplicates identical endpoints', () => {
    const config = resolveRuntimeConfig({
      ...validEnvironment,
      XRPL_DEVNET_RPC_FALLBACK_URL: validEnvironment.XRPL_DEVNET_RPC_URL,
    })
    expect(config.xrplRpcUrls).toHaveLength(1)
  })

  it('rejects Mainnet settings', () => {
    expect(() =>
      resolveRuntimeConfig({ ...validEnvironment, APP_NETWORK: 'mainnet' }),
    ).toThrow('APP_NETWORK must remain devnet')

    expect(() =>
      resolveRuntimeConfig({ ...validEnvironment, MAINNET_ENABLED: 'true' }),
    ).toThrow('MAINNET_ENABLED must remain false')
  })

  it('rejects insecure endpoints', () => {
    expect(() =>
      resolveRuntimeConfig({
        ...validEnvironment,
        XRPL_DEVNET_RPC_URL: 'http://localhost:51234',
      }),
    ).toThrow('XRPL_DEVNET_RPC_URL must use HTTPS')

    expect(() =>
      resolveRuntimeConfig({
        ...validEnvironment,
        XRPL_DEVNET_RPC_FALLBACK_URL: 'http://fallback.example',
      }),
    ).toThrow('XRPL_DEVNET_RPC_FALLBACK_URL must use HTTPS')
  })

  it('rejects invalid numeric limits', () => {
    expect(() =>
      resolveRuntimeConfig({ ...validEnvironment, XRPL_RPC_TIMEOUT_MS: '0' }),
    ).toThrow('XRPL_RPC_TIMEOUT_MS must be a positive integer')

    expect(() =>
      resolveRuntimeConfig({
        ...validEnvironment,
        NETWORK_STATUS_STALE_AFTER_SECONDS: '1.5',
      }),
    ).toThrow('NETWORK_STATUS_STALE_AFTER_SECONDS must be a positive integer')
  })
})
