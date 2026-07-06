import { describe, expect, it } from 'vitest'
import { resolveReplacementBaseRuntimeConfig } from './replacement-base-runtime-config'

const targetEnv = {
  REPLACEMENT_BASE_REBASE_ENABLED: 'true',
  REPLACEMENT_BASE_EPOCH_ID: 'devnet-3371675',
  REPLACEMENT_BASE_SNAPSHOT_ID: 'devnet-3432924-canonical',
  REPLACEMENT_BASE_LEDGER_INDEX: '3432924',
  REPLACEMENT_BASE_LEDGER_HASH: '52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218',
}

describe('replacement-base runtime config', () => {
  it('defaults rebase to disabled', () => {
    expect(resolveReplacementBaseRuntimeConfig({})).toEqual({
      rebaseEnabled: false,
      target: null,
    })
  })

  it('resolves the enabled replacement target identity', () => {
    expect(resolveReplacementBaseRuntimeConfig(targetEnv)).toEqual({
      rebaseEnabled: true,
      target: {
        epochId: 'devnet-3371675',
        snapshotId: 'devnet-3432924-canonical',
        ledgerIndex: 3432924,
        ledgerHash: '52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218',
      },
    })
  })

  it('rejects enabled rebase without a complete target identity', () => {
    expect(() => resolveReplacementBaseRuntimeConfig({
      REPLACEMENT_BASE_REBASE_ENABLED: 'true',
    })).toThrow('REPLACEMENT_BASE_LEDGER_INDEX is required')
  })

  it('rejects invalid target ledger hashes', () => {
    expect(() => resolveReplacementBaseRuntimeConfig({
      ...targetEnv,
      REPLACEMENT_BASE_LEDGER_HASH: 'not-a-ledger-hash',
    })).toThrow('64-character hexadecimal hash')
  })

  it('rejects invalid enable flags', () => {
    expect(() => resolveReplacementBaseRuntimeConfig({
      REPLACEMENT_BASE_REBASE_ENABLED: 'yes',
    })).toThrow('must be true or false')
  })
})
