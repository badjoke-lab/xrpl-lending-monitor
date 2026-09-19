import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { decode } from 'ripple-binary-codec'

import { XrplJsonRpcClient } from '../src/collector/network/xrpl-rpc'
import { currentKindForLedgerEntryType, streamFilteredLendingLedgerObjects, type FilteredLedgerTraversalResult } from '../src/shared/current-state/filtered-ledger-traversal'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import { releaseNativeBucket, type ReleaseNativeDataAsset, type ReleaseNativeDataRecord, type ReleaseNativeIndexAsset, type ReleaseNativeIndexRecord, type ReleaseNativeManifest, type ReleaseNativeObjectReference } from '../src/shared/current-state/release-native-reader'

type ReleaseKind = 'vault' | 'loan-broker' | 'loan'

type LedgerIdentity = {
  ledgerHash: string
  ledgerIndex: number
}

type Counts = {
  vaults: number
  loanBrokers: number
  loans: number
}

type Arguments = {
  endpoint: string
  timeoutMs: number
  pageLimit: number
  objectLimitPerPage: number
  outputDir: string
  releaseTag: string
  epochId: string | null
  snapshotId: string | null
  indexBuckets: number
  dataSegments: number
}

type TraversalResult = FilteredLedgerTraversalResult

type DataMaterializationResult = {
  dataAssets: ReleaseNativeDataAsset[]
  dataCompressedBytes: number
  dataUncompressedBytes: number
  counts: Counts
  relevantObjectCount: number
}

type IndexMaterializationResult = {
  indexAssets: ReleaseNativeIndexAsset[]
  indexCompressedBytes: number
  indexUncompressedBytes: number
}

const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234'
const DATA_ASSET_PREFIX = 'data-segment-'
const UINT32_SPACE = 0x1_0000_0000

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function integerArgument(args: readonly string[], name: string, fallback: number): number {
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
  if (!args.includes('--local')) throw new Error('Release current-state materialization requires --local')
  const releaseTag = flatText(argumentValue(args, '--release-tag') ?? `current-state-${Date.now()}`, 'releaseTag')
  return {
    endpoint: argumentValue(args, '--endpoint') ?? DEFAULT_ENDPOINT,
    timeoutMs: integerArgument(args, '--timeout-ms', 8_000),
    pageLimit: integerArgument(args, '--page-limit', 4_000),
    objectLimitPerPage: integerArgument(args, '--object-limit-per-page', 2_048),
    outputDir: resolve(argumentValue(args, '--output-dir') ?? '.local/current-state-release'),
    releaseTag,
    epochId: argumentValue(args, '--epoch-id'),
    snapshotId: argumentValue(args, '--snapshot-id'),
    indexBuckets: integerArgument(args, '--index-buckets', 64),
    dataSegments: integerArgument(args, '--data-segments', 20),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function requiredLedgerIndex(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) throw new Error('ledger_index must be a positive safe integer')
  return Number(parsed)
}

function id(value: string, field: string): string {
  const normalized = value.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalized)) throw new Error(`${field} must be a 64-character uppercase object id`)
  return normalized
}

function emptyCounts(): Counts {
  return { vaults: 0, loanBrokers: 0, loans: 0 }
}

function addKindCount(counts: Counts, kind: ReleaseKind): void {
  if (kind === 'vault') counts.vaults += 1
  else if (kind === 'loan-broker') counts.loanBrokers += 1
  else counts.loans += 1
}

function addCounts(target: Counts, source: Counts): void {
  target.vaults += source.vaults
  target.loanBrokers += source.loanBrokers
  target.loans += source.loans
}

function countRecords(records: readonly ReleaseNativeDataRecord[]): Counts {
  const counts = emptyCounts()
  for (const record of records) addKindCount(counts, record.kind)
  return counts
}

function segmentId(index: number): string {
  return `segment-${String(index).padStart(5, '0')}`
}

function dataAssetName(index: number): string {
  return `${DATA_ASSET_PREFIX}${String(index).padStart(5, '0')}.ndjson.gz`
}

function dataRawPath(workDataDir: string, index: number): string {
  return join(workDataDir, `segment-${String(index).padStart(5, '0')}.ndjson`)
}

function indexRawPath(workIndexDir: string, index: number): string {
  return join(workIndexDir, `bucket-${String(index).padStart(5, '0')}.ndjson`)
}

function dataSegmentForId(objectId: string, segmentCount: number): number {
  const prefix = Number.parseInt(objectId.slice(0, 8), 16)
  if (!Number.isFinite(prefix)) throw new Error(`Could not derive data segment for ${objectId}`)
  return Math.min(segmentCount - 1, Math.floor(prefix * segmentCount / UINT32_SPACE))
}

function dataAssetNameForRecord(record: ReleaseNativeDataRecord): string {
  const suffix = record.segmentId.replace(/^segment-/, '')
  if (!/^[0-9]{5}$/.test(suffix)) throw new Error(`Invalid segment id ${record.segmentId}`)
  return `${DATA_ASSET_PREFIX}${suffix}.ndjson.gz`
}

async function getValidatedLedger(endpoint: string, timeoutMs: number): Promise<LedgerIdentity> {
  const client = new XrplJsonRpcClient({ endpoint, timeoutMs })
  const result = await client.call<unknown>('ledger', { ledger_index: 'validated' })
  if (!isRecord(result)) throw new Error('ledger result must be an object')
  return {
    ledgerHash: id(requiredString(result.ledger_hash, 'ledger_hash'), 'ledger_hash'),
    ledgerIndex: requiredLedgerIndex(result.ledger_index),
  }
}

async function writeText(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${canonicalJson(value)}\n`, 'utf8')
}

async function writeGzipNdjson(path: string, records: readonly unknown[]): Promise<{
  compressedBytes: number
  uncompressedBytes: number
  sha256: string
}> {
  const text = records.length === 0 ? '' : `${records.map((record) => canonicalJson(record)).join('\n')}\n`
  const uncompressed = utf8(text)
  const compressed = await gzipDeterministic(uncompressed)
  await writeFile(path, compressed)
  return {
    compressedBytes: compressed.byteLength,
    uncompressedBytes: uncompressed.byteLength,
    sha256: await sha256Hex(compressed),
  }
}

async function readNdjson<T>(path: string): Promise<T[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return []
    throw error
  }
  if (text.length === 0) return []
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}

async function appendCanonicalLines(path: string, values: readonly unknown[]): Promise<void> {
  if (values.length === 0) return
  await appendFile(path, `${values.map((value) => canonicalJson(value)).join('\n')}\n`, 'utf8')
}

function reference(record: ReleaseNativeDataRecord): ReleaseNativeObjectReference {
  return {
    segmentId: record.segmentId,
    assetName: dataAssetNameForRecord(record),
    id: record.id,
    kind: record.kind,
  }
}

function indexRecordsForRecord(record: ReleaseNativeDataRecord): ReleaseNativeIndexRecord[] {
  const indexes: ReleaseNativeIndexRecord[] = [{
    schemaVersion: 1,
    bucket: 0,
    term: record.id,
    lookupKind: 'object-id',
    value: { reference: reference(record) },
  }]

  for (const field of ['Account', 'Owner', 'Borrower'] as const) {
    const value = record.value[field]
    if (typeof value !== 'string' || value.length === 0) continue
    indexes.push({
      schemaVersion: 1,
      bucket: 0,
      term: value,
      lookupKind: 'account',
      value: { field, reference: reference(record) },
    })
  }

  if (record.kind === 'loan-broker') {
    const vaultId = id(requiredString(record.value.VaultID, 'VaultID'), 'VaultID')
    indexes.push({
      schemaVersion: 1,
      bucket: 0,
      term: vaultId,
      lookupKind: 'relationship',
      value: {
        relation: 'vault-loan-broker',
        source: { id: vaultId, kind: 'vault' },
        target: reference(record),
      },
    })
  }

  if (record.kind === 'loan') {
    const loanBrokerId = id(requiredString(record.value.LoanBrokerID, 'LoanBrokerID'), 'LoanBrokerID')
    indexes.push({
      schemaVersion: 1,
      bucket: 0,
      term: loanBrokerId,
      lookupKind: 'relationship',
      value: {
        relation: 'loan-broker-loan',
        source: { id: loanBrokerId, kind: 'loan-broker' },
        target: reference(record),
      },
    })
  }

  return indexes
}

async function streamFullLedgerTraversal(options: Arguments, ledger: LedgerIdentity, workDataDir: string): Promise<TraversalResult> {
  const client = new XrplJsonRpcClient({ endpoint: options.endpoint, timeoutMs: options.timeoutMs })

  process.stderr.write(
    `Running binary type-filtered traversal to marker exhaustion for Vault, LoanBroker, and Loan; per-type page safety limit ${options.pageLimit}.\n`,
  )

  const traversal = await streamFilteredLendingLedgerObjects({
    ledger,
    objectLimitPerPage: options.objectLimitPerPage,
    pageLimitPerType: options.pageLimit,
    callLedgerData: (params) => client.call<unknown>('ledger_data', params),
    decodeBinary: decode,
    async onPage(page) {
      const pageBatches = Array.from({ length: options.dataSegments }, () => [] as ReleaseNativeDataRecord[])
      for (const object of page.records) {
        const kind = currentKindForLedgerEntryType(object.entryType) as ReleaseKind
        const segment = dataSegmentForId(object.objectId, options.dataSegments)
        pageBatches[segment]!.push({
          schemaVersion: 1,
          segmentId: segmentId(segment),
          sourcePage: object.sourcePage,
          id: object.objectId,
          kind,
          valueSha256: await sha256Hex(canonicalJson(object.value)),
          value: object.value,
        })
      }

      for (let segment = 0; segment < pageBatches.length; segment += 1) {
        await appendCanonicalLines(dataRawPath(workDataDir, segment), pageBatches[segment]!)
      }

      if (page.typePage % 100 === 0) {
        process.stderr.write(
          `Processed ${page.typePage} pages for ${page.entryType}; total source pages: ${page.sourcePage}.\n`,
        )
      }
    },
  })

  for (const [entryType, pages] of Object.entries(traversal.pagesByType)) {
    process.stderr.write(`Completed ledger_data type filter ${entryType} after ${pages} pages.\n`)
  }
  return traversal
}

async function appendIndexRecordsForSegment(records: readonly ReleaseNativeDataRecord[], bucketCount: number, workIndexDir: string): Promise<void> {
  const batches = Array.from({ length: bucketCount }, () => [] as ReleaseNativeIndexRecord[])
  for (const record of records) {
    for (const seed of indexRecordsForRecord(record)) {
      const bucket = await releaseNativeBucket(seed.term, bucketCount)
      batches[bucket]!.push({ ...seed, bucket })
    }
  }
  for (let bucket = 0; bucket < batches.length; bucket += 1) {
    await appendCanonicalLines(indexRawPath(workIndexDir, bucket), batches[bucket]!)
  }
}

async function materializeDataAssets(options: Arguments, traversal: TraversalResult, assetsDir: string, workDataDir: string, workIndexDir: string): Promise<DataMaterializationResult> {
  const dataAssets: ReleaseNativeDataAsset[] = []
  const totalCounts = emptyCounts()
  let dataCompressedBytes = 0
  let dataUncompressedBytes = 0
  let relevantObjectCount = 0

  for (let segment = 0; segment < options.dataSegments; segment += 1) {
    process.stderr.write(`Materializing data segment ${segment + 1}/${options.dataSegments}.\n`)
    const records = await readNdjson<ReleaseNativeDataRecord>(dataRawPath(workDataDir, segment))
    records.sort((left, right) => left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind))

    const assetName = dataAssetName(segment)
    const stats = await writeGzipNdjson(join(assetsDir, assetName), records)
    const counts = countRecords(records)
    addCounts(totalCounts, counts)
    relevantObjectCount += records.length
    dataCompressedBytes += stats.compressedBytes
    dataUncompressedBytes += stats.uncompressedBytes

    dataAssets.push({
      assetName,
      segmentId: segmentId(segment),
      sha256: stats.sha256,
      compressedBytes: stats.compressedBytes,
      uncompressedBytes: stats.uncompressedBytes,
      recordCount: records.length,
      sourcePages: { first: 1, last: traversal.sourcePages, count: traversal.sourcePages },
      firstObjectId: records[0]?.id ?? null,
      lastObjectId: records.at(-1)?.id ?? null,
      counts,
    })

    await appendIndexRecordsForSegment(records, options.indexBuckets, workIndexDir)
  }

  return {
    dataAssets,
    dataCompressedBytes,
    dataUncompressedBytes,
    counts: totalCounts,
    relevantObjectCount,
  }
}

async function materializeIndexAssets(options: Arguments, assetsDir: string, workIndexDir: string): Promise<IndexMaterializationResult> {
  const indexAssets: ReleaseNativeIndexAsset[] = []
  let indexCompressedBytes = 0
  let indexUncompressedBytes = 0

  for (let bucket = 0; bucket < options.indexBuckets; bucket += 1) {
    process.stderr.write(`Materializing index bucket ${bucket + 1}/${options.indexBuckets}.\n`)
    const records = await readNdjson<ReleaseNativeIndexRecord>(indexRawPath(workIndexDir, bucket))
    records.sort((left, right) => left.term.localeCompare(right.term)
      || left.lookupKind.localeCompare(right.lookupKind)
      || canonicalJson(left.value).localeCompare(canonicalJson(right.value)))

    const assetName = `index-bucket-${String(bucket).padStart(5, '0')}.ndjson.gz`
    const stats = await writeGzipNdjson(join(assetsDir, assetName), records)
    indexCompressedBytes += stats.compressedBytes
    indexUncompressedBytes += stats.uncompressedBytes

    indexAssets.push({
      assetName,
      bucket,
      sha256: stats.sha256,
      compressedBytes: stats.compressedBytes,
      uncompressedBytes: stats.uncompressedBytes,
      recordCount: records.length,
      firstTerm: records[0]?.term ?? null,
      lastTerm: records.at(-1)?.term ?? null,
    })
  }

  return { indexAssets, indexCompressedBytes, indexUncompressedBytes }
}

function assertTraversalAccounting(traversal: TraversalResult, data: DataMaterializationResult): void {
  if (traversal.relevantObjectCount !== data.relevantObjectCount) {
    throw new Error(`Relevant object count mismatch: traversal=${traversal.relevantObjectCount} materialized=${data.relevantObjectCount}`)
  }
  if (
    traversal.counts.vaults !== data.counts.vaults
    || traversal.counts.loanBrokers !== data.counts.loanBrokers
    || traversal.counts.loans !== data.counts.loans
  ) throw new Error('Object type counts changed during materialization')
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const assetsDir = join(args.outputDir, 'assets')
  const channelDir = join(args.outputDir, 'channel')
  const workDir = resolve(`${args.outputDir}.work`)
  const workDataDir = join(workDir, 'data')
  const workIndexDir = join(workDir, 'index')

  await rm(workDir, { recursive: true, force: true })
  await mkdir(assetsDir, { recursive: true })
  await mkdir(channelDir, { recursive: true })
  await mkdir(workDataDir, { recursive: true })
  await mkdir(workIndexDir, { recursive: true })

  const ledger = await getValidatedLedger(args.endpoint, args.timeoutMs)
  const epochId = args.epochId ?? `devnet-${ledger.ledgerIndex}`
  const snapshotId = args.snapshotId ?? `devnet-${ledger.ledgerIndex}-${ledger.ledgerHash.slice(0, 12).toLowerCase()}`

  const traversal = await streamFullLedgerTraversal(args, ledger, workDataDir)
  const data = await materializeDataAssets(args, traversal, assetsDir, workDataDir, workIndexDir)
  assertTraversalAccounting(traversal, data)
  const indexes = await materializeIndexAssets(args, assetsDir, workIndexDir)

  const manifestWithoutDigest = {
    schemaVersion: 2 as const,
    network: 'devnet' as const,
    endpoint: args.endpoint,
    epochId,
    snapshotId,
    releaseTag: args.releaseTag,
    ledgerIndex: ledger.ledgerIndex,
    ledgerHash: ledger.ledgerHash,
    complete: traversal.complete,
    sourcePages: traversal.sourcePages,
    decodedObjectCount: traversal.decodedObjectCount,
    relevantObjectCount: data.relevantObjectCount,
    counts: data.counts,
    layout: {
      pagesPerSegment: Math.max(1, Math.ceil(traversal.sourcePages / args.dataSegments)),
      indexBuckets: args.indexBuckets,
      dataSegmentCount: data.dataAssets.length,
      hashFunction: 'sha256-first-u32-mod-bucket-count' as const,
    },
    dataAssets: data.dataAssets,
    indexAssets: indexes.indexAssets,
    totals: {
      dataCompressedBytes: data.dataCompressedBytes,
      dataUncompressedBytes: data.dataUncompressedBytes,
      indexCompressedBytes: indexes.indexCompressedBytes,
      indexUncompressedBytes: indexes.indexUncompressedBytes,
    },
    manifestSha256: null,
  }

  const manifestSha256 = await sha256Hex(`${canonicalJson(manifestWithoutDigest)}\n`)
  const manifest: ReleaseNativeManifest = { ...manifestWithoutDigest, manifestSha256 }
  const manifestAssetName = 'manifest.json'
  await writeText(join(assetsDir, manifestAssetName), manifest)

  const channel = {
    schemaVersion: 1 as const,
    active: {
      releaseTag: args.releaseTag,
      manifestAssetName,
      manifestSha256,
    },
    rollback: null,
    updatedAt: new Date().toISOString(),
  }
  await writeText(join(channelDir, 'channel.json'), channel)

  const summary = {
    releaseTag: args.releaseTag,
    channelTag: 'current-state-channel',
    traversalMode: 'binary-type-filtered-marker-exhaustive' as const,
    complete: traversal.complete,
    manifestAssetName,
    manifestSha256,
    ledger,
    sourcePages: traversal.sourcePages,
    decodedObjectCount: traversal.decodedObjectCount,
    counts: data.counts,
    dataAssets: data.dataAssets.length,
    indexAssets: indexes.indexAssets.length,
    totalAssets: data.dataAssets.length + indexes.indexAssets.length + 1,
  }
  await writeText(join(args.outputDir, 'release-summary.json'), summary)

  await writeFile(
    join(args.outputDir, 'release-notes.md'),
    `# XRPL Lending Monitor current-state snapshot\n\n- release: ${args.releaseTag}\n- traversal mode: binary-type-filtered-marker-exhaustive\n- complete: ${traversal.complete}\n- source pages: ${traversal.sourcePages}\n- decoded objects: ${traversal.decodedObjectCount}\n- data assets: ${data.dataAssets.length}\n- index assets: ${indexes.indexAssets.length}\n- total release assets: ${data.dataAssets.length + indexes.indexAssets.length + 1}\n- ledger: ${ledger.ledgerIndex}\n- ledger hash: ${ledger.ledgerHash}\n- vaults: ${data.counts.vaults}\n- loan brokers: ${data.counts.loanBrokers}\n- loans: ${data.counts.loans}\n- manifest sha256: ${manifestSha256}\n`,
    'utf8',
  )

  await rm(workDir, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})