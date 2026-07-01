import { describe, expect, it } from 'vitest'

import { resolveRuntimeConfig } from './runtime-config'

const validEnvironment = {
  APP_NETWORK: 'devnet',
  MAINNET_ENABLED: 'false',
  XRPL_DEVNET_RPC_URL: 'https://s.devnet.rippletest.net:51234',
}

describe('resolveRuntimeConfig', () => {
  it('accepts the approved Devnet configuration with fail-closed scan defaults', () => {
    expect(resolveRuntimeConfig(validEnvironment)).toEqual({
      network: 'devnet',
      mainnetEnabled: false,
      xrplRpcUrls: ['https://s.devnet.rippletest.net:51234/'],
      rpcTimeoutMs: 8000,
      staleAfterSeconds: 30,
      currentStateCollectionEnabled: false,
      currentScanPageLimitPerType: 200,
      currentScanRequestLimitTotal: 600,
      currentScanObjectLimitPerPage: 2048,
      currentScanWriteBatchSize: 50,
    })
  })

  it('accepts a distinct HTTPS fallback and explicit collection limits', () => {
    const config = resolveRuntimeConfig({
      ...validEnvironment,
      XRPL_DEVNET_RPC_FALLBACK_URL: 'https://fallback.example/rpc',
      XRPL_RPC_TIMEOUT_MS: '5000',
      NETWORK_STATUS_STALE_AFTER_SECONDS: '45',
      CURRENT_STATE_COLLECTION_ENABLED: 'true',
      CURRENT_SCAN_PAGE_LIMIT_PER_TYPE: '25',
      CURRENT_SCAN_REQUEST_LIMIT_TOTAL: '75',
      CURRENT_SCAN_OBJECT_LIMIT_PER_PAGE: '1024',
      CURRENT_SCAN_WRITE_BATCH_SIZE: '20',
    })

    expect(config).toMatchObject({
      xrplRpcUrls: [
        'https://s.devnet.rippletest.net:51234/',
        'https://fallback.example/rpc',
      ],
      rpcTimeoutMs: 5000,
      staleAfterSeconds: 45,
      currentStateCollectionEnabled: true,
      currentScanPageLimitPerType: 25,
      currentScanRequestLimitTotal: 75,
      currentScanObjectLimitPerPage: 1024,
      currentScanWriteBatchSize: 20,
    })
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

  it('rejects invalid flags and numeric limits', () => {
    expect(() =>
      resolveRuntimeConfig({ ...validEnvironment, XRPL_RPC_TIMEOUT_MS: '0' }),
    ).toThrow('XRPL_RPC_TIMEOUT_MS must be a positive integer')

    expect(() =>
      resolveRuntimeConfig({
        ...validEnvironment,
        NETWORK_STATUS_STALE_AFTER_SECONDS: '1.5',
      }),
    ).toThrow('NETWORK_STATUS_STALE_AFTER_SECONDS must be a positive integer')

    expect(() =>
      resolveRuntimeConfig({
        ...validEnvironment,
        CURRENT_STATE_COLLECTION_ENABLED: 'yes',
      }),
    ).toThrow('CURRENT_STATE_COLLECTION_ENABLED must be true or false')

    expect(() =>
      resolveRuntimeConfig({
        ...validEnvironment,
        CURRENT_SCAN_REQUEST_LIMIT_TOTAL: '2',
      }),
    ).toThrow('CURRENT_SCAN_REQUEST_LIMIT_TOTAL must allow at least three requests')

    expect(() =>
      resolveRuntimeConfig({
        ...validEnvironment,
        CURRENT_SCAN_OBJECT_LIMIT_PER_PAGE: '0',
      }),
    ).toThrow('CURRENT_SCAN_OBJECT_LIMIT_PER_PAGE must be a positive integer')
  })
})
