export type AppNetwork = 'devnet'

export interface RuntimeEnvironment {
  APP_NETWORK?: string
  MAINNET_ENABLED?: string
  XRPL_DEVNET_RPC_URL?: string
  XRPL_DEVNET_RPC_FALLBACK_URL?: string
  XRPL_RPC_TIMEOUT_MS?: string
  NETWORK_STATUS_STALE_AFTER_SECONDS?: string
  CURRENT_STATE_GITHUB_REPOSITORY?: string
  CURRENT_STATE_RELEASE_CHANNEL_TAG?: string
  CURRENT_STATE_MAX_ASSET_BYTES?: string
  CURRENT_STATE_MAX_DECOMPRESSED_BYTES?: string
  HISTORY_GITHUB_REPOSITORY?: string
  HISTORY_GITHUB_BRANCH?: string
  HISTORY_CHANNEL_PATH?: string
  HISTORY_MAX_ASSET_BYTES?: string
  HISTORY_FETCH_TIMEOUT_MS?: string
}

export interface CurrentStateRuntimeConfig {
  githubRepository: string | null
  releaseChannelTag: string
  maxAssetBytes: number
  maxDecompressedBytes: number
}

export interface HistoryRuntimeConfig {
  githubRepository: string | null
  githubBranch: string
  channelPath: string
  maxAssetBytes: number
  fetchTimeoutMs: number
}

export interface RuntimeConfig {
  network: AppNetwork
  mainnetEnabled: false
  xrplRpcUrls: readonly string[]
  rpcTimeoutMs: number
  staleAfterSeconds: number
  currentState: CurrentStateRuntimeConfig
  history: HistoryRuntimeConfig
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

function parseHttpsUrl(value: string, name: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS`)
  }
  return url.toString()
}

function parseGithubRepository(value: string | undefined, name: string): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error(`${name} must be owner/name`)
  }
  return normalized
}

function parseReleaseChannelTag(value: string | undefined): string {
  const normalized = value?.trim() || 'current-state-channel'
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error('CURRENT_STATE_RELEASE_CHANNEL_TAG must be a flat release tag')
  }
  return normalized
}

function parseBranch(value: string | undefined): string {
  const normalized = value?.trim() || 'history-data'
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error('HISTORY_GITHUB_BRANCH is invalid')
  }
  return normalized
}

function parseRelativePath(value: string | undefined): string {
  const normalized = value?.trim() || 'history-channel.json'
  if (
    normalized.startsWith('/')
    || normalized.includes('\\')
    || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) throw new Error('HISTORY_CHANNEL_PATH must be a safe relative path')
  return normalized
}

export function resolveRuntimeConfig(env: RuntimeEnvironment): RuntimeConfig {
  if (env.APP_NETWORK !== 'devnet') {
    throw new Error('APP_NETWORK must remain devnet until Mainnet is explicitly approved')
  }

  if (env.MAINNET_ENABLED !== 'false') {
    throw new Error('MAINNET_ENABLED must remain false until Mainnet is explicitly approved')
  }

  if (!env.XRPL_DEVNET_RPC_URL) {
    throw new Error('XRPL_DEVNET_RPC_URL is required')
  }

  const endpoints = [
    parseHttpsUrl(env.XRPL_DEVNET_RPC_URL, 'XRPL_DEVNET_RPC_URL'),
    ...(env.XRPL_DEVNET_RPC_FALLBACK_URL
      ? [parseHttpsUrl(env.XRPL_DEVNET_RPC_FALLBACK_URL, 'XRPL_DEVNET_RPC_FALLBACK_URL')]
      : []),
  ]

  return {
    network: 'devnet',
    mainnetEnabled: false,
    xrplRpcUrls: [...new Set(endpoints)],
    rpcTimeoutMs: parsePositiveInteger(env.XRPL_RPC_TIMEOUT_MS, 8_000, 'XRPL_RPC_TIMEOUT_MS'),
    staleAfterSeconds: parsePositiveInteger(
      env.NETWORK_STATUS_STALE_AFTER_SECONDS,
      30,
      'NETWORK_STATUS_STALE_AFTER_SECONDS',
    ),
    currentState: {
      githubRepository: parseGithubRepository(
        env.CURRENT_STATE_GITHUB_REPOSITORY,
        'CURRENT_STATE_GITHUB_REPOSITORY',
      ),
      releaseChannelTag: parseReleaseChannelTag(env.CURRENT_STATE_RELEASE_CHANNEL_TAG),
      maxAssetBytes: parsePositiveInteger(
        env.CURRENT_STATE_MAX_ASSET_BYTES,
        8 * 1024 * 1024,
        'CURRENT_STATE_MAX_ASSET_BYTES',
      ),
      maxDecompressedBytes: parsePositiveInteger(
        env.CURRENT_STATE_MAX_DECOMPRESSED_BYTES,
        16 * 1024 * 1024,
        'CURRENT_STATE_MAX_DECOMPRESSED_BYTES',
      ),
    },
    history: {
      githubRepository: parseGithubRepository(
        env.HISTORY_GITHUB_REPOSITORY,
        'HISTORY_GITHUB_REPOSITORY',
      ),
      githubBranch: parseBranch(env.HISTORY_GITHUB_BRANCH),
      channelPath: parseRelativePath(env.HISTORY_CHANNEL_PATH),
      maxAssetBytes: parsePositiveInteger(
        env.HISTORY_MAX_ASSET_BYTES,
        32 * 1024 * 1024,
        'HISTORY_MAX_ASSET_BYTES',
      ),
      fetchTimeoutMs: parsePositiveInteger(
        env.HISTORY_FETCH_TIMEOUT_MS,
        8_000,
        'HISTORY_FETCH_TIMEOUT_MS',
      ),
    },
  }
}
