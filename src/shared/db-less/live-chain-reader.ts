import {
  verifyDbLessChannel,
  type DbLessChannelV1,
  type DbLessLivePointerV1,
} from './channel'
import {
  verifyDbLessLiveChainManifest,
  type DbLessLiveChainManifestV1,
} from './live-chain'
import { canonicalJson, sha256Hex } from '../current-state/canonical-json'

export type DbLessLiveChainArtifactReader = (
  pointer: DbLessLivePointerV1,
) => Promise<Uint8Array | null>

export interface DbLessLiveChainVerificationSummary {
  generationCount: number
  traversedManifests: number
  ledgerCount: number
  startLedgerIndex: number
  startLedgerHash: string
  startParentHash: string
  endLedgerIndex: number
  endLedgerHash: string
  headGenerationId: string
}

export interface DbLessLiveHeadVerificationSummary {
  generationCount: number
  traversedManifests: number
  ledgerCount: number
  startLedgerIndex: number
  startLedgerHash: string
  startParentHash: string
  endLedgerIndex: number
  endLedgerHash: string
  headGenerationId: string
  previousGenerationId: string | null
}

function sameLocation(left: DbLessLivePointerV1['location'], right: DbLessLivePointerV1['location']): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

async function decodeAndVerify(
  pointer: DbLessLivePointerV1,
  bytes: Uint8Array,
): Promise<DbLessLiveChainManifestV1> {
  if (await sha256Hex(bytes) !== pointer.manifestSha256) {
    throw new Error('Live chain artifact SHA-256 does not match its pointer')
  }

  let manifest: DbLessLiveChainManifestV1
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes)) as DbLessLiveChainManifestV1
  } catch {
    throw new Error('Live chain artifact is not valid JSON')
  }

  await verifyDbLessLiveChainManifest(manifest)

  if (!sameLocation(pointer.location, manifest.publicationLocation)) {
    throw new Error('Live chain artifact location does not match its pointer')
  }
  if (pointer.generationId !== manifest.generationId) {
    throw new Error('Live chain generation ID does not match its pointer')
  }
  if (pointer.manifestKey !== `${manifest.generationId}-manifest.json`) {
    throw new Error('Live chain manifest key does not match its pointer')
  }
  if (pointer.payloadDigest !== manifest.chainDigest) {
    throw new Error('Live chain digest does not match its pointer')
  }
  if (
    pointer.startLedgerIndex !== manifest.startLedgerIndex
    || pointer.startLedgerHash !== manifest.startLedgerHash
    || pointer.startParentHash !== manifest.startParentHash
    || pointer.endLedgerIndex !== manifest.endLedgerIndex
    || pointer.endLedgerHash !== manifest.endLedgerHash
  ) {
    throw new Error('Live chain ledger boundaries do not match its pointer')
  }

  return manifest
}

export async function verifyDbLessLiveChainFromChannel(options: {
  channel: DbLessChannelV1
  readArtifact: DbLessLiveChainArtifactReader
  maxGenerations?: number
}): Promise<DbLessLiveChainVerificationSummary | null> {
  await verifyDbLessChannel(options.channel)
  const maxGenerations = options.maxGenerations ?? 2_048
  if (!Number.isSafeInteger(maxGenerations) || maxGenerations < 1) {
    throw new Error('maxGenerations must be a positive safe integer')
  }

  if (options.channel.live === null) return null

  const seen = new Set<string>()
  let pointer: DbLessLivePointerV1 = options.channel.live
  let expectedGenerationCount: number | null = null
  let expectedLedgerCount: number | null = null
  let expectedContext: {
    epochId: string
    baseIdentity: string
    baseLedgerIndex: number
    baseLedgerHash: string
  } | null = null
  let head: DbLessLiveChainManifestV1 | null = null
  let traversed = 0

  for (;;) {
    const identity = `${canonicalJson(pointer.location)}|${pointer.generationId}|${pointer.manifestKey}`
    if (seen.has(identity)) throw new Error('Live chain previous-pointer cycle detected')
    seen.add(identity)

    const bytes = await options.readArtifact(pointer)
    if (!bytes) throw new Error(`Missing live chain artifact: ${pointer.manifestKey}`)
    const manifest = await decodeAndVerify(pointer, bytes)

    if (head === null) {
      head = manifest
      expectedContext = {
        epochId: manifest.epochId,
        baseIdentity: manifest.baseIdentity,
        baseLedgerIndex: manifest.baseLedgerIndex,
        baseLedgerHash: manifest.baseLedgerHash,
      }
      if (
        manifest.epochId !== options.channel.epochId
        || manifest.baseIdentity !== options.channel.base.generationId
        || manifest.baseLedgerIndex !== options.channel.base.ledgerIndex
        || manifest.baseLedgerHash !== options.channel.base.ledgerHash
      ) {
        throw new Error('Live chain head does not match the active channel base context')
      }
      if (manifest.generationCount > maxGenerations) {
        throw new Error('Live chain exceeds bounded verification generation limit')
      }
    } else {
      if (expectedGenerationCount === null || expectedLedgerCount === null) {
        throw new Error('Live chain traversal lost expected backlink counters')
      }
      if (
        manifest.epochId !== expectedContext!.epochId
        || manifest.baseIdentity !== expectedContext!.baseIdentity
        || manifest.baseLedgerIndex !== expectedContext!.baseLedgerIndex
        || manifest.baseLedgerHash !== expectedContext!.baseLedgerHash
      ) {
        throw new Error('Live chain previous generation changed base context')
      }
      if (manifest.generationCount !== expectedGenerationCount) {
        throw new Error('Live chain previous generationCount does not match its backlink')
      }
      if (manifest.ledgerCount !== expectedLedgerCount) {
        throw new Error('Live chain previous ledgerCount does not match its backlink')
      }
    }

    traversed += 1
    if (traversed > maxGenerations) {
      throw new Error('Live chain traversal exceeded bounded verification generation limit')
    }

    if (manifest.previous === null) {
      if (manifest.generationCount !== 1) {
        throw new Error('Terminal live chain generation must be generation 1')
      }
      if (!head) throw new Error('Live chain head was not captured')
      if (traversed !== head.generationCount) {
        throw new Error('Live chain traversed generation count does not match head')
      }
      if (
        head.startLedgerIndex !== options.channel.live.startLedgerIndex
        || head.startLedgerHash !== options.channel.live.startLedgerHash
        || head.startParentHash !== options.channel.live.startParentHash
        || head.endLedgerIndex !== options.channel.live.endLedgerIndex
        || head.endLedgerHash !== options.channel.live.endLedgerHash
      ) {
        throw new Error('Live chain head boundaries do not match active channel')
      }
      return {
        generationCount: head.generationCount,
        traversedManifests: traversed,
        ledgerCount: head.ledgerCount,
        startLedgerIndex: head.startLedgerIndex,
        startLedgerHash: head.startLedgerHash,
        startParentHash: head.startParentHash,
        endLedgerIndex: head.endLedgerIndex,
        endLedgerHash: head.endLedgerHash,
        headGenerationId: head.generationId,
      }
    }

    expectedGenerationCount = manifest.previous.generationCount
    expectedLedgerCount = manifest.previous.ledgerCount
    pointer = manifest.previous
  }
}

export async function verifyDbLessLiveChainHeadFromChannel(options: {
  channel: DbLessChannelV1
  readArtifact: DbLessLiveChainArtifactReader
}): Promise<DbLessLiveHeadVerificationSummary | null> {
  await verifyDbLessChannel(options.channel)
  if (options.channel.live === null) return null

  const headBytes = await options.readArtifact(options.channel.live)
  if (!headBytes) throw new Error(`Missing live chain artifact: ${options.channel.live.manifestKey}`)
  const head = await decodeAndVerify(options.channel.live, headBytes)

  if (
    head.epochId !== options.channel.epochId
    || head.baseIdentity !== options.channel.base.generationId
    || head.baseLedgerIndex !== options.channel.base.ledgerIndex
    || head.baseLedgerHash !== options.channel.base.ledgerHash
  ) {
    throw new Error('Live chain head does not match the active channel base context')
  }

  let traversedManifests = 1
  let previousGenerationId: string | null = null

  if (head.previous !== null) {
    const previousBytes = await options.readArtifact(head.previous)
    if (!previousBytes) {
      throw new Error(`Missing live chain artifact: ${head.previous.manifestKey}`)
    }
    const previous = await decodeAndVerify(head.previous, previousBytes)
    traversedManifests += 1
    previousGenerationId = previous.generationId

    if (
      previous.epochId !== head.epochId
      || previous.baseIdentity !== head.baseIdentity
      || previous.baseLedgerIndex !== head.baseLedgerIndex
      || previous.baseLedgerHash !== head.baseLedgerHash
    ) {
      throw new Error('Live chain predecessor changed base context')
    }
    if (previous.generationCount !== head.previous.generationCount) {
      throw new Error('Live chain predecessor generationCount does not match its backlink')
    }
    if (previous.ledgerCount !== head.previous.ledgerCount) {
      throw new Error('Live chain predecessor ledgerCount does not match its backlink')
    }
  }

  return {
    generationCount: head.generationCount,
    traversedManifests,
    ledgerCount: head.ledgerCount,
    startLedgerIndex: head.startLedgerIndex,
    startLedgerHash: head.startLedgerHash,
    startParentHash: head.startParentHash,
    endLedgerIndex: head.endLedgerIndex,
    endLedgerHash: head.endLedgerHash,
    headGenerationId: head.generationId,
    previousGenerationId,
  }
}

