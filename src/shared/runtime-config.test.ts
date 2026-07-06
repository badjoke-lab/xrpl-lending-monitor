import { describe, expect, it } from 'vitest'

import { resolveRuntimeConfig } from './runtime-config'

const validEnvironment = {
  APP_NETWORK: 'devnet',
  MAINNET_ENABLED: 'false',
  XRPL_DEVNET_RPC_URL: 'https://s.devnet.rippletest.net:51234',
}

const defaultCurrentState = {
  githubRepository: null,
  githubBranch: 'current-state-data',
  replacement: null,
  releaseChannelTag: 'current-state-channel',
  maxAssetBytes: 8 * 1024 * 1024,
  maxDecompressedBytes: 16 * 1024 * 1024,
}

const defaultHistory = {
  githubRepository: null,
  githubBranch: 'history-data',
  channelPath: 'history-channel.json',
  maxAssetBytes: 32 * 1024 * 1024,
  fetchTimeoutMs: 8_000,
}

describe('resolveRuntimeConfig', () => {
  it('accepts the approved Devnet status configuration', () => {
    expect(resolveRuntimeConfig(validEnvironment)).toEqual({
      network: 'devnet',
      mainnetEnabled: false,
      xrplRpcUrls: ['https://s.devnet.rippletest.net:51234/'],
      rpcTimeoutMs: 8000,
      staleAfterSeconds: 30,
      currentState: defaultCurrentState,
      history: defaultHistory,
    })
  })

  it('accepts a distinct HTTPS fallback and explicit status limits', () => {
    const config = resolveRuntimeConfig({
      ...validEnvironment,
      XRPL_DEVNET_RPC_FALLBACK_URL: 'https://fallback.example/rpc',
      XRPL_RPC_TIMEOUT_MS: '5000',
      NETWORK_STATUS_STALE_AFTER_SECONDS: '45',
    })

    expect(config).toEqual({
      network: 'devnet',
      mainnetEnabled: false,
      xrplRpcUrls: [
        'https://s.devnet.rippletest.net:51234/',
        'https://fallback.example/rpc',
      ],
      rpcTimeoutMs: 5000,
      staleAfterSeconds: 45,
      currentState: defaultCurrentState,
      history: defaultHistory,
    })
  })

  it('accepts explicit release current-state settings', () => {
    const config = resolveRuntimeConfig({
      ...validEnvironment,
      CURRENT_STATE_GITHUB_REPOSITORY: 'badjoke-lab/xrpl-lending-monitor',
      CURRENT_STATE_GITHUB_BRANCH: 'current-state-devnet',
      CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID: 'devnet-3432924-canonical',
      CURRENT_STATE_REPLACEMENT_GITHUB_BRANCH: 'current-state-candidate-data',
      CURRENT_STATE_RELEASE_CHANNEL_TAG: 'current-state-devnet',
      CURRENT_STATE_MAX_ASSET_BYTES: '12345',
      CURRENT_STATE_MAX_DECOMPRESSED_BYTES: '45678',
    })

    expect(config.currentState).toEqual({
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      githubBranch: 'current-state-devnet',
      replacement: {
        snapshotId: 'devnet-3432924-canonical',
        githubBranch: 'current-state-candidate-data',
      },
      releaseChannelTag: 'current-state-devnet',
      maxAssetBytes: 12345,
      maxDecompressedBytes: 45678,
    })
  })

  it('rejects incomplete replacement current-state mapping', () => {
    expect(() => resolveRuntimeConfig({
      ...validEnvironment,
      CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID: 'devnet-3432924-canonical',
    })).toThrow('must be configured together')
  })

  it('accepts explicit hybrid history settings', () => {
    const config = resolveRuntimeConfig({
      ...validEnvironment,
      HISTORY_GITHUB_REPOSITORY: 'badjoke-lab/xrpl-lending-monitor',
      HISTORY_GITHUB_BRANCH: 'history-devnet',
      HISTORY_CHANNEL_PATH: 'history/channel.json',
      HISTORY_MAX_ASSET_BYTES: '123456',
      HISTORY_FETCH_TIMEOUT_MS: '4321',
    })

    expect(config.history).toEqual({
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      githubBranch: 'history-devnet',
      channelPath: 'history/channel.json',
      maxAssetBytes: 123456,
      fetchTimeoutMs: 4321,
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
    expect(() => resolveRuntimeConfig({ ...validEnvironment, APP_NETWORK: 'mainnet' }))
      .toThrow('APP_NETWORK must remain devnet')
    expect(() => resolveRuntimeConfig({ ...validEnvironment, MAINNET_ENABLED: 'true' }))
      .toThrow('MAINNET_ENABLED must remain false')
  })

  it('rejects insecure endpoints', () => {
    expect(() => resolveRuntimeConfig({
      ...validEnvironment,
      XRPL_DEVNET_RPC_URL: 'http://localhost:51234',
    })).toThrow('XRPL_DEVNET_RPC_URL must use HTTPS')

    expect(() => resolveRuntimeConfig({
      ...validEnvironment,
      XRPL_DEVNET_RPC_FALLBACK_URL: 'http://fallback.example',
    })).toThrow('XRPL_DEVNET_RPC_FALLBACK_URL must use HTTPS')
  })

  it('rejects invalid numeric limits', () => {
    expect(() => resolveRuntimeConfig({ ...validEnvironment, XRPL_RPC_TIMEOUT_MS: '0' }))
      .toThrow('XRPL_RPC_TIMEOUT_MS must be a positive integer')
    expect(() => resolveRuntimeConfig({
      ...validEnvironment,
      NETWORK_STATUS_STALE_AFTER_SECONDS: '1.5',
    })).toThrow('NETWORK_STATUS_STALE_AFTER_SECONDS must be a positive integer')
    expect(() => resolveRuntimeConfig({
      ...validEnvironment,
      HISTORY_MAX_ASSET_BYTES: '0',
    })).toThrow('HISTORY_MAX_ASSET_BYTES must be a positive integer')
  })

  it('rejects unsafe branch and channel paths', () => {
    expect(() => resolveRuntimeConfig({
      ...validEnvironment,
      CURRENT_STATE_GITHUB_BRANCH: 'current/state',
    })).toThrow('CURRENT_STATE_GITHUB_BRANCH is invalid')
    expect(() => resolveRuntimeConfig({
      ...validEnvironment,
      HISTORY_GITHUB_BRANCH: 'history/devnet',
    })).toThrow('HISTORY_GITHUB_BRANCH is invalid')
    expect(() => resolveRuntimeConfig({
      ...validEnvironment,
      HISTORY_CHANNEL_PATH: '../history-channel.json',
    })).toThrow('HISTORY_CHANNEL_PATH must be a safe relative path')
  })
})
