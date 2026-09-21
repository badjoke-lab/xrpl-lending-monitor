import {
  buildDbLessChannel,
  type DbLessArtifactLocationV1,
  type DbLessChannelV1,
  type DbLessHistoryCoverageRangeV1,
} from './channel'
import {
  verifyDbLessBaseManifest,
  type DbLessBaseManifestV1,
} from './base-manifest'
import { sha256Hex } from '../current-state/canonical-json'

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/
const COMMIT_SHA = /^[a-f0-9]{40}$/

export interface LegacyHistoryChannelV1 {
  schemaVersion: 1
  active: {
    dataCommitSha: string
    publicationPath: string
    publicationSha256: string
    chainId: string
    epochId: string
    exactIndex?: {
      manifestPath: string
      manifestSha256: string
    } | null
  }
  updatedAt: string
}

export interface LegacyHistoryPublicationV1 {
  schemaVersion: 1
  network: 'devnet'
  complete: true
  chainId: string
  epochId: string
  startLedgerIndex: number
  startLedgerHash: string
  endLedgerIndex: number
  endLedgerHash: string
  ledgerCount: number
}

function nonEmpty(value: string, field: string): void {
  if (!value.length) throw new Error(`${field} must be non-empty`)
}

function safeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be a safe integer of at least ${minimum}`)
  }
}

function ledgerHash(value: string, field: string): void {
  if (!LEDGER_HASH.test(value)) {
    throw new Error(`${field} must be an uppercase 64-character ledger hash`)
  }
}

function safePath(value: string, field: string): void {
  nonEmpty(value, field)
  if (
    value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    throw new Error(`${field} is unsafe`)
  }
}

function validateLegacyArchive(
  channel: LegacyHistoryChannelV1,
  publication: LegacyHistoryPublicationV1,
): void {
  if (channel.schemaVersion !== 1) throw new Error('Unsupported legacy history channel schema')
  if (publication.schemaVersion !== 1) throw new Error('Unsupported legacy history publication schema')
  if (publication.network !== 'devnet') throw new Error('Legacy history publication network must be devnet')
  if (publication.complete !== true) throw new Error('Legacy history publication must be complete')
  if (!COMMIT_SHA.test(channel.active.dataCommitSha)) {
    throw new Error('Legacy history data commit must be a lowercase 40-character SHA')
  }
  if (!SHA256.test(channel.active.publicationSha256)) {
    throw new Error('Legacy history publication digest must be a lowercase SHA-256')
  }
  safePath(channel.active.publicationPath, 'legacy publicationPath')
  nonEmpty(channel.active.chainId, 'legacy chainId')
  nonEmpty(channel.active.epochId, 'legacy epochId')
  if (channel.active.exactIndex !== undefined && channel.active.exactIndex !== null) {
    safePath(channel.active.exactIndex.manifestPath, 'legacy exactIndex.manifestPath')
    if (!SHA256.test(channel.active.exactIndex.manifestSha256)) {
      throw new Error('Legacy exact-index manifest digest must be a lowercase SHA-256')
    }
  }
  nonEmpty(channel.updatedAt, 'legacy updatedAt')
  nonEmpty(publication.chainId, 'legacy publication chainId')
  nonEmpty(publication.epochId, 'legacy publication epochId')
  safeInteger(publication.startLedgerIndex, 'legacy startLedgerIndex', 1)
  safeInteger(publication.endLedgerIndex, 'legacy endLedgerIndex', 1)
  safeInteger(publication.ledgerCount, 'legacy ledgerCount', 1)
  ledgerHash(publication.startLedgerHash, 'legacy startLedgerHash')
  ledgerHash(publication.endLedgerHash, 'legacy endLedgerHash')

  if (publication.chainId !== channel.active.chainId) {
    throw new Error('Legacy history chain ID does not match its channel')
  }
  if (publication.epochId !== channel.active.epochId) {
    throw new Error('Legacy history epoch does not match its channel')
  }
  if (publication.endLedgerIndex < publication.startLedgerIndex) {
    throw new Error('Legacy history end precedes its start')
  }
  if (publication.ledgerCount !== publication.endLedgerIndex - publication.startLedgerIndex + 1) {
    throw new Error('Legacy history ledger count does not match its inclusive range')
  }
}

export async function buildDbLessInitialChannel(options: {
  baseManifest: DbLessBaseManifestV1
  baseManifestBytes: Uint8Array
  baseLocation: DbLessArtifactLocationV1
  baseManifestKey: string
  archiveChannel: LegacyHistoryChannelV1
  archivePublication: LegacyHistoryPublicationV1
  archivePublicationBytes: Uint8Array
  archiveExactIndexBytes: Uint8Array | null
  archiveRepository: string
  updatedAt: string
}): Promise<DbLessChannelV1> {
  await verifyDbLessBaseManifest(options.baseManifest)
  validateLegacyArchive(options.archiveChannel, options.archivePublication)
  nonEmpty(options.updatedAt, 'updatedAt')
  safePath(options.baseManifestKey, 'baseManifestKey')

  const archivePublicationSha256 = await sha256Hex(options.archivePublicationBytes)
  if (archivePublicationSha256 !== options.archiveChannel.active.publicationSha256) {
    throw new Error('Legacy history publication bytes do not match the pinned channel digest')
  }

  if (options.archiveChannel.active.exactIndex) {
    if (options.archiveExactIndexBytes === null) {
      throw new Error('Legacy history exact-index bytes are required by the pinned channel')
    }
    const exactIndexSha256 = await sha256Hex(options.archiveExactIndexBytes)
    if (exactIndexSha256 !== options.archiveChannel.active.exactIndex.manifestSha256) {
      throw new Error('Legacy history exact-index bytes do not match the pinned channel digest')
    }
  } else if (options.archiveExactIndexBytes !== null) {
    throw new Error('Legacy history exact-index bytes were supplied without a pinned exact index')
  }

  const baseManifestSha256 = await sha256Hex(options.baseManifestBytes)
  const archiveLocation: DbLessArtifactLocationV1 = {
    provider: 'github-commit',
    repository: options.archiveRepository,
    commitSha: options.archiveChannel.active.dataCommitSha,
  }
  const archiveRange: DbLessHistoryCoverageRangeV1 = {
    rangeId: `archive:${options.archivePublication.chainId}`,
    source: 'archive',
    epochId: options.archivePublication.epochId,
    location: archiveLocation,
    manifestKey: options.archiveChannel.active.publicationPath,
    manifestSha256: options.archiveChannel.active.publicationSha256,
    exactIndex: options.archiveChannel.active.exactIndex
      ? {
          manifestKey: options.archiveChannel.active.exactIndex.manifestPath,
          manifestSha256: options.archiveChannel.active.exactIndex.manifestSha256,
        }
      : null,
    startLedgerIndex: options.archivePublication.startLedgerIndex,
    startLedgerHash: options.archivePublication.startLedgerHash,
    endLedgerIndex: options.archivePublication.endLedgerIndex,
    endLedgerHash: options.archivePublication.endLedgerHash,
  }

  return buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: options.baseManifest.epochId,
    base: {
      location: options.baseLocation,
      generationId: options.baseManifest.generationId,
      snapshotId: options.baseManifest.snapshotId,
      manifestKey: options.baseManifestKey,
      manifestSha256: baseManifestSha256,
      ledgerIndex: options.baseManifest.ledgerIndex,
      ledgerHash: options.baseManifest.ledgerHash,
    },
    live: null,
    lastCommittedLedgerIndex: options.baseManifest.ledgerIndex,
    lastCommittedLedgerHash: options.baseManifest.ledgerHash,
    historyCoverage: [archiveRange],
    updatedAt: options.updatedAt,
  })
}