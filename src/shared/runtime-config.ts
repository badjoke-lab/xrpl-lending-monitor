export type AppNetwork = 'devnet'

export interface RuntimeEnvironment {
  APP_NETWORK?: string
  MAINNET_ENABLED?: string
  XRPL_DEVNET_RPC_URL?: string
  XRPL_DEVNET_RPC_FALLBACK_URL?: string
  XRPL_RPC_TIMEOUT_MS?: string
  NETWORK_STATUS_STALE_AFTER_SECONDS?: string
  CURRENT_STATE_COLLECTION_ENABLED?: string
  CURRENT_SCAN_PAGE_LIMIT_PER_TYPE?: string
  CURRENT_SCAN_REQUEST_LIMIT_TOTAL?: string
  CURRENT_SCAN_OBJECT_LIMIT_PER_PAGE?: string
  CURRENT_SCAN_WRITE_BATCH_SIZE?: string
}

export interface RuntimeConfig {
  network: AppNetwork
  mainnetEnabled: false
  xrplRpcUrls: readonly string[]
  rpcTimeoutMs: number
  staleAfterSeconds: number
  currentStateCollectionEnabled: boolean
  currentScanPageLimitPerType: number
  currentScanRequestLimitTotal: number
  currentScanObjectLimitPerPage: number
  currentScanWriteBatchSize: number
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
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
  const pageLimit = parsePositiveInteger(
    env.CURRENT_SCAN_PAGE_LIMIT_PER_TYPE,
    200,
    'CURRENT_SCAN_PAGE_LIMIT_PER_TYPE',
  )
  const requestLimit = parsePositiveInteger(
    env.CURRENT_SCAN_REQUEST_LIMIT_TOTAL,
    600,
    'CURRENT_SCAN_REQUEST_LIMIT_TOTAL',
  )
  if (requestLimit < 3) {
    throw new Error('CURRENT_SCAN_REQUEST_LIMIT_TOTAL must allow at least three requests')
  }

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
    currentStateCollectionEnabled: parseBoolean(
      env.CURRENT_STATE_COLLECTION_ENABLED,
      false,
      'CURRENT_STATE_COLLECTION_ENABLED',
    ),
    currentScanPageLimitPerType: pageLimit,
    currentScanRequestLimitTotal: requestLimit,
    currentScanObjectLimitPerPage: parsePositiveInteger(
      env.CURRENT_SCAN_OBJECT_LIMIT_PER_PAGE,
      2_048,
      'CURRENT_SCAN_OBJECT_LIMIT_PER_PAGE',
    ),
    currentScanWriteBatchSize: parsePositiveInteger(
      env.CURRENT_SCAN_WRITE_BATCH_SIZE,
      50,
      'CURRENT_SCAN_WRITE_BATCH_SIZE',
    ),
  }
}
