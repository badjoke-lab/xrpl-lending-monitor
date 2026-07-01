export type AppNetwork = 'devnet'

export interface RuntimeEnvironment {
  APP_NETWORK?: string
  MAINNET_ENABLED?: string
  XRPL_DEVNET_RPC_URL?: string
  XRPL_DEVNET_RPC_FALLBACK_URL?: string
  XRPL_RPC_TIMEOUT_MS?: string
  NETWORK_STATUS_STALE_AFTER_SECONDS?: string
}

export interface RuntimeConfig {
  network: AppNetwork
  mainnetEnabled: false
  xrplRpcUrls: readonly string[]
  rpcTimeoutMs: number
  staleAfterSeconds: number
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
  }
}
