import type { PortableJsonValue } from '../portable-collector-payload'
import { canonicalJson, utf8 } from '../current-state/canonical-json'
import type { DbLessCurrentOverlayObjectTypeV1 } from './current-overlay-checkpoint'
import { DbLessCurrentOverlayReader } from './current-overlay-reader'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const DEFAULT_OVERLAY_SHARD_READS = 8
const DEFAULT_BASE_READS = 8
const DEFAULT_SHADOW_CHECKS = 100

export interface DbLessBaseCurrentRecordV1 {
  objectId: string
  value: PortableJsonValue
}

export interface DbLessBaseCurrentLookupResultV1 {
  item: DbLessBaseCurrentRecordV1 | null
  assetReads: number
}

export interface DbLessBaseCurrentListResultV1 {
  items: DbLessBaseCurrentRecordV1[]
  nextCursor: string | null
  complete: boolean
  assetReads: number
}

export interface DbLessBaseCurrentReaderV1 {
  get(
    objectType: DbLessCurrentOverlayObjectTypeV1,
    objectId: string,
  ): Promise<DbLessBaseCurrentLookupResultV1>
  list(
    objectType: DbLessCurrentOverlayObjectTypeV1,
    options: {
      limit: number
      cursor?: string
      maxAssetReads: number
    },
  ): Promise<DbLessBaseCurrentListResultV1>
}

export interface DbLessCompositeCurrentItemV1 {
  objectType: DbLessCurrentOverlayObjectTypeV1
  objectId: string
  value: PortableJsonValue
  source: 'overlay' | 'base'
}

export interface DbLessCompositeCurrentLookupResultV1 {
  item: DbLessCompositeCurrentItemV1 | null
  overlayShardReads: number
  baseAssetReads: number
}

export interface DbLessCompositeCurrentListOptionsV1 {
  limit?: number
  cursor?: string
  maxOverlayShardReads?: number
  maxBaseAssetReads?: number
  maxShadowChecks?: number
}

export interface DbLessCompositeCurrentListResultV1 {
  items: DbLessCompositeCurrentItemV1[]
  nextCursor: string | null
  complete: boolean
  overlayShardReads: number
  baseAssetReads: number
  shadowChecks: number
  shadowShardReads: number
}

type CompositeCursorV1 = {
  v: 1
  throughLedgerIndex: number
  objectType: DbLessCurrentOverlayObjectTypeV1
  phase: 'overlay' | 'base'
  overlayCursor: string | null
  baseCursor: string | null
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
  return value
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be non-empty`)
  }
  return value
}

function encodeCursor(cursor: CompositeCursorV1): string {
  return Array.from(utf8(canonicalJson(cursor)), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

function decodeCursor(options: {
  cursor?: string
  throughLedgerIndex: number
  objectType: DbLessCurrentOverlayObjectTypeV1
}): CompositeCursorV1 {
  if (!options.cursor) {
    return {
      v: 1,
      throughLedgerIndex: options.throughLedgerIndex,
      objectType: options.objectType,
      phase: 'overlay',
      overlayCursor: null,
      baseCursor: null,
    }
  }
  if (options.cursor.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(options.cursor)) {
    throw new Error('D4 composite cursor is invalid')
  }
  const bytes = new Uint8Array(options.cursor.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(options.cursor.slice(index * 2, index * 2 + 2), 16)
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CompositeCursorV1>
  if (
    parsed.v !== 1
    || parsed.throughLedgerIndex !== options.throughLedgerIndex
    || parsed.objectType !== options.objectType
    || (parsed.phase !== 'overlay' && parsed.phase !== 'base')
    || (parsed.overlayCursor !== null && typeof parsed.overlayCursor !== 'string')
    || (parsed.baseCursor !== null && typeof parsed.baseCursor !== 'string')
  ) {
    throw new Error('D4 composite cursor does not match the query')
  }
  return parsed as CompositeCursorV1
}

function compositeItem(options: {
  objectType: DbLessCurrentOverlayObjectTypeV1
  objectId: string
  value: PortableJsonValue
  source: 'overlay' | 'base'
}): DbLessCompositeCurrentItemV1 {
  return {
    objectType: options.objectType,
    objectId: nonEmpty(options.objectId, 'objectId'),
    value: options.value,
    source: options.source,
  }
}

export class DbLessCompositeCurrentReader {
  readonly #overlay: DbLessCurrentOverlayReader
  readonly #base: DbLessBaseCurrentReaderV1

  constructor(options: {
    overlay: DbLessCurrentOverlayReader
    base: DbLessBaseCurrentReaderV1
  }) {
    this.#overlay = options.overlay
    this.#base = options.base
  }

  async get(
    objectType: DbLessCurrentOverlayObjectTypeV1,
    objectId: string,
  ): Promise<DbLessCompositeCurrentLookupResultV1> {
    const id = nonEmpty(objectId, 'objectId')
    const overlay = await this.#overlay.get(objectType, id)
    if (overlay.item) {
      return {
        item: overlay.item.isTombstone
          ? null
          : compositeItem({
              objectType,
              objectId: overlay.item.objectId,
              value: overlay.item.value,
              source: 'overlay',
            }),
        overlayShardReads: overlay.shardReads,
        baseAssetReads: 0,
      }
    }

    const base = await this.#base.get(objectType, id)
    return {
      item: base.item
        ? compositeItem({
            objectType,
            objectId: base.item.objectId,
            value: base.item.value,
            source: 'base',
          })
        : null,
      overlayShardReads: overlay.shardReads,
      baseAssetReads: base.assetReads,
    }
  }

  async list(
    objectType: DbLessCurrentOverlayObjectTypeV1,
    options: DbLessCompositeCurrentListOptionsV1 = {},
  ): Promise<DbLessCompositeCurrentListResultV1> {
    const limit = positiveInteger(options.limit ?? DEFAULT_LIMIT, 'limit')
    if (limit > MAX_LIMIT) throw new Error(`limit must not exceed ${MAX_LIMIT}`)
    const maxOverlayShardReads = positiveInteger(
      options.maxOverlayShardReads ?? DEFAULT_OVERLAY_SHARD_READS,
      'maxOverlayShardReads',
    )
    const maxBaseAssetReads = positiveInteger(
      options.maxBaseAssetReads ?? DEFAULT_BASE_READS,
      'maxBaseAssetReads',
    )
    const maxShadowChecks = positiveInteger(
      options.maxShadowChecks ?? DEFAULT_SHADOW_CHECKS,
      'maxShadowChecks',
    )

    const cursor = decodeCursor({
      cursor: options.cursor,
      throughLedgerIndex: this.#overlay.manifest.throughLedgerIndex,
      objectType,
    })

    const items: DbLessCompositeCurrentItemV1[] = []
    let overlayShardReads = 0
    let baseAssetReads = 0
    let shadowChecks = 0
    let shadowShardReads = 0
    let phase = cursor.phase
    let overlayCursor = cursor.overlayCursor ?? undefined
    let baseCursor = cursor.baseCursor ?? undefined

    if (phase === 'overlay') {
      const overlay = await this.#overlay.list(objectType, {
        limit,
        cursor: overlayCursor,
        maxShardReads: maxOverlayShardReads,
        includeTombstones: false,
      })
      overlayShardReads += overlay.shardReads
      items.push(...overlay.items.map((entry) => compositeItem({
        objectType,
        objectId: entry.objectId,
        value: entry.value,
        source: 'overlay',
      })))

      if (!overlay.complete) {
        return {
          items,
          nextCursor: encodeCursor({
            ...cursor,
            phase: 'overlay',
            overlayCursor: overlay.nextCursor,
            baseCursor: null,
          }),
          complete: false,
          overlayShardReads,
          baseAssetReads,
          shadowChecks,
          shadowShardReads,
        }
      }

      phase = 'base'
      if (items.length >= limit) {
        return {
          items,
          nextCursor: encodeCursor({
            ...cursor,
            phase,
            overlayCursor: null,
            baseCursor: null,
          }),
          complete: false,
          overlayShardReads,
          baseAssetReads,
          shadowChecks,
          shadowShardReads,
        }
      }
    }

    let baseComplete = false
    while (
      items.length < limit
      && !baseComplete
      && baseAssetReads < maxBaseAssetReads
      && shadowChecks < maxShadowChecks
    ) {
      const requestLimit = Math.min(
        limit - items.length,
        maxShadowChecks - shadowChecks,
      )
      const remainingReads = maxBaseAssetReads - baseAssetReads
      const page = await this.#base.list(objectType, {
        limit: requestLimit,
        cursor: baseCursor,
        maxAssetReads: remainingReads,
      })
      if (page.assetReads < 0 || page.assetReads > remainingReads) {
        throw new Error('D4 base reader exceeded its asset-read budget')
      }
      if (!page.complete && page.nextCursor === null) {
        throw new Error('D4 base reader returned an incomplete page without a cursor')
      }
      baseAssetReads += page.assetReads

      for (const baseItem of page.items) {
        shadowChecks += 1
        const shadow = await this.#overlay.get(objectType, baseItem.objectId)
        shadowShardReads += shadow.shardReads
        if (shadow.item !== null) continue
        items.push(compositeItem({
          objectType,
          objectId: baseItem.objectId,
          value: baseItem.value,
          source: 'base',
        }))
      }

      baseCursor = page.nextCursor ?? undefined
      baseComplete = page.complete
      if (
        page.items.length === 0
        && !page.complete
        && page.assetReads === 0
      ) {
        throw new Error('D4 base reader made no progress')
      }
    }

    const complete = baseComplete
    return {
      items,
      nextCursor: complete
        ? null
        : encodeCursor({
            ...cursor,
            phase: 'base',
            overlayCursor: null,
            baseCursor: baseCursor ?? null,
          }),
      complete,
      overlayShardReads,
      baseAssetReads,
      shadowChecks,
      shadowShardReads,
    }
  }
}
