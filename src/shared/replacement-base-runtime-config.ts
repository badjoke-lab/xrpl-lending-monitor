import type { CatchUpBaseIdentity } from './catch-up-base-identity'

export interface ReplacementBaseRuntimeEnvironment {
  REPLACEMENT_BASE_REBASE_ENABLED?: string
  REPLACEMENT_BASE_EPOCH_ID?: string
  REPLACEMENT_BASE_SNAPSHOT_ID?: string
  REPLACEMENT_BASE_LEDGER_INDEX?: string
  REPLACEMENT_BASE_LEDGER_HASH?: string
}

export interface ReplacementBaseRuntimeConfig {
  rebaseEnabled: boolean
  target: CatchUpBaseIdentity | null
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required when a replacement base target is configured`)
  return normalized
}

export function resolveReplacementBaseRuntimeConfig(
  env: ReplacementBaseRuntimeEnvironment,
): ReplacementBaseRuntimeConfig {
  const rebaseEnabled = parseBoolean(
    env.REPLACEMENT_BASE_REBASE_ENABLED,
    false,
    'REPLACEMENT_BASE_REBASE_ENABLED',
  )

  const targetFields = [
    env.REPLACEMENT_BASE_EPOCH_ID,
    env.REPLACEMENT_BASE_SNAPSHOT_ID,
    env.REPLACEMENT_BASE_LEDGER_INDEX,
    env.REPLACEMENT_BASE_LEDGER_HASH,
  ]
  const hasTargetField = targetFields.some((value) => Boolean(value?.trim()))
  if (!rebaseEnabled && !hasTargetField) return { rebaseEnabled: false, target: null }

  const ledgerIndexText = required(
    env.REPLACEMENT_BASE_LEDGER_INDEX,
    'REPLACEMENT_BASE_LEDGER_INDEX',
  )
  const ledgerIndex = Number(ledgerIndexText)
  if (!Number.isSafeInteger(ledgerIndex) || ledgerIndex < 0) {
    throw new Error('REPLACEMENT_BASE_LEDGER_INDEX must be a non-negative safe integer')
  }

  const ledgerHash = required(
    env.REPLACEMENT_BASE_LEDGER_HASH,
    'REPLACEMENT_BASE_LEDGER_HASH',
  ).toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(ledgerHash)) {
    throw new Error('REPLACEMENT_BASE_LEDGER_HASH must be a 64-character hexadecimal hash')
  }

  return {
    rebaseEnabled,
    target: {
      epochId: required(env.REPLACEMENT_BASE_EPOCH_ID, 'REPLACEMENT_BASE_EPOCH_ID'),
      snapshotId: required(env.REPLACEMENT_BASE_SNAPSHOT_ID, 'REPLACEMENT_BASE_SNAPSHOT_ID'),
      ledgerIndex,
      ledgerHash,
    },
  }
}
