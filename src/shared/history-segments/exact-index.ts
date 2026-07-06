import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import { type HistorySegmentFileKind } from './manifest'
import type { HistorySegmentChainPublication } from './publication'

export type HistoryExactReferenceKind =
  | 'transaction_event'
  | 'object_change'
  | 'archived_object'
  | 'loan_lifecycle'
  | 'balance_history'

export interface HistoryExactIndexReference {
  kind: HistoryExactReferenceKind
  segmentId: string
  fileKind: HistorySegmentFileKind
  ledgerIndex: number
}

export interface HistoryExactIndexRecord {
  schemaVersion: 1
  bucket: number
  term: string
  reference: HistoryExactIndexReference
}

export interface HistoryExactIndexAsset {
  bucket: number
  path: string
  sha256: string
  compressedBytes: number
  recordCount: number
  firstTerm: string | null
  lastTerm: string | null
}

export interface HistoryExactIndexManifest {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  chainId: string
  publicationSha256: string
  bucketCount: number
  hashFunction: 'sha256-first-u32-mod-bucket-count'
  assets: HistoryExactIndexAsset[]
  totalRecords: number
  sourceRevision: string
  generatedAt: string
  manifestSha256: string
}

const SHA256 = /^[a-f0-9]{64}$/
const FILE_KINDS = new Set<HistorySegmentFileKind>([
  'ledgers',
  'protocol_events',
  'object_changes',
  'loan_lifecycle',
  'archived_objects',
  'balance_history',
  'current_projection_mutations',
])
const REFERENCE_KINDS = new Set<HistoryExactReferenceKind>([
  'transaction_event',
  'object_change',
  'archived_object',
  'loan_lifecycle',
  'balance_history',
])

function integer(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${field} is invalid`)
}

function text(value: string, field: string): void {
  if (value.length === 0) throw new Error(`${field} must be non-empty`)
}

function digest(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`)
}

function safePath(value: string, field: string): void {
  if (
    value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
  ) throw new Error(`${field} is unsafe`)
}

export function normalizeHistoryExactTerm(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error('Exact history term must be non-empty')
  return /^[a-f0-9]{64}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed
}

export async function historyExactIndexBucket(term: string, bucketCount: number): Promise<number> {
  integer(bucketCount, 'bucketCount', 1)
  const digestValue = await sha256Hex(utf8(normalizeHistoryExactTerm(term)))
  return Number.parseInt(digestValue.slice(0, 8), 16) % bucketCount
}

export function assertHistoryExactIndexRecord(
  record: HistoryExactIndexRecord,
  bucketCount: number,
): void {
  if (record.schemaVersion !== 1) throw new Error('History exact index record schema is invalid')
  integer(record.bucket, 'record.bucket')
  if (record.bucket >= bucketCount) throw new Error('History exact index record bucket is out of range')
  text(record.term, 'record.term')
  if (!REFERENCE_KINDS.has(record.reference.kind)) throw new Error('History exact index reference kind is invalid')
  text(record.reference.segmentId, 'reference.segmentId')
  if (!FILE_KINDS.has(record.reference.fileKind)) throw new Error('History exact index file kind is invalid')
  integer(record.reference.ledgerIndex, 'reference.ledgerIndex', 1)
}

export function assertHistoryExactIndexManifest(
  manifest: HistoryExactIndexManifest,
  publication: HistorySegmentChainPublication,
): void {
  if (manifest.schemaVersion !== 1 || manifest.network !== 'devnet') {
    throw new Error('History exact index manifest schema is invalid')
  }
  text(manifest.epochId, 'epochId')
  text(manifest.chainId, 'chainId')
  text(manifest.sourceRevision, 'sourceRevision')
  text(manifest.generatedAt, 'generatedAt')
  digest(manifest.publicationSha256, 'publicationSha256')
  digest(manifest.manifestSha256, 'manifestSha256')
  integer(manifest.bucketCount, 'bucketCount', 1)
  integer(manifest.totalRecords, 'totalRecords')
  if (manifest.hashFunction !== 'sha256-first-u32-mod-bucket-count') {
    throw new Error('Unsupported history exact index hash function')
  }
  if (
    manifest.epochId !== publication.epochId
    || manifest.chainId !== publication.chainId
    || manifest.publicationSha256 !== publication.publicationSha256
  ) throw new Error('History exact index manifest does not match publication identity')
  if (manifest.assets.length !== manifest.bucketCount) {
    throw new Error('History exact index asset count does not match bucket count')
  }
  let totalRecords = 0
  const paths = new Set<string>()
  manifest.assets.forEach((asset, index) => {
    integer(asset.bucket, `assets[${index}].bucket`)
    if (asset.bucket !== index) throw new Error('History exact index buckets are not complete and ordered')
    safePath(asset.path, `assets[${index}].path`)
    if (paths.has(asset.path)) throw new Error('Duplicate history exact index asset path')
    paths.add(asset.path)
    digest(asset.sha256, `assets[${index}].sha256`)
    integer(asset.compressedBytes, `assets[${index}].compressedBytes`, 1)
    integer(asset.recordCount, `assets[${index}].recordCount`)
    if ((asset.firstTerm === null) !== (asset.lastTerm === null)) {
      throw new Error('History exact index term bounds must be both present or both null')
    }
    if (asset.firstTerm !== null) {
      text(asset.firstTerm, `assets[${index}].firstTerm`)
      text(asset.lastTerm!, `assets[${index}].lastTerm`)
      if (asset.firstTerm.localeCompare(asset.lastTerm!) > 0) throw new Error('History exact index term bounds are inverted')
    } else if (asset.recordCount !== 0) {
      throw new Error('Non-empty history exact index asset requires term bounds')
    }
    totalRecords += asset.recordCount
  })
  if (totalRecords !== manifest.totalRecords) throw new Error('History exact index total record count mismatch')
}

export function historyExactIndexManifestDigest(
  manifest: HistoryExactIndexManifest,
): Promise<string> {
  return sha256Hex(`${canonicalJson({ ...manifest, manifestSha256: null })}\n`)
}
