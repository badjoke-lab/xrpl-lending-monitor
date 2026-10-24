import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import type { NormalizedPayloadChunkLimits } from '../portable-collector-payload'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import {
  buildDbLessChannel,
  encodeDbLessChannel,
  verifyDbLessChannel,
  type DbLessArtifactLocationV1,
  type DbLessChannelV1,
  type DbLessCurrentProjectionTailIndexV1,
  type DbLessCurrentProjectionTailGenerationV1,
  type DbLessHistoryCoverageRangeV1,
} from './channel'
import {
  buildDbLessLiveChainArtifacts,
  verifyDbLessLiveChainManifest,
  type DbLessLiveChainManifestV1,
  type DbLessLiveChainArtifactSet,
} from './live-chain'
import {
  buildDbLessLiveDeltaArtifacts,
  type DbLessArtifact,
  type DbLessLiveDeltaArtifactSet,
} from './live-delta'
import {
  buildDbLessCurrentOnlyArtifactV1,
  type DbLessCurrentOnlyAssetSetV1,
} from './current-only-artifact'

export const DB_LESS_CURRENT_PROJECTION_TAIL_MAX_GENERATIONS = 128

export interface DbLessPreparedLivePublication {
  status: 'prepared'
  delta: DbLessLiveDeltaArtifactSet
  chain: DbLessLiveChainArtifactSet
  immutableArtifacts: DbLessArtifact[]
  nextChannel: DbLessChannelV1
  nextChannelBytes: Uint8Array
}

export interface DbLessCaughtUpLivePublication {
  status: 'caught-up'
  channel: DbLessChannelV1
}

export type DbLessLivePublicationPlan =
  | DbLessPreparedLivePublication
  | DbLessCaughtUpLivePublication

export interface DbLessPreparedLiveDelta {
  status: 'delta-prepared'
  channel: DbLessChannelV1
  previousChain: DbLessLiveChainManifestV1 | null
  delta: DbLessLiveDeltaArtifactSet
  currentOnlyAsset?: DbLessCurrentOnlyAssetSetV1 | null
  finalLedgerIndex: number
  finalLedgerHash: string
  immutableArtifactCountBeforeChain: number
}

export type DbLessLiveDeltaPreparation =
  | DbLessPreparedLiveDelta
  | DbLessCaughtUpLivePublication

async function assertPreviousChainMatchesChannel(options: {
  channel: DbLessChannelV1
  previousChain: DbLessLiveChainManifestV1 | null | undefined
}): Promise<void> {
  const { channel, previousChain } = options
  if (channel.live === null) {
    if (previousChain !== null && previousChain !== undefined) {
      throw new Error('Channel without live data must not supply a previous live chain')
    }
    return
  }

  if (!previousChain) {
    throw new Error('Channel with live data requires its previous live chain manifest')
  }
  await verifyDbLessLiveChainManifest(previousChain)

  const bytes = utf8(`${canonicalJson(previousChain)}\n`)
  const manifestSha256 = await sha256Hex(bytes)
  const expectedManifestKey = `${previousChain.generationId}-manifest.json`

  if (
    canonicalJson(channel.live.location) !== canonicalJson(previousChain.publicationLocation)
    || channel.live.generationId !== previousChain.generationId
    || channel.live.manifestKey !== expectedManifestKey
    || channel.live.manifestSha256 !== manifestSha256
    || channel.live.payloadDigest !== previousChain.chainDigest
    || channel.live.startLedgerIndex !== previousChain.startLedgerIndex
    || channel.live.startLedgerHash !== previousChain.startLedgerHash
    || channel.live.startParentHash !== previousChain.startParentHash
    || channel.live.endLedgerIndex !== previousChain.endLedgerIndex
    || channel.live.endLedgerHash !== previousChain.endLedgerHash
  ) {
    throw new Error('Previous live chain manifest does not match the active channel pointer')
  }
}

function nextCurrentProjectionTail(options: {
  prepared: DbLessPreparedLiveDelta
  publicationLocation: DbLessArtifactLocationV1
}): DbLessCurrentProjectionTailIndexV1 {
  const previous = options.prepared.channel.currentProjectionTail ?? {
    schemaVersion: 1 as const,
    coverageStartLedgerIndex: options.prepared.channel.lastCommittedLedgerIndex,
    coverageStartLedgerHash: options.prepared.channel.lastCommittedLedgerHash,
    generations: [],
  }
  let coverageStartLedgerIndex = previous.coverageStartLedgerIndex
  let coverageStartLedgerHash = previous.coverageStartLedgerHash
  let generations: DbLessCurrentProjectionTailGenerationV1[] = [
    ...previous.generations,
  ]

  const mutations = options.prepared.delta.manifest.semanticCounts.currentProjectionMutations
  if (mutations > 0) {
    const manifest = options.prepared.delta.manifest
    const artifact = options.prepared.delta.manifestArtifact
    generations.push({
      location: options.publicationLocation,
      generationId: manifest.generationId,
      manifestKey: artifact.key,
      manifestSha256: artifact.sha256,
      payloadDigest: manifest.payloadDigest,
      previousLedgerIndex: manifest.previousLedgerIndex,
      expectedParentHash: manifest.expectedParentHash,
      startLedgerIndex: manifest.startLedgerIndex,
      startLedgerHash: manifest.startLedgerHash,
      endLedgerIndex: manifest.endLedgerIndex,
      endLedgerHash: manifest.endLedgerHash,
      ledgerCount: manifest.ledgerCount,
      currentProjectionMutations: mutations,
      ...(options.prepared.currentOnlyAsset
        ? { currentOnly: {
            key: options.prepared.currentOnlyAsset.artifact.key,
            sha256: options.prepared.currentOnlyAsset.artifact.sha256,
            bytes: options.prepared.currentOnlyAsset.artifact.bytes.byteLength,
            sourceDeltaManifestSha256: artifact.sha256,
          } }
        : {}),
    })
  }

  if (generations.length > DB_LESS_CURRENT_PROJECTION_TAIL_MAX_GENERATIONS) {
    generations = generations.slice(-DB_LESS_CURRENT_PROJECTION_TAIL_MAX_GENERATIONS)
    const first = generations[0]!
    coverageStartLedgerIndex = first.previousLedgerIndex
    coverageStartLedgerHash = first.expectedParentHash
  }

  return {
    schemaVersion: 1,
    coverageStartLedgerIndex,
    coverageStartLedgerHash,
    generations,
  }
}

function nextHistoryCoverage(options: {
  channel: DbLessChannelV1
  chain: DbLessLiveChainArtifactSet
}): DbLessHistoryCoverageRangeV1[] {
  const rangeId = `live:${options.channel.base.generationId}`

  const replacement: DbLessHistoryCoverageRangeV1 = {
    rangeId,
    source: 'live',
    epochId: options.channel.epochId,
    location: options.chain.channelPointer.location,
    manifestKey: options.chain.manifestArtifact.key,
    manifestSha256: options.chain.manifestArtifact.sha256,
    exactIndex: null,
    startLedgerIndex: options.chain.manifest.startLedgerIndex,
    startLedgerHash: options.chain.manifest.startLedgerHash,
    endLedgerIndex: options.chain.manifest.endLedgerIndex,
    endLedgerHash: options.chain.manifest.endLedgerHash,
  }

  const retained = options.channel.historyCoverage.filter((range) => range.rangeId !== rangeId)
  return [...retained, replacement].sort((left, right) => (
    left.epochId.localeCompare(right.epochId)
    || left.startLedgerIndex - right.startLedgerIndex
    || left.rangeId.localeCompare(right.rangeId)
  ))
}

export async function prepareDbLessLiveDelta(options: {
  channel: DbLessChannelV1
  previousChain?: DbLessLiveChainManifestV1 | null
  scan: IncrementalScanResult
  sourceRevision: string
  chunkLimits?: NormalizedPayloadChunkLimits
  /** Isolated opt-in; false for all existing D3 callers and production runs. */
  enableCurrentOnlyArtifact?: boolean
}): Promise<DbLessLiveDeltaPreparation> {
  await verifyDbLessChannel(options.channel)
  await assertPreviousChainMatchesChannel({
    channel: options.channel,
    previousChain: options.previousChain,
  })

  const expectedStart = options.channel.lastCommittedLedgerIndex + 1
  if (options.scan.startLedgerIndex !== expectedStart) {
    throw new Error('Incremental scan does not start immediately after the committed channel head')
  }

  if (options.scan.ledgers.length === 0) {
    if (options.scan.startLedgerIndex > options.scan.latestValidatedLedger) {
      return { status: 'caught-up', channel: options.channel }
    }
    throw new Error('Incremental scan made no progress while validated work remains')
  }

  const first = options.scan.ledgers[0]
  const last = options.scan.ledgers.at(-1)
  if (!first || !last || options.scan.endLedgerIndex === null) {
    throw new Error('Non-empty incremental scan is missing ledger boundaries')
  }
  if (first.ledgerIndex !== expectedStart) {
    throw new Error('Incremental scan first ledger does not match the committed channel head + 1')
  }
  if (first.parentHash !== options.channel.lastCommittedLedgerHash) {
    throw new Error('Incremental scan first parent hash does not match the committed channel hash')
  }

  const baseIdentity = options.channel.base.generationId
  const delta = await buildDbLessLiveDeltaArtifacts({
    scan: options.scan,
    epochId: options.channel.epochId,
    baseIdentity,
    previousLedgerIndex: options.channel.lastCommittedLedgerIndex,
    expectedParentHash: options.channel.lastCommittedLedgerHash,
    sourceRevision: options.sourceRevision,
    chunkLimits: options.chunkLimits,
  })

  const currentOnlyAsset = options.enableCurrentOnlyArtifact === true
    && delta.manifest.semanticCounts.currentProjectionMutations > 0
    ? await buildDbLessCurrentOnlyArtifactV1(delta)
    : null

  return {
    status: 'delta-prepared',
    channel: options.channel,
    previousChain: options.previousChain ?? null,
    delta,
    currentOnlyAsset,
    finalLedgerIndex: last.ledgerIndex,
    finalLedgerHash: last.ledgerHash,
    immutableArtifactCountBeforeChain: delta.chunkArtifacts.length + 1
      + (currentOnlyAsset === null ? 0 : 1),
  }
}

export async function finalizeDbLessLivePublication(options: {
  prepared: DbLessPreparedLiveDelta
  publicationLocation: DbLessArtifactLocationV1
}): Promise<DbLessPreparedLivePublication> {
  const { prepared } = options
  const baseIdentity = prepared.channel.base.generationId

  const chain = await buildDbLessLiveChainArtifacts({
    epochId: prepared.channel.epochId,
    baseIdentity,
    baseLedgerIndex: prepared.channel.base.ledgerIndex,
    baseLedgerHash: prepared.channel.base.ledgerHash,
    publicationLocation: options.publicationLocation,
    previousChain: prepared.previousChain,
    deltaManifest: prepared.delta.manifest,
    deltaManifestArtifact: prepared.delta.manifestArtifact,
  })

  const nextChannel = await buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: prepared.channel.epochId,
    base: prepared.channel.base,
    live: chain.channelPointer,
    currentProjectionTail: nextCurrentProjectionTail({
      prepared,
      publicationLocation: options.publicationLocation,
    }),
    lastCommittedLedgerIndex: prepared.finalLedgerIndex,
    lastCommittedLedgerHash: prepared.finalLedgerHash,
    historyCoverage: nextHistoryCoverage({
      channel: prepared.channel,
      chain,
    }),
    updatedAt: prepared.delta.manifest.generatedAt,
  })

  return {
    status: 'prepared',
    delta: prepared.delta,
    chain,
    immutableArtifacts: [
      ...prepared.delta.chunkArtifacts,
      prepared.delta.manifestArtifact,
      ...(prepared.currentOnlyAsset ? [prepared.currentOnlyAsset.artifact] : []),
      chain.manifestArtifact,
    ],
    nextChannel,
    nextChannelBytes: encodeDbLessChannel(nextChannel),
  }
}

export async function prepareDbLessLivePublication(options: {
  channel: DbLessChannelV1
  publicationLocation: DbLessArtifactLocationV1
  previousChain?: DbLessLiveChainManifestV1 | null
  scan: IncrementalScanResult
  sourceRevision: string
  chunkLimits?: NormalizedPayloadChunkLimits
  enableCurrentOnlyArtifact?: boolean
}): Promise<DbLessLivePublicationPlan> {
  const prepared = await prepareDbLessLiveDelta({
    channel: options.channel,
    previousChain: options.previousChain,
    scan: options.scan,
    sourceRevision: options.sourceRevision,
    chunkLimits: options.chunkLimits,
    enableCurrentOnlyArtifact: options.enableCurrentOnlyArtifact,
  })
  if (prepared.status === 'caught-up') return prepared
  return finalizeDbLessLivePublication({
    prepared,
    publicationLocation: options.publicationLocation,
  })
}
