import { describe, expect, it } from 'vitest'

import { resolveRuntimeConfig } from './runtime-config'

const validEnvironment = {
  APP_NETWORK: 'devnet',
  MAINNET_ENABLED: 'false',
  XRPL_DEVNET_RPC_URL: 'https://s.devnet.rippletest.net:51234',
}

describe('resolveRuntimeConfig', () => {
  it('accepts the approved Devnet configuration', () => {
    expect(resolveRuntimeConfig(validEnvironment)).toEqual({
      network: 'devnet',
      mainnetEnabled: false,
      xrplRpcUrl: 'https://s.devnet.rippletest.net:51234/',
    })
  })

  it('rejects a Mainnet network value', () => {
    expect(() =>
      resolveRuntimeConfig({ ...validEnvironment, APP_NETWORK: 'mainnet' }),
    ).toThrow('APP_NETWORK must remain devnet')
  })

  it('rejects enabling Mainnet', () => {
    expect(() =>
      resolveRuntimeConfig({ ...validEnvironment, MAINNET_ENABLED: 'true' }),
    ).toThrow('MAINNET_ENABLED must remain false')
  })

  it('rejects an insecure RPC endpoint', () => {
    expect(() =>
      resolveRuntimeConfig({
        ...validEnvironment,
        XRPL_DEVNET_RPC_URL: 'http://localhost:51234',
      }),
    ).toThrow('XRPL_DEVNET_RPC_URL must use HTTPS')
  })
})
