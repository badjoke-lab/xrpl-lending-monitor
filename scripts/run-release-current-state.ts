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