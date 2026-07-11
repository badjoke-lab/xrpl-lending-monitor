import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import {
  getResolvedCurrentProjection as getCanonicalCurrentProjection,
  listResolvedCurrentProjections as listCanonicalCurrentProjections,
  type BaseOverlayListOptions,
  type BaseOverlayListResult,
} from './base-overlay-current-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'
import { readFastLaneShadowBaseBinding } from './fast-lane-shadow-base-binding'
import { readFastLaneShadowState } from './fast-lane-shadow-repository'
import type { ReleaseCurrentStateSource } from './release-current-state'

type Projection = VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection
type Operation = 'upsert' | 'deleted'
type Direction = 'asc' | 'desc'

interface PositionedRow {
  object_id: string
  operation: Operation
  projection_json: string | null
  source_ledger_index: number
  source_transaction_index: number
}

interface FastLaneReadContext {
  epochId: string
  token: string
}

interface ThreeLayerCursor {
  v: 1
  snapshot: string
  kind: ReadModelKind
  direction: Direction
  scope: string
  canonicalCursor: string | null
  canonicalOffset: number
  canonicalDone: boolean
  fastAfter: string | null
  fastOffset: number
  fastDone: boolean
  fastToken: string | null
}

interface FastPage {
  rows: PositionedRow[]
  scanEndId: string | null
  complete: boolean
}

const SOURCE_PAGE_SIZE = 100
const MAX_SOURCE_PAGE_READS = 4
const MAX_IDS_PER_QUERY = 90

function objectType(kind: ReadModelKind): 'vault' | 'loan_broker' | 'loan' {
  return kind === 'loan-broker' ? 'loan_broker' : kind
}

function expectedProjectionKind(kind: ReadModelKind): 'vault' | 'loan_broker' | 'loan' {
  return objectType(kind)
}

function sameHash(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase()
}

function positionCompare(left: PositionedRow, right: PositionedRow): number {
  if (left.source_ledger_index !== right.source_ledger_index) {
    return left.source_ledger_index - right.source_ledger_index
  }
  return left.source_transaction_index - right.source_transaction_index
}

function isFastLaneSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no such table: fast_lane_shadow_')
    || message.includes('no such table: main.fast_lane_shadow_')
}

async function readFastLaneContext(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
): Promise<FastLaneReadContext | null> {
  try {
    const [binding, state] = await Promise.all([
      readFastLaneShadowBaseBinding(db),
      readFastLaneShadowState(db),
    ])
    if (!binding || !state || state.status === 'error') return null
    if (state.epochId !== binding.shadowEpochId) return null
    if (
      binding.base.epochId !== snapshot.epochId
      || binding.base.snapshotId !== snapshot.id
      || binding.base.ledgerIndex !== snapshot.ledgerIndex
      || !sameHash(binding.base.ledgerHash, snapshot.ledgerHash)
    ) return null
    if (state.lastProcessedLedger < snapshot.ledgerIndex) return null
    return {
      epochId: state.epochId,
      token: `${state.epochId}:${binding.boundAt}`,
    }
  } catch (error) {
    if (isFastLaneSchemaError(error)) return null
    return null
  }
}

function parseFastProjection(row: PositionedRow, kind: ReadModelKind): Projection {
  if (row.operation !== 'upsert' || row.projection_json === null) {
    throw new Error('fast-lane projection is unavailable')
  }
  const value = JSON.parse(row.projection_json) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('fast-lane projection shape is invalid')
  }
  const projection = value as Projection
  if (projection.id !== row.object_id || projection.kind !== expectedProjectionKind(kind)) {
    throw new Error('fast-lane projection identity mismatch')
  }
  return projection
}

function encodeCursor(cursor: ThreeLayerCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function newCursor(options: {
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
  fastToken: string | null
}): ThreeLayerCursor {
  return {
    v: 1,
    snapshot: options.snapshot.id,
    kind: options.kind,
    direction: options.list.direction,
    scope: options.list.scope,
    canonicalCursor: null,
    canonicalOffset: 0,
    canonicalDone: false,
    fastAfter: null,
    fastOffset: 0,
    fastDone: options.fastToken === null,
    fastToken: options.fastToken,
  }
}

function decodeCursor(options: {
  value: string | undefined
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
  fastToken: string | null
}): ThreeLayerCursor {
  if (!options.value) {
    return newCursor(options)
  }
  try {
    const parsed = JSON.parse(decodeBase64Url(options.value)) as Partial<ThreeLayerCursor>
    if (
      parsed.v !== 1
      || parsed.snapshot !== options.snapshot.id
      || parsed.kind !== options.kind
      || parsed.direction !== options.list.direction
      || parsed.scope !== options.list.scope
      || (parsed.canonicalCursor !== null && typeof parsed.canonicalCursor !== 'string')
      || !Number.isSafeInteger(parsed.canonicalOffset)
      || Number(parsed.canonicalOffset) < 0
      || typeof parsed.canonicalDone !== 'boolean'
      || (parsed.fastAfter !== null && typeof parsed.fastAfter !== 'string')
      || !Number.isSafeInteger(parsed.fastOffset)
      || Number(parsed.fastOffset) < 0
      || typeof parsed.fastDone !== 'boolean'
      || (parsed.fastToken !== null && typeof parsed.fastToken !== 'string')
    ) throw new Error('invalid')
    if (parsed.fastToken !== null && parsed.fastToken !== options.fastToken) {
      throw new CurrentStateObjectReadError(
        'manifest_integrity_error',
        'fast-lane read context changed during pagination',
      )
    }
    return parsed as ThreeLayerCursor
  } catch (error) {
    if (error instanceof CurrentStateObjectReadError) throw error
    return {
      ...newCursor({ ...options, fastToken: null }),
      canonicalCursor: options.value,
      fastDone: true,
    }
  }
}

async function overlayRowsForIds(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  ids: string[]
}): Promise<Map<string, PositionedRow>> {
  const output = new Map<string, PositionedRow>()
  for (let offset = 0; offset < options.ids.length; offset += MAX_IDS_PER_QUERY) {
    const ids = options.ids.slice(offset, offset + MAX_IDS_PER_QUERY)
    if (ids.length === 0) continue
    const placeholders = ids.map((_, index) => `?${index + 4}`).join(', ')
    const result = await options.db.prepare(
      `SELECT object_id, operation, projection_json,
              source_ledger_index, source_transaction_index
       FROM current_state_overlay_objects
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND base_snapshot_id = ?2
         AND object_type = ?3
         AND object_id IN (${placeholders})`,
    ).bind(
      options.snapshot.epochId,
      options.snapshot.id,
      objectType(options.kind),
      ...ids,
    ).all<PositionedRow>()
    for (const row of result.results ?? []) output.set(row.object_id, row)
  }
  return output
}

async function fastRowsForIds(options: {
  db: D1Database
  context: FastLaneReadContext
  kind: ReadModelKind
  ids: string[]
}): Promise<Map<string, PositionedRow>> {
  const output = new Map<string, PositionedRow>()
  for (let offset = 0; offset < options.ids.length; offset += MAX_IDS_PER_QUERY) {
    const ids = options.ids.slice(offset, offset + MAX_IDS_PER_QUERY)
    if (ids.length === 0) continue
    const placeholders = ids.map((_, index) => `?${index + 4}`).join(', ')
    const result = await options.db.prepare(
      `SELECT object_id, operation, projection_json,
              source_ledger_index, source_transaction_index
       FROM fast_lane_shadow_objects_compact
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND object_type = ?2
         AND object_id IN (${placeholders})`,
    ).bind(
      options.context.epochId,
      objectType(options.kind),
      ...ids,
    ).all<PositionedRow>()
    for (const row of result.results ?? []) output.set(row.object_id, row)
  }
  return output
}

async function fastObject(options: {
  db: D1Database
  context: FastLaneReadContext
  kind: ReadModelKind
  objectId: string
}): Promise<PositionedRow | null> {
  return options.db.prepare(
    `SELECT object_id, operation, projection_json,
            source_ledger_index, source_transaction_index
     FROM fast_lane_shadow_objects_compact
     WHERE network = 'devnet'
       AND epoch_id = ?1
       AND object_type = ?2
       AND object_id = ?3
     LIMIT 1`,
  ).bind(options.context.epochId, objectType(options.kind), options.objectId).first<PositionedRow>()
}

async function overlayObject(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  objectId: string
}): Promise<PositionedRow | null> {
  return options.db.prepare(
    `SELECT object_id, operation, projection_json,
            source_ledger_index, source_transaction_index
     FROM current_state_overlay_objects
     WHERE network = 'devnet'
       AND epoch_id = ?1
       AND base_snapshot_id = ?2
       AND object_type = ?3
       AND object_id = ?4
     LIMIT 1`,
  ).bind(
    options.snapshot.epochId,
    options.snapshot.id,
    objectType(options.kind),
    options.objectId,
  ).first<PositionedRow>()
}

function fastSupersedesCanonical(options: {
  fast: PositionedRow
  overlay: PositionedRow | undefined | null
  snapshot: ActiveSnapshotRecord
}): boolean {
  if (options.overlay) return positionCompare(options.fast, options.overlay) > 0
  return options.fast.source_ledger_index > options.snapshot.ledgerIndex
}

async function loadFastPage(options: {
  db: D1Database
  context: FastLaneReadContext
  kind: ReadModelKind
  direction: Direction
  after: string | null
}): Promise<FastPage> {
  const comparison = options.direction === 'asc' ? '>' : '<'
  const order = options.direction === 'asc' ? 'ASC' : 'DESC'
  const bindings: unknown[] = [options.context.epochId, objectType(options.kind)]
  const afterCondition = options.after === null ? '' : `AND object_id ${comparison} ?3`
  if (options.after !== null) bindings.push(options.after)
  bindings.push(SOURCE_PAGE_SIZE)
  const limitParameter = `?${bindings.length}`
  const result = await options.db.prepare(
    `SELECT object_id, operation, projection_json,
            source_ledger_index, source_transaction_index
     FROM fast_lane_shadow_objects_compact
     WHERE network = 'devnet'
       AND epoch_id = ?1
       AND object_type = ?2
       AND operation = 'upsert'
       ${afterCondition}
     ORDER BY object_id ${order}
     LIMIT ${limitParameter}`,
  ).bind(...bindings).all<PositionedRow>()
  const rows = result.results ?? []
  return {
    rows,
    scanEndId: rows.at(-1)?.object_id ?? options.after,
    complete: rows.length < SOURCE_PAGE_SIZE,
  }
}

function compareIds(left: string, right: string, direction: Direction): number {
  const comparison = left.localeCompare(right)
  return direction === 'asc' ? comparison : -comparison
}

export async function getThreeLayerCurrentProjection(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  objectId: string
}): Promise<{ item: Projection | null; assetReads: number }> {
  const objectId = options.objectId.toUpperCase()
  const canonical = await getCanonicalCurrentProjection({ ...options, objectId })
  const context = await readFastLaneContext(options.db, options.snapshot)
  if (!context) return canonical

  try {
    const [fast, overlay] = await Promise.all([
      fastObject({ db: options.db, context, kind: options.kind, objectId }),
      overlayObject({
        db: options.db,
        snapshot: options.snapshot,
        kind: options.kind,
        objectId,
      }),
    ])
    if (!fast || !fastSupersedesCanonical({ fast, overlay, snapshot: options.snapshot })) {
      return canonical
    }
    if (fast.operation === 'deleted') return { item: null, assetReads: canonical.assetReads }
    return {
      item: parseFastProjection(fast, options.kind),
      assetReads: canonical.assetReads,
    }
  } catch {
    return canonical
  }
}

export async function listThreeLayerCurrentProjections(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
}): Promise<BaseOverlayListResult> {
  if (!Number.isSafeInteger(options.list.limit) || options.list.limit < 1 || options.list.limit > 100) {
    throw new Error('limit must be an integer from 1 to 100')
  }

  const context = await readFastLaneContext(options.db, options.snapshot)
  const cursor = decodeCursor({
    value: options.list.cursor,
    snapshot: options.snapshot,
    kind: options.kind,
    list: options.list,
    fastToken: context?.token ?? null,
  })
  const activeContext = cursor.fastToken === null ? null : context
  if (cursor.fastToken !== null && !activeContext) {
    throw new CurrentStateObjectReadError(
      'manifest_integrity_error',
      'fast-lane read context is unavailable during pagination',
    )
  }

  const predicate = options.list.predicate ?? (() => true)
  const output: Projection[] = []
  let basePageReads = 0
  let objectsExamined = 0
  let canonicalPageReads = 0
  let fastPageReads = 0

  while (output.length < options.list.limit && (!cursor.canonicalDone || !cursor.fastDone)) {
    let canonicalItems: Projection[] = []
    let canonicalNextCursor: string | null = null
    let fastForCanonical = new Map<string, PositionedRow>()
    let overlayForCanonical = new Map<string, PositionedRow>()

    if (!cursor.canonicalDone && canonicalPageReads < MAX_SOURCE_PAGE_READS) {
      const canonical = await listCanonicalCurrentProjections({
        db: options.db,
        source: options.source,
        snapshot: options.snapshot,
        kind: options.kind,
        list: {
          ...options.list,
          limit: SOURCE_PAGE_SIZE,
          cursor: cursor.canonicalCursor ?? undefined,
        },
      })
      canonicalPageReads += 1
      basePageReads += canonical.basePageReads
      objectsExamined += canonical.objectsExamined
      canonicalItems = canonical.items
      canonicalNextCursor = canonical.nextCursor
      if (cursor.canonicalOffset > canonicalItems.length) {
        throw new CurrentStateObjectReadError('invalid_cursor', 'canonical cursor offset is beyond the current page')
      }
      if (activeContext && canonicalItems.length > 0) {
        const ids = canonicalItems.map((item) => item.id)
        ;[fastForCanonical, overlayForCanonical] = await Promise.all([
          fastRowsForIds({ db: options.db, context: activeContext, kind: options.kind, ids }),
          overlayRowsForIds({ db: options.db, snapshot: options.snapshot, kind: options.kind, ids }),
        ])
      }
    }

    let fastPage: FastPage = { rows: [], scanEndId: cursor.fastAfter, complete: true }
    let overlayForFast = new Map<string, PositionedRow>()
    if (!cursor.fastDone && activeContext && fastPageReads < MAX_SOURCE_PAGE_READS) {
      fastPage = await loadFastPage({
        db: options.db,
        context: activeContext,
        kind: options.kind,
        direction: options.list.direction,
        after: cursor.fastAfter,
      })
      fastPageReads += 1
      objectsExamined += fastPage.rows.length
      if (cursor.fastOffset > fastPage.rows.length) {
        throw new CurrentStateObjectReadError('invalid_cursor', 'fast-lane cursor offset is beyond the current page')
      }
      if (fastPage.rows.length > 0) {
        overlayForFast = await overlayRowsForIds({
          db: options.db,
          snapshot: options.snapshot,
          kind: options.kind,
          ids: fastPage.rows.map((row) => row.object_id),
        })
      }
    }

    function canonicalCandidate(): Projection | null {
      while (cursor.canonicalOffset < canonicalItems.length) {
        const candidate = canonicalItems[cursor.canonicalOffset]!
        const fast = fastForCanonical.get(candidate.id)
        const overlay = overlayForCanonical.get(candidate.id)
        if (fast && fastSupersedesCanonical({ fast, overlay, snapshot: options.snapshot })) {
          cursor.canonicalOffset += 1
          continue
        }
        return candidate
      }
      return null
    }

    function fastCandidate(): Projection | null {
      while (cursor.fastOffset < fastPage.rows.length) {
        const row = fastPage.rows[cursor.fastOffset]!
        const overlay = overlayForFast.get(row.object_id)
        if (!fastSupersedesCanonical({ fast: row, overlay, snapshot: options.snapshot })) {
          cursor.fastOffset += 1
          continue
        }
        let projection: Projection
        try {
          projection = parseFastProjection(row, options.kind)
        } catch {
          cursor.fastOffset += 1
          continue
        }
        if (!predicate(projection)) {
          cursor.fastOffset += 1
          continue
        }
        return projection
      }
      return null
    }

    while (output.length < options.list.limit) {
      const canonical = canonicalCandidate()
      const fast = fastCandidate()
      if (!canonical && !fast) break
      if (canonical && (!fast || compareIds(canonical.id, fast.id, options.list.direction) < 0)) {
        output.push(canonical)
        cursor.canonicalOffset += 1
        continue
      }
      if (fast && (!canonical || compareIds(fast.id, canonical.id, options.list.direction) < 0)) {
        output.push(fast)
        cursor.fastOffset += 1
        continue
      }
      if (canonical && fast) {
        output.push(fast)
        cursor.canonicalOffset += 1
        cursor.fastOffset += 1
      }
    }

    let advanced = false
    if (!cursor.canonicalDone && cursor.canonicalOffset >= canonicalItems.length) {
      if (canonicalNextCursor === null) {
        cursor.canonicalDone = true
      } else {
        cursor.canonicalCursor = canonicalNextCursor
        cursor.canonicalOffset = 0
        advanced = true
      }
    }
    if (!cursor.fastDone && cursor.fastOffset >= fastPage.rows.length) {
      if (fastPage.complete) {
        cursor.fastDone = true
      } else {
        cursor.fastAfter = fastPage.scanEndId
        cursor.fastOffset = 0
        advanced = true
      }
    }

    if (output.length >= options.list.limit) break
    if (!advanced) break
    if (canonicalPageReads >= MAX_SOURCE_PAGE_READS && fastPageReads >= MAX_SOURCE_PAGE_READS) break
  }

  const complete = cursor.canonicalDone && cursor.fastDone
  return {
    items: output,
    nextCursor: complete ? null : encodeCursor(cursor),
    basePageReads,
    objectsExamined,
  }
}
