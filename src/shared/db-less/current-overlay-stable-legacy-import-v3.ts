/**
 * Isolated D5: turn an independently authenticated and fully read v2 D4
 * checkpoint into a v3 immutable-shard candidate WITHOUT publication.
 * The caller MUST verify the D4 Release/channel pointer and each old shard
 * using DbLessCurrentOverlayReader.readAll() before passing these entries.
 */
import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import type {
  DbLessCurrentOverlayCheckpointManifestV2,
  DbLessCurrentOverlayEntryV1,
} from './current-overlay-checkpoint'
import { compareDbLessCurrentProjectionCanonicalKeys } from './current-projection-identity'
import {
  prepareDbLessStableD4CheckpointV3,
  readDbLessStableD4CheckpointV3,
  type DbLessStableD4ReferencedReaderV3,
} from './current-overlay-stable-checkpoint-v3'

const SHA = /^[a-f0-9]{64}$/
const LEDGER_HASH = /^[A-F0-9]{64}$/

export async function prepareDbLessStableD4FromVerifiedV2(options: {
  manifest: DbLessCurrentOverlayCheckpointManifestV2
  entries: readonly DbLessCurrentOverlayEntryV1[]
  expectedStateSha256: string
}): Promise<{
  candidate: Awaited<ReturnType<typeof prepareDbLessStableD4CheckpointV3>>
  readbackStateSha256: string
  exactStateMatch: true
}> {
  const { manifest, entries } = options
  if (manifest.schemaVersion !== 2 || manifest.network !== 'devnet'
    || !manifest.epochId || !manifest.baseIdentity
    || !Number.isSafeInteger(manifest.throughLedgerIndex)
    || manifest.throughLedgerIndex < 1
    || !LEDGER_HASH.test(manifest.throughLedgerHash)
    || manifest.bucketCount < 1 || manifest.bucketCount > 256
    || !Number.isSafeInteger(manifest.bucketCount)
    || !SHA.test(options.expectedStateSha256)
    || manifest.entryCount !== entries.length
    || manifest.tombstoneCount !== entries.filter(e => e.isTombstone).length
    || manifest.generationCount !== manifest.sourceGenerationProvenance?.generationCount
  ) {
    throw new Error('D4 v2 to v3 import source manifest/entry identity mismatch')
  }
  const bucketIds = new Set<number>()
  const assetKeys = new Set<string>()
  let referencedRecords = 0
  if (!Array.isArray(manifest.shards) || manifest.shards.length > manifest.bucketCount) {
    throw new Error('D4 v2 to v3 import shard catalog is invalid')
  }
  for (const shard of manifest.shards) {
    if (!Number.isSafeInteger(shard.bucket) || shard.bucket < 0
      || shard.bucket >= manifest.bucketCount || bucketIds.has(shard.bucket)
      || !shard.key || assetKeys.has(shard.key)
      || !Number.isSafeInteger(shard.records) || shard.records < 1
      || !Number.isSafeInteger(shard.bytes) || shard.bytes < 1
      || !SHA.test(shard.artifactSha256)) {
      throw new Error('D4 v2 to v3 import referenced shard catalog is malformed')
    }
    referencedRecords += shard.records
    bucketIds.add(shard.bucket)
    assetKeys.add(shard.key)
  }
  if (referencedRecords !== entries.length) {
    throw new Error('D4 v2 to v3 import referenced shard record count mismatch')
  }
  const ordered = [...entries].sort((a, b) =>
    compareDbLessCurrentProjectionCanonicalKeys(a.canonicalKey, b.canonicalKey))
  const sourceSha = await sha256Hex(`${canonicalJson(ordered)}\n`)
  if (sourceSha !== options.expectedStateSha256) {
    throw new Error('D4 v2 to v3 import full source state SHA mismatch')
  }
  const candidate = await prepareDbLessStableD4CheckpointV3({
    epochId: manifest.epochId,
    baseIdentity: manifest.baseIdentity,
    throughLedgerIndex: manifest.throughLedgerIndex,
    throughLedgerHash: manifest.throughLedgerHash,
    generationProvenance: manifest.sourceGenerationProvenance,
    bucketCount: manifest.bucketCount,
    entries,
  })
  if (candidate.manifest.stateSha256 !== sourceSha
    || candidate.manifest.entryCount !== manifest.entryCount
    || candidate.manifest.tombstoneCount !== manifest.tombstoneCount) {
    throw new Error('D4 v2 to v3 import candidate changed source state')
  }
  const assets = new Map(candidate.uploadArtifacts.map(a => [a.key, a.bytes]))
  const reader: DbLessStableD4ReferencedReaderV3 = async (releaseTag, key) =>
    releaseTag === `d5-stable-d4-v3-${manifest.throughLedgerIndex}`
      ? assets.get(key) ?? null
      : null
  const readback = await readDbLessStableD4CheckpointV3({
    manifestBytes: candidate.manifestArtifact.bytes,
    manifestSha256: candidate.manifestArtifact.sha256,
    readArtifact: reader,
  })
  if (readback.manifest.stateSha256 !== sourceSha
    || readback.entries.length !== entries.length) {
    throw new Error('D4 v2 to v3 import SHA-bound round-trip failed')
  }
  return { candidate, readbackStateSha256: sourceSha, exactStateMatch: true }
}
