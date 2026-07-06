import { describe, expect, it } from 'vitest'

import type { ArtifactMetadata, ArtifactStore } from '../current-state/artifact-metadata'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../current-state/canonical-json'
import {
  historyExactIndexBucket,
  historyExactIndexManifestDigest,
  type HistoryExactIndexManifest,
  type HistoryExactIndexRecord,
} from './exact-index'
import { HistoryExactIndexReader } from './exact-index-reader'
import {
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from './publication'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const TERM = 'a'.repeat(64)

class MemoryStore implements ArtifactStore {
  readonly values = new Map<string, Uint8Array>()
  write(key: string, bytes: Uint8Array): Promise<void> { this.values.set(key, bytes); return Promise.resolve() }
  read(key: string): Promise<Uint8Array | null> { return Promise.resolve(this.values.get(key) ?? null) }
  async inspect(key: string): Promise<ArtifactMetadata | null> {
    const bytes = this.values.get(key)
    return bytes ? { key, size: bytes.byteLength, sha256: await sha256Hex(bytes) } : null
  }
  enumerate(): Promise<ArtifactMetadata[]> { return Promise.resolve([]) }
}

async function fixture() {
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'epoch-1',
    chainId: 'chain-1',
    complete: true,
    startLedgerIndex: 101,
    startLedgerHash: B,
    startParentHash: A,
    endLedgerIndex: 105,
    endLedgerHash: C,
    segmentCount: 1,
    ledgerCount: 5,
    sourceRevision: 'deadbeef',
    publishedAt: '2026-07-06T00:00:00.000Z',
    segments: [{
      segmentId: 's-101-105',
      manifestPath: 'history/epoch-1/s-101-105/manifest.json',
      manifestSha256: 'a'.repeat(64),
      startLedgerIndex: 101,
      startLedgerHash: B,
      startParentHash: A,
      endLedgerIndex: 105,
      endLedgerHash: C,
      ledgerCount: 5,
      previousSegmentId: null,
      previousSegmentEndHash: null,
      recordCounts: {
        ledgers: 5,
        protocol_events: 1,
        object_changes: 2,
        loan_lifecycle: 1,
        archived_objects: 0,
        balance_history: 0,
        current_projection_mutations: 0,
      },
    }],
    publicationSha256: 'a'.repeat(64),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)

  const store = new MemoryStore()
  const bucketCount = 4
  const targetBucket = await historyExactIndexBucket(TERM, bucketCount)
  const assets: HistoryExactIndexManifest['assets'] = []
  let totalRecords = 0
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const records: HistoryExactIndexRecord[] = bucket === targetBucket ? [
      {
        schemaVersion: 1,
        bucket,
        term: TERM.toUpperCase(),
        reference: {
          kind: 'transaction_event',
          segmentId: 's-101-105',
          fileKind: 'protocol_events',
          ledgerIndex: 104,
        },
      },
      {
        schemaVersion: 1,
        bucket,
        term: TERM.toUpperCase(),
        reference: {
          kind: 'object_change',
          segmentId: 's-101-105',
          fileKind: 'object_changes',
          ledgerIndex: 104,
        },
      },
    ] : []
    const text = records.length ? `${records.map((record) => canonicalJson(record)).join('\n')}\n` : ''
    const bytes = await gzipDeterministic(utf8(text))
    const path = `history/index/${String(bucket).padStart(4, '0')}.ndjson.gz`
    store.values.set(path, bytes)
    assets.push({
      bucket,
      path,
      sha256: await sha256Hex(bytes),
      compressedBytes: bytes.byteLength,
      recordCount: records.length,
      firstTerm: records[0]?.term ?? null,
      lastTerm: records.at(-1)?.term ?? null,
    })
    totalRecords += records.length
  }
  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: publication.epochId,
    chainId: publication.chainId,
    publicationSha256: publication.publicationSha256,
    bucketCount,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets,
    totalRecords,
    sourceRevision: 'deadbeef',
    generatedAt: publication.publishedAt,
    manifestSha256: 'a'.repeat(64),
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  return { store, publication, manifest, targetBucket }
}

describe('history exact index reader', () => {
  it('normalizes a hexadecimal term and reads only its bucket', async () => {
    const { store, publication, manifest, targetBucket } = await fixture()
    const reader = await HistoryExactIndexReader.open({ store, publication, manifest })
    const result = await reader.find(TERM)
    expect(result.term).toBe(TERM.toUpperCase())
    expect(result.bucket).toBe(targetBucket)
    expect(result.references.map((reference) => reference.kind)).toEqual([
      'object_change',
      'transaction_event',
    ])
    expect(result.assetReads).toBe(1)
  })

  it('reuses a verified bucket from the in-memory cache', async () => {
    const { store, publication, manifest } = await fixture()
    const reader = await HistoryExactIndexReader.open({ store, publication, manifest })
    await reader.find(TERM)
    const second = await reader.find(TERM)
    expect(second.assetReads).toBe(0)
    expect(second.compressedBytes).toBe(0)
  })

  it('fails closed on bucket asset digest corruption', async () => {
    const { store, publication, manifest, targetBucket } = await fixture()
    const path = manifest.assets[targetBucket]!.path
    const bytes = new Uint8Array(store.values.get(path)!)
    bytes[0] = bytes[0]! ^ 1
    store.values.set(path, bytes)
    const reader = await HistoryExactIndexReader.open({ store, publication, manifest })
    await expect(reader.find(TERM)).rejects.toThrow('digest mismatch')
  })

  it('rejects an index manifest bound to a different publication', async () => {
    const { store, publication, manifest } = await fixture()
    const changed = { ...publication, chainId: 'other-chain' }
    await expect(HistoryExactIndexReader.open({ store, publication: changed, manifest }))
      .rejects.toThrow('does not match publication identity')
  })
})
