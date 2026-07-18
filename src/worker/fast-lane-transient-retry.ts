import { XrplRpcError } from '../collector/network/xrpl-rpc'

const DEFAULT_MAX_ATTEMPTS = 6
const DEFAULT_BASE_DELAY_MS = 500

const TRANSIENT_RPC_CODES = new Set([
  'ledgerNotFound',
  'notSynced',
  'timeout',
  'network_error',
  'tooBusy',
])

const TRANSIENT_MESSAGE_FRAGMENTS = [
  'ledgernotfound',
  'notsynced',
  'not synced',
  'timed out',
  'connection error',
  'connection closed unexpectedly',
  'network error',
  'temporarily unavailable',
  'too busy',
]

export interface FastLaneRetryEvent {
  attempt: number
  nextAttempt: number
  maxAttempts: number
  delayMs: number
  error: unknown
}

export interface FastLaneTransientRetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  sleep?: (delayMs: number) => Promise<void>
  onRetry?: (event: FastLaneRetryEvent) => void
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function isTransientFastLaneXrplError(error: unknown): boolean {
  if (error instanceof XrplRpcError && TRANSIENT_RPC_CODES.has(error.code)) return true

  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => normalized.includes(fragment))
}

export async function withFastLaneTransientRetry<T>(
  operation: () => Promise<T>,
  options: FastLaneTransientRetryOptions = {},
): Promise<T> {
  const maxAttempts = positiveInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts')
  const baseDelayMs = positiveInteger(options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS, 'baseDelayMs')
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientFastLaneXrplError(error)) throw error

      const delayMs = baseDelayMs * attempt
      options.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        error,
      })
      await sleep(delayMs)
    }
  }

  throw new Error('fast-lane transient retry exhausted unexpectedly')
}
