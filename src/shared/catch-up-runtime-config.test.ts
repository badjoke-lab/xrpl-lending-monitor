import { describe, expect, it } from 'vitest'
import { resolveCatchUpRuntimeConfig } from './catch-up-runtime-config'

const baseEnv = {
  CATCH_UP_INITIALIZATION_ENABLED: 'true',
  CATCH_UP_BASE_EPOCH_ID: 'devnet-3371675',
  CATCH_UP_BASE_SNAPSHOT_ID: 'devnet-3371675-0ba2ed766c19',
  CATCH_UP_BASE_LEDGER_INDEX: '3371675',
  CATCH_UP_BASE_LEDGER_HASH: '0BA2ED766C190C733F8F26288785CBDF01D0FC26E1A6C03EDB7E9DFF6F8BCB90',
}

describe('catch-up runtime config', () => {
  it('defaults initialization to disabled', () => {
    expect(resolveCatchUpRuntimeConfig({})).toEqual({
      initializationEnabled: false,
      base: null,
    })
  })

  it('resolves the enabled verified base identity', () => {
    expect(resolveCatchUpRuntimeConfig(baseEnv)).toEqual({
      initializationEnabled: true,
      base: {
        epochId: 'devnet-3371675',
        snapshotId: 'devnet-3371675-0ba2ed766c19',
        ledgerIndex: 3371675,
        ledgerHash: '0BA2ED766C190C733F8F26288785CBDF01D0FC26E1A6C03EDB7E9DFF6F8BCB90',
      },
    })
  })

  it('rejects enabled initialization without a complete verified base identity', () => {
    expect(() => resolveCatchUpRuntimeConfig({
      CATCH_UP_INITIALIZATION_ENABLED: 'true',
    })).toThrow('CATCH_UP_BASE_LEDGER_INDEX is required')
  })

  it('rejects invalid base ledger hashes', () => {
    expect(() => resolveCatchUpRuntimeConfig({
      ...baseEnv,
      CATCH_UP_BASE_LEDGER_HASH: 'not-a-ledger-hash',
    })).toThrow('64-character hexadecimal hash')
  })
})
