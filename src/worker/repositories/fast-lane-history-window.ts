import { normalizeAffectedNodes } from '../../collector/incremental/affected-nodes'
import { deriveArchivedObjects } from '../../collector/incremental/deleted-object-archive'
import { deriveBalanceHistory } from '../../collector/incremental/cover-debt-loss'
import { deriveLoanLifecycleEvents } from '../../collector/incremental/loan-lifecycle'
import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import type {
  ArchivedObjectRecord,
  BalanceHistoryApiRecord,
  LoanLifecycleRecord,
  ObjectChangeRecord,
  ProtocolEventRecord,
} from './history-api-repository'
import {
  segmentArchivedObjectToApi,
  segmentBalanceHistoryToApi,
  segmentLoanLifecycleToApi,
  segmentObjectChangeToApi,
} from './history-segment-adapter'

const DEFAULT_MAX_WINDOWS = 400

export interface FastLaneHistoryBundle {
  schemaVersion: 1
  epochId: string
  startLedgerIndex: number
  endLedgerIndex: number
  endLedgerHash: string
  createdAt: string
  protocolEvents: ProtocolEventRecord[]
  objectChanges: ObjectChangeRecord[]
  loanLifecycle: LoanLifecycleRecord[]
  archivedObjects: ArchivedObjectRecord[]
  balanceHistory: BalanceHistoryApiRecord[]
}

interface FastLaneHistoryWindowRow {
  bundle_json: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBundle(value: string): FastLaneHistoryBundle {
  const parsed: unknown = JSON.parse(value)
  if (
    !isRecord(parsed)
    || parsed.schemaVersion !== 1
    || typeof parsed.epochId !== 'string'
    || !Number.isSafeInteger(parsed.startLedgerIndex)
    || !Number.isSafeInteger(parsed.endLedgerIndex)
    || typeof parsed.endLedgerHash !== 'string'
    || typeof parsed.createdAt !== 'string'
    || !Array.isArray(parsed.protocolEvents)
    || !Array.isArray(parsed.objectChanges)
    || !Array.isArray(parsed.loanLifecycle)
    || !Array.isArray(parsed.archivedObjects)
    || !Array.isArray(parsed.balanceHistory)
  ) {
    throw new Error('Fast-lane history bundle is invalid')
  }
  return parsed as unknown as FastLaneHistoryBundle
}

export function buildFastLaneHistoryBundle(options: {
  scan: IncrementalScanResult
  epochId: string
  processedAt: string
}): FastLaneHistoryBundle {
  const first = options.scan.ledgers[0]
  const final = options.scan.ledgers.at(-1)
  if (!first || !final) throw new Error('Fast-lane history bundle requires a non-empty scan')

  const protocolEvents: ProtocolEventRecord[] = []
  const objectChanges: ObjectChangeRecord[] = []
  const loanLifecycle: LoanLifecycleRecord[] = []
  const archivedObjects: ArchivedObjectRecord[] = []
  const balanceHistory: BalanceHistoryApiRecord[] = []

  for (const ledger of options.scan.ledgers) {
    for (const event of ledger.lendingTransactions) {
      protocolEvents.push({
        eventHash: event.hash,
        epochId: options.epochId,
        ledgerIndex: ledger.ledgerIndex,
        eventIndex: event.transactionIndex,
        closeTime: ledger.closeTime,
        eventType: event.transactionType,
        resultCode: event.result,
        payloadRetained: false,
        sourceJson: null,
        metadataJson: null,
        createdAt: options.processedAt,
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
      objectChanges.push(...changes.map(segmentObjectChangeToApi))
      loanLifecycle.push(...deriveLoanLifecycleEvents(changes).map(segmentLoanLifecycleToApi))
      archivedObjects.push(...deriveArchivedObjects(changes).map(segmentArchivedObjectToApi))
      balanceHistory.push(...deriveBalanceHistory(changes).map(segmentBalanceHistoryToApi))
    }
  }

  return {
    schemaVersion: 1,
    epochId: options.epochId,
    startLedgerIndex: first.ledgerIndex,
    endLedgerIndex: final.ledgerIndex,
    endLedgerHash: final.ledgerHash,
    createdAt: options.processedAt,
    protocolEvents,
    objectChanges,
    loanLifecycle,
    archivedObjects,
    balanceHistory,
  }
}

export async function readFastLaneHistoryBundlesAfterBoundary(options: {
  db: D1Database
  boundaryLedgerIndex: number
  maxWindows?: number
}): Promise<FastLaneHistoryBundle[]> {
  if (!Number.isSafeInteger(options.boundaryLedgerIndex) || options.boundaryLedgerIndex < 1) {
    throw new Error('History live boundary must be a positive safe integer')
  }
  const maxWindows = options.maxWindows ?? DEFAULT_MAX_WINDOWS
  if (!Number.isSafeInteger(maxWindows) || maxWindows < 1 || maxWindows > 2_016) {
    throw new Error('Fast-lane history window read limit is invalid')
  }
  const result = await options.db.prepare(
    `SELECT bundle_json
     FROM fast_lane_history_windows
     WHERE network = 'devnet' AND end_ledger_index > ?1
     ORDER BY end_ledger_index DESC
     LIMIT ?2`,
  ).bind(options.boundaryLedgerIndex, maxWindows).all<FastLaneHistoryWindowRow>()
  return (result.results ?? []).map((row) => parseBundle(row.bundle_json))
}
