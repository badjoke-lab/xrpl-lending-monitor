export interface PreviousLedgerObservation {
  index: number
  hash: string
}

export type ResetReason = 'ledger_index_rewind' | 'same_index_hash_changed'

export interface ResetDetection {
  suspected: boolean
  reason: ResetReason | null
  previous: PreviousLedgerObservation | null
  current: PreviousLedgerObservation
}

export function detectReset(
  previous: PreviousLedgerObservation | null,
  current: PreviousLedgerObservation,
): ResetDetection {
  if (!previous) {
    return {
      suspected: false,
      reason: null,
      previous,
      current,
    }
  }

  if (current.index < previous.index) {
    return {
      suspected: true,
      reason: 'ledger_index_rewind',
      previous,
      current,
    }
  }

  if (current.index === previous.index && current.hash !== previous.hash) {
    return {
      suspected: true,
      reason: 'same_index_hash_changed',
      previous,
      current,
    }
  }

  return {
    suspected: false,
    reason: null,
    previous,
    current,
  }
}
