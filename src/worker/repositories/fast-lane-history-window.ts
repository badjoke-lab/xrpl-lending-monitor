import { buildHistorySegmentRecords } from '../../collector/history-segments/build-segment-records'
import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import {
  decodeFastLaneHistoryPayload,
  encodeFastLaneHistoryBundle,
  fastLaneHistoryPayloadBytes,
} from './fast-lane-history-codec'
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
  encodedBundle: string
  encodedBytes: number
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

function validateBundle(parsed: unknown): FastLaneHistoryBundle {
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

async function decodeBundle(value: string): Promise<FastLaneHistoryBundle> {
  return validateBundle(await decodeFastLaneHistoryPayload(value))
}

function scanWithLedgers(
  scan: IncrementalScanResult,
  ledgers: IncrementalScanResult['ledgers'],
): IncrementalScanResult {
  const first = ledgers[0]
  const final = ledgers.at(-1)
  if (!first || !final) throw new Error('Fast-lane history scan slice is empty')
  return {
    ...scan,
    startLedgerIndex: first.ledgerIndex,
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

function scanPrefix(scan: IncrementalScanResult, ledgerCount: number): IncrementalScanResult {
  if (!Number.isSafeInteger(ledgerCount) || ledgerCount < 1 || ledgerCount > scan.ledgers.length) {
    throw new Error('Fast-lane history scan prefix is invalid')
  }
  return scanWithLedgers(scan, scan.ledgers.slice(0, ledgerCount))
}

function scanSuffix(scan: IncrementalScanResult, offset: number): IncrementalScanResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= scan.ledgers.length) {
    throw new Error('Fast-lane history scan suffix is invalid')
  }
  return scanWithLedgers(scan, scan.ledgers.slice(offset))
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

  return {
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
}

async function encodedCandidate(options: {
  scan: IncrementalScanResult
  epochId: string
  processedAt: string
}): Promise<Omit<BoundedFastLaneHistoryWindow, 'reduced'>> {
  const bundle = buildFastLaneHistoryBundle(options)
  const encodedBundle = await encodeFastLaneHistoryBundle(bundle)
  const encodedBytes = fastLaneHistoryPayloadBytes(encodedBundle)
  if (encodedBytes > MAX_FAST_LANE_HISTORY_BUNDLE_BYTES) {
    throw new FastLaneHistoryBundleTooLargeError(
      encodedBytes,
      MAX_FAST_LANE_HISTORY_BUNDLE_BYTES,
    )
  }
  return { scan: options.scan, bundle, encodedBundle, encodedBytes }
}

export async function buildBoundedFastLaneHistoryWindow(options: {
  scan: IncrementalScanResult
  epochId: string
  processedAt: string
}): Promise<BoundedFastLaneHistoryWindow> {
  if (options.scan.ledgers.length === 0) {
    throw new Error('Fast-lane history bundle requires a non-empty scan')
  }

  try {
    const full = await encodedCandidate(options)
    return { ...full, reduced: false }
  } catch (error) {
    if (!(error instanceof FastLaneHistoryBundleTooLargeError)) throw error
  }

  let lower = 1
  let upper = options.scan.ledgers.length - 1
  let best: BoundedFastLaneHistoryWindow | null = null

  while (lower <= upper) {
    const count = Math.floor((lower + upper) / 2)
    const candidateScan = scanPrefix(options.scan, count)
    try {
      const candidate = await encodedCandidate({ ...options, scan: candidateScan })
      best = { ...candidate, reduced: true }
      lower = count + 1
    } catch (error) {
      if (!(error instanceof FastLaneHistoryBundleTooLargeError)) throw error
      upper = count - 1
    }
  }

  if (best) return best

  const singleLedgerScan = scanPrefix(options.scan, 1)
  const single = await encodedCandidate({ ...options, scan: singleLedgerScan })
  return { ...single, reduced: options.scan.ledgers.length !== 1 }
}

export async function buildBoundedFastLaneHistoryWindows(options: {
  scan: IncrementalScanResult
  epochId: string
  processedAt: string
}): Promise<BoundedFastLaneHistoryWindow[]> {
  if (options.scan.ledgers.length === 0) {
    throw new Error('Fast-lane history bundle requires a non-empty scan')
  }

  const windows: BoundedFastLaneHistoryWindow[] = []
  let offset = 0
  while (offset < options.scan.ledgers.length) {
    const remaining = offset === 0 ? options.scan : scanSuffix(options.scan, offset)
    const window = await buildBoundedFastLaneHistoryWindow({ ...options, scan: remaining })
    windows.push(window)
    offset += window.scan.ledgers.length
  }
  return windows
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
  return Promise.all((result.results ?? []).map((row) => decodeBundle(row.bundle_json)))
}
