import { describe, expect, it } from 'vitest'
import type { ArtifactMetadata, ArtifactStore } from '../current-state/artifact-metadata'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../current-state/canonical-json'
import { historyExactIndexBucket, historyExactIndexManifestDigest, type HistoryExactIndexManifest, type HistoryExactIndexRecord } from './exact-index'
import { HistoryExactIndexReader } from './exact-index-reader'
import { historySegmentPublicationDigest, type HistorySegmentChainPublication } from './publication'

const H = (c: string) => c.repeat(64)
const TERM = H('a')
class Store implements ArtifactStore {
  values = new Map<string, Uint8Array>()
  write(k: string, b: Uint8Array) { this.values.set(k, b); return Promise.resolve() }
  read(k: string) { return Promise.resolve(this.values.get(k) ?? null) }
  async inspect(k: string): Promise<ArtifactMetadata | null> { const b = this.values.get(k); return b ? { key: k, size: b.length, sha256: await sha256Hex(b) } : null }
  enumerate() { return Promise.resolve([]) }
}

async function fixture() {
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1, network: 'devnet', epochId: 'e', chainId: 'chain', complete: true,
    startLedgerIndex: 101, startLedgerHash: H('B'), startParentHash: H('A'), endLedgerIndex: 105,
    endLedgerHash: H('C'), segmentCount: 1, ledgerCount: 5, sourceRevision: 'deadbeef',
    publishedAt: '2026-07-06T00:00:00.000Z',
    segments: [{ segmentId: 's', manifestPath: 'history/e/s/manifest.json', manifestSha256: H('b'), startLedgerIndex: 101, startLedgerHash: H('B'), startParentHash: H('A'), endLedgerIndex: 105, endLedgerHash: H('C'), ledgerCount: 5, previousSegmentId: null, previousSegmentEndHash: null, recordCounts: { ledgers: 5, protocol_events: 0, object_changes: 3, loan_lifecycle: 0, archived_objects: 0, balance_history: 1, current_projection_mutations: 0 } }],
    publicationSha256: H('a'),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  const store = new Store(); const bucketCount = 2; const bucket = await historyExactIndexBucket(TERM, bucketCount)
  const records: HistoryExactIndexRecord[] = [
    { schemaVersion: 2, bucket, term: TERM.toUpperCase(), reference: { kind: 'balance_history', segmentId: 's', fileKind: 'balance_history', ledgerIndex: 105, searchResult: null } },
    { schemaVersion: 2, bucket, term: TERM.toUpperCase(), reference: { kind: 'object_change', segmentId: 's', fileKind: 'object_changes', ledgerIndex: 104, searchResult: { kind: 'object_change', epochId: 'e', ledgerIndex: 104, transactionHash: 'TX-104', objectType: 'Loan', objectId: 'L', loanId: 'L' } } },
    { schemaVersion: 2, bucket, term: TERM.toUpperCase(), reference: { kind: 'object_change', segmentId: 's', fileKind: 'object_changes', ledgerIndex: 103, searchResult: { kind: 'object_change', epochId: 'e', ledgerIndex: 103, transactionHash: 'TX-103', objectType: 'LoanBroker', objectId: 'B', loanId: 'L' } } },
    { schemaVersion: 2, bucket, term: TERM.toUpperCase(), reference: { kind: 'object_change', segmentId: 's', fileKind: 'object_changes', ledgerIndex: 102, searchResult: { kind: 'object_change', epochId: 'e', ledgerIndex: 102, transactionHash: 'TX-102', objectType: 'Loan', objectId: 'L', loanId: 'L' } } },
  ]
  const assets: HistoryExactIndexManifest['assets'] = []
  for (let i = 0; i < bucketCount; i += 1) {
    const rows = i === bucket ? records : []; const bytes = await gzipDeterministic(utf8(rows.length ? `${rows.map(canonicalJson).join('\n')}\n` : '')); const path = `index/${i}.gz`; store.values.set(path, bytes)
    assets.push({ bucket: i, path, sha256: await sha256Hex(bytes), compressedBytes: bytes.length, recordCount: rows.length, firstTerm: rows[0]?.term ?? null, lastTerm: rows.at(-1)?.term ?? null })
  }
  const manifest: HistoryExactIndexManifest = { schemaVersion: 2, network: 'devnet', epochId: 'e', chainId: 'chain', publicationSha256: publication.publicationSha256, bucketCount, hashFunction: 'sha256-first-u32-mod-bucket-count', assets, totalRecords: records.length, sourceRevision: 'deadbeef', generatedAt: publication.publishedAt, manifestSha256: H('a') }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  return { store, publication, manifest, bucket }
}

describe('history exact index reader', () => {
  it('filters kinds before limit and caches the bucket', async () => {
    const f = await fixture(); const r = await HistoryExactIndexReader.open(f)
    const first = await r.find(TERM, { limit: 1, referenceKinds: ['object_change'] })
    expect(first.references.map((x) => x.kind)).toEqual(['object_change'])
    expect(first.assetReads).toBe(1)
    expect((await r.find(TERM)).assetReads).toBe(0)
  })

  it('applies semantic reference filtering before limit', async () => {
    const f = await fixture(); const r = await HistoryExactIndexReader.open(f)
    const result = await r.find(TERM, {
      limit: 2,
      referenceKinds: ['object_change'],
      referencePredicate: (reference) => reference.searchResult?.objectType === 'Loan' && reference.searchResult.objectId === 'L',
    })
    expect(result.references.map((reference) => reference.ledgerIndex)).toEqual([104, 102])
  })

  it('can return exact references oldest first', async () => {
    const f = await fixture(); const r = await HistoryExactIndexReader.open(f)
    const result = await r.find(TERM, {
      limit: 2,
      referenceKinds: ['object_change'],
      referencePredicate: (reference) => reference.searchResult?.objectType === 'Loan' && reference.searchResult.objectId === 'L',
      direction: 'asc',
    })
    expect(result.references.map((reference) => reference.ledgerIndex)).toEqual([102, 104])
  })

  it('fails closed on asset corruption', async () => { const f = await fixture(); const path = f.manifest.assets[f.bucket]!.path; const bytes = new Uint8Array(f.store.values.get(path)!); bytes[0] = bytes[0]! ^ 1; f.store.values.set(path, bytes); const r = await HistoryExactIndexReader.open(f); await expect(r.find(TERM)).rejects.toThrow('digest mismatch') })
  it('rejects publication identity mismatch', async () => { const f = await fixture(); await expect(HistoryExactIndexReader.open({ store: f.store, manifest: f.manifest, publication: { ...f.publication, chainId: 'other' } })).rejects.toThrow('does not match publication identity') })
})
