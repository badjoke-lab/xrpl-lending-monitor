export interface HistorySourceMergeDiagnostics {
  immutableInput: number
  liveInput: number
  immutableAccepted: number
  liveAccepted: number
  liveSuppressedAtBoundary: number
  duplicatesSuppressed: number
}

export interface HistorySourceMergeResult<T> {
  items: T[]
  diagnostics: HistorySourceMergeDiagnostics
}

export function mergeHistorySources<T>(options: {
  immutable: readonly T[]
  live: readonly T[]
  boundaryLedgerIndex: number
  ledgerIndex: (value: T) => number
  identity: (value: T) => string
  compare: (left: T, right: T) => number
  limit: number
}): HistorySourceMergeResult<T> {
  if (!Number.isSafeInteger(options.boundaryLedgerIndex) || options.boundaryLedgerIndex < 1) {
    throw new Error('History merge boundary must be a positive safe integer')
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('History merge limit must be between 1 and 100')
  }

  for (const item of options.immutable) {
    const ledger = options.ledgerIndex(item)
    if (!Number.isSafeInteger(ledger) || ledger < 1) throw new Error('Immutable history ledger index is invalid')
    if (ledger > options.boundaryLedgerIndex) {
      throw new Error('Immutable history row exceeds the verified publication boundary')
    }
  }

  const liveAccepted: T[] = []
  let liveSuppressedAtBoundary = 0
  for (const item of options.live) {
    const ledger = options.ledgerIndex(item)
    if (!Number.isSafeInteger(ledger) || ledger < 1) throw new Error('Live history ledger index is invalid')
    if (ledger <= options.boundaryLedgerIndex) {
      liveSuppressedAtBoundary += 1
      continue
    }
    liveAccepted.push(item)
  }

  const candidates = [
    ...options.immutable,
    ...liveAccepted,
  ].sort(options.compare)

  const items: T[] = []
  const identities = new Set<string>()
  let duplicatesSuppressed = 0
  for (const item of candidates) {
    const identity = options.identity(item)
    if (identity.length === 0) throw new Error('History merge identity must be non-empty')
    if (identities.has(identity)) {
      duplicatesSuppressed += 1
      continue
    }
    identities.add(identity)
    items.push(item)
    if (items.length >= options.limit) break
  }

  return {
    items,
    diagnostics: {
      immutableInput: options.immutable.length,
      liveInput: options.live.length,
      immutableAccepted: options.immutable.length,
      liveAccepted: liveAccepted.length,
      liveSuppressedAtBoundary,
      duplicatesSuppressed,
    },
  }
}
