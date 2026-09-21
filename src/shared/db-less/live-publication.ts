import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import type { NormalizedPayloadChunkLimits } from '../portable-collector-payload'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import {
  buildDbLessChannel,
  encodeDbLessChannel,
  verifyDbLessChannel,
  type DbLessArtifactLocationV1,
  type DbLessChannelV1,
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

  return {
    status: 'delta-prepared',
    channel: options.channel,
    previousChain: options.previousChain ?? null,
    delta,
    finalLedgerIndex: last.ledgerIndex,
    finalLedgerHash: last.ledgerHash,
    immutableArtifactCountBeforeChain: delta.chunkArtifacts.length + 1,
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
}): Promise<DbLessLivePublicationPlan> {
  const prepared = await prepareDbLessLiveDelta({
    channel: options.channel,
    previousChain: options.previousChain,
    scan: options.scan,
    sourceRevision: options.sourceRevision,
    chunkLimits: options.chunkLimits,
  })
  if (prepared.status === 'caught-up') return prepared
  return finalizeDbLessLivePublication({
    prepared,
    publicationLocation: options.publicationLocation,
  })
}
