import { deriveCurrentStateOverlayMutations } from './current-state-overlay'
import {
  coalesceLatestOverlayMutations,
  type SourcedOverlayMutation,
} from './coalesced-overlay-mutations'
import type { IncrementalScanResult } from './scan-validated-ledgers'

export interface FastLaneShadowActivity {
  hash: string
  ledgerIndex: number
  transactionIndex: number
  transactionType: string
  result: string
  account: string | null
}

export interface FastLaneShadowWindowPlan {
  epochId: string
  startLedgerIndex: number
  endLedgerIndex: number
  endLedgerHash: string
  latestObservedLedger: number
  latestObservedHash: string
  windowStartCloseTime: number
  windowEndCloseTime: number
  inspectedTransactions: number
  lendingTransactions: number
  successfulLendingTransactions: number
  activity: FastLaneShadowActivity[]
  mutations: SourcedOverlayMutation[]
}

export function buildFastLaneShadowWindowPlan(options: {
  epochId: string
  scan: IncrementalScanResult
  latestObservedHash: string
  processedAt: string
}): FastLaneShadowWindowPlan {
  const firstLedger = options.scan.ledgers[0]
  const finalLedger = options.scan.ledgers.at(-1)
  if (!firstLedger || !finalLedger) throw new Error('Fast-lane shadow plan requires at least one ledger')

  const activity: FastLaneShadowActivity[] = []
  const sourcedMutations: SourcedOverlayMutation[] = []
  let successfulLendingTransactions = 0

  for (const ledger of options.scan.ledgers) {
    for (const event of ledger.lendingTransactions) {
      activity.push({
        hash: event.hash,
        ledgerIndex: ledger.ledgerIndex,
        transactionIndex: event.transactionIndex,
        transactionType: event.transactionType,
        result: event.result,
        account: event.account,
      })

      if (event.result !== 'tesSUCCESS') continue
      successfulLendingTransactions += 1
      const mutations = deriveCurrentStateOverlayMutations(event.metadata, {
        ledgerIndex: ledger.ledgerIndex,
        transactionHash: event.hash,
      })
      for (const mutation of mutations) {
        sourcedMutations.push({
          mutation,
          ledgerIndex: ledger.ledgerIndex,
          ledgerHash: ledger.ledgerHash,
          transactionHash: event.hash,
          transactionIndex: event.transactionIndex,
          updatedAt: options.processedAt,
        })
      }
    }
  }

  return {
    epochId: options.epochId,
    startLedgerIndex: firstLedger.ledgerIndex,
    endLedgerIndex: finalLedger.ledgerIndex,
    endLedgerHash: finalLedger.ledgerHash,
    latestObservedLedger: options.scan.latestValidatedLedger,
    latestObservedHash: options.latestObservedHash,
    windowStartCloseTime: firstLedger.closeTime,
    windowEndCloseTime: finalLedger.closeTime,
    inspectedTransactions: options.scan.metrics.inspectedTransactions,
    lendingTransactions: options.scan.metrics.lendingTransactions,
    successfulLendingTransactions,
    activity,
    mutations: coalesceLatestOverlayMutations(sourcedMutations),
  }
}
