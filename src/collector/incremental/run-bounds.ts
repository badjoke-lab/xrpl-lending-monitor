import { deriveArchivedObjects } from './deleted-object-archive'
import { deriveBalanceHistory } from './cover-debt-loss'
import { deriveCurrentStateOverlayMutations } from './current-state-overlay'
import { normalizeAffectedNodes } from './affected-nodes'
import { deriveLoanLifecycleEvents } from './loan-lifecycle'
import type { IncrementalLedgerRead, IncrementalScanResult } from './scan-validated-ledgers'
import type { IncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'

const FIXED_STATEMENTS = 7
const FIXED_ROWS = 8

export interface IncrementalWorkEstimate {
  ledgers: number
  inspectedTransactions: number
  lendingTransactions: number
  estimatedRows: number
  estimatedStatements: number
  overlayMutations: number
}

export class IncrementalWorkBudgetError extends Error {
  readonly code: 'ledger_exceeds_run_budget'
  readonly ledgerIndex: number

  constructor(ledgerIndex: number) {
    super(`Ledger ${ledgerIndex} exceeds the configured incremental run budget`)
    this.name = 'IncrementalWorkBudgetError'
    this.code = 'ledger_exceeds_run_budget'
    this.ledgerIndex = ledgerIndex
  }
}

function estimateLedger(ledger: IncrementalLedgerRead, epochId: string): IncrementalWorkEstimate {
  let rows = 1
  let statements = 1
  let overlays = 0

  for (const event of ledger.lendingTransactions) {
    const context = {
      network: 'devnet' as const,
      epochId,
      ledgerIndex: ledger.ledgerIndex,
      closeTime: ledger.closeTime,
      transactionHash: event.hash,
      transactionIndex: event.transactionIndex,
      transactionType: event.transactionType,
      result: event.result,
    }
    const changes = normalizeAffectedNodes(event.metadata, context)
    const lifecycle = deriveLoanLifecycleEvents(changes)
    const archives = deriveArchivedObjects(changes)
    const balances = deriveBalanceHistory(changes)
    const overlay = deriveCurrentStateOverlayMutations(event.metadata, {
      ledgerIndex: ledger.ledgerIndex,
      transactionHash: event.hash,
    })
    const eventRows = 1 + changes.length + lifecycle.length + archives.length + balances.length + overlay.length
    rows += eventRows
    statements += eventRows
    overlays += overlay.length
  }

  return {
    ledgers: 1,
    inspectedTransactions: ledger.transactions.length,
    lendingTransactions: ledger.lendingTransactions.length,
    estimatedRows: rows,
    estimatedStatements: statements,
    overlayMutations: overlays,
  }
}

function add(left: IncrementalWorkEstimate, right: IncrementalWorkEstimate): IncrementalWorkEstimate {
  return {
    ledgers: left.ledgers + right.ledgers,
    inspectedTransactions: left.inspectedTransactions + right.inspectedTransactions,
    lendingTransactions: left.lendingTransactions + right.lendingTransactions,
    estimatedRows: left.estimatedRows + right.estimatedRows,
    estimatedStatements: left.estimatedStatements + right.estimatedStatements,
    overlayMutations: left.overlayMutations + right.overlayMutations,
  }
}

function within(estimate: IncrementalWorkEstimate, config: IncrementalRuntimeConfig): boolean {
  return estimate.ledgers <= config.maxLedgersPerRun
    && estimate.inspectedTransactions <= config.maxInspectedTransactionsPerRun
    && estimate.lendingTransactions <= config.maxLendingTransactionsPerRun
    && estimate.estimatedRows <= config.maxRowsPerRun
    && estimate.estimatedStatements <= config.maxStatementsPerRun
    && estimate.overlayMutations <= config.maxOverlayMutationsPerRun
}

export function selectIncrementalCommitPrefix(options: {
  scan: IncrementalScanResult
  epochId: string
  config: IncrementalRuntimeConfig
}): { scan: IncrementalScanResult; estimate: IncrementalWorkEstimate } {
  const selected: IncrementalLedgerRead[] = []
  let estimate: IncrementalWorkEstimate = {
    ledgers: 0,
    inspectedTransactions: 0,
    lendingTransactions: 0,
    estimatedRows: FIXED_ROWS,
    estimatedStatements: FIXED_STATEMENTS,
    overlayMutations: 0,
  }

  for (const ledger of options.scan.ledgers) {
    if (ledger.transactions.length > options.config.maxTransactionsPerLedger) {
      if (selected.length === 0) throw new IncrementalWorkBudgetError(ledger.ledgerIndex)
      break
    }
    const candidate = add(estimate, estimateLedger(ledger, options.epochId))
    if (!within(candidate, options.config)) {
      if (selected.length === 0) throw new IncrementalWorkBudgetError(ledger.ledgerIndex)
      break
    }
    selected.push(ledger)
    estimate = candidate
  }

  const endLedgerIndex = selected.at(-1)?.ledgerIndex ?? null
  return {
    scan: {
      ...options.scan,
      endLedgerIndex,
      completeToLatest: endLedgerIndex === options.scan.latestValidatedLedger,
      ledgers: selected,
      metrics: {
        ledgers: selected.length,
        inspectedTransactions: estimate.inspectedTransactions,
        lendingTransactions: estimate.lendingTransactions,
        elapsedMs: options.scan.metrics.elapsedMs,
      },
    },
    estimate,
  }
}
