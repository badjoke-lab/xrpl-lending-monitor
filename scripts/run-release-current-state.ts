import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { scanLedgerObjects, type CurrentObjectFilter, type ScannedLedgerObject } from '../src/collector/current-state/scan-ledger-objects'
import { XrplJsonRpcClient } from '../src/collector/network/xrpl-rpc'
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
}

const FILTERS: readonly CurrentObjectFilter[] = ['vault', 'loan_broker', 'loan']
const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234'
const DATA_ASSET_NAME = 'data-segment-00000.ndjson.gz'

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
    pageLimit: integerArgument(args, '--page-limit', 500),
    objectLimitPerPage: integerArgument(args, '--object-limit-per-page', 2_048),
    outputDir: resolve(argumentValue(args, '--output-dir') ?? '.local/current-state-release'),
    releaseTag,
    epochId: argumentValue(args, '--epoch-id'),
    snapshotId: argumentValue(args, '--snapshot-id'),
    indexBuckets: integerArgument(args, '--index-buckets', 16),
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

function kindFromFilter(filter: CurrentObjectFilter): ReleaseKind {
  if (filter === 'vault') return 'vault'
  if (filter === 'loan_broker') return 'loan-broker'
  return 'loan'
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

function countRecords(records: readonly ReleaseNativeDataRecord[]): Counts {
  return {
    vaults: records.filter((record) => record.kind === 'vault').length,
    loanBrokers: records.filter((record) => record.kind === 'loan-broker').length,
    loans: records.filter((record) => record.kind === 'loan').length,
  }
}

function reference(record: ReleaseNativeDataRecord): ReleaseNativeObjectReference {
  return {
    segmentId: record.segmentId,
    assetName: DATA_ASSET_NAME,
    id: record.id,
    kind: record.kind,
  }
}

function addObjectIndex(indexes: ReleaseNativeIndexRecord[], record: ReleaseNativeDataRecord): void {
  indexes.push({
    schemaVersion: 1,
    bucket: 0,
    term: record.id,
    lookupKind: 'object-id',
    value: { reference: reference(record) },
  })
}

function addAccountIndex(indexes: ReleaseNativeIndexRecord[], record: ReleaseNativeDataRecord, field: 'Account' | 'Owner' | 'Borrower', value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) return
  indexes.push({
    schemaVersion: 1,
    bucket: 0,
    term: value,
    lookupKind: 'account',
    value: { field, reference: reference(record) },
  })
}

function addRelationshipIndex(indexes: ReleaseNativeIndexRecord[], record: ReleaseNativeDataRecord): void {
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
}

async function makeDataRecords(options: Arguments, ledger: LedgerIdentity): Promise<{
  records: ReleaseNativeDataRecord[]
  sourcePages: number
  decodedObjectCount: number
}> {
  const records: ReleaseNativeDataRecord[] = []
  let sourcePages = 0
  let decodedObjectCount = 0
  for (const filter of FILTERS) {
    const scan = await scanLedgerObjects({
      endpoint: options.endpoint,
      timeoutMs: options.timeoutMs,
      ledgerHash: ledger.ledgerHash,
      ledgerIndex: ledger.ledgerIndex,
      filter,
      pageLimit: options.pageLimit,
      requestLimit: options.pageLimit,
      objectLimitPerPage: options.objectLimitPerPage,
    })
    sourcePages += scan.metrics.pages
    decodedObjectCount += scan.metrics.objects
    const kind = kindFromFilter(filter)
    for (const object of scan.objects) {
      const value = object as ScannedLedgerObject & Record<string, unknown>
      records.push({
        schemaVersion: 1,
        segmentId: 'segment-00000',
        sourcePage: 1,
        id: id(value.index, 'object.index'),
        kind,
        valueSha256: await sha256Hex(canonicalJson(value)),
        value,
      })
    }
  }
  records.sort((left, right) => left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind))
  return { records, sourcePages: Math.max(1, sourcePages), decodedObjectCount }
}

async function bucketize(indexes: readonly ReleaseNativeIndexRecord[], bucketCount: number): Promise<ReleaseNativeIndexRecord[][]> {
  const buckets = Array.from({ length: bucketCount }, () => [] as ReleaseNativeIndexRecord[])
  for (const index of indexes) {
    const bucket = await releaseNativeBucket(index.term, bucketCount)
    buckets[bucket]!.push({ ...index, bucket })
  }
  for (const bucket of buckets) {
    bucket.sort((left, right) => left.term.localeCompare(right.term)
      || left.lookupKind.localeCompare(right.lookupKind)
      || canonicalJson(left.value).localeCompare(canonicalJson(right.value)))
  }
  return buckets
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const assetsDir = join(args.outputDir, 'assets')
  const channelDir = join(args.outputDir, 'channel')
  await mkdir(assetsDir, { recursive: true })
  await mkdir(channelDir, { recursive: true })

  const ledger = await getValidatedLedger(args.endpoint, args.timeoutMs)
  const epochId = args.epochId ?? `devnet-${ledger.ledgerIndex}`
  const snapshotId = args.snapshotId ?? `devnet-${ledger.ledgerIndex}-${ledger.ledgerHash.slice(0, 12).toLowerCase()}`

  const materialized = await makeDataRecords(args, ledger)
  const dataCounts = countRecords(materialized.records)
  const dataStats = await writeGzipNdjson(join(assetsDir, DATA_ASSET_NAME), materialized.records)
  const dataAsset: ReleaseNativeDataAsset = {
    assetName: DATA_ASSET_NAME,
    segmentId: 'segment-00000',
    sha256: dataStats.sha256,
    compressedBytes: dataStats.compressedBytes,
    uncompressedBytes: dataStats.uncompressedBytes,
    recordCount: materialized.records.length,
    sourcePages: { first: 1, last: 1, count: 1 },
    firstObjectId: materialized.records[0]?.id ?? null,
    lastObjectId: materialized.records.at(-1)?.id ?? null,
    counts: dataCounts,
  }

  const indexSeed: ReleaseNativeIndexRecord[] = []
  for (const record of materialized.records) {
    addObjectIndex(indexSeed, record)
    addAccountIndex(indexSeed, record, 'Account', record.value.Account)
    addAccountIndex(indexSeed, record, 'Owner', record.value.Owner)
    addAccountIndex(indexSeed, record, 'Borrower', record.value.Borrower)
    addRelationshipIndex(indexSeed, record)
  }

  const buckets = await bucketize(indexSeed, args.indexBuckets)
  const indexAssets: ReleaseNativeIndexAsset[] = []
  let indexCompressedBytes = 0
  let indexUncompressedBytes = 0
  for (let bucket = 0; bucket < buckets.length; bucket += 1) {
    const records = buckets[bucket]!
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
    sourcePages: materialized.sourcePages,
    decodedObjectCount: materialized.decodedObjectCount,
    relevantObjectCount: materialized.records.length,
    counts: dataCounts,
    layout: {
      pagesPerSegment: 1,
      indexBuckets: args.indexBuckets,
      dataSegmentCount: 1,
      hashFunction: 'sha256-first-u32-mod-bucket-count' as const,
    },
    dataAssets: [dataAsset],
    indexAssets,
    totals: {
      dataCompressedBytes: dataStats.compressedBytes,
      dataUncompressedBytes: dataStats.uncompressedBytes,
      indexCompressedBytes,
      indexUncompressedBytes,
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
    manifestAssetName,
    manifestSha256,
    ledger,
    counts: dataCounts,
    dataAssets: 1,
    indexAssets: indexAssets.length,
    totalAssets: 1 + indexAssets.length + 1,
  }
  await writeText(join(args.outputDir, 'release-summary.json'), summary)
  await writeFile(
    join(args.outputDir, 'release-notes.md'),
    `# XRPL Lending Monitor current-state snapshot\n\n- release: ${args.releaseTag}\n- ledger: ${ledger.ledgerIndex}\n- ledger hash: ${ledger.ledgerHash}\n- vaults: ${dataCounts.vaults}\n- loan brokers: ${dataCounts.loanBrokers}\n- loans: ${dataCounts.loans}\n- manifest sha256: ${manifestSha256}\n`,
    'utf8',
  )
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
