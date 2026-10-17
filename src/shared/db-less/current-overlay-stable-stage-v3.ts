/**
 * D5 isolated two-phase immutable candidate staging. This function may write
 * candidate assets only through explicitly supplied adapters, but has NO
 * channel/pointer mutation capability and is not invoked by production.
 * Required future activation must re-verify the D3 head and active channel at
 * commit time under a new owner authorization.
 */
import { sha256Hex } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'
import {
  readDbLessStableD4CheckpointV3,
  type DbLessStableD4CheckpointV3,
  type DbLessStableD4ReferencedReaderV3,
} from './current-overlay-stable-checkpoint-v3'
import { verifyDbLessStableD4PublicationPreflightV3 } from './current-overlay-stable-publication-preflight-v3'

type WriteImmutableV3 = (
  releaseTag: string,
  artifact: DbLessArtifact,
) => Promise<void>

export async function stageDbLessStableD4CandidateV3(options: {
  manifest: DbLessStableD4CheckpointV3
  manifestArtifact: DbLessArtifact
  stagedReleaseTag: string
  uploadArtifacts: readonly DbLessArtifact[]
  readArtifact: DbLessStableD4ReferencedReaderV3
  writeImmutable: WriteImmutableV3
  expectedD3ThroughLedgerIndex: number
  expectedD3ThroughLedgerHash: string
  expectedStateSha256: string
}): Promise<{
  stagedReleaseTag: string
  writtenShardAssets: number
  preexistingVerifiedShardAssets: number
  verifiedOldReleaseAssets: number
  manifestUploaded: boolean
  stateSha256: string
  sourceThroughLedgerIndex: number
  publicationMutation: false
  channelActivationPerformed: false
}> {
  const dryRun = await verifyDbLessStableD4PublicationPreflightV3({
    manifest: options.manifest,
    manifestArtifact: options.manifestArtifact,
    stagedReleaseTag: options.stagedReleaseTag,
    uploadArtifacts: options.uploadArtifacts,
    readExisting: options.readArtifact,
    expectedD3ThroughLedgerIndex: options.expectedD3ThroughLedgerIndex,
    expectedD3ThroughLedgerHash: options.expectedD3ThroughLedgerHash,
    expectedStateSha256: options.expectedStateSha256,
  })
  const requireSha = async (
    tag: string, artifact: DbLessArtifact,
  ): Promise<boolean> => {
    const observed = await options.readArtifact(tag, artifact.key)
    if (!observed) return false
    if (observed.byteLength !== artifact.bytes.byteLength
      || await sha256Hex(observed) !== artifact.sha256) {
      throw new Error(`D4 v3 existing immutable candidate asset has mismatched bytes: ${artifact.key}`)
    }
    return true
  }

  let writtenShardAssets = 0
  let preexistingVerifiedShardAssets = 0
  for (const artifact of options.uploadArtifacts) {
    if (await requireSha(options.stagedReleaseTag, artifact)) {
      preexistingVerifiedShardAssets += 1
      continue
    }
    await options.writeImmutable(options.stagedReleaseTag, artifact)
    if (!await requireSha(options.stagedReleaseTag, artifact)) {
      throw new Error('D4 v3 candidate shard was not readable after immutable write')
    }
    writtenShardAssets += 1
  }

  // All old and newly-staged immutable Release shards MUST be readable before
  // manifest publication. A partial staging failure cannot expose a channel.
  const full = await readDbLessStableD4CheckpointV3({
    manifestBytes: options.manifestArtifact.bytes,
    manifestSha256: options.manifestArtifact.sha256,
    readArtifact: options.readArtifact,
  })
  if (full.manifest.stateSha256 !== dryRun.stateSha256
    || full.shardReads !== dryRun.referencedShards) {
    throw new Error('D4 v3 staged full-checkpoint readback mismatch')
  }
  let manifestUploaded = false
  if (!await requireSha(options.stagedReleaseTag, options.manifestArtifact)) {
    await options.writeImmutable(options.stagedReleaseTag, options.manifestArtifact)
    if (!await requireSha(options.stagedReleaseTag, options.manifestArtifact)) {
      throw new Error('D4 v3 candidate manifest was not readable after immutable write')
    }
    manifestUploaded = true
  }
  return {
    stagedReleaseTag: options.stagedReleaseTag,
    writtenShardAssets,
    preexistingVerifiedShardAssets,
    verifiedOldReleaseAssets: dryRun.oldAssets,
    manifestUploaded,
    stateSha256: full.manifest.stateSha256,
    sourceThroughLedgerIndex: full.manifest.throughLedgerIndex,
    publicationMutation: false,
    channelActivationPerformed: false,
  }
}
