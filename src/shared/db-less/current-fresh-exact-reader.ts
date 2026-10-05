import type { PortableJsonValue } from '../portable-collector-payload'
import type {
  DbLessCompositeCurrentLookupResultV1,
  DbLessCompositeCurrentItemV1,
} from './current-composite-reader'
import type {
  DbLessCurrentOverlayGenerationV1,
  DbLessCurrentOverlayObjectTypeV1,
} from './current-overlay-checkpoint'
import { buildDbLessCurrentProjectionCanonicalKey } from './current-projection-identity'

export interface DbLessCheckpointExactReaderV1 {
  get(
    objectType: DbLessCurrentOverlayObjectTypeV1,
    objectId: string,
  ): Promise<DbLessCompositeCurrentLookupResultV1>
}

export interface DbLessFreshCurrentItemV1 {
  objectType: DbLessCurrentOverlayObjectTypeV1
  objectId: string
  value: PortableJsonValue
  source: 'tail' | DbLessCompositeCurrentItemV1['source']
  sourceLedgerIndex: number | null
}

export interface DbLessFreshCurrentLookupResultV1 {
  item: DbLessFreshCurrentItemV1 | null
  tailMutationHit: boolean
  checkpointOverlayShardReads: number
  baseAssetReads: number
  checkpointThroughLedgerIndex: number
  currentThroughLedgerIndex: number
}

type TailMutation = {
  objectType: DbLessCurrentOverlayObjectTypeV1
  objectId: string
  sourceLedgerIndex: number
  isTombstone: boolean
  value: PortableJsonValue
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
  return value
}

function buildTailIndex(options: {
  checkpointThroughLedgerIndex: number
  currentThroughLedgerIndex: number
  generations: readonly DbLessCurrentOverlayGenerationV1[]
}): Map<string, TailMutation> {
  positiveInteger(options.checkpointThroughLedgerIndex, 'checkpointThroughLedgerIndex')
  positiveInteger(options.currentThroughLedgerIndex, 'currentThroughLedgerIndex')
  if (options.currentThroughLedgerIndex < options.checkpointThroughLedgerIndex) {
    throw new Error('Fresh Current head precedes the checkpoint')
  }

  const latest = new Map<string, TailMutation>()
  let previousEnd = options.checkpointThroughLedgerIndex
  for (const [generationIndex, generation] of options.generations.entries()) {
    positiveInteger(generation.startLedgerIndex, `generations[${generationIndex}].startLedgerIndex`)
    positiveInteger(generation.endLedgerIndex, `generations[${generationIndex}].endLedgerIndex`)
    if (
      generation.startLedgerIndex <= options.checkpointThroughLedgerIndex
      || generation.endLedgerIndex < generation.startLedgerIndex
      || generation.startLedgerIndex <= previousEnd
      || generation.endLedgerIndex > options.currentThroughLedgerIndex
    ) {
      throw new Error('Fresh Current tail generation boundaries are invalid')
    }
    previousEnd = generation.endLedgerIndex

    for (const record of generation.records) {
      if (
        record.semanticClass !== 'current-projection'
        || record.objectId === null
        || record.sourceTransactionHash === null
      ) {
        throw new Error('Fresh Current tail contains a non-projection mutation')
      }
      const objectType = record.canonicalKey.startsWith('projection:vault:')
        ? 'vault'
        : record.canonicalKey.startsWith('projection:loan_broker:')
          ? 'loan_broker'
          : record.canonicalKey.startsWith('projection:loan:')
            ? 'loan'
            : null
      if (
        objectType === null
        || buildDbLessCurrentProjectionCanonicalKey(objectType, record.objectId) !== record.canonicalKey
      ) {
        throw new Error('Fresh Current tail projection identity is invalid')
      }
      if (record.isTombstone && record.value !== null) {
        throw new Error('Fresh Current tail tombstone must have a null value')
      }
      if (!record.isTombstone && record.value === null) {
        throw new Error('Fresh Current tail upsert must have a value')
      }

      latest.set(record.canonicalKey, {
        objectType,
        objectId: record.objectId,
        sourceLedgerIndex: record.sourceLedgerIndex,
        isTombstone: record.isTombstone,
        value: record.value,
      })
    }
  }
  return latest
}

export class DbLessFreshExactCurrentReader {
  readonly checkpointThroughLedgerIndex: number
  readonly currentThroughLedgerIndex: number
  readonly #checkpoint: DbLessCheckpointExactReaderV1
  readonly #tail: Map<string, TailMutation>

  constructor(options: {
    checkpoint: DbLessCheckpointExactReaderV1
    checkpointThroughLedgerIndex: number
    currentThroughLedgerIndex: number
    tailGenerations: readonly DbLessCurrentOverlayGenerationV1[]
  }) {
    this.#checkpoint = options.checkpoint
    this.checkpointThroughLedgerIndex = positiveInteger(
      options.checkpointThroughLedgerIndex,
      'checkpointThroughLedgerIndex',
    )
    this.currentThroughLedgerIndex = positiveInteger(
      options.currentThroughLedgerIndex,
      'currentThroughLedgerIndex',
    )
    this.#tail = buildTailIndex({
      checkpointThroughLedgerIndex: this.checkpointThroughLedgerIndex,
      currentThroughLedgerIndex: this.currentThroughLedgerIndex,
      generations: options.tailGenerations,
    })
  }

  async get(
    objectType: DbLessCurrentOverlayObjectTypeV1,
    objectId: string,
  ): Promise<DbLessFreshCurrentLookupResultV1> {
    const key = buildDbLessCurrentProjectionCanonicalKey(objectType, objectId)
    const tail = this.#tail.get(key)
    if (tail) {
      if (tail.objectType !== objectType || tail.objectId !== objectId) {
        throw new Error('Fresh Current tail lookup identity mismatch')
      }
      return {
        item: tail.isTombstone
          ? null
          : {
              objectType,
              objectId,
              value: tail.value,
              source: 'tail',
              sourceLedgerIndex: tail.sourceLedgerIndex,
            },
        tailMutationHit: true,
        checkpointOverlayShardReads: 0,
        baseAssetReads: 0,
        checkpointThroughLedgerIndex: this.checkpointThroughLedgerIndex,
        currentThroughLedgerIndex: this.currentThroughLedgerIndex,
      }
    }

    const checkpoint = await this.#checkpoint.get(objectType, objectId)
    return {
      item: checkpoint.item
        ? {
            ...checkpoint.item,
            sourceLedgerIndex: null,
          }
        : null,
      tailMutationHit: false,
      checkpointOverlayShardReads: checkpoint.overlayShardReads,
      baseAssetReads: checkpoint.baseAssetReads,
      checkpointThroughLedgerIndex: this.checkpointThroughLedgerIndex,
      currentThroughLedgerIndex: this.currentThroughLedgerIndex,
    }
  }
}
