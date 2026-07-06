import { decodeGzipNdjsonWithMetadata } from '../current-state/artifact-reader-codec'
import type { ArtifactStore } from '../current-state/artifact-metadata'
import {
  assertHistoryExactIndexManifest,
  assertHistoryExactIndexRecord,
  historyExactIndexBucket,
  historyExactIndexManifestDigest,
  normalizeHistoryExactTerm,
  type HistoryExactIndexManifest,
  type HistoryExactIndexReference,
  type HistoryExactIndexRecord,
  type HistoryExactReferenceKind,
} from './exact-index'
import type { HistorySegmentChainPublication } from './publication'

const DEFAULT_MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024
const MAX_RESULT_LIMIT = 100

export interface HistoryExactLookupResult {
  term: string
  bucket: number
  references: HistoryExactIndexReference[]
  assetReads: number
  compressedBytes: number
  decompressedBytes: number
}

export class HistoryExactIndexReader {
  readonly manifest: HistoryExactIndexManifest
  readonly publication: HistorySegmentChainPublication
  readonly #store: ArtifactStore
  readonly #maxDecompressedBytes: number
  readonly #cache = new Map<number, HistoryExactIndexRecord[]>()

  private constructor(options: {
    store: ArtifactStore
    publication: HistorySegmentChainPublication
    manifest: HistoryExactIndexManifest
    maxDecompressedBytes: number
  }) {
    this.#store = options.store
    this.publication = options.publication
    this.manifest = options.manifest
    this.#maxDecompressedBytes = options.maxDecompressedBytes
  }

  static async open(options: {
    store: ArtifactStore
    publication: HistorySegmentChainPublication
    manifest: HistoryExactIndexManifest
    maxDecompressedBytes?: number
  }): Promise<HistoryExactIndexReader> {
    assertHistoryExactIndexManifest(options.manifest, options.publication)
    if (await historyExactIndexManifestDigest(options.manifest) !== options.manifest.manifestSha256) {
      throw new Error('History exact index manifest digest mismatch')
    }
    const maxDecompressedBytes = options.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES
    if (!Number.isSafeInteger(maxDecompressedBytes) || maxDecompressedBytes < 1) {
      throw new Error('History exact index decompressed byte limit must be positive')
    }
    return new HistoryExactIndexReader({
      store: options.store,
      publication: options.publication,
      manifest: options.manifest,
      maxDecompressedBytes,
    })
  }

  async #bucket(bucket: number): Promise<{
    records: HistoryExactIndexRecord[]
    assetReads: number
    compressedBytes: number
    decompressedBytes: number
  }> {
    const cached = this.#cache.get(bucket)
    if (cached) return { records: cached, assetReads: 0, compressedBytes: 0, decompressedBytes: 0 }
    const asset = this.manifest.assets[bucket]
    if (!asset) throw new Error('History exact index bucket asset is unavailable')
    const bytes = await this.#store.read(asset.path)
    if (!bytes || bytes.byteLength !== asset.compressedBytes) {
      throw new Error(`Missing or invalid history exact index asset ${asset.path}`)
    }
    const decoded = await decodeGzipNdjsonWithMetadata({
      bytes,
      sha256: asset.sha256,
      maxDecompressedBytes: this.#maxDecompressedBytes,
    })
    const records = decoded.records.map((value) => value as HistoryExactIndexRecord)
    if (records.length !== asset.recordCount) throw new Error('History exact index asset record count mismatch')
    for (const record of records) {
      assertHistoryExactIndexRecord(record, this.manifest.bucketCount)
      if (record.bucket !== bucket) throw new Error('History exact index record is in the wrong bucket')
    }
    for (let index = 1; index < records.length; index += 1) {
      const previous = records[index - 1]!
      const current = records[index]!
      const order = previous.term.localeCompare(current.term)
        || current.reference.ledgerIndex - previous.reference.ledgerIndex
        || previous.reference.kind.localeCompare(current.reference.kind)
        || previous.reference.segmentId.localeCompare(current.reference.segmentId)
      if (order > 0) throw new Error('History exact index asset records are not deterministically ordered')
    }
    if (this.#cache.size >= 4) this.#cache.delete(this.#cache.keys().next().value as number)
    this.#cache.set(bucket, records)
    return { records, assetReads: 1, compressedBytes: bytes.byteLength, decompressedBytes: decoded.decompressedBytes }
  }

  async find(termValue: string, options: {
    limit?: number
    referenceKinds?: readonly HistoryExactReferenceKind[]
  } = {}): Promise<HistoryExactLookupResult> {
    const limit = options.limit ?? MAX_RESULT_LIMIT
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) {
      throw new Error('History exact lookup limit must be between 1 and 100')
    }
    const allowedKinds = options.referenceKinds ? new Set(options.referenceKinds) : null
    const term = normalizeHistoryExactTerm(termValue)
    const bucket = await historyExactIndexBucket(term, this.manifest.bucketCount)
    const loaded = await this.#bucket(bucket)
    return {
      term,
      bucket,
      references: loaded.records
        .filter((record) => record.term === term && (allowedKinds === null || allowedKinds.has(record.reference.kind)))
        .slice(0, limit)
        .map((record) => record.reference),
      assetReads: loaded.assetReads,
      compressedBytes: loaded.compressedBytes,
      decompressedBytes: loaded.decompressedBytes,
    }
  }
}
