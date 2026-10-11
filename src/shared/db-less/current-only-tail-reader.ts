import type { DbLessChannelV1, DbLessArtifactLocationV1 } from './channel'
import type {
  DbLessCurrentOverlayCheckpointManifest,
  DbLessCurrentOverlayGenerationV1,
} from './current-overlay-checkpoint'
import { decodeAndVerifyDbLessCurrentOnlyArtifactV1 } from './current-only-artifact'

const DEFAULT_MAX_GENERATIONS = 32
const DEFAULT_MAX_TOTAL_BYTES = 8_000_000

export type DbLessCurrentOnlyLocatedReader = (
  location: DbLessArtifactLocationV1,
  key: string,
) => Promise<Uint8Array | null>

export interface DbLessCurrentOnlyTailResultV1 {
  generations: DbLessCurrentOverlayGenerationV1[]
  assetReads: number
  transferredBytes: number
  fromLedgerIndex: number
  toLedgerIndex: number
}

export async function readDbLessCurrentOnlyTailV1(options: {
  channel: DbLessChannelV1
  checkpoint: Pick<
    DbLessCurrentOverlayCheckpointManifest,
    'epochId' | 'baseIdentity' | 'throughLedgerIndex' | 'throughLedgerHash'
  >
  readArtifact: DbLessCurrentOnlyLocatedReader
  maxGenerations?: number
  maxTotalBytes?: number
}): Promise<DbLessCurrentOnlyTailResultV1> {
  const { channel, checkpoint } = options
  const tail = channel.currentProjectionTail
  if (!tail) throw new Error('Current-only bounded tail index is unavailable')
  if (channel.epochId !== checkpoint.epochId
    || channel.base.generationId !== checkpoint.baseIdentity) {
    throw new Error('Current-only checkpoint base/epoch mismatch')
  }
  if (checkpoint.throughLedgerIndex > channel.lastCommittedLedgerIndex
    || checkpoint.throughLedgerIndex < tail.coverageStartLedgerIndex) {
    throw new Error('Current-only checkpoint is outside indexed tail coverage')
  }
  if (checkpoint.throughLedgerIndex === tail.coverageStartLedgerIndex
    && checkpoint.throughLedgerHash !== tail.coverageStartLedgerHash) {
    throw new Error('Current-only coverage boundary hash mismatch')
  }
  if (checkpoint.throughLedgerIndex === channel.lastCommittedLedgerIndex
    && checkpoint.throughLedgerHash !== channel.lastCommittedLedgerHash) {
    throw new Error('Current-only checkpoint head hash mismatch')
  }
  const maxGenerations = options.maxGenerations ?? DEFAULT_MAX_GENERATIONS
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
  if (!Number.isSafeInteger(maxGenerations) || maxGenerations < 1 || maxGenerations > 128
    || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) {
    throw new Error('Current-only browser read budget is invalid')
  }

  const selected = tail.generations.filter(
    (g) => g.endLedgerIndex > checkpoint.throughLedgerIndex,
  )
  if (selected.length > maxGenerations) {
    throw new Error('Current-only tail exceeds bounded generation read budget')
  }
  if (selected.some(g => g.startLedgerIndex <= checkpoint.throughLedgerIndex)) {
    throw new Error('Current-only checkpoint cuts through a mutation generation')
  }

  // Do not fall back to fetching all normalized historical chunks.
  // A mixed old/new tail must fail closed until D4 compacts old generations.
  let declaredBytes = 0
  for (const pointer of selected) {
    if (!pointer.currentOnly) {
      throw new Error('Current-only pointer is missing; D4 refresh required')
    }
    declaredBytes += pointer.currentOnly.bytes
    if (declaredBytes > maxTotalBytes) {
      throw new Error('Current-only tail exceeds bounded total byte budget')
    }
  }
  let transferredBytes = 0
  const generations: DbLessCurrentOverlayGenerationV1[] = []
  for (const pointer of selected) {
    const asset = pointer.currentOnly!
    const bytes = await options.readArtifact(pointer.location, asset.key)
    if (!bytes || bytes.byteLength !== asset.bytes) {
      throw new Error('Current-only immutable asset is missing or has wrong length')
    }
    transferredBytes += bytes.byteLength
    const document = await decodeAndVerifyDbLessCurrentOnlyArtifactV1({
      bytes,
      expectedSha256: asset.sha256,
      expected: {
        epochId: channel.epochId,
        baseIdentity: channel.base.generationId,
        generationId: pointer.generationId,
        sourceDeltaManifestSha256: pointer.manifestSha256,
        payloadDigest: pointer.payloadDigest,
        previousLedgerIndex: pointer.previousLedgerIndex,
        expectedParentHash: pointer.expectedParentHash,
        startLedgerIndex: pointer.startLedgerIndex,
        endLedgerIndex: pointer.endLedgerIndex,
        endLedgerHash: pointer.endLedgerHash,
        currentProjectionMutations: pointer.currentProjectionMutations,
      },
    })
    generations.push({
      generationId: document.generationId,
      startLedgerIndex: document.startLedgerIndex,
      endLedgerIndex: document.endLedgerIndex,
      records: document.records,
    })
  }
  return {
    generations,
    assetReads: selected.length,
    transferredBytes,
    fromLedgerIndex: checkpoint.throughLedgerIndex,
    toLedgerIndex: channel.lastCommittedLedgerIndex,
  }
}
