import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { buildHistorySegmentRecords } from '../src/collector/history-segments/build-segment-records'
import { scanValidatedLedgerRange } from '../src/collector/incremental/scan-validated-ledgers'
import {
  canonicalJson,
  gzipDeterministic,
  sha256Hex,
  utf8,
} from '../src/shared/current-state/canonical-json'
import { historySegmentJsonValue } from '../src/shared/history-segments/json-safe'
import {
  assertHistorySegmentManifest,
  type HistorySegmentFile,
  type HistorySegmentFileKind,
  type HistorySegmentManifest,
} from '../src/shared/history-segments/manifest'

interface Arguments {
  endpoint: string
  timeoutMs: number
  startLedger: number
  endLedger: number
  epochId: string
  segmentId: string
  outputDir: string
  sourceRevision: string
  previousSegmentId: string | null
  previousSegmentEndHash: string | null
}

const DEFAULT_ENDPOINT = 'https://devnet.honeycluster.io/'
const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800
const MAX_REHEARSAL_LEDGERS = 500

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function requiredArgument(args: readonly string[], name: string): string {
  const value = argumentValue(args, name)
  if (value === null) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(args: readonly string[], name: string, fallback?: number): number {
  const value = argumentValue(args, name)
  if (value === null && fallback !== undefined) return fallback
  if (value === null) throw new Error(`${name} is required`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function flatText(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${field} must be a flat safe identifier`)
  }
  return value
}

function optionalHash(value: string | null, field: string): string | null {
  if (value === null) return null
  const normalized = value.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalized)) throw new Error(`${field} must be a 64-character hexadecimal hash`)
  return normalized
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('History segment generation requires --local')
  const startLedger = positiveInteger(args, '--start-ledger')
  const endLedger = positiveInteger(args, '--end-ledger')
  if (endLedger < startLedger) throw new Error('--end-ledger must be at least --start-ledger')
  if (endLedger - startLedger + 1 > MAX_REHEARSAL_LEDGERS) {
    throw new Error(`A rehearsal segment may contain at most ${MAX_REHEARSAL_LEDGERS} ledgers`)
  }
  const epochId = flatText(requiredArgument(args, '--epoch-id'), 'epochId')
  const segmentId = flatText(
    argumentValue(args, '--segment-id') ?? `${epochId}-${startLedger}-${endLedger}`,
    'segmentId',
  )
  const previousSegmentIdValue = argumentValue(args, '--previous-segment-id')
  const previousSegmentEndHash = optionalHash(
    argumentValue(args, '--previous-segment-end-hash'),
    'previousSegmentEndHash',
  )
  if ((previousSegmentIdValue === null) !== (previousSegmentEndHash === null)) {
    throw new Error('Previous segment ID and terminal hash must be supplied together')
  }
  return {
    endpoint: argumentValue(args, '--endpoint') ?? DEFAULT_ENDPOINT,
    timeoutMs: positiveInteger(args, '--timeout-ms', 8_000),
    startLedger,
    endLedger,
    epochId,
    segmentId,
    outputDir: resolve(argumentValue(args, '--output-dir') ?? `.local/history-segments/${segmentId}`),
    sourceRevision: flatText(
      argumentValue(args, '--source-revision') ?? process.env.GITHUB_SHA ?? 'local',
      'sourceRevision',
    ),
    previousSegmentId: previousSegmentIdValue === null
      ? null
      : flatText(previousSegmentIdValue, 'previousSegmentId'),
    previousSegmentEndHash,
  }
}

function generatedAtFromRippleCloseTime(closeTime: number): string {
  if (!Number.isSafeInteger(closeTime) || closeTime < 0) throw new Error('closeTime must be a non-negative safe integer')
  return new Date((closeTime + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

async function writeRecords(options: {
  outputDir: string
  kind: HistorySegmentFileKind
  fileName: string
  records: readonly unknown[]
}): Promise<HistorySegmentFile> {
  const text = options.records.length === 0
    ? ''
    : `${options.records
      .map((record) => canonicalJson(historySegmentJsonValue(record)))
      .join('\n')}\n`
  const compressed = await gzipDeterministic(utf8(text))
  await writeFile(join(options.outputDir, options.fileName), compressed)
  return {
    kind: options.kind,
    path: options.fileName,
    bytes: compressed.byteLength,
    records: options.records.length,
    sha256: await sha256Hex(compressed),
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const scan = await scanValidatedLedgerRange({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    startLedgerIndex: options.startLedger,
    latestValidatedLedger: options.endLedger,
    maxLedgers: options.endLedger - options.startLedger + 1,
    expectedPreviousHash: options.previousSegmentEndHash,
  })
  if (!scan.completeToLatest || scan.endLedgerIndex !== options.endLedger) {
    throw new Error('History segment scan did not complete the requested fixed range')
  }

  const records = buildHistorySegmentRecords({ scan, epochId: options.epochId })
  const first = scan.ledgers[0]
  const last = scan.ledgers.at(-1)
  if (!first || !last) throw new Error('History segment scan boundaries are unavailable')

  await rm(options.outputDir, { recursive: true, force: true })
  await mkdir(options.outputDir, { recursive: true })

  const files = await Promise.all([
    writeRecords({ outputDir: options.outputDir, kind: 'ledgers', fileName: 'ledgers.ndjson.gz', records: records.ledgers }),
    writeRecords({ outputDir: options.outputDir, kind: 'protocol_events', fileName: 'protocol-events.ndjson.gz', records: records.protocolEvents }),
    writeRecords({ outputDir: options.outputDir, kind: 'object_changes', fileName: 'object-changes.ndjson.gz', records: records.objectChanges }),
    writeRecords({ outputDir: options.outputDir, kind: 'loan_lifecycle', fileName: 'loan-lifecycle.ndjson.gz', records: records.lifecycleEvents }),
    writeRecords({ outputDir: options.outputDir, kind: 'archived_objects', fileName: 'archived-objects.ndjson.gz', records: records.archivedObjects }),
    writeRecords({ outputDir: options.outputDir, kind: 'balance_history', fileName: 'balance-history.ndjson.gz', records: records.balanceHistory }),
    writeRecords({ outputDir: options.outputDir, kind: 'current_projection_mutations', fileName: 'current-projection-mutations.ndjson.gz', records: records.currentProjectionMutations }),
  ])

  const manifest: HistorySegmentManifest = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: options.epochId,
    segmentId: options.segmentId,
    startLedgerIndex: first.ledgerIndex,
    startLedgerHash: first.ledgerHash,
    startParentHash: first.parentHash,
    endLedgerIndex: last.ledgerIndex,
    endLedgerHash: last.ledgerHash,
    ledgerCount: records.ledgers.length,
    sourceRevision: options.sourceRevision,
    generatedAt: generatedAtFromRippleCloseTime(last.closeTime),
    previousSegmentId: options.previousSegmentId,
    previousSegmentEndHash: options.previousSegmentEndHash,
    files,
  }
  assertHistorySegmentManifest(manifest)
  await writeFile(join(options.outputDir, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')
  process.stdout.write(`${canonicalJson(manifest)}\n`)
}

await main()
