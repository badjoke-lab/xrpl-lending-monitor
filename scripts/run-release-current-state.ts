import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { decode } from '@xrpl-commons/ripple-binary-codec'

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
  dataSegments: number
}

type LedgerDataResult = {
  ledger_hash?: unknown
  ledger_index?: unknown
  validated?: unknown
  state?: unknown
  marker?: unknown
}

type RelevantEntry = {
  kind: ReleaseKind
  page: number
  object: Record<string, unknown>
}

type TraversalResult = {
  entries: RelevantEntry[]
  sourcePages: number
  decodedObjectCount: number
  complete: boolean
}

const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234'
const DATA_ASSET_PREFIX = 'data-segment-'

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

function requiredHex(value: unknown, field: string): string {
  const hex = requiredString(value, field)
  if (hex.length % 2 !== 0 || !/^[A-Fa-f0-9]+$/.test(hex)) throw new Error(`${field} must be an even-length hexadecimal string`)
  return hex.toUpperCase()
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

function markerFingerprint(marker: unknown): string {
  try {
    return JSON.stringify(marker)
  } catch {
    throw new Error('ledger_data marker could not be serialized')
  }
}

function kindFromLedgerEntryType(value: unknown): ReleaseKind | null {
  if (value === 'Vault') return 'vault'
  if (value === 'LoanBroker') return 'loan-broker'
  if (value === 'Loan') return 'loan'
  return null
}

function segmentId(index: number): string {
  return `segment-${String(index).padStart(5, '0')}`
}

function dataAssetName(index: number): string {
  return `${DATA_ASSET_PREFIX}${String(index).padStart(5, '0')}.ndjson.gz`
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
    assetName: dataAssetNameForRecord(record),
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

async function boundedFullLedgerTraversal(options: Arguments, ledger: LedgerIdentity): Promise<TraversalResult> {
  const client = new XrplJsonRpcClient({ endpoint: options.endpoint, timeoutMs: options.timeoutMs })
  const entries: RelevantEntry[] = []
  const seenMarkers = new Set<string>()
  let marker: unknown = undefined
  let page = 0
  let decodedObjectCount = 0
  let complete = false

  process.stderr.write(`Running bounded full-ledger traversal with page limit ${options.pageLimit}.\n`)
  for (;;) {
    if (page >= options.pageLimit) {
      process.stderr.write(`Bounded traversal stopped at page limit ${options.pageLimit}; snapshot is partial.\n`)
      break
    }
    const params: Record<string, unknown> = {
      ledger_hash: ledger.ledgerHash,
      binary: true,
      limit: options.objectLimitPerPage,
    }
    if (marker !== undefined) params.marker = marker
    const result = await client.call<LedgerDataResult>('ledger_data', params)
    const ledgerHash = id(requiredString(result.ledger_hash, 'ledger_hash'), 'ledger_hash')
    const ledgerIndex = requiredLedgerIndex(result.ledger_index)
    if (ledgerHash !== ledger.ledgerHash || ledgerIndex !== ledger.ledgerIndex) throw new Error('ledger_data moved during traversal')
    if (result.validated !== true) throw new Error('ledger_data response must describe a validated ledger')
    if (!Array.isArray(result.state)) throw new Error('ledger_data response state must be an array')

    page += 1
    if (page % 10 === 0) process.stderr.write(`Processed ${page} ledger_data pages; relevant objects so far: ${entries.length}.\n`)
    for (let index = 0; index < result.state.length; index += 1) {
      const stateEntry = result.state[index]
      if (!isRecord(stateEntry)) throw new Error(`state[${index}] must be an object`)
      const binaryHex = requiredHex(stateEntry.data, `state[${index}].data`)
      const decoded = decode(binaryHex)
      if (!isRecord(decoded)) throw new Error(`state[${index}] did not decode to an object`)
      decodedObjectCount += 1
      const kind = kindFromLedgerEntryType(decoded.LedgerEntryType)
      if (!kind) continue
      entries.push({
        kind,
        page,
        object: {
          ...decoded,
          LedgerEntryType: decoded.LedgerEntryType,
          index: id(requiredString(stateEntry.index, `state[${index}].index`), `state[${index}].index`),
          BinaryHex: binaryHex,
        },
      })
    }

    marker = result.marker
    if (marker === undefined || marker === null) {
      complete = true
      break
    }
    const fingerprint = markerFingerprint(marker)
    if (seenMarkers.has(fingerprint)) throw new Error(`ledger_data repeated marker after page ${page}`)
    seenMarkers.add(fingerprint)
  }

  return { entries, sourcePages: Math.max(1, page), decodedObjectCount, complete }
}

async function makeDataRecords(options: Arguments, ledger: LedgerIdentity): Promise<{
  records: ReleaseNativeDataRecord[]
  sourcePages: number
  decodedObjectCount: number
  traversalMode: 'bounded-full-ledger'
  complete: boolean
}> {
  const materialized = await boundedFullLedgerTraversal(options, ledger)
  const records: ReleaseNativeDataRecord[] = []
  for (const entry of materialized.entries) {
    records.push({
      schemaVersion: 1,
      segmentId: 'segment-00000',
      sourcePage: entry.page,
      id: id(requiredString(entry.object.index, 'object.index'), 'object.index'),
      kind: entry.kind,
      valueSha256: await sha256Hex(canonicalJson(entry.object)),
      value: entry.object,
    })
  }
  records.sort((left, right) => left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind))
  return {
    records,
    sourcePages: materialized.sourcePages,
    decodedObjectCount: materialized.decodedObjectCount,
    traversalMode: 'bounded-full-ledger',
    complete: materialized.complete,
  }
}

function segmentRecords(records: readonly ReleaseNativeDataRecord[], segmentCount: number): ReleaseNativeDataRecord[][] {
  const segments = Array.from({ length: segmentCount }, () => [] as ReleaseNativeDataRecord[])
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const start = Math.floor(records.length * segment / segmentCount)
    const end = Math.floor(records.length * (segment + 1) / segmentCount)
    const idForSegment = segmentId(segment)
    for (const record of records.slice(start, end)) segments[segment]!.push({ ...record, segmentId: idForSegment })
  }
  return segments
}

function pageRange(records: readonly ReleaseNativeDataRecord[], totalSourcePages: number): { first: number; last: number; count: number } {
  if (records.length === 0) return { first: 1, last: totalSourcePages, count: totalSourcePages }
  const pages = records.map((record) => record.sourcePage)
  const first = Math.min(...pages)
  const last = Math.max(...pages)
  return { first, last, count: last - first + 1 }
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
  const segmentedRecords = segmentRecords(materialized.records, args.dataSegments)
  const allRecords = segmentedRecords.flat()
  const dataCounts = countRecords(allRecords)
  const dataAssets: ReleaseNativeDataAsset[] = []
  let dataCompressedBytes = 0
  let dataUncompressedBytes = 0

  for (let segment = 0; segment < segmentedRecords.length; segment += 1) {
    const records = segmentedRecords[segment]!
    const assetName = dataAssetName(segment)
    const stats = await writeGzipNdjson(join(assetsDir, assetName), records)
    dataCompressedBytes += stats.compressedBytes
    dataUncompressedBytes += stats.uncompressedBytes
    dataAssets.push({
      assetName,
      segmentId: segmentId(segment),
      sha256: stats.sha256,
      compressedBytes: stats.compressedBytes,
      uncompressedBytes: stats.uncompressedBytes,
      recordCount: records.length,
      sourcePages: pageRange(records, materialized.sourcePages),
      firstObjectId: records[0]?.id ?? null,
      lastObjectId: records.at(-1)?.id ?? null,
      counts: countRecords(records),
    })
  }

  const indexSeed: ReleaseNativeIndexRecord[] = []
  for (const record of allRecords) {
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
    complete: materialized.complete,
    sourcePages: materialized.sourcePages,
    decodedObjectCount: materialized.decodedObjectCount,
    relevantObjectCount: allRecords.length,
    counts: dataCounts,
    layout: {
      pagesPerSegment: Math.max(1, Math.ceil(materialized.sourcePages / args.dataSegments)),
      indexBuckets: args.indexBuckets,
      dataSegmentCount: dataAssets.length,
      hashFunction: 'sha256-first-u32-mod-bucket-count' as const,
    },
    dataAssets,
    indexAssets,
    totals: {
      dataCompressedBytes,
      dataUncompressedBytes,
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
    traversalMode: materialized.traversalMode,
    complete: materialized.complete,
    manifestAssetName,
    manifestSha256,
    ledger,
    sourcePages: materialized.sourcePages,
    decodedObjectCount: materialized.decodedObjectCount,
    counts: dataCounts,
    dataAssets: dataAssets.length,
    indexAssets: indexAssets.length,
    totalAssets: dataAssets.length + indexAssets.length + 1,
  }
  await writeText(join(args.outputDir, 'release-summary.json'), summary)
  await writeFile(
    join(args.outputDir, 'release-notes.md'),
    `# XRPL Lending Monitor current-state snapshot\n\n- release: ${args.releaseTag}\n- traversal mode: ${materialized.traversalMode}\n- complete: ${materialized.complete}\n- source pages: ${materialized.sourcePages}\n- decoded objects: ${materialized.decodedObjectCount}\n- data assets: ${dataAssets.length}\n- index assets: ${indexAssets.length}\n- total release assets: ${dataAssets.length + indexAssets.length + 1}\n- ledger: ${ledger.ledgerIndex}\n- ledger hash: ${ledger.ledgerHash}\n- vaults: ${dataCounts.vaults}\n- loan brokers: ${dataCounts.loanBrokers}\n- loans: ${dataCounts.loans}\n- manifest sha256: ${manifestSha256}\n`,
    'utf8',
  )
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
