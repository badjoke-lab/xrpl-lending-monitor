import { describe, expect, it } from 'vitest'

import type { ArtifactMetadata, ArtifactStore } from '../current-state/artifact-metadata'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../current-state/canonical-json'
import { HISTORY_SEGMENT_FILE_KINDS, type HistorySegmentManifest } from './manifest'
import {
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from './publication'
import { HistorySegmentChainReader } from './reader'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)
const E = 'E'.repeat(64)

class MemoryStore implements ArtifactStore {
  readonly values = new Map<string, Uint8Array>()
  async write(key: string, bytes: Uint8Array): Promise<void> { this.values.set(key, bytes) }
  async read(key: string): Promise<Uint8Array | null> { return this.values.get(key) ?? null }
  async inspect(key: string): Promise<ArtifactMetadata | null> {
    const bytes = this.values.get(key)
    return bytes ? { key, size: bytes.byteLength, sha256: await sha256Hex(bytes) } : null
  }
  async enumerate(prefix: string): Promise<ArtifactMetadata[]> {
    const result: ArtifactMetadata[] = []
    for (const [key, bytes] of this.values) {
      if (key.startsWith(prefix)) result.push({ key, size: bytes.byteLength, sha256: await sha256Hex(bytes) })
    }
    return result
  }
}

async function addSegment(options: {
  store: MemoryStore
  segmentId: string
  start: number
  end: number
  startHash: string
  parentHash: string
  endHash: string
  previousId: string | null
  previousHash: string | null
  events: unknown[]
}): Promise<PublishedHistorySegment> {
  const base = `history/${options.segmentId}/`
  const files: HistorySegmentManifest['files'] = []
  for (const kind of HISTORY_SEGMENT_FILE_KINDS) {
    const records = kind === 'protocol_events' ? options.events : kind === 'ledgers'
      ? Array.from({ length: options.end - options.start + 1 }, (_, index) => ({ ledgerIndex: options.start + index }))
      : []
    const text = records.length ? `${records.map((record) => canonicalJson(record)).join('\n')}\n` : ''
    const bytes = await gzipDeterministic(utf8(text))
    const path = `${kind}.ndjson.gz`
    options.store.values.set(`${base}${path}`, bytes)
    files.push({ kind, path, bytes: bytes.byteLength, records: records.length, sha256: await sha256Hex(bytes) })
  }
  const manifest: HistorySegmentManifest = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    segmentId: options.segmentId,
    startLedgerIndex: options.start,
    startLedgerHash: options.startHash,
    startParentHash: options.parentHash,
    endLedgerIndex: options.end,
    endLedgerHash: options.endHash,
    ledgerCount: options.end - options.start + 1,
    sourceRevision: 'deadbeef',
    generatedAt: '2026-07-06T00:00:00.000Z',
    previousSegmentId: options.previousId,
    previousSegmentEndHash: options.previousHash,
    files,
  }
  const manifestPath = `${base}manifest.json`
  const manifestBytes = utf8(`${canonicalJson(manifest)}\n`)
  options.store.values.set(manifestPath, manifestBytes)
  return {
    segmentId: manifest.segmentId,
    manifestPath,
    manifestSha256: await sha256Hex(manifestBytes),
    startLedgerIndex: manifest.startLedgerIndex,
    startLedgerHash: manifest.startLedgerHash,
    startParentHash: manifest.startParentHash,
    endLedgerIndex: manifest.endLedgerIndex,
    endLedgerHash: manifest.endLedgerHash,
    ledgerCount: manifest.ledgerCount,
    previousSegmentId: manifest.previousSegmentId,
    previousSegmentEndHash: manifest.previousSegmentEndHash,
    recordCounts: Object.fromEntries(files.map((file) => [file.kind, file.records])) as PublishedHistorySegment['recordCounts'],
  }
}

async function fixture(): Promise<{ store: MemoryStore; publication: HistorySegmentChainPublication }> {
  const store = new MemoryStore()
  const first = await addSegment({
    store, segmentId: 's-101-105', start: 101, end: 105,
    startHash: B, parentHash: A, endHash: C, previousId: null, previousHash: null,
    events: [{ ledgerIndex: 101 }, { ledgerIndex: 102 }],
  })
  const second = await addSegment({
    store, segmentId: 's-106-110', start: 106, end: 110,
    startHash: D, parentHash: C, endHash: E, previousId: first.segmentId, previousHash: C,
    events: [{ ledgerIndex: 106 }, { ledgerIndex: 107 }],
  })
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1, network: 'devnet', epochId: 'devnet-test', chainId: 'chain-101-110', complete: true,
    startLedgerIndex: 101, startLedgerHash: B, startParentHash: A,
    endLedgerIndex: 110, endLedgerHash: E, segmentCount: 2, ledgerCount: 10,
    sourceRevision: 'deadbeef', publishedAt: '2026-07-06T00:00:00.000Z',
    segments: [first, second], publicationSha256: 'a'.repeat(64),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  return { store, publication }
}

describe('history segment chain reader', () => {
  it('reads newest records across segments in deterministic order', async () => {
    const { store, publication } = await fixture()
    const reader = await HistorySegmentChainReader.open({ store, publication })
    const result = await reader.list<{ ledgerIndex: number }>({ kind: 'protocol_events', direction: 'desc', limit: 10 })
    expect(result.items.map((item) => item.ledgerIndex)).toEqual([107, 106, 102, 101])
    expect(result.complete).toBe(true)
    expect(result.segmentReads).toBe(2)
  })

  it('reads targeted references in requested ascending and descending order', async () => {
    const { store, publication } = await fixture()
    const reader = await HistorySegmentChainReader.open({ store, publication })
    const references = publication.segments.map((segment) => ({
      segmentId: segment.segmentId,
      fileKind: 'protocol_events' as const,
    }))
    const ascending = await reader.readReferenced<{ ledgerIndex: number }>({ references, direction: 'asc', limit: 10 })
    const descending = await reader.readReferenced<{ ledgerIndex: number }>({ references, direction: 'desc', limit: 10 })
    expect(ascending.items.map((item) => item.ledgerIndex)).toEqual([101, 102, 106, 107])
    expect(descending.items.map((item) => item.ledgerIndex)).toEqual([107, 106, 102, 101])
  })

  it('returns a cursor when the segment-read budget is exhausted and resumes', async () => {
    const { store, publication } = await fixture()
    const reader = await HistorySegmentChainReader.open({ store, publication })
    const first = await reader.list<{ ledgerIndex: number }>({ kind: 'protocol_events', limit: 10, maxSegmentReads: 1 })
    expect(first.items.map((item) => item.ledgerIndex)).toEqual([107, 106])
    expect(first.complete).toBe(false)
    expect(first.nextCursor).not.toBeNull()
    const second = await reader.list<{ ledgerIndex: number }>({ kind: 'protocol_events', limit: 10, maxSegmentReads: 1, cursor: first.nextCursor! })
    expect(second.items.map((item) => item.ledgerIndex)).toEqual([102, 101])
    expect(second.complete).toBe(true)
  })

  it('fails closed on an asset digest mismatch', async () => {
    const { store, publication } = await fixture()
    const path = 'history/s-106-110/protocol_events.ndjson.gz'
    const bytes = store.values.get(path)!
    const corrupted = new Uint8Array(bytes)
    corrupted[0] = corrupted[0]! ^ 1
    store.values.set(path, corrupted)
    const reader = await HistorySegmentChainReader.open({ store, publication })
    await expect(reader.list({ kind: 'protocol_events' })).rejects.toThrow('digest mismatch')
  })

  it('fails closed on an asset record-count mismatch', async () => {
    const { store, publication } = await fixture()
    publication.segments[1]!.recordCounts.protocol_events = 3
    publication.publicationSha256 = await historySegmentPublicationDigest(publication)
    const reader = await HistorySegmentChainReader.open({ store, publication })
    await expect(reader.list({ kind: 'protocol_events' })).rejects.toThrow('record count mismatch')
  })

  it('rejects an asset larger than the compressed-byte budget', async () => {
    const { store, publication } = await fixture()
    const reader = await HistorySegmentChainReader.open({ store, publication })
    await expect(reader.list({ kind: 'protocol_events', maxCompressedBytes: 1 })).rejects.toThrow('compressed byte limit')
  })

  it('fails closed when decompressed output exceeds the budget', async () => {
    const { store, publication } = await fixture()
    const reader = await HistorySegmentChainReader.open({ store, publication })
    await expect(reader.list({ kind: 'protocol_events', maxDecompressedBytes: 1 })).rejects.toThrow('decompressed size exceeds limit')
  })

  it('returns a resumable cursor when the wall-time budget is exhausted', async () => {
    const { store, publication } = await fixture()
    let tick = 0
    const reader = await HistorySegmentChainReader.open({ store, publication, now: () => tick++ === 0 ? 0 : 2_000 })
    const result = await reader.list({ kind: 'protocol_events', maxWallTimeMs: 1_000 })
    expect(result.items).toEqual([])
    expect(result.complete).toBe(false)
    expect(result.nextCursor).not.toBeNull()
  })

  it('skips published zero-record segments without consuming the segment-read budget', async () => {
    const { store, publication } = await fixture()
    const reader = await HistorySegmentChainReader.open({ store, publication })
    const result = await reader.list({ kind: 'balance_history', limit: 10, maxSegmentReads: 1 })
    expect(result.items).toEqual([])
    expect(result.complete).toBe(true)
    expect(result.nextCursor).toBeNull()
    expect(result.segmentReads).toBe(0)
    expect(result.recordsExamined).toBe(0)
  })

  it('skips newer zero-record segments and reaches older records within the read budget', async () => {
    const { store, publication } = await fixture()
    const newest = publication.segments[1]!
    const manifestBytes = store.values.get(newest.manifestPath)!
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as HistorySegmentManifest
    const file = manifest.files.find((entry) => entry.kind === 'protocol_events')!
    const emptyBytes = await gzipDeterministic(utf8(''))
    store.values.set('history/s-106-110/protocol_events.ndjson.gz', emptyBytes)
    file.bytes = emptyBytes.byteLength
    file.records = 0
    file.sha256 = await sha256Hex(emptyBytes)
    const updatedManifestBytes = utf8(`${canonicalJson(manifest)}\n`)
    store.values.set(newest.manifestPath, updatedManifestBytes)
    newest.manifestSha256 = await sha256Hex(updatedManifestBytes)
    newest.recordCounts.protocol_events = 0
    publication.publicationSha256 = await historySegmentPublicationDigest(publication)

    const reader = await HistorySegmentChainReader.open({ store, publication })
    const result = await reader.list<{ ledgerIndex: number }>({
      kind: 'protocol_events', direction: 'desc', limit: 10, maxSegmentReads: 1,
    })
    expect(result.items.map((item) => item.ledgerIndex)).toEqual([102, 101])
    expect(result.complete).toBe(true)
    expect(result.segmentReads).toBe(1)
  })
})
