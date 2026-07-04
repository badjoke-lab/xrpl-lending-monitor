import type { CatchUpBaseIdentity } from './catch-up-base-identity'

export interface CatchUpRuntimeEnvironment {
  CATCH_UP_INITIALIZATION_ENABLED?: string
  CATCH_UP_BASE_EPOCH_ID?: string
  CATCH_UP_BASE_SNAPSHOT_ID?: string
  CATCH_UP_BASE_LEDGER_INDEX?: string
  CATCH_UP_BASE_LEDGER_HASH?: string
}

export interface CatchUpRuntimeConfig {
  initializationEnabled: boolean
  base: CatchUpBaseIdentity | null
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required when catch-up initialization is enabled`)
  return normalized
}

export function resolveCatchUpRuntimeConfig(env: CatchUpRuntimeEnvironment): CatchUpRuntimeConfig {
  const initializationEnabled = parseBoolean(
    env.CATCH_UP_INITIALIZATION_ENABLED,
    false,
    'CATCH_UP_INITIALIZATION_ENABLED',
  )

  if (!initializationEnabled) {
    return { initializationEnabled: false, base: null }
  }

  const ledgerIndexText = required(env.CATCH_UP_BASE_LEDGER_INDEX, 'CATCH_UP_BASE_LEDGER_INDEX')
  const ledgerIndex = Number(ledgerIndexText)
  if (!Number.isSafeInteger(ledgerIndex) || ledgerIndex < 0) {
    throw new Error('CATCH_UP_BASE_LEDGER_INDEX must be a non-negative safe integer')
  }

  const ledgerHash = required(env.CATCH_UP_BASE_LEDGER_HASH, 'CATCH_UP_BASE_LEDGER_HASH').toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(ledgerHash)) {
    throw new Error('CATCH_UP_BASE_LEDGER_HASH must be a 64-character hexadecimal hash')
  }

  return {
    initializationEnabled: true,
    base: {
      epochId: required(env.CATCH_UP_BASE_EPOCH_ID, 'CATCH_UP_BASE_EPOCH_ID'),
      snapshotId: required(env.CATCH_UP_BASE_SNAPSHOT_ID, 'CATCH_UP_BASE_SNAPSHOT_ID'),
      ledgerIndex,
      ledgerHash,
    },
  }
}
