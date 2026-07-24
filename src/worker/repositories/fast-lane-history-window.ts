import { buildHistorySegmentRecords } from '../../collector/history-segments/build-segment-records'
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
export const MAX_FAST_LANE_HISTORY_BUNDLE_BYTES = 131_072

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

export interface BoundedFastLaneHistoryWindow {
  scan: IncrementalScanResult
  bundle: FastLaneHistoryBundle
  reduced: boolean
}

interface FastLaneHistoryWindowRow {
  bundle_json: string
}

export class FastLaneHistoryBundleTooLargeError extends Error {
  readonly bytes: number
  readonly limit: number

  constructor(bytes: number, limit: number) {
    super(`Fast-lane history bundle exceeds the persistence limit: bytes=${bytes}, limit=${limit}`)
    this.name = 'FastLaneHistoryBundleTooLargeError'
    this.bytes = bytes
    this.limit = limit
  }
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

function assertBundleSize(bundle: FastLaneHistoryBundle): void {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle)).byteLength
  if (bytes > MAX_FAST_LANE_HISTORY_BUNDLE_BYTES) {
    throw new FastLaneHistoryBundleTooLargeError(bytes, MAX_FAST_LANE_HISTORY_BUNDLE_BYTES)
  }
}

function scanPrefix(scan: IncrementalScanResult, ledgerCount: number): IncrementalScanResult {
  if (!Number.isSafeInteger(ledgerCount) || ledgerCount < 1 || ledgerCount > scan.ledgers.length) {
    throw new Error('Fast-lane history scan prefix is invalid')
  }
  const ledgers = scan.ledgers.slice(0, ledgerCount)
  const final = ledgers.at(-1)
  if (!final) throw new Error('Fast-lane history scan prefix is empty')
  return {
    ...scan,
    endLedgerIndex: final.ledgerIndex,
    completeToLatest: final.ledgerIndex === scan.latestValidatedLedger,
    ledgers,
    metrics: {
      ...scan.metrics,
      ledgers: ledgers.length,
      inspectedTransactions: ledgers.reduce((total, ledger) => total + ledger.transactions.length, 0),
      lendingTransactions: ledgers.reduce((total, ledger) => total + ledger.lendingTransactions.length, 0),
    },
  }
}

export function buildFastLaneHistoryBundle(options: {
  scan: IncrementalScanResult
  epochId: string
  processedAt: string
}): FastLaneHistoryBundle {
  const first = options.scan.ledgers[0]
  const final = options.scan.ledgers.at(-1)
  if (!first || !final) throw new Error('Fast-lane history bundle requires a non-empty scan')

  const records = buildHistorySegmentRecords({
    scan: options.scan,
    epochId: options.epochId,
  })
  const protocolEvents: ProtocolEventRecord[] = []
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
    }
  }

  const bundle: FastLaneHistoryBundle = {
    schemaVersion: 1,
    epochId: options.epochId,
    startLedgerIndex: first.ledgerIndex,
    endLedgerIndex: final.ledgerIndex,
    endLedgerHash: final.ledgerHash,
    createdAt: options.processedAt,
    protocolEvents,
    objectChanges: records.objectChanges.map(segmentObjectChangeToApi),
    loanLifecycle: records.lifecycleEvents.map(segmentLoanLifecycleToApi),
    archivedObjects: records.archivedObjects.map(segmentArchivedObjectToApi),
    balanceHistory: records.balanceHistory.map(segmentBalanceHistoryToApi),
  }
  assertBundleSize(bundle)
  return bundle
}

export function buildBoundedFastLaneHistoryWindow(options: {
  scan: IncrementalScanResult
  epochId: string
  processedAt: string
}): BoundedFastLaneHistoryWindow {
  if (options.scan.ledgers.length === 0) {
    throw new Error('Fast-lane history bundle requires a non-empty scan')
  }

  let lower = 1
  let upper = options.scan.ledgers.length
  let best: BoundedFastLaneHistoryWindow | null = null

  while (lower <= upper) {
    const count = Math.floor((lower + upper) / 2)
    const candidateScan = scanPrefix(options.scan, count)
    try {
      const bundle = buildFastLaneHistoryBundle({ ...options, scan: candidateScan })
      best = {
        scan: candidateScan,
        bundle,
        reduced: candidateScan.ledgers.length !== options.scan.ledgers.length,
      }
      lower = count + 1
    } catch (error) {
      if (!(error instanceof FastLaneHistoryBundleTooLargeError)) throw error
      upper = count - 1
    }
  }

  if (best) return best

  const singleLedgerScan = scanPrefix(options.scan, 1)
  return {
    scan: singleLedgerScan,
    bundle: buildFastLaneHistoryBundle({ ...options, scan: singleLedgerScan }),
    reduced: options.scan.ledgers.length !== 1,
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
     WHERE network = 'devnet'
       AND epoch_id = (
         SELECT base_epoch_id
         FROM fast_lane_shadow_base_binding
         WHERE network = 'devnet'
       )
       AND end_ledger_index > ?1
     ORDER BY end_ledger_index DESC
     LIMIT ?2`,
  ).bind(options.boundaryLedgerIndex, maxWindows).all<FastLaneHistoryWindowRow>()
  return (result.results ?? []).map((row) => parseBundle(row.bundle_json))
}
