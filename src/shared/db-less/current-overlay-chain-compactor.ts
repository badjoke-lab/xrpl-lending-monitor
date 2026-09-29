import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import { verifyDbLessChannel, type DbLessChannelV1, type DbLessLivePointerV1 } from './channel'
import {
  buildDbLessCurrentOverlayCheckpoint,
  type DbLessCurrentOverlayCheckpointManifestV1,
  type DbLessCurrentOverlayCheckpointV1,
  type DbLessCurrentOverlayEntryV1,
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

export interface DbLessCurrentOverlayProgressV1 {
  phase: 'verify-chain' | 'read-chain-manifests' | 'read-generations'
  completed: number
  total: number | null
}

export async function readDbLessCurrentOverlaySourceFromChannel(options: {
  channel: DbLessChannelV1
  readChainArtifact: DbLessLiveChainArtifactReader
  readLocatedArtifact: DbLessLocatedArtifactReader
  maxGenerations?: number
  onProgress?: (progress: DbLessCurrentOverlayProgressV1) => void
}): Promise<DbLessCurrentOverlaySourceV1> {
  await verifyDbLessChannel(options.channel)
  if (options.channel.live === null) {
    throw new Error('D4 Current overlay compaction requires a live chain')
  }

  options.onProgress?.({ phase: 'verify-chain', completed: 0, total: null })
  const verification = await verifyDbLessLiveChainFromChannel({
    channel: options.channel,
    readArtifact: options.readChainArtifact,
    maxGenerations: options.maxGenerations,
  })
  if (!verification) throw new Error('D4 Current overlay compaction requires a verified live chain')
  options.onProgress?.({
    phase: 'verify-chain',
    completed: verification.generationCount,
    total: verification.generationCount,
  })

  const reverse: DbLessLiveChainManifestV1[] = []
  let pointer: DbLessLivePointerV1 = options.channel.live
  for (;;) {
    const manifest = await readVerifiedChainManifest({
      pointer,
      readArtifact: options.readChainArtifact,
    })
    reverse.push(manifest)
    if (reverse.length === 1 || reverse.length % 25 === 0) {
      options.onProgress?.({
        phase: 'read-chain-manifests',
        completed: reverse.length,
        total: verification.generationCount,
      })
    }
    if (manifest.previous === null) break
    pointer = manifest.previous
  }

  if (
    reverse.length !== verification.generationCount
    || reverse.length !== verification.traversedManifests
  ) {
    throw new Error('D4 Current overlay traversal count does not match live-chain verification')
  }

  options.onProgress?.({
    phase: 'read-chain-manifests',
    completed: reverse.length,
    total: verification.generationCount,
  })

  const manifests = reverse.reverse()
  const generations: DbLessCurrentOverlayGenerationV1[] = []
  for (const manifest of manifests) {
    generations.push(await readDbLessCurrentOverlayGeneration({
      delta: manifest.delta,
      readArtifact: options.readLocatedArtifact,
    }))
    if (generations.length === 1 || generations.length % 25 === 0) {
      options.onProgress?.({
        phase: 'read-generations',
        completed: generations.length,
        total: manifests.length,
      })
    }
  }
  options.onProgress?.({
    phase: 'read-generations',
    completed: generations.length,
    total: manifests.length,
  })

  return { verification, generations }
}

export interface DbLessCurrentOverlayIncrementalSourceV1 {
  generations: DbLessCurrentOverlayGenerationV1[]
  traversedManifests: number
  fromLedgerIndex: number
  toLedgerIndex: number
}

export async function readDbLessCurrentOverlaySourceAfterCheckpoint(options: {
  channel: DbLessChannelV1
  checkpoint: DbLessCurrentOverlayCheckpointManifestV1
  readChainArtifact: DbLessLiveChainArtifactReader
  readLocatedArtifact: DbLessLocatedArtifactReader
  maxNewGenerations?: number
  onProgress?: (progress: DbLessCurrentOverlayProgressV1) => void
}): Promise<DbLessCurrentOverlayIncrementalSourceV1> {
  await verifyDbLessChannel(options.channel)

  const maxNewGenerations = options.maxNewGenerations ?? 2_048
  if (!Number.isSafeInteger(maxNewGenerations) || maxNewGenerations < 1) {
    throw new Error('maxNewGenerations must be a positive safe integer')
  }

  if (
    options.checkpoint.epochId !== options.channel.epochId
    || options.checkpoint.baseIdentity !== options.channel.base.generationId
  ) {
    throw new Error('D4 active checkpoint does not match the D3 channel base context')
  }
  if (options.checkpoint.throughLedgerIndex > options.channel.lastCommittedLedgerIndex) {
    throw new Error('D4 active checkpoint is newer than the D3 channel')
  }
  if (options.checkpoint.throughLedgerIndex === options.channel.lastCommittedLedgerIndex) {
    if (options.checkpoint.throughLedgerHash !== options.channel.lastCommittedLedgerHash) {
      throw new Error('D4 active checkpoint head hash does not match the D3 channel')
    }
    return {
      generations: [],
      traversedManifests: 0,
      fromLedgerIndex: options.checkpoint.throughLedgerIndex,
      toLedgerIndex: options.channel.lastCommittedLedgerIndex,
    }
  }
  if (options.channel.live === null) {
    throw new Error('D4 incremental compaction requires a live D3 chain')
  }

  const seen = new Set<string>()
  const reverse: DbLessLiveChainManifestV1[] = []
  let pointer: DbLessLivePointerV1 = options.channel.live

  for (;;) {
    if (pointer.endLedgerIndex === options.checkpoint.throughLedgerIndex) {
      if (pointer.endLedgerHash !== options.checkpoint.throughLedgerHash) {
        throw new Error('D4 incremental boundary hash does not match the active checkpoint')
      }
      break
    }
    if (pointer.endLedgerIndex < options.checkpoint.throughLedgerIndex) {
      throw new Error('D4 active checkpoint is not an ancestor of the D3 live head')
    }

    const identity = `${canonicalJson(pointer.location)}|${pointer.generationId}|${pointer.manifestKey}`
    if (seen.has(identity)) {
      throw new Error('D4 incremental live-chain cycle detected')
    }
    seen.add(identity)

    const manifest = await readVerifiedChainManifest({
      pointer,
      readArtifact: options.readChainArtifact,
    })
    if (
      manifest.epochId !== options.channel.epochId
      || manifest.baseIdentity !== options.channel.base.generationId
      || manifest.baseLedgerIndex !== options.channel.base.ledgerIndex
      || manifest.baseLedgerHash !== options.channel.base.ledgerHash
    ) {
      throw new Error('D4 incremental live generation changed base context')
    }

    reverse.push(manifest)
    if (reverse.length > maxNewGenerations) {
      throw new Error('D4 incremental compaction exceeds the new-generation bound')
    }
    if (reverse.length === 1 || reverse.length % 25 === 0) {
      options.onProgress?.({
        phase: 'read-chain-manifests',
        completed: reverse.length,
        total: null,
      })
    }

    if (manifest.previous === null) {
      throw new Error('D4 incremental traversal reached the base before the active checkpoint')
    }
    pointer = manifest.previous
  }

  options.onProgress?.({
    phase: 'read-chain-manifests',
    completed: reverse.length,
    total: reverse.length,
  })

  const manifests = reverse.reverse()
  const first = manifests[0]
  if (
    !first
    || first.delta.previousLedgerIndex !== options.checkpoint.throughLedgerIndex
    || first.delta.expectedParentHash !== options.checkpoint.throughLedgerHash
    || first.delta.startLedgerIndex !== options.checkpoint.throughLedgerIndex + 1
  ) {
    throw new Error('D4 incremental generation does not continue the active checkpoint')
  }

  const head = manifests.at(-1)!
  if (
    head.endLedgerIndex !== options.channel.lastCommittedLedgerIndex
    || head.endLedgerHash !== options.channel.lastCommittedLedgerHash
  ) {
    throw new Error('D4 incremental head does not match the D3 channel')
  }

  const generations: DbLessCurrentOverlayGenerationV1[] = []
  for (const manifest of manifests) {
    generations.push(await readDbLessCurrentOverlayGeneration({
      delta: manifest.delta,
      readArtifact: options.readLocatedArtifact,
    }))
    if (generations.length === 1 || generations.length % 25 === 0) {
      options.onProgress?.({
        phase: 'read-generations',
        completed: generations.length,
        total: manifests.length,
      })
    }
  }
  options.onProgress?.({
    phase: 'read-generations',
    completed: generations.length,
    total: manifests.length,
  })

  return {
    generations,
    traversedManifests: manifests.length,
    fromLedgerIndex: options.checkpoint.throughLedgerIndex,
    toLedgerIndex: options.channel.lastCommittedLedgerIndex,
  }
}

export async function buildDbLessCurrentOverlayCheckpointIncrementally(options: {
  channel: DbLessChannelV1
  seedManifest: DbLessCurrentOverlayCheckpointManifestV1
  seedEntries: readonly DbLessCurrentOverlayEntryV1[]
  readChainArtifact: DbLessLiveChainArtifactReader
  readLocatedArtifact: DbLessLocatedArtifactReader
  maxNewGenerations?: number
  bucketCount?: number
  maxRecordsPerShard?: number
  maxBytesPerShard?: number
  onProgress?: (progress: DbLessCurrentOverlayProgressV1) => void
}): Promise<DbLessCurrentOverlayCheckpointV1 | null> {
  const source = await readDbLessCurrentOverlaySourceAfterCheckpoint({
    channel: options.channel,
    checkpoint: options.seedManifest,
    readChainArtifact: options.readChainArtifact,
    readLocatedArtifact: options.readLocatedArtifact,
    maxNewGenerations: options.maxNewGenerations,
    onProgress: options.onProgress,
  })
  if (source.generations.length === 0) return null

  return buildDbLessCurrentOverlayCheckpoint({
    epochId: options.channel.epochId,
    baseIdentity: options.channel.base.generationId,
    throughLedgerIndex: options.channel.lastCommittedLedgerIndex,
    throughLedgerHash: options.channel.lastCommittedLedgerHash,
    generations: source.generations,
    seed: {
      manifest: options.seedManifest,
      entries: options.seedEntries,
    },
    bucketCount: options.bucketCount,
    maxRecordsPerShard: options.maxRecordsPerShard,
    maxBytesPerShard: options.maxBytesPerShard,
  })
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
