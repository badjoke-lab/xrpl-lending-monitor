import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import type {
  DbLessCurrentOverlayCheckpointManifestV1,
  DbLessCurrentOverlayEntryV1,
  DbLessCurrentOverlayGenerationV1,
  DbLessCurrentOverlayObjectTypeV1,
} from './current-overlay-checkpoint'
import { DbLessCurrentOverlayReader } from './current-overlay-reader'
import {
  compareDbLessCurrentProjectionCanonicalKeys,
  parseDbLessCurrentProjectionCanonicalKey,
} from './current-projection-identity'

export interface DbLessCurrentOverlayEquivalenceSummaryV1 {
  schemaVersion: 1
  generationCount: number
  sourceEntryCount: number
  checkpointEntryCount: number
  sourceTombstoneCount: number
  checkpointTombstoneCount: number
  sourceStateSha256: string
  checkpointStateSha256: string
  equivalent: true
}

function entryFromCandidate(candidate: NormalizedCandidateV1): DbLessCurrentOverlayEntryV1 {
  if (candidate.semanticClass !== 'current-projection') {
    throw new Error('D4 equivalence source contains a non-current projection')
  }
  if (candidate.objectId === null || candidate.sourceTransactionHash === null) {
    throw new Error('D4 equivalence source Current projection is missing identity provenance')
  }
  const parsedType = parseDbLessCurrentProjectionCanonicalKey(
    candidate.canonicalKey,
    candidate.objectId,
  )
  if (candidate.isTombstone && candidate.value !== null) {
    throw new Error('D4 equivalence source tombstone must have a null value')
  }
  if (!candidate.isTombstone && candidate.value === null) {
    throw new Error('D4 equivalence source upsert must have a non-null value')
  }

  return {
    canonicalKey: candidate.canonicalKey,
    objectType: parsedType as DbLessCurrentOverlayObjectTypeV1,
    objectId: candidate.objectId,
    sourceLedgerIndex: candidate.sourceLedgerIndex,
    sourceLedgerHash: candidate.sourceLedgerHash,
    sourceTransactionHash: candidate.sourceTransactionHash,
    relationshipIds: [...candidate.relationshipIds].sort((left, right) => left.localeCompare(right)),
    isTombstone: candidate.isTombstone,
    value: candidate.value,
  }
}

function sourceState(
  generations: readonly DbLessCurrentOverlayGenerationV1[],
  seedEntries: readonly DbLessCurrentOverlayEntryV1[] = [],
  initialPreviousEnd: number | null = null,
): DbLessCurrentOverlayEntryV1[] {
  if (generations.length === 0) {
    throw new Error('D4 equivalence requires at least one source generation')
  }

  const latest = new Map<string, DbLessCurrentOverlayEntryV1>()
  for (const entry of seedEntries) {
    if (latest.has(entry.canonicalKey)) {
      throw new Error('D4 equivalence seed contains duplicate canonical keys')
    }
    latest.set(entry.canonicalKey, entry)
  }
  let previousEnd: number | null = initialPreviousEnd
  for (const generation of generations) {
    if (
      !Number.isSafeInteger(generation.startLedgerIndex)
      || !Number.isSafeInteger(generation.endLedgerIndex)
      || generation.startLedgerIndex < 1
      || generation.endLedgerIndex < generation.startLedgerIndex
    ) {
      throw new Error('D4 equivalence source generation ledger range is invalid')
    }
    if (previousEnd !== null && generation.startLedgerIndex !== previousEnd + 1) {
      throw new Error('D4 equivalence source generations are not contiguous')
    }
    previousEnd = generation.endLedgerIndex

    const seen = new Set<string>()
    for (const candidate of generation.records) {
      if (
        candidate.sourceLedgerIndex < generation.startLedgerIndex
        || candidate.sourceLedgerIndex > generation.endLedgerIndex
      ) {
        throw new Error('D4 equivalence source record lies outside its generation')
      }
      if (seen.has(candidate.canonicalKey)) {
        throw new Error('D4 equivalence source generation contains a duplicate canonical key')
      }
      seen.add(candidate.canonicalKey)
      latest.set(candidate.canonicalKey, entryFromCandidate(candidate))
    }
  }

  return [...latest.values()].sort((left, right) =>
    compareDbLessCurrentProjectionCanonicalKeys(
      left.canonicalKey,
      right.canonicalKey,
    ))
}

async function checkpointState(
  reader: DbLessCurrentOverlayReader,
): Promise<DbLessCurrentOverlayEntryV1[]> {
  const entries: DbLessCurrentOverlayEntryV1[] = []
  const seen = new Set<string>()
  const types: DbLessCurrentOverlayObjectTypeV1[] = ['vault', 'loan_broker', 'loan']

  for (const objectType of types) {
    let cursor: string | undefined
    let complete = false
    let calls = 0
    while (!complete) {
      const page = await reader.list(objectType, {
        limit: 100,
        cursor,
        maxShardReads: reader.manifest.shards.length || 1,
        includeTombstones: true,
      })
      for (const entry of page.items) {
        if (seen.has(entry.canonicalKey)) {
          throw new Error('D4 checkpoint contains duplicate canonical keys')
        }
        seen.add(entry.canonicalKey)
        entries.push(entry)
      }
      cursor = page.nextCursor ?? undefined
      complete = page.complete
      calls += 1
      if (calls > reader.manifest.entryCount + reader.manifest.shards.length + 1) {
        throw new Error('D4 checkpoint equivalence traversal did not converge')
      }
    }
  }

  return entries.sort((left, right) =>
    compareDbLessCurrentProjectionCanonicalKeys(
      left.canonicalKey,
      right.canonicalKey,
    ))
}

async function digestState(entries: readonly DbLessCurrentOverlayEntryV1[]): Promise<string> {
  return sha256Hex(`${canonicalJson(entries)}\n`)
}

export async function verifyDbLessCurrentOverlayEquivalence(options: {
  generations: readonly DbLessCurrentOverlayGenerationV1[]
  reader: DbLessCurrentOverlayReader
}): Promise<DbLessCurrentOverlayEquivalenceSummaryV1> {
  if (options.generations.length !== options.reader.manifest.generationCount) {
    throw new Error('D4 equivalence generation count does not match checkpoint manifest')
  }
  const sourceGenerationIds = options.generations.map((generation) => generation.generationId)
  if (canonicalJson(sourceGenerationIds) !== canonicalJson(options.reader.manifest.sourceGenerationIds)) {
    throw new Error('D4 equivalence source generation IDs do not match checkpoint manifest')
  }
  const lastGeneration = options.generations.at(-1)!
  if (lastGeneration.endLedgerIndex !== options.reader.manifest.throughLedgerIndex) {
    throw new Error('D4 equivalence source head does not match checkpoint through ledger')
  }

  const expected = sourceState(options.generations)
  const actual = await checkpointState(options.reader)
  const sourceStateSha256 = await digestState(expected)
  const checkpointStateSha256 = await digestState(actual)
  const sourceTombstoneCount = expected.filter((entry) => entry.isTombstone).length
  const checkpointTombstoneCount = actual.filter((entry) => entry.isTombstone).length

  if (
    expected.length !== options.reader.manifest.entryCount
    || actual.length !== options.reader.manifest.entryCount
    || sourceTombstoneCount !== options.reader.manifest.tombstoneCount
    || checkpointTombstoneCount !== options.reader.manifest.tombstoneCount
    || sourceStateSha256 !== checkpointStateSha256
  ) {
    throw new Error('D4 compacted Current overlay is not equivalent to source generations')
  }

  return {
    schemaVersion: 1,
    generationCount: options.generations.length,
    sourceEntryCount: expected.length,
    checkpointEntryCount: actual.length,
    sourceTombstoneCount,
    checkpointTombstoneCount,
    sourceStateSha256,
    checkpointStateSha256,
    equivalent: true,
  }
}

export async function verifyDbLessCurrentOverlayIncrementalEquivalence(options: {
  seedManifest: DbLessCurrentOverlayCheckpointManifestV1
  seedEntries: readonly DbLessCurrentOverlayEntryV1[]
  generations: readonly DbLessCurrentOverlayGenerationV1[]
  reader: DbLessCurrentOverlayReader
}): Promise<DbLessCurrentOverlayEquivalenceSummaryV1> {
  if (options.generations.length === 0) {
    throw new Error('D4 incremental equivalence requires at least one new generation')
  }
  if (
    options.seedManifest.epochId !== options.reader.manifest.epochId
    || options.seedManifest.baseIdentity !== options.reader.manifest.baseIdentity
    || options.seedManifest.bucketCount !== options.reader.manifest.bucketCount
    || options.seedManifest.throughLedgerIndex >= options.reader.manifest.throughLedgerIndex
  ) {
    throw new Error('D4 incremental equivalence seed identity is incompatible')
  }
  if (
    options.seedEntries.length !== options.seedManifest.entryCount
    || options.seedEntries.filter((entry) => entry.isTombstone).length
      !== options.seedManifest.tombstoneCount
  ) {
    throw new Error('D4 incremental equivalence seed counts are inconsistent')
  }

  const expectedGenerationIds = [
    ...options.seedManifest.sourceGenerationIds,
    ...options.generations.map((generation) => generation.generationId),
  ]
  if (
    options.reader.manifest.generationCount !== expectedGenerationIds.length
    || canonicalJson(options.reader.manifest.sourceGenerationIds)
      !== canonicalJson(expectedGenerationIds)
  ) {
    throw new Error('D4 incremental equivalence generation provenance does not match')
  }

  const firstGeneration = options.generations[0]!
  const lastGeneration = options.generations.at(-1)!
  if (firstGeneration.startLedgerIndex !== options.seedManifest.throughLedgerIndex + 1) {
    throw new Error('D4 incremental equivalence does not continue the seed checkpoint')
  }
  if (lastGeneration.endLedgerIndex !== options.reader.manifest.throughLedgerIndex) {
    throw new Error('D4 incremental equivalence source head does not match checkpoint')
  }

  const expected = sourceState(
    options.generations,
    options.seedEntries,
    options.seedManifest.throughLedgerIndex,
  )
  const actual = await checkpointState(options.reader)
  const sourceStateSha256 = await digestState(expected)
  const checkpointStateSha256 = await digestState(actual)
  const sourceTombstoneCount = expected.filter((entry) => entry.isTombstone).length
  const checkpointTombstoneCount = actual.filter((entry) => entry.isTombstone).length

  if (
    expected.length !== options.reader.manifest.entryCount
    || actual.length !== options.reader.manifest.entryCount
    || sourceTombstoneCount !== options.reader.manifest.tombstoneCount
    || checkpointTombstoneCount !== options.reader.manifest.tombstoneCount
    || sourceStateSha256 !== checkpointStateSha256
  ) {
    throw new Error('D4 incremental checkpoint is not equivalent to seed plus new generations')
  }

  return {
    schemaVersion: 1,
    generationCount: options.reader.manifest.generationCount,
    sourceEntryCount: expected.length,
    checkpointEntryCount: actual.length,
    sourceTombstoneCount,
    checkpointTombstoneCount,
    sourceStateSha256,
    checkpointStateSha256,
    equivalent: true,
  }
}
