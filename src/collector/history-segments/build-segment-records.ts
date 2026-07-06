import { normalizeAffectedNodes } from '../incremental/affected-nodes'
import { deriveArchivedObjects } from '../incremental/deleted-object-archive'
import { deriveBalanceHistory } from '../incremental/cover-debt-loss'
import { deriveCurrentStateOverlayMutations } from '../incremental/current-state-overlay'
import { deriveLoanLifecycleEvents } from '../incremental/loan-lifecycle'
import type { IncrementalScanResult } from '../incremental/scan-validated-ledgers'

export interface SegmentLedgerRecord {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  closeTime: number
  inspectedTransactions: number
  lendingTransactions: number
}

export interface SegmentProtocolEventRecord {
  eventHash: string
  ledgerIndex: number
  eventIndex: number
  closeTime: number
  eventType: string
  resultCode: string
  account: string | null
  sequence: number | null
  fee: string | null
}

export interface SegmentProjectionMutationRecord {
  ledgerIndex: number
  ledgerHash: string
  transactionHash: string
  transactionIndex: number
  mutation: ReturnType<typeof deriveCurrentStateOverlayMutations>[number]
}

export interface HistorySegmentRecords {
  ledgers: SegmentLedgerRecord[]
  protocolEvents: SegmentProtocolEventRecord[]
  objectChanges: ReturnType<typeof normalizeAffectedNodes>
  lifecycleEvents: ReturnType<typeof deriveLoanLifecycleEvents>
  archivedObjects: ReturnType<typeof deriveArchivedObjects>
  balanceHistory: ReturnType<typeof deriveBalanceHistory>
  currentProjectionMutations: SegmentProjectionMutationRecord[]
}

function assertContiguousScan(scan: IncrementalScanResult): void {
  if (scan.ledgers.length === 0) throw new Error('History segment scan must contain at least one ledger')
  const first = scan.ledgers[0]
  const last = scan.ledgers.at(-1)
  if (!first || !last) throw new Error('History segment scan boundaries are unavailable')
  if (first.ledgerIndex !== scan.startLedgerIndex) {
    throw new Error('History segment scan does not begin at the declared start ledger')
  }
  if (last.ledgerIndex !== scan.endLedgerIndex) {
    throw new Error('History segment scan does not end at the declared end ledger')
  }
  for (let index = 1; index < scan.ledgers.length; index += 1) {
    const previous = scan.ledgers[index - 1]
    const current = scan.ledgers[index]
    if (!previous || !current) throw new Error('History segment scan sequence is incomplete')
    if (current.ledgerIndex !== previous.ledgerIndex + 1) {
      throw new Error('History segment scan contains a ledger index gap')
    }
    if (current.parentHash !== previous.ledgerHash) {
      throw new Error('History segment scan contains a parent-hash discontinuity')
    }
  }
}

export function buildHistorySegmentRecords(options: {
  scan: IncrementalScanResult
  epochId: string
}): HistorySegmentRecords {
  if (options.epochId.length === 0) throw new Error('epochId must be non-empty')
  assertContiguousScan(options.scan)

  const ledgers: SegmentLedgerRecord[] = []
  const protocolEvents: SegmentProtocolEventRecord[] = []
  const objectChanges: HistorySegmentRecords['objectChanges'] = []
  const lifecycleEvents: HistorySegmentRecords['lifecycleEvents'] = []
  const archivedObjects: HistorySegmentRecords['archivedObjects'] = []
  const balanceHistory: HistorySegmentRecords['balanceHistory'] = []
  const currentProjectionMutations: SegmentProjectionMutationRecord[] = []

  for (const ledger of options.scan.ledgers) {
    ledgers.push({
      ledgerIndex: ledger.ledgerIndex,
      ledgerHash: ledger.ledgerHash,
      parentHash: ledger.parentHash,
      closeTime: ledger.closeTime,
      inspectedTransactions: ledger.transactions.length,
      lendingTransactions: ledger.lendingTransactions.length,
    })

    for (const event of ledger.lendingTransactions) {
      protocolEvents.push({
        eventHash: event.hash,
        ledgerIndex: ledger.ledgerIndex,
        eventIndex: event.transactionIndex,
        closeTime: ledger.closeTime,
        eventType: event.transactionType,
        resultCode: event.result,
        account: event.account,
        sequence: event.sequence,
        fee: event.fee,
      })

      const changes = normalizeAffectedNodes(event.metadata, {
        network: 'devnet',
        epochId: options.epochId,
        ledgerIndex: ledger.ledgerIndex,
        closeTime: ledger.closeTime,
        transactionHash: event.hash,
        transactionIndex: event.transactionIndex,
        transactionType: event.transactionType,
        result: event.result,
      })
      objectChanges.push(...changes)
      lifecycleEvents.push(...deriveLoanLifecycleEvents(changes))
      archivedObjects.push(...deriveArchivedObjects(changes))
      balanceHistory.push(...deriveBalanceHistory(changes))

      const mutations = deriveCurrentStateOverlayMutations(event.metadata, {
        ledgerIndex: ledger.ledgerIndex,
        transactionHash: event.hash,
      })
      for (const mutation of mutations) {
        currentProjectionMutations.push({
          ledgerIndex: ledger.ledgerIndex,
          ledgerHash: ledger.ledgerHash,
          transactionHash: event.hash,
          transactionIndex: event.transactionIndex,
          mutation,
        })
      }
    }
  }

  return {
    ledgers,
    protocolEvents,
    objectChanges,
    lifecycleEvents,
    archivedObjects,
    balanceHistory,
    currentProjectionMutations,
  }
}
