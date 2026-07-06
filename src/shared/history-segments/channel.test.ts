import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import { historyExactIndexManifestDigest, type HistoryExactIndexManifest } from './exact-index'
import { openGithubHistorySegmentChain, type HistorySegmentChannel } from './channel'
import { historySegmentPublicationDigest, type HistorySegmentChainPublication } from './publication'

const H = (c: string) => c.repeat(64)
const COMMIT = 'b'.repeat(40)
function response(url: string, body: Uint8Array) { const r = new Response(body, { status: 200 }); Object.defineProperty(r, 'url', { value: url }); return r }
async function publication() {
  const p: HistorySegmentChainPublication = {
    schemaVersion: 1, network: 'devnet', epochId: 'e', chainId: 'chain', complete: true,
    startLedgerIndex: 101, startLedgerHash: H('B'), startParentHash: H('A'),
    endLedgerIndex: 105, endLedgerHash: H('C'), segmentCount: 1, ledgerCount: 5,
    sourceRevision: 'deadbeef', publishedAt: '2026-07-06T00:00:00.000Z',
    segments: [{ segmentId: 's', manifestPath: 'history/e/s/manifest.json', manifestSha256: H('a'), startLedgerIndex: 101, startLedgerHash: H('B'), startParentHash: H('A'), endLedgerIndex: 105, endLedgerHash: H('C'), ledgerCount: 5, previousSegmentId: null, previousSegmentEndHash: null, recordCounts: { ledgers: 5, protocol_events: 0, object_changes: 0, loan_lifecycle: 0, archived_objects: 0, balance_history: 0, current_projection_mutations: 0 } }],
    publicationSha256: H('a'),
  }
  p.publicationSha256 = await historySegmentPublicationDigest(p); return p
}
async function fixture(withIndex: boolean) {
  const p = await publication(); const pb = utf8(`${canonicalJson(p)}\n`)
  let exact: HistoryExactIndexManifest | null = null; let eb: Uint8Array | null = null
  if (withIndex) {
    exact = { schemaVersion: 2, network: 'devnet', epochId: p.epochId, chainId: p.chainId, publicationSha256: p.publicationSha256, bucketCount: 1, hashFunction: 'sha256-first-u32-mod-bucket-count', assets: [{ bucket: 0, path: 'history/index/0.gz', sha256: H('a'), compressedBytes: 1, recordCount: 0, firstTerm: null, lastTerm: null }], totalRecords: 0, sourceRevision: 'deadbeef', generatedAt: p.publishedAt, manifestSha256: H('a') }
    exact.manifestSha256 = await historyExactIndexManifestDigest(exact); eb = utf8(`${canonicalJson(exact)}\n`)
  }
  const channel: HistorySegmentChannel = { schemaVersion: 1, active: { dataCommitSha: COMMIT, publicationPath: 'history/publication.json', publicationSha256: await sha256Hex(pb), chainId: p.chainId, epochId: p.epochId, exactIndex: eb ? { manifestPath: 'history/index/manifest.json', manifestSha256: await sha256Hex(eb) } : null }, updatedAt: p.publishedAt }
  return { p, pb, exact, eb, cb: utf8(`${canonicalJson(channel)}\n`) }
}

describe('history exact-commit channel', () => {
  it('opens publication from the pinned commit', async () => { const f = await fixture(false); const seen: string[] = []; const fetcher: typeof fetch = async (input) => { const u = String(input); seen.push(u); return response(u, u.includes('history-data/history-channel.json') ? f.cb : f.pb) }; const opened = await openGithubHistorySegmentChain({ githubRepository: 'o/r', githubBranch: 'history-data', fetcher }); expect(opened.exactIndex).toBeNull(); expect(seen[1]).toContain(`/${COMMIT}/history/publication.json`) })
  it('opens exact index manifest from the same pinned commit', async () => { const f = await fixture(true); const seen: string[] = []; const fetcher: typeof fetch = async (input) => { const u = String(input); seen.push(u); return response(u, u.includes('history-data/history-channel.json') ? f.cb : u.endsWith('publication.json') ? f.pb : f.eb!) }; const opened = await openGithubHistorySegmentChain({ githubRepository: 'o/r', githubBranch: 'history-data', fetcher }); expect(opened.exactIndex?.manifest.schemaVersion).toBe(2); expect(seen[2]).toContain(`/${COMMIT}/history/index/manifest.json`) })
  it('rejects publication byte mismatch', async () => { const f = await fixture(false); const bad = JSON.parse(new TextDecoder().decode(f.cb)); bad.active.publicationSha256 = H('a'); const cb = utf8(`${canonicalJson(bad)}\n`); const fetcher: typeof fetch = async (input) => { const u = String(input); return response(u, u.includes('history-channel.json') ? cb : f.pb) }; await expect(openGithubHistorySegmentChain({ githubRepository: 'o/r', githubBranch: 'history-data', fetcher })).rejects.toThrow('publication digest mismatch') })
})
