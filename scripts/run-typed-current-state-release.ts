import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { scanLedgerObjects, type CurrentObjectFilter, type ScannedLedgerObject } from '../src/collector/current-state/scan-ledger-objects'
import { XrplJsonRpcClient } from '../src/collector/network/xrpl-rpc'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import type {
  ReleaseNativeDataAsset,
  ReleaseNativeDataRecord,
  ReleaseNativeIndexAsset,
  ReleaseNativeManifest,
} from '../src/shared/current-state/release-native-reader'

type ReadKind = 'vault' | 'loan-broker' | 'loan'
type Counts = { vaults: number; loanBrokers: number; loans: number }
type LedgerIdentity = { ledgerHash: string; ledgerIndex: number }

type Arguments = {
  endpoint: string
  timeoutMs: number
  pageLimit: number
  objectLimitPerPage: number
  outputDir: string
  releaseTag: string
  epochId: string | null
  snapshotId: string | null
}

const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234'
const FILTERS: readonly CurrentObjectFilter[] = ['vault', 'loan_broker', 'loan']

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function positiveInteger(args: readonly string[], name: string, fallback: number): number {
  const value = argumentValue(args, name)
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function flatText(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${field} must be a flat release-safe string`)
  return value
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('Typed current-state release requires --local')
  const releaseTag = flatText(argumentValue(args, '--release-tag') ?? `current-state-${Date.now()}`, 'releaseTag')
  return {
    endpoint: argumentValue(args, '--endpoint') ?? DEFAULT_ENDPOINT,
    timeoutMs: positiveInteger(args, '--timeout-ms', 8_000),
    pageLimit: positiveInteger(args, '--page-limit', 2_000),
    objectLimitPerPage: positiveInteger(args, '--object-limit-per-page', 2_048),
    outputDir: resolve(argumentValue(args, '--output-dir') ?? '.local/typed-current-state-release'),
    releaseTag,
    epochId: argumentValue(args, '--epoch-id'),
    snapshotId: argumentValue(args, '--snapshot-id'),
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function objectId(value: unknown, field: string): string {
  const result = requiredString(value, field).toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(result)) throw new Error(`${field} must be a 64-character object ID`)
  return result
}

function ledgerIndex(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) throw new Error('ledger_index must be a positive safe integer')
  return Number(parsed)
}

async function validatedLedger(endpoint: string, timeoutMs: number): Promise<LedgerIdentity> {
  const client = new XrplJsonRpcClient({ endpoint, timeoutMs })
  const result = record(await client.call<unknown>('ledger', {
    ledger_index: 'validated',
    transactions: false,
    expand: false,
  }), 'ledger result')
  return {
    ledgerHash: objectId(result.ledger_hash, 'ledger_hash'),
    ledgerIndex: ledgerIndex(result.ledger_index),
  }
}

function readKind(filter: CurrentObjectFilter): ReadKind {
  if (filter === 'vault') return 'vault'
  if (filter === 'loan_broker') return 'loan-broker'
  return 'loan'
}

function countsFor(kind: ReadKind, count: number): Counts {
  return {
    vaults: kind === 'vault' ? count : 0,
    loanBrokers: kind === 'loan-broker' ? count : 0,
    loans: kind === 'loan' ? count : 0,
  }
}

function addCounts(target: Counts, source: Counts): void {
  target.vaults += source.vaults
  target.loanBrokers += source.loanBrokers
  target.loans += source.loans
}

async function writeGzipNdjson(path: string, records: readonly unknown[]): Promise<{
  compressedBytes: number
  uncompressedBytes: number
  sha256: string
}> {
  const text = records.length === 0 ? '' : `${records.map((entry) => canonicalJson(entry)).join('\n')}\n`
  const uncompressed = utf8(text)
  const compressed = await gzipDeterministic(uncompressed)
  await writeFile(path, compressed)
  return {
    compressedBytes: compressed.byteLength,
    uncompressedBytes: uncompressed.byteLength,
    sha256: await sha256Hex(compressed),
  }
}

function releaseValue(object: ScannedLedgerObject): Record<string, unknown> {
  const { BinaryHex: _binaryHex, ...value } = object
  return value
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const assetsDir = join(args.outputDir, 'assets')
  await rm(args.outputDir, { recursive: true, force: true })
  await mkdir(assetsDir, { recursive: true })

  const ledger = await validatedLedger(args.endpoint, args.timeoutMs)
  const epochId = flatText(args.epochId ?? `devnet-${ledger.ledgerIndex}`, 'epochId')
  const snapshotId = flatText(args.snapshotId ?? `devnet-${ledger.ledgerIndex}-${ledger.ledgerHash.slice(0, 12).toLowerCase()}`, 'snapshotId')
  const dataAssets: ReleaseNativeDataAsset[] = []
  const totalCounts: Counts = { vaults: 0, loanBrokers: 0, loans: 0 }
  let totalPages = 0
  let totalRecords = 0
  let dataCompressedBytes = 0
  let dataUncompressedBytes = 0

  for (let filterIndex = 0; filterIndex < FILTERS.length; filterIndex += 1) {
    const filter = FILTERS[filterIndex]!
    const kind = readKind(filter)
    process.stderr.write(`Scanning ${filter} objects at ledger ${ledger.ledgerIndex}.\n`)
    const scan = await scanLedgerObjects({
      endpoint: args.endpoint,
      timeoutMs: args.timeoutMs,
      ledgerHash: ledger.ledgerHash,
      ledgerIndex: ledger.ledgerIndex,
      filter,
      pageLimit: args.pageLimit,
      requestLimit: args.pageLimit,
      objectLimitPerPage: args.objectLimitPerPage,
    })
    const segmentId = `segment-${String(filterIndex).padStart(5, '0')}`
    const assetName = `data-segment-${String(filterIndex).padStart(5, '0')}.ndjson.gz`
    const records: ReleaseNativeDataRecord[] = []
    for (const object of scan.objects) {
      const value = releaseValue(object)
      const id = objectId(object.index, `${filter}.index`)
      records.push({
        schemaVersion: 1,
        segmentId,
        sourcePage: 1,
        id,
        kind,
        valueSha256: await sha256Hex(canonicalJson(value)),
        value,
      })
    }
    records.sort((left, right) => left.id.localeCompare(right.id))
    const stats = await writeGzipNdjson(join(assetsDir, assetName), records)
    const assetCounts = countsFor(kind, records.length)
    addCounts(totalCounts, assetCounts)
    totalPages += scan.metrics.pages
    totalRecords += records.length
    dataCompressedBytes += stats.compressedBytes
    dataUncompressedBytes += stats.uncompressedBytes
    dataAssets.push({
      assetName,
      segmentId,
      sha256: stats.sha256,
      compressedBytes: stats.compressedBytes,
      uncompressedBytes: stats.uncompressedBytes,
      recordCount: records.length,
      sourcePages: { first: 1, last: 1, count: 1 },
      firstObjectId: records[0]?.id ?? null,
      lastObjectId: records.at(-1)?.id ?? null,
      counts: assetCounts,
    })
    process.stderr.write(`Completed ${filter}: ${records.length} objects across ${scan.metrics.pages} pages.\n`)
  }

  const emptyIndexStats = await writeGzipNdjson(join(assetsDir, 'index-bucket-00000.ndjson.gz'), [])
  const indexAssets: ReleaseNativeIndexAsset[] = [{
    assetName: 'index-bucket-00000.ndjson.gz',
    bucket: 0,
    sha256: emptyIndexStats.sha256,
    compressedBytes: emptyIndexStats.compressedBytes,
    uncompressedBytes: emptyIndexStats.uncompressedBytes,
    recordCount: 0,
    firstTerm: null,
    lastTerm: null,
  }]

  const manifestWithoutDigest = {
    schemaVersion: 2 as const,
    network: 'devnet' as const,
    endpoint: args.endpoint,
    epochId,
    snapshotId,
    releaseTag: args.releaseTag,
    ledgerIndex: ledger.ledgerIndex,
    ledgerHash: ledger.ledgerHash,
    complete: true,
    sourcePages: Math.max(1, totalPages),
    decodedObjectCount: totalRecords,
    relevantObjectCount: totalRecords,
    counts: totalCounts,
    layout: {
      pagesPerSegment: 1,
      indexBuckets: 1,
      dataSegmentCount: dataAssets.length,
      hashFunction: 'sha256-first-u32-mod-bucket-count' as const,
    },
    dataAssets,
    indexAssets,
    totals: {
      dataCompressedBytes,
      dataUncompressedBytes,
      indexCompressedBytes: emptyIndexStats.compressedBytes,
      indexUncompressedBytes: emptyIndexStats.uncompressedBytes,
    },
    manifestSha256: null,
  }
  const manifestSha256 = await sha256Hex(`${canonicalJson(manifestWithoutDigest)}\n`)
  const manifest: ReleaseNativeManifest = { ...manifestWithoutDigest, manifestSha256 }
  await writeFile(join(assetsDir, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')

  const summary = {
    releaseTag: args.releaseTag,
    complete: true,
    snapshotId,
    epochId,
    ledger,
    sourcePages: totalPages,
    counts: totalCounts,
    totalRecords,
    manifestSha256,
    dataAssets: dataAssets.length,
    indexAssets: indexAssets.length,
  }
  await writeFile(join(args.outputDir, 'release-summary.json'), `${canonicalJson(summary)}\n`, 'utf8')
  await writeFile(
    join(args.outputDir, 'release-notes.md'),
    `# XRPL Lending Monitor typed current-state snapshot\n\n- release: ${args.releaseTag}\n- snapshot: ${snapshotId}\n- ledger: ${ledger.ledgerIndex}\n- ledger hash: ${ledger.ledgerHash}\n- vaults: ${totalCounts.vaults}\n- loan brokers: ${totalCounts.loanBrokers}\n- loans: ${totalCounts.loans}\n- source pages: ${totalPages}\n- manifest sha256: ${manifestSha256}\n`,
    'utf8',
  )
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
