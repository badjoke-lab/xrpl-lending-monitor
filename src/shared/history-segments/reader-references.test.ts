import { describe, expect, it } from 'vitest'
import type { ArtifactMetadata, ArtifactStore } from '../current-state/artifact-metadata'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../current-state/canonical-json'
import { HISTORY_SEGMENT_FILE_KINDS, type HistorySegmentManifest } from './manifest'
import { historySegmentPublicationDigest, type HistorySegmentChainPublication } from './publication'
import { HistorySegmentChainReader } from './reader'

const HASH = (c: string) => c.repeat(64)
class Store implements ArtifactStore {
  values = new Map<string, Uint8Array>()
  write(k: string, b: Uint8Array) { this.values.set(k, b); return Promise.resolve() }
  read(k: string) { return Promise.resolve(this.values.get(k) ?? null) }
  async inspect(k: string): Promise<ArtifactMetadata | null> { const b = this.values.get(k); return b ? { key: k, size: b.length, sha256: await sha256Hex(b) } : null }
  enumerate() { return Promise.resolve([]) }
}

async function makeReader() {
  const store = new Store()
  const base = 'history/e/s/'
  const files: HistorySegmentManifest['files'] = []
  for (const kind of HISTORY_SEGMENT_FILE_KINDS) {
    const rows = kind === 'object_changes'
      ? [{ transactionHash: 'TX1', ledgerIndex: 104 }, { transactionHash: 'TX2', ledgerIndex: 105 }]
      : kind === 'ledgers' ? [101, 102, 103, 104, 105].map((ledgerIndex) => ({ ledgerIndex })) : []
    const text = rows.length ? `${rows.map(canonicalJson).join('\n')}\n` : ''
    const bytes = await gzipDeterministic(utf8(text))
    const path = `${kind}.ndjson.gz`
    store.values.set(`${base}${path}`, bytes)
    files.push({ kind, path, bytes: bytes.length, records: rows.length, sha256: await sha256Hex(bytes) })
  }
  const manifest: HistorySegmentManifest = {
    schemaVersion: 1, network: 'devnet', epochId: 'e', segmentId: 's',
    startLedgerIndex: 101, startLedgerHash: HASH('B'), startParentHash: HASH('A'),
    endLedgerIndex: 105, endLedgerHash: HASH('C'), ledgerCount: 5,
    sourceRevision: 'deadbeef', generatedAt: '2026-07-06T00:00:00.000Z',
    previousSegmentId: null, previousSegmentEndHash: null, files,
  }
  const manifestBytes = utf8(`${canonicalJson(manifest)}\n`)
  store.values.set(`${base}manifest.json`, manifestBytes)
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1, network: 'devnet', epochId: 'e', chainId: 'chain', complete: true,
    startLedgerIndex: 101, startLedgerHash: HASH('B'), startParentHash: HASH('A'),
    endLedgerIndex: 105, endLedgerHash: HASH('C'), segmentCount: 1, ledgerCount: 5,
    sourceRevision: 'deadbeef', publishedAt: manifest.generatedAt,
    segments: [{
      segmentId: 's', manifestPath: `${base}manifest.json`, manifestSha256: await sha256Hex(manifestBytes),
      startLedgerIndex: 101, startLedgerHash: HASH('B'), startParentHash: HASH('A'),
      endLedgerIndex: 105, endLedgerHash: HASH('C'), ledgerCount: 5,
      previousSegmentId: null, previousSegmentEndHash: null,
      recordCounts: Object.fromEntries(files.map((f) => [f.kind, f.records])) as HistorySegmentChainPublication['segments'][number]['recordCounts'],
    }],
    publicationSha256: HASH('a'),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  return HistorySegmentChainReader.open({ store, publication })
}

describe('readReferenced', () => {
  it('reads one deduplicated asset and filters records', async () => {
    const reader = await makeReader()
    const result = await reader.readReferenced<{ transactionHash: string; ledgerIndex: number }>({
      references: [
        { segmentId: 's', fileKind: 'object_changes', ledgerIndex: 104 },
        { segmentId: 's', fileKind: 'object_changes', ledgerIndex: 104 },
      ],
      predicate: (row) => row.transactionHash === 'TX1',
      limit: 100,
    })
    expect(result.items).toEqual([{ transactionHash: 'TX1', ledgerIndex: 104 }])
    expect(result.assetReads).toBe(1)
    expect(result.recordsExamined).toBe(2)
  })

  it('rejects unpublished and out-of-range references', async () => {
    const reader = await makeReader()
    await expect(reader.readReferenced({ references: [{ segmentId: 'missing', fileKind: 'object_changes' }] })).rejects.toThrow('not published')
    await expect(reader.readReferenced({ references: [{ segmentId: 's', fileKind: 'object_changes', ledgerIndex: 106 }] })).rejects.toThrow('outside the published segment')
  })
})
