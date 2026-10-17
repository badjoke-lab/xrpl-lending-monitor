/**
 * D5 isolated cutover gate. All assets must be available from immutable
 * sources before a future publisher may activate a v3 checkpoint. No writes.
 * The caller must separately compare its expected D3 source identity and
 * active-channel revision at the actual publication transaction boundary.
 */
import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import {
  readDbLessStableD4CheckpointV3,
  type DbLessStableD4CheckpointV3,
  type DbLessStableD4ReferencedReaderV3,
} from './current-overlay-stable-checkpoint-v3'
import type { DbLessArtifact } from './live-delta'

const SHA = /^[a-f0-9]{64}$/

export async function verifyDbLessStableD4PublicationPreflightV3(options: {
  manifest: DbLessStableD4CheckpointV3
  manifestArtifact: DbLessArtifact
  stagedReleaseTag: string
  uploadArtifacts: readonly DbLessArtifact[]
  readExisting: DbLessStableD4ReferencedReaderV3
  expectedD3ThroughLedgerIndex: number
  expectedD3ThroughLedgerHash: string
  expectedStateSha256: string
  maxTotalCompressedBytes?: number
}): Promise<{
  schemaVersion: 1
  throughLedgerIndex: number
  referencedShards: number
  newAssets: number
  oldAssets: number
  totalReferencedBytes: number
  stateSha256: string
  retainedReleaseTags: string[]
  publicationMutation: false
  passed: true
}> {
  if (!Number.isSafeInteger(options.expectedD3ThroughLedgerIndex)
    || options.manifest.throughLedgerIndex !== options.expectedD3ThroughLedgerIndex
    || options.manifest.throughLedgerHash !== options.expectedD3ThroughLedgerHash
    || !SHA.test(options.expectedStateSha256)
    || options.manifest.stateSha256 !== options.expectedStateSha256) {
    throw new Error('D4 v3 cutover source ledger/state identity mismatch')
  }
  if (options.stagedReleaseTag !== `d5-stable-d4-v3-${options.manifest.throughLedgerIndex}`) {
    throw new Error('D4 v3 cutover staged Release tag mismatch')
  }
  const limit = options.maxTotalCompressedBytes ?? 64_000_000
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64_000_000) {
    throw new Error('D4 v3 cutover total compressed byte bound invalid')
  }
  const totalReferencedBytes = options.manifest.shards.reduce((sum, s) => sum + s.bytes, 0)
  if (totalReferencedBytes > limit) {
    throw new Error('D4 v3 cutover checkpoint exceeds total byte budget')
  }
  const staged = new Map(options.uploadArtifacts.map(a => [a.key,a]))
  if (staged.size !== options.uploadArtifacts.length) {
    throw new Error('D4 v3 cutover contains duplicate staged asset key')
  }
  for (const a of options.uploadArtifacts) {
    if (a.immutable !== true || a.mediaType !== 'application/gzip'
      || !SHA.test(a.sha256) || await sha256Hex(a.bytes) !== a.sha256) {
      throw new Error('D4 v3 cutover staged immutable asset digest is invalid')
    }
  }
  const needed = options.manifest.shards
    .filter(s => s.releaseTag === options.stagedReleaseTag)
  if (needed.length !== options.uploadArtifacts.length
    || needed.some(s => {
      const a = staged.get(s.key)
      return !a || a.sha256 !== s.sha256 || a.bytes.byteLength !== s.bytes
    })) {
    throw new Error('D4 v3 cutover staged assets do not match checkpoint references')
  }
  const readArtifact: DbLessStableD4ReferencedReaderV3 = async (tag,key) => {
    if (tag === options.stagedReleaseTag) return staged.get(key)?.bytes ?? null
    return options.readExisting(tag,key)
  }
  const replay = await readDbLessStableD4CheckpointV3({
    manifestBytes: options.manifestArtifact.bytes,
    manifestSha256: options.manifestArtifact.sha256,
    readArtifact,
  })
  if (canonicalJson(replay.manifest) !== canonicalJson(options.manifest)
    || replay.manifest.stateSha256 !== options.expectedStateSha256
    || replay.entries.length !== options.manifest.entryCount) {
    throw new Error('D4 v3 cutover replay state digest mismatch')
  }
  return {
    schemaVersion: 1,
    throughLedgerIndex: options.manifest.throughLedgerIndex,
    referencedShards: replay.shardReads,
    newAssets: needed.length,
    oldAssets: replay.shardReads - needed.length,
    totalReferencedBytes,
    stateSha256: replay.manifest.stateSha256,
    retainedReleaseTags: [...new Set(options.manifest.shards.map(s=>s.releaseTag))].sort(),
    publicationMutation: false,
    passed: true,
  }
}
