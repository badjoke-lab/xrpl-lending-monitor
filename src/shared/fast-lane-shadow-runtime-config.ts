export interface FastLaneShadowRuntimeEnvironment {
  FAST_LANE_WEBSOCKET_ENDPOINT?: string
  FAST_LANE_BOOTSTRAP_LEDGERS?: string
  FAST_LANE_MAX_LEDGERS_PER_RUN?: string
  FAST_LANE_REANCHOR_LAG_LEDGERS?: string
  FAST_LANE_READ_WINDOW?: string
}

export interface FastLaneShadowRuntimeConfig {
  webSocketEndpoint: string
  bootstrapLedgers: number
  maxLedgersPerRun: number
  reanchorLagLedgers: number
  readWindow: number
}

// The Queue Worker performs D1 preflight, claim, atomic window commit, retention,
// successor staging, and completion around each pass. Keep the production-safe
// ledger bound as the default instead of allowing an omitted binding to restore
// the previously unsafe 180-ledger shadow profile.
export const FAST_LANE_SUBREQUEST_SAFE_MAX_LEDGERS = 32

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function webSocketUrl(value: string | undefined): string {
  if (!value) throw new Error('FAST_LANE_WEBSOCKET_ENDPOINT is required')
  const url = new URL(value)
  if (url.protocol !== 'wss:') throw new Error('FAST_LANE_WEBSOCKET_ENDPOINT must use WSS')
  return url.toString()
}

export function resolveFastLaneShadowRuntimeConfig(
  env: FastLaneShadowRuntimeEnvironment,
): FastLaneShadowRuntimeConfig {
  const bootstrapLedgers = positiveInteger(
    env.FAST_LANE_BOOTSTRAP_LEDGERS,
    90,
    'FAST_LANE_BOOTSTRAP_LEDGERS',
  )
  const maxLedgersPerRun = positiveInteger(
    env.FAST_LANE_MAX_LEDGERS_PER_RUN,
    FAST_LANE_SUBREQUEST_SAFE_MAX_LEDGERS,
    'FAST_LANE_MAX_LEDGERS_PER_RUN',
  )
  const reanchorLagLedgers = positiveInteger(
    env.FAST_LANE_REANCHOR_LAG_LEDGERS,
    720,
    'FAST_LANE_REANCHOR_LAG_LEDGERS',
  )
  const readWindow = positiveInteger(env.FAST_LANE_READ_WINDOW, 8, 'FAST_LANE_READ_WINDOW')

  if (maxLedgersPerRun > FAST_LANE_SUBREQUEST_SAFE_MAX_LEDGERS) {
    throw new Error(
      `FAST_LANE_MAX_LEDGERS_PER_RUN must not exceed the subrequest-safe bound of ${FAST_LANE_SUBREQUEST_SAFE_MAX_LEDGERS}`,
    )
  }
  if (reanchorLagLedgers < maxLedgersPerRun) {
    throw new Error('FAST_LANE_REANCHOR_LAG_LEDGERS must be at least FAST_LANE_MAX_LEDGERS_PER_RUN')
  }
  if (reanchorLagLedgers < bootstrapLedgers) {
    throw new Error('FAST_LANE_REANCHOR_LAG_LEDGERS must be at least FAST_LANE_BOOTSTRAP_LEDGERS')
  }

  return {
    webSocketEndpoint: webSocketUrl(env.FAST_LANE_WEBSOCKET_ENDPOINT),
    bootstrapLedgers,
    maxLedgersPerRun,
    reanchorLagLedgers,
    readWindow,
  }
}
