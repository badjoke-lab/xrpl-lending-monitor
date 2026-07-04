import { isLendingTransactionType } from './lending-transaction-types'
import {
  readValidatedLedger,
  type ValidatedLedgerRead,
  type ValidatedLedgerTransaction,
} from './read-validated-ledger'

export interface IncrementalLedgerRead extends ValidatedLedgerRead {
  lendingTransactions: readonly ValidatedLedgerTransaction[]
}

export interface IncrementalScanResult {
  endpoint: string
  startLedgerIndex: number
  endLedgerIndex: number | null
  latestValidatedLedger: number
  completeToLatest: boolean
  ledgers: readonly IncrementalLedgerRead[]
  metrics: {
    ledgers: number
    inspectedTransactions: number
    lendingTransactions: number
    elapsedMs: number
  }
}

export type LedgerReader = typeof readValidatedLedger

function safeInteger(value: number, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be a safe integer of at least ${minimum}`)
  }
  return value
}

export async function scanValidatedLedgerRange(options: {
  endpoint: string
  timeoutMs: number
  startLedgerIndex: number
  latestValidatedLedger: number
  maxLedgers: number
  expectedPreviousHash: string | null
  reader?: LedgerReader
  now?: () => number
  shouldContinue?: (nextLedgerIndex: number, ledgersRead: number) => boolean
}): Promise<IncrementalScanResult> {
  const startLedgerIndex = safeInteger(options.startLedgerIndex, 'startLedgerIndex', 0)
  const latestValidatedLedger = safeInteger(
    options.latestValidatedLedger,
    'latestValidatedLedger',
    0,
  )
  const maxLedgers = safeInteger(options.maxLedgers, 'maxLedgers', 1)
  const now = options.now ?? Date.now
  const startedAt = now()

  if (startLedgerIndex > latestValidatedLedger) {
    return {
      endpoint: options.endpoint,
      startLedgerIndex,
      endLedgerIndex: null,
      latestValidatedLedger,
      completeToLatest: true,
      ledgers: [],
      metrics: {
        ledgers: 0,
        inspectedTransactions: 0,
        lendingTransactions: 0,
        elapsedMs: Math.max(0, now() - startedAt),
      },
    }
  }

  const reader = options.reader ?? readValidatedLedger
  const plannedEndLedgerIndex = Math.min(latestValidatedLedger, startLedgerIndex + maxLedgers - 1)
  const ledgers: IncrementalLedgerRead[] = []
  let expectedParentHash = options.expectedPreviousHash
  let inspectedTransactions = 0
  let lendingTransactions = 0

  for (let ledgerIndex = startLedgerIndex; ledgerIndex <= plannedEndLedgerIndex; ledgerIndex += 1) {
    if (options.shouldContinue && !options.shouldContinue(ledgerIndex, ledgers.length)) break
    const ledger = await reader({
      endpoint: options.endpoint,
      ledgerIndex,
      timeoutMs: options.timeoutMs,
    })
    if (ledger.ledgerIndex !== ledgerIndex) {
      throw new Error(`Incremental reader returned ledger ${ledger.ledgerIndex} for ${ledgerIndex}`)
    }
    if (expectedParentHash && ledger.parentHash !== expectedParentHash) {
      throw new Error(`Ledger ${ledgerIndex} parent hash does not match the prior ledger`)
    }

    const matching = ledger.transactions.filter((item) =>
      isLendingTransactionType(item.transactionType),
    )
    inspectedTransactions += ledger.transactions.length
    lendingTransactions += matching.length
    ledgers.push({ ...ledger, lendingTransactions: matching })
    expectedParentHash = ledger.ledgerHash
  }

  const endLedgerIndex = ledgers.at(-1)?.ledgerIndex ?? null
  return {
    endpoint: options.endpoint,
    startLedgerIndex,
    endLedgerIndex,
    latestValidatedLedger,
    completeToLatest: endLedgerIndex === latestValidatedLedger,
    ledgers,
    metrics: {
      ledgers: ledgers.length,
      inspectedTransactions,
      lendingTransactions,
      elapsedMs: Math.max(0, now() - startedAt),
    },
  }
}
