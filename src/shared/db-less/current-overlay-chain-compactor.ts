import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import { verifyDbLessChannel, type DbLessChannelV1, type DbLessLivePointerV1 } from './channel'
import {
  buildDbLessCurrentOverlayCheckpoint,
  type DbLessCurrentOverlayCheckpointV1,
  type DbLessCurrentOverlayGenerationV1,
} from './current-overlay-checkpoint'
import {
  readDbLessCurrentOverlayGeneration,
  type DbLessLocatedArtifactReader,
} from './current-overlay-generation-reader'
import {
  verifyDbLessLiveChainManifest,
  type DbLessLiveChainManifestV1,
} from './live-chain'
import {
  verifyDbLessLiveChainFromChannel,
  type DbLessLiveChainArtifactReader,
  type DbLessLiveChainVerificationSummary,
} from './live-chain-reader'

function sameLocation(
  left: DbLessLivePointerV1['location'],
  right: DbLessLivePointerV1['location'],
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

async function readVerifiedChainManifest(options: {
  pointer: DbLessLivePointerV1
  readArtifact: DbLessLiveChainArtifactReader
}): Promise<DbLessLiveChainManifestV1> {
  const bytes = await options.readArtifact(options.pointer)
  if (!bytes) throw new Error(`Missing live chain artifact: ${options.pointer.manifestKey}`)
  if (await sha256Hex(bytes) !== options.pointer.manifestSha256) {
    throw new Error('Live chain artifact SHA-256 does not match its pointer')
  }

  let manifest: DbLessLiveChainManifestV1
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes)) as DbLessLiveChainManifestV1
  } catch {
    throw new Error('Live chain artifact is not valid JSON')
  }
  await verifyDbLessLiveChainManifest(manifest)

  if (
    !sameLocation(options.pointer.location, manifest.publicationLocation)
    || options.pointer.generationId !== manifest.generationId
    || options.pointer.manifestKey !== `${manifest.generationId}-manifest.json`
    || options.pointer.payloadDigest !== manifest.chainDigest
    || options.pointer.startLedgerIndex !== manifest.startLedgerIndex
    || options.pointer.startLedgerHash !== manifest.startLedgerHash
    || options.pointer.startParentHash !== manifest.startParentHash
    || options.pointer.endLedgerIndex !== manifest.endLedgerIndex
    || options.pointer.endLedgerHash !== manifest.endLedgerHash
  ) {
    throw new Error('Live chain manifest does not match its pointer')
  }
  return manifest
}

export interface DbLessCurrentOverlaySourceV1 {
  verification: DbLessLiveChainVerificationSummary
  generations: DbLessCurrentOverlayGenerationV1[]
}

export async function readDbLessCurrentOverlaySourceFromChannel(options: {
  channel: DbLessChannelV1
  readChainArtifact: DbLessLiveChainArtifactReader
  readLocatedArtifact: DbLessLocatedArtifactReader
  maxGenerations?: number
}): Promise<DbLessCurrentOverlaySourceV1> {
  await verifyDbLessChannel(options.channel)
  if (options.channel.live === null) {
    throw new Error('D4 Current overlay compaction requires a live chain')
  }

  const verification = await verifyDbLessLiveChainFromChannel({
    channel: options.channel,
    readArtifact: options.readChainArtifact,
    maxGenerations: options.maxGenerations,
  })
  if (!verification) throw new Error('D4 Current overlay compaction requires a verified live chain')

  const reverse: DbLessLiveChainManifestV1[] = []
  let pointer: DbLessLivePointerV1 = options.channel.live
  for (;;) {
    const manifest = await readVerifiedChainManifest({
      pointer,
      readArtifact: options.readChainArtifact,
    })
    reverse.push(manifest)
    if (manifest.previous === null) break
    pointer = manifest.previous
  }

  if (
    reverse.length !== verification.generationCount
    || reverse.length !== verification.traversedManifests
  ) {
    throw new Error('D4 Current overlay traversal count does not match live-chain verification')
  }

  const manifests = reverse.reverse()
  const generations: DbLessCurrentOverlayGenerationV1[] = []
  for (const manifest of manifests) {
    generations.push(await readDbLessCurrentOverlayGeneration({
      delta: manifest.delta,
      readArtifact: options.readLocatedArtifact,
    }))
  }

  return { verification, generations }
}

export async function buildDbLessCurrentOverlayCheckpointFromChannel(options: {
  channel: DbLessChannelV1
  readChainArtifact: DbLessLiveChainArtifactReader
  readLocatedArtifact: DbLessLocatedArtifactReader
  maxGenerations?: number
  bucketCount?: number
  maxRecordsPerShard?: number
  maxBytesPerShard?: number
}): Promise<DbLessCurrentOverlayCheckpointV1> {
  const source = await readDbLessCurrentOverlaySourceFromChannel(options)

  return buildDbLessCurrentOverlayCheckpoint({
    epochId: options.channel.epochId,
    baseIdentity: options.channel.base.generationId,
    throughLedgerIndex: options.channel.lastCommittedLedgerIndex,
    throughLedgerHash: options.channel.lastCommittedLedgerHash,
    generations: source.generations,
    bucketCount: options.bucketCount,
    maxRecordsPerShard: options.maxRecordsPerShard,
    maxBytesPerShard: options.maxBytesPerShard,
  })
}
