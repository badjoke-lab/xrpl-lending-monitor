import {
  decodeArtifactReaderCursor,
  decodeGzipNdjsonWithMetadata,
  encodeArtifactReaderCursor,
} from '../current-state/artifact-reader-codec'
import type { ArtifactStore } from '../current-state/artifact-metadata'
import { sha256Hex } from '../current-state/canonical-json'
import {
  assertHistorySegmentManifest,
  type HistorySegmentFileKind,
  type HistorySegmentManifest,
} from './manifest'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from './publication'

export interface HistorySegmentReadOptions<T = unknown> {
  kind: HistorySegmentFileKind
  limit?: number
  cursor?: string
  direction?: 'asc' | 'desc'
  scope?: string
  predicate?: (value: T) => boolean
  maxSegmentReads?: number
  maxCompressedBytes?: number
  maxDecompressedBytes?: number
  maxRecordsExamined?: number
  maxWallTimeMs?: number
}

export interface HistorySegmentReadResult<T = unknown> {
  items: T[]
  nextCursor: string | null
  complete: boolean
  segmentReads: number
  compressedBytes: number
  decompressedBytes: number
  recordsExamined: number
}

export interface HistorySegmentFileReference {
  segmentId: string
  fileKind: HistorySegmentFileKind
  ledgerIndex?: number
}

export interface HistoryReferencedReadResult<T = unknown> {
  items: T[]
  assetReads: number
  compressedBytes: number
  decompressedBytes: number
  recordsExamined: number
}

const MAX_RESULT_LIMIT = 100
const DEFAULT_LIMIT = 50
const DEFAULT_SEGMENT_READS = 4
const DEFAULT_COMPRESSED_BYTES = 16 * 1024 * 1024
const DEFAULT_DECOMPRESSED_BYTES = 64 * 1024 * 1024
const DEFAULT_RECORDS_EXAMINED = 10_000
const DEFAULT_WALL_TIME_MS = 1_000
const MAX_MANIFEST_BYTES = 1024 * 1024

function positive(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${field} must be a positive safe integer`)
  return result
}

function safeRelativePath(value: string, field: string): void {
  if (
    value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
  ) throw new Error(`${field} is unsafe`)
}

function assetPath(manifestPath: string, filePath: string): string {
  safeRelativePath(manifestPath, 'manifestPath')
  safeRelativePath(filePath, 'segment file path')
  const slash = manifestPath.lastIndexOf('/')
  return `${slash < 0 ? '' : manifestPath.slice(0, slash + 1)}${filePath}`
}

function assertDescriptorMatchesManifest(
  descriptor: PublishedHistorySegment,
  manifest: HistorySegmentManifest,
): void {
  if (
    manifest.segmentId !== descriptor.segmentId
    || manifest.startLedgerIndex !== descriptor.startLedgerIndex
    || manifest.startLedgerHash !== descriptor.startLedgerHash
    || manifest.startParentHash !== descriptor.startParentHash
    || manifest.endLedgerIndex !== descriptor.endLedgerIndex
    || manifest.endLedgerHash !== descriptor.endLedgerHash
    || manifest.ledgerCount !== descriptor.ledgerCount
    || manifest.previousSegmentId !== descriptor.previousSegmentId
    || manifest.previousSegmentEndHash !== descriptor.previousSegmentEndHash
  ) throw new Error(`Published history segment identity mismatch for ${descriptor.segmentId}`)

  for (const file of manifest.files) {
    if (file.records !== descriptor.recordCounts[file.kind]) {
      throw new Error(`Published history record count mismatch for ${descriptor.segmentId}:${file.kind}`)
    }
  }
}

export class HistorySegmentChainReader {
  readonly publication: HistorySegmentChainPublication
  readonly #store: ArtifactStore
  readonly #now: () => number

  private constructor(options: {
    store: ArtifactStore
    publication: HistorySegmentChainPublication
    now?: () => number
  }) {
    this.#store = options.store
    this.publication = options.publication
    this.#now = options.now ?? (() => Date.now())
  }

  static async open(options: {
    store: ArtifactStore
    publication: HistorySegmentChainPublication
    now?: () => number
  }): Promise<HistorySegmentChainReader> {
    await assertHistorySegmentPublicationDigest(options.publication)
    return new HistorySegmentChainReader(options)
  }

  async #manifest(descriptor: PublishedHistorySegment): Promise<HistorySegmentManifest> {
    const bytes = await this.#store.read(descriptor.manifestPath)
    if (!bytes) throw new Error(`Missing history segment manifest ${descriptor.manifestPath}`)
    if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('History segment manifest exceeds size limit')
    if (await sha256Hex(bytes) !== descriptor.manifestSha256) {
      throw new Error(`History segment manifest digest mismatch for ${descriptor.segmentId}`)
    }
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as HistorySegmentManifest
    assertHistorySegmentManifest(manifest)
    assertDescriptorMatchesManifest(descriptor, manifest)
    return manifest
  }

  async readReferenced<T = unknown>(options: {
    references: readonly HistorySegmentFileReference[]
    predicate?: (value: T) => boolean
    limit?: number
    maxAssetReads?: number
    maxCompressedBytes?: number
    maxDecompressedBytes?: number
    maxRecordsExamined?: number
  }): Promise<HistoryReferencedReadResult<T>> {
    const limit = positive(options.limit, DEFAULT_LIMIT, 'limit')
    if (limit > MAX_RESULT_LIMIT) throw new Error('History referenced result limit exceeds maximum')
    const maxAssetReads = positive(options.maxAssetReads, DEFAULT_SEGMENT_READS, 'maxAssetReads')
    const maxCompressedBytes = positive(options.maxCompressedBytes, DEFAULT_COMPRESSED_BYTES, 'maxCompressedBytes')
    const maxDecompressedBytes = positive(options.maxDecompressedBytes, DEFAULT_DECOMPRESSED_BYTES, 'maxDecompressedBytes')
    const maxRecordsExamined = positive(options.maxRecordsExamined, DEFAULT_RECORDS_EXAMINED, 'maxRecordsExamined')
    const predicate = options.predicate ?? (() => true)
    const descriptorOrder = new Map(this.publication.segments.map((segment, index) => [segment.segmentId, index]))
    const unique = new Map<string, HistorySegmentFileReference>()
    for (const reference of options.references) {
      const descriptorIndex = descriptorOrder.get(reference.segmentId)
      if (descriptorIndex === undefined) throw new Error(`History reference segment is not published: ${reference.segmentId}`)
      const descriptor = this.publication.segments[descriptorIndex]!
      if (reference.ledgerIndex !== undefined) {
        if (!Number.isSafeInteger(reference.ledgerIndex)
          || reference.ledgerIndex < descriptor.startLedgerIndex
          || reference.ledgerIndex > descriptor.endLedgerIndex) {
          throw new Error('History reference ledger is outside the published segment')
        }
      }
      unique.set(`${reference.segmentId}:${reference.fileKind}`, reference)
    }
    const references = [...unique.values()].sort((left, right) =>
      descriptorOrder.get(left.segmentId)! - descriptorOrder.get(right.segmentId)!
      || left.fileKind.localeCompare(right.fileKind))
    if (references.length > maxAssetReads) throw new Error('History referenced read exceeds asset-read limit')

    const items: T[] = []
    let assetReads = 0
    let compressedBytes = 0
    let decompressedBytes = 0
    let recordsExamined = 0
    for (const reference of references) {
      const descriptor = this.publication.segments[descriptorOrder.get(reference.segmentId)!]!
      const manifest = await this.#manifest(descriptor)
      const file = manifest.files.find((entry) => entry.kind === reference.fileKind)
      if (!file) throw new Error(`History referenced file kind is unavailable: ${reference.fileKind}`)
      if (compressedBytes + file.bytes > maxCompressedBytes) throw new Error('History referenced read exceeds compressed byte limit')
      const bytes = await this.#store.read(assetPath(descriptor.manifestPath, file.path))
      if (!bytes || bytes.byteLength !== file.bytes) throw new Error('Missing or invalid referenced history segment asset')
      const remainingDecompressed = maxDecompressedBytes - decompressedBytes
      if (remainingDecompressed < 1) throw new Error('History referenced read exceeds decompressed byte limit')
      const decoded = await decodeGzipNdjsonWithMetadata({
        bytes,
        sha256: file.sha256,
        maxDecompressedBytes: remainingDecompressed,
      })
      if (decoded.records.length !== file.records) throw new Error('History referenced asset record count mismatch')
      assetReads += 1
      compressedBytes += bytes.byteLength
      decompressedBytes += decoded.decompressedBytes
      for (const raw of decoded.records) {
        recordsExamined += 1
        if (recordsExamined > maxRecordsExamined) throw new Error('History referenced read exceeds record examination limit')
        const value = raw as T
        if (!predicate(value)) continue
        items.push(value)
        if (items.length >= limit) {
          return { items, assetReads, compressedBytes, decompressedBytes, recordsExamined }
        }
      }
    }
    return { items, assetReads, compressedBytes, decompressedBytes, recordsExamined }
  }

  async list<T = unknown>(options: HistorySegmentReadOptions<T>): Promise<HistorySegmentReadResult<T>> {
    const limit = positive(options.limit, DEFAULT_LIMIT, 'limit')
    if (limit > MAX_RESULT_LIMIT) throw new Error('History segment result limit exceeds maximum')
    const maxSegmentReads = positive(options.maxSegmentReads, DEFAULT_SEGMENT_READS, 'maxSegmentReads')
    const maxCompressedBytes = positive(options.maxCompressedBytes, DEFAULT_COMPRESSED_BYTES, 'maxCompressedBytes')
    const maxDecompressedBytes = positive(options.maxDecompressedBytes, DEFAULT_DECOMPRESSED_BYTES, 'maxDecompressedBytes')
    const maxRecordsExamined = positive(options.maxRecordsExamined, DEFAULT_RECORDS_EXAMINED, 'maxRecordsExamined')
    const maxWallTimeMs = positive(options.maxWallTimeMs, DEFAULT_WALL_TIME_MS, 'maxWallTimeMs')
    const direction = options.direction ?? 'desc'
    const scope = options.scope ?? '*'
    if (scope.length === 0) throw new Error('History segment read scope must be non-empty')
    if (options.predicate && options.scope === undefined) throw new Error('Filtered history segment reads require an explicit cursor scope')
    const predicate = options.predicate ?? (() => true)
    const descriptors = direction === 'asc' ? this.publication.segments : [...this.publication.segments].reverse()
    const mode = `history:${options.kind}:${direction}:${scope}`
    const cursor = decodeArtifactReaderCursor({ cursor: options.cursor, mode, term: this.publication.chainId })
    if (cursor.descriptorIndex > descriptors.length) throw new Error('History segment cursor is beyond the publication')

    const startedAt = this.#now()
    const items: T[] = []
    let segmentReads = 0
    let compressedBytes = 0
    let decompressedBytes = 0
    let recordsExamined = 0
    const nextCursor = (descriptorIndex: number, lineIndex: number): string => encodeArtifactReaderCursor({
      schemaVersion: 1, mode, term: this.publication.chainId, descriptorIndex, lineIndex,
    })

    for (let descriptorIndex = cursor.descriptorIndex; descriptorIndex < descriptors.length; descriptorIndex += 1) {
      const lineStart = descriptorIndex === cursor.descriptorIndex ? cursor.lineIndex : 0
      if (segmentReads >= maxSegmentReads || this.#now() - startedAt >= maxWallTimeMs) {
        return { items, nextCursor: nextCursor(descriptorIndex, lineStart), complete: false, segmentReads, compressedBytes, decompressedBytes, recordsExamined }
      }
      const descriptor = descriptors[descriptorIndex]!
      const manifest = await this.#manifest(descriptor)
      const file = manifest.files.find((entry) => entry.kind === options.kind)
      if (!file) throw new Error(`History segment file kind is unavailable: ${options.kind}`)
      if (file.bytes > maxCompressedBytes - compressedBytes) {
        if (compressedBytes === 0) throw new Error('History segment asset exceeds compressed byte limit')
        return { items, nextCursor: nextCursor(descriptorIndex, lineStart), complete: false, segmentReads, compressedBytes, decompressedBytes, recordsExamined }
      }
      const path = assetPath(descriptor.manifestPath, file.path)
      const bytes = await this.#store.read(path)
      if (!bytes || bytes.byteLength !== file.bytes) throw new Error(`Missing or invalid history segment asset ${path}`)
      const remainingDecompressed = maxDecompressedBytes - decompressedBytes
      if (remainingDecompressed < 1) {
        return { items, nextCursor: nextCursor(descriptorIndex, lineStart), complete: false, segmentReads, compressedBytes, decompressedBytes, recordsExamined }
      }
      const decoded = await decodeGzipNdjsonWithMetadata({ bytes, sha256: file.sha256, maxDecompressedBytes: remainingDecompressed })
      if (decoded.records.length !== file.records) throw new Error('History segment asset record count mismatch')
      segmentReads += 1
      compressedBytes += bytes.byteLength
      decompressedBytes += decoded.decompressedBytes
      const records = direction === 'asc' ? decoded.records : [...decoded.records].reverse()
      if (lineStart > records.length) throw new Error('History segment cursor is beyond the asset')

      for (let lineIndex = lineStart; lineIndex < records.length; lineIndex += 1) {
        if (recordsExamined >= maxRecordsExamined || this.#now() - startedAt >= maxWallTimeMs) {
          return { items, nextCursor: nextCursor(descriptorIndex, lineIndex), complete: false, segmentReads, compressedBytes, decompressedBytes, recordsExamined }
        }
        const value = records[lineIndex] as T
        recordsExamined += 1
        if (!predicate(value)) continue
        items.push(value)
        if (items.length >= limit) {
          const assetDone = lineIndex + 1 >= records.length
          const nextDescriptor = assetDone ? descriptorIndex + 1 : descriptorIndex
          const complete = nextDescriptor >= descriptors.length
          return {
            items,
            nextCursor: complete ? null : nextCursor(nextDescriptor, assetDone ? 0 : lineIndex + 1),
            complete,
            segmentReads,
            compressedBytes,
            decompressedBytes,
            recordsExamined,
          }
        }
      }
    }
    return { items, nextCursor: null, complete: true, segmentReads, compressedBytes, decompressedBytes, recordsExamined }
  }
}
