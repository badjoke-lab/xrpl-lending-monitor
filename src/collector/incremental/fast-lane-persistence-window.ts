import type { IncrementalScanResult } from './scan-validated-ledgers'
import {
  buildFastLaneShadowWindowPlan,
  type FastLaneShadowWindowPlan,
} from './fast-lane-shadow-plan'

export const FAST_LANE_MAX_PERSISTENCE_LEDGERS = 32
export const FAST_LANE_MAX_PERSISTENCE_MUTATIONS = 24

export interface FastLanePersistenceWindow {
  scan: IncrementalScanResult
  plan: FastLaneShadowWindowPlan
}

function prefixScan(scan: IncrementalScanResult, count: number): IncrementalScanResult {
  const ledgers = scan.ledgers.slice(0, count)
  const finalLedger = ledgers.at(-1)
  if (!finalLedger) throw new Error('Fast-lane persistence prefix requires at least one ledger')

  return {
    endpoint: scan.endpoint,
    startLedgerIndex: scan.startLedgerIndex,
    endLedgerIndex: finalLedger.ledgerIndex,
    latestValidatedLedger: scan.latestValidatedLedger,
    completeToLatest: finalLedger.ledgerIndex === scan.latestValidatedLedger,
    ledgers,
    metrics: {
      ledgers: ledgers.length,
      inspectedTransactions: ledgers.reduce((total, ledger) => total + ledger.transactions.length, 0),
      lendingTransactions: ledgers.reduce(
        (total, ledger) => total + ledger.lendingTransactions.length,
        0,
      ),
      elapsedMs: scan.metrics.elapsedMs,
    },
  }
}

export function selectFastLanePersistenceWindow(options: {
  scan: IncrementalScanResult
  epochId: string
  latestObservedHash: string
  processedAt: string
  maxLedgers?: number
  maxMutations?: number
}): FastLanePersistenceWindow {
  const maxLedgers = options.maxLedgers ?? FAST_LANE_MAX_PERSISTENCE_LEDGERS
  const maxMutations = options.maxMutations ?? FAST_LANE_MAX_PERSISTENCE_MUTATIONS
  const candidateCount = Math.min(options.scan.ledgers.length, maxLedgers)
  if (candidateCount < 1) throw new Error('Fast-lane persistence selection requires at least one ledger')

  let selected: FastLanePersistenceWindow | null = null
  for (let count = 1; count <= candidateCount; count += 1) {
    const scan = prefixScan(options.scan, count)
    const plan = buildFastLaneShadowWindowPlan({
      epochId: options.epochId,
      scan,
      latestObservedHash: options.latestObservedHash,
      processedAt: options.processedAt,
    })
    if (plan.mutations.length <= maxMutations) selected = { scan, plan }
  }

  if (!selected) {
    throw new Error(
      `Fast-lane first persistence window exceeds mutation budget: limit=${maxMutations}`,
    )
  }
  return selected
}
