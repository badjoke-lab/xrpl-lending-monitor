import { describe, expect, it } from 'vitest'

import type { ArtifactMetadata, ArtifactStore } from '../current-state/artifact-metadata'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../current-state/canonical-json'
import { HISTORY_SEGMENT_FILE_KINDS, type HistorySegmentManifest } from './manifest'
import {
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from './publication'
import { HistorySegmentChainReader } from './reader'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)

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
  const store = new MemoryStore()
  const base = 'history/epoch-1/s-101-105/'
  const objectChanges = [
    { objectId: 'A', ledgerIndex: 101 },
    { objectId: 'B', ledgerIndex: 102 },
    { objectId: 'A', ledgerIndex: 103 },
    { objectId: 'B', ledgerIndex: 104 },
    { objectId: 'A', ledgerIndex: 105 },
  ]
  const files: HistorySegmentManifest['files'] = []
  for (const kind of HISTORY_SEGMENT_FILE_KINDS) {
    const records = kind === 'object_changes'
      ? objectChanges
      : kind === 'ledgers'
        ? Array.from({ length: 5 }, (_, index) => ({ ledgerIndex: 101 + index }))
        : []
    const text = records.length ? `${records.map((value) => canonicalJson(value)).join('\n')}\n` : ''
    const bytes = await gzipDeterministic(utf8(text))
    const path = `${kind}.ndjson.gz`
    store.values.set(`${base}${path}`, bytes)
    files.push({ kind, path, bytes: bytes.byteLength, records: records.length, sha256: await sha256Hex(bytes) })
  }
  const manifest: HistorySegmentManifest = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'epoch-1',
    segmentId: 's-101-105',
    startLedgerIndex: 101,
    startLedgerHash: B,
    startParentHash: A,
    endLedgerIndex: 105,
    endLedgerHash: C,
    ledgerCount: 5,
    sourceRevision: 'deadbeef',
    generatedAt: '2026-07-06T00:00:00.000Z',
    previousSegmentId: null,
    previousSegmentEndHash: null,
    files,
  }
  const manifestBytes = utf8(`${canonicalJson(manifest)}\n`)
  store.values.set(`${base}manifest.json`, manifestBytes)
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'epoch-1',
    chainId: 'chain-101-105',
    complete: true,
    startLedgerIndex: 101,
    startLedgerHash: B,
    startParentHash: A,
    endLedgerIndex: 105,
    endLedgerHash: C,
    segmentCount: 1,
    ledgerCount: 5,
    sourceRevision: 'deadbeef',
    publishedAt: manifest.generatedAt,
    segments: [{
      segmentId: manifest.segmentId,
      manifestPath: `${base}manifest.json`,
      manifestSha256: await sha256Hex(manifestBytes),
      startLedgerIndex: manifest.startLedgerIndex,
      startLedgerHash: manifest.startLedgerHash,
      startParentHash: manifest.startParentHash,
      endLedgerIndex: manifest.endLedgerIndex,
      endLedgerHash: manifest.endLedgerHash,
      ledgerCount: manifest.ledgerCount,
      previousSegmentId: null,
      previousSegmentEndHash: null,
      recordCounts: Object.fromEntries(files.map((file) => [file.kind, file.records])) as HistorySegmentChainPublication['segments'][number]['recordCounts'],
    }],
    publicationSha256: 'a'.repeat(64),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  return { reader: await HistorySegmentChainReader.open({ store, publication }) }
}

describe('filtered history segment reader', () => {
  it('examines bounded rows, returns matching rows, and resumes from the next unexamined row', async () => {
    const { reader } = await fixture()
    const predicate = (value: { objectId: string }) => value.objectId === 'A'
    const first = await reader.list<{ objectId: string; ledgerIndex: number }>({
      kind: 'object_changes',
      direction: 'asc',
      scope: 'object:A',
      predicate,
      limit: 3,
      maxRecordsExamined: 2,
    })
    expect(first.items.map((row) => row.ledgerIndex)).toEqual([101])
    expect(first.recordsExamined).toBe(2)
    expect(first.complete).toBe(false)
    expect(first.nextCursor).not.toBeNull()

    const second = await reader.list<{ objectId: string; ledgerIndex: number }>({
      kind: 'object_changes',
      direction: 'asc',
      scope: 'object:A',
      predicate,
      limit: 3,
      maxRecordsExamined: 3,
      cursor: first.nextCursor!,
    })
    expect(second.items.map((row) => row.ledgerIndex)).toEqual([103, 105])
    expect(second.complete).toBe(true)
  })

  it('rejects filtered reads without explicit cursor scope', async () => {
    const { reader } = await fixture()
    await expect(reader.list({
      kind: 'object_changes',
      predicate: () => true,
    })).rejects.toThrow('explicit cursor scope')
  })

  it('rejects reuse of a cursor under a different filter scope', async () => {
    const { reader } = await fixture()
    const first = await reader.list<{ objectId: string }>({
      kind: 'object_changes',
      scope: 'object:A',
      predicate: (value) => value.objectId === 'A',
      maxRecordsExamined: 1,
    })
    await expect(reader.list({
      kind: 'object_changes',
      scope: 'object:B',
      predicate: () => true,
      cursor: first.nextCursor!,
    })).rejects.toThrow('cursor does not match')
  })
})
