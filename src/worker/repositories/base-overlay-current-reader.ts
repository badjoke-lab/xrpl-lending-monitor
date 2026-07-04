import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'
import {
  normalizeReleaseRecord,
  type ReleaseCurrentStateSource,
} from './release-current-state'

type Projection = VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection

type Direction = 'asc' | 'desc'

interface HybridCursor {
  v: 1
  snapshot: string
  kind: ReadModelKind
  direction: Direction
  scope: string
  baseCursor: string | null
  baseOffset: number
  baseDone: boolean
  overlayAfter: string | null
  overlayOffset: number
  overlayDone: boolean
}

interface OverlayRow {
  object_id: string
  operation: 'upsert' | 'deleted'
  projection_json: string | null
}

interface OverlayStateRow {
  network: string
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  overlay_ledger_index: number
  overlay_ledger_hash: string
  updated_at: string
}

export interface BaseOverlayListOptions {
  limit: number
  cursor?: string
  direction: Direction
  scope: string
  maxBasePageReads?: number
  predicate?: (projection: Projection) => boolean
}

export interface BaseOverlayListResult {
  items: Projection[]
  nextCursor: string | null
  basePageReads: number
  objectsExamined: number
}

const OVERLAY_PAGE_SIZE = 100
const MAX_OVERLAY_PAGE_READS = 4

function objectType(kind: ReadModelKind): 'vault' | 'loan_broker' | 'loan' {
  return kind === 'loan-broker' ? 'loan_broker' : kind
}

function expectedProjectionKind(kind: ReadModelKind): 'vault' | 'loan_broker' | 'loan' {
  return objectType(kind)
}

function isMissingOverlaySchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no such table: current_state_overlay_')
    || message.includes('no such table: main.current_state_overlay_')
}

function encodeCursor(cursor: HybridCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeCursor(
  value: string | undefined,
  expected: Pick<HybridCursor, 'snapshot' | 'kind' | 'direction' | 'scope'>,
): HybridCursor {
  if (!value) {
    return {
      v: 1,
      ...expected,
      baseCursor: null,
      baseOffset: 0,
      baseDone: false,
      overlayAfter: null,
      overlayOffset: 0,
      overlayDone: false,
    }
  }
  try {
    if (value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) throw new Error('invalid')
    const bytes = new Uint8Array(value.length / 2)
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    }
    const source = JSON.parse(new TextDecoder().decode(bytes)) as Partial<HybridCursor>
    if (
      source.v !== 1
      || source.snapshot !== expected.snapshot
      || source.kind !== expected.kind
      || source.direction !== expected.direction
      || source.scope !== expected.scope
      || typeof source.baseDone !== 'boolean'
      || typeof source.overlayDone !== 'boolean'
      || !Number.isSafeInteger(source.baseOffset)
      || Number(source.baseOffset) < 0
      || !Number.isSafeInteger(source.overlayOffset)
      || Number(source.overlayOffset) < 0
      || (source.baseCursor !== null && typeof source.baseCursor !== 'string')
      || (source.overlayAfter !== null && typeof source.overlayAfter !== 'string')
    ) throw new Error('invalid')
    return source as HybridCursor
  } catch {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor does not match the base-plus-overlay query')
  }
}

async function readOverlayState(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
): Promise<OverlayStateRow | null> {
  try {
    const row = await db.prepare(
      `SELECT network, epoch_id, base_snapshot_id, base_ledger_index,
              base_ledger_hash, overlay_ledger_index, overlay_ledger_hash, updated_at
       FROM current_state_overlay_state
       WHERE network = 'devnet' AND epoch_id = ?1 AND base_snapshot_id = ?2
       LIMIT 1`,
    ).bind(snapshot.epochId, snapshot.id).first<OverlayStateRow>()
    if (!row) return null
    if (
      row.network !== 'devnet'
      || row.epoch_id !== snapshot.epochId
      || row.base_snapshot_id !== snapshot.id
      || row.base_ledger_index !== snapshot.ledgerIndex
      || row.base_ledger_hash !== snapshot.ledgerHash
      || row.overlay_ledger_index < row.base_ledger_index
    ) {
      throw new CurrentStateObjectReadError('manifest_integrity_error', 'overlay base identity mismatch')
    }
    return row
  } catch (error) {
    if (isMissingOverlaySchema(error)) return null
    throw error
  }
}

async function overlayObject(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
  kind: ReadModelKind,
  objectId: string,
): Promise<OverlayRow | null> {
  try {
    return await db.prepare(
      `SELECT object_id, operation, projection_json
       FROM current_state_overlay_objects
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND base_snapshot_id = ?2
         AND object_type = ?3
         AND object_id = ?4
       LIMIT 1`,
    ).bind(snapshot.epochId, snapshot.id, objectType(kind), objectId).first<OverlayRow>()
  } catch (error) {
    if (isMissingOverlaySchema(error)) return null
    throw error
  }
}

function parseOverlayProjection(row: OverlayRow, kind: ReadModelKind): Projection {
  if (row.operation !== 'upsert' || row.projection_json === null) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'overlay projection is unavailable')
  }
  let value: unknown
  try {
    value = JSON.parse(row.projection_json)
  } catch {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'overlay projection JSON is invalid')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'overlay projection shape is invalid')
  }
  const projection = value as Projection
  if (projection.id !== row.object_id || projection.kind !== expectedProjectionKind(kind)) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'overlay projection identity mismatch')
  }
  return projection
}

async function baseProjection(
  source: ReleaseCurrentStateSource,
  kind: ReadModelKind,
  objectId: string,
): Promise<{ item: Projection | null; assetReads: number }> {
  const found = await source.opened.reader.getObject(objectId, { maxAssetReads: 512 })
  if (!found.complete) {
    throw new CurrentStateObjectReadError('relationship_read_limit', 'base current-state read limit exceeded')
  }
  if (!found.item) return { item: null, assetReads: found.assetReads }
  if (found.item.kind !== kind) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'base object kind mismatch')
  }
  return { item: normalizeReleaseRecord(found.item), assetReads: found.assetReads }
}

export async function getResolvedCurrentProjection(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  objectId: string
}): Promise<{ item: Projection | null; assetReads: number }> {
  await readOverlayState(options.db, options.snapshot)
  const overlay = await overlayObject(
    options.db,
    options.snapshot,
    options.kind,
    options.objectId.toUpperCase(),
  )
  if (overlay?.operation === 'deleted') return { item: null, assetReads: 0 }
  if (overlay?.operation === 'upsert') {
    return { item: parseOverlayProjection(overlay, options.kind), assetReads: 0 }
  }
  return baseProjection(options.source, options.kind, options.objectId.toUpperCase())
}

async function overlayOperationsForIds(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  ids: string[]
}): Promise<Map<string, OverlayRow['operation']>> {
  if (options.ids.length === 0) return new Map()
  const placeholders = options.ids.map((_, index) => `?${index + 4}`).join(', ')
  try {
    const result = await options.db.prepare(
      `SELECT object_id, operation, projection_json
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
      ...options.ids,
    ).all<OverlayRow>()
    return new Map((result.results ?? []).map((row) => [row.object_id, row.operation]))
  } catch (error) {
    if (isMissingOverlaySchema(error)) return new Map()
    throw error
  }
}

async function loadOverlayPage(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  direction: Direction
  after: string | null
  predicate: (projection: Projection) => boolean
}): Promise<{
  items: Projection[]
  rawRows: number
  scanEndId: string | null
  complete: boolean
}> {
  const comparison = options.direction === 'asc' ? '>' : '<'
  const order = options.direction === 'asc' ? 'ASC' : 'DESC'
  const values: unknown[] = [options.snapshot.epochId, options.snapshot.id, objectType(options.kind)]
  const afterCondition = options.after === null ? '' : `AND object_id ${comparison} ?4`
  if (options.after !== null) values.push(options.after)
  values.push(OVERLAY_PAGE_SIZE)
  const limitParameter = `?${values.length}`
  try {
    const result = await options.db.prepare(
      `SELECT object_id, operation, projection_json
       FROM current_state_overlay_objects
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND base_snapshot_id = ?2
         AND object_type = ?3
         AND operation = 'upsert'
         ${afterCondition}
       ORDER BY object_id ${order}
       LIMIT ${limitParameter}`,
    ).bind(...values).all<OverlayRow>()
    const rows = result.results ?? []
    const items = rows
      .map((row) => parseOverlayProjection(row, options.kind))
      .filter(options.predicate)
    return {
      items,
      rawRows: rows.length,
      scanEndId: rows.at(-1)?.object_id ?? options.after,
      complete: rows.length < OVERLAY_PAGE_SIZE,
    }
  } catch (error) {
    if (isMissingOverlaySchema(error)) {
      return { items: [], rawRows: 0, scanEndId: options.after, complete: true }
    }
    throw error
  }
}

function compareIds(left: string, right: string, direction: Direction): number {
  const comparison = left.localeCompare(right)
  return direction === 'asc' ? comparison : -comparison
}

export async function listResolvedCurrentProjections(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
}): Promise<BaseOverlayListResult> {
  if (!Number.isSafeInteger(options.list.limit) || options.list.limit < 1 || options.list.limit > 100) {
    throw new Error('limit must be an integer from 1 to 100')
  }
  await readOverlayState(options.db, options.snapshot)
  const predicate = options.list.predicate ?? (() => true)
  const cursor = decodeCursor(options.list.cursor, {
    snapshot: options.snapshot.id,
    kind: options.kind,
    direction: options.list.direction,
    scope: options.list.scope,
  })

  const output: Projection[] = []
  let basePageReads = 0
  let objectsExamined = 0
  let overlayPageReads = 0

  while (output.length < options.list.limit && (!cursor.baseDone || !cursor.overlayDone)) {
    let baseItems: Projection[] = []
    let baseNextCursor: string | null = null
    if (!cursor.baseDone) {
      const baseResult = await options.source.opened.reader.listObjects(
        options.kind,
        {
          limit: 100,
          cursor: cursor.baseCursor ?? undefined,
          maxAssetReads: Math.max(1, Math.min(options.list.maxBasePageReads ?? 4, 4)),
          direction: options.list.direction,
        },
        (record) => predicate(normalizeReleaseRecord(record)),
      )
      basePageReads += baseResult.assetReads
      objectsExamined += baseResult.items.length
      baseItems = baseResult.items.map((record) => normalizeReleaseRecord(record))
      baseNextCursor = baseResult.nextCursor
      if (cursor.baseOffset > baseItems.length) {
        throw new CurrentStateObjectReadError('invalid_cursor', 'base cursor offset is beyond the current page')
      }
      if (cursor.baseOffset >= baseItems.length) {
        if (baseNextCursor === null) {
          cursor.baseDone = true
        } else {
          cursor.baseCursor = baseNextCursor
          cursor.baseOffset = 0
          continue
        }
      }
    }

    let overlayItems: Projection[] = []
    let overlayPage: Awaited<ReturnType<typeof loadOverlayPage>> | null = null
    if (!cursor.overlayDone) {
      overlayPage = await loadOverlayPage({
        db: options.db,
        snapshot: options.snapshot,
        kind: options.kind,
        direction: options.list.direction,
        after: cursor.overlayAfter,
        predicate,
      })
      overlayPageReads += 1
      objectsExamined += overlayPage.rawRows
      overlayItems = overlayPage.items
      if (cursor.overlayOffset > overlayItems.length) {
        throw new CurrentStateObjectReadError('invalid_cursor', 'overlay cursor offset is beyond the current page')
      }
      if (cursor.overlayOffset >= overlayItems.length) {
        if (overlayPage.complete) {
          cursor.overlayDone = true
        } else {
          cursor.overlayAfter = overlayPage.scanEndId
          cursor.overlayOffset = 0
          if (overlayPageReads >= MAX_OVERLAY_PAGE_READS) break
          continue
        }
      }
    }

    const activeBaseIds = baseItems.slice(cursor.baseOffset).map((item) => item.id)
    const overlayOperations = await overlayOperationsForIds({
      db: options.db,
      snapshot: options.snapshot,
      kind: options.kind,
      ids: activeBaseIds,
    })

    while (output.length < options.list.limit) {
      while (
        !cursor.baseDone
        && cursor.baseOffset < baseItems.length
        && overlayOperations.has(baseItems[cursor.baseOffset]!.id)
      ) {
        cursor.baseOffset += 1
      }

      const base = cursor.baseDone || cursor.baseOffset >= baseItems.length
        ? null
        : baseItems[cursor.baseOffset]!
      const overlay = cursor.overlayDone || cursor.overlayOffset >= overlayItems.length
        ? null
        : overlayItems[cursor.overlayOffset]!

      if (!base && !overlay) break
      if (base && (!overlay || compareIds(base.id, overlay.id, options.list.direction) < 0)) {
        output.push(base)
        cursor.baseOffset += 1
        continue
      }
      if (overlay && (!base || compareIds(overlay.id, base.id, options.list.direction) < 0)) {
        output.push(overlay)
        cursor.overlayOffset += 1
        continue
      }
      if (base && overlay) {
        output.push(overlay)
        cursor.baseOffset += 1
        cursor.overlayOffset += 1
      }
    }

    if (!cursor.baseDone && cursor.baseOffset >= baseItems.length) {
      if (baseNextCursor === null) {
        cursor.baseDone = true
      } else {
        cursor.baseCursor = baseNextCursor
        cursor.baseOffset = 0
      }
    }
    if (!cursor.overlayDone && overlayPage && cursor.overlayOffset >= overlayItems.length) {
      if (overlayPage.complete) {
        cursor.overlayDone = true
      } else {
        cursor.overlayAfter = overlayPage.scanEndId
        cursor.overlayOffset = 0
      }
    }
  }

  const complete = cursor.baseDone && cursor.overlayDone
  return {
    items: output,
    nextCursor: complete ? null : encodeCursor(cursor),
    basePageReads,
    objectsExamined,
  }
}

export async function readResolvedOverlayState(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
}): Promise<{
  overlayLedgerIndex: number
  overlayLedgerHash: string
  updatedAt: string
} | null> {
  const row = await readOverlayState(options.db, options.snapshot)
  return row ? {
    overlayLedgerIndex: row.overlay_ledger_index,
    overlayLedgerHash: row.overlay_ledger_hash,
    updatedAt: row.updated_at,
  } : null
}
