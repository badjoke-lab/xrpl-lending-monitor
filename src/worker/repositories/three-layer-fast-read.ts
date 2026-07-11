import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { readFastLaneShadowBaseBinding } from './fast-lane-shadow-base-binding'
import { readFastLaneShadowState } from './fast-lane-shadow-repository'

export type ThreeLayerProjection = VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection

export interface PositionedCurrentRow {
  object_id: string
  operation: 'upsert' | 'deleted'
  projection_json: string | null
  source_ledger_index: number
  source_transaction_index: number
}

export interface FastLaneReadContext {
  epochId: string
  token: string
}

export interface FastLanePage {
  rows: PositionedCurrentRow[]
  scanEndId: string | null
  complete: boolean
}

const PAGE_SIZE = 100
const MAX_IDS_PER_QUERY = 90

export function currentObjectType(kind: ReadModelKind): 'vault' | 'loan_broker' | 'loan' {
  return kind === 'loan-broker' ? 'loan_broker' : kind
}

function sameHash(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase()
}

function positionCompare(left: PositionedCurrentRow, right: PositionedCurrentRow): number {
  if (left.source_ledger_index !== right.source_ledger_index) {
    return left.source_ledger_index - right.source_ledger_index
  }
  return left.source_transaction_index - right.source_transaction_index
}

export async function readFastLaneContext(
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
  } catch {
    return null
  }
}

export function parseFastProjection(
  row: PositionedCurrentRow,
  kind: ReadModelKind,
): ThreeLayerProjection {
  if (row.operation !== 'upsert' || row.projection_json === null) {
    throw new Error('fast-lane projection is unavailable')
  }
  const value = JSON.parse(row.projection_json) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('fast-lane projection shape is invalid')
  }
  const projection = value as ThreeLayerProjection
  if (projection.id !== row.object_id || projection.kind !== currentObjectType(kind)) {
    throw new Error('fast-lane projection identity mismatch')
  }
  return projection
}

export function fastIsNewer(
  fast: PositionedCurrentRow,
  overlay: PositionedCurrentRow | null | undefined,
  snapshot: ActiveSnapshotRecord,
): boolean {
  return overlay
    ? positionCompare(fast, overlay) > 0
    : fast.source_ledger_index > snapshot.ledgerIndex
}

export function usableFastSupersedes(options: {
  fast: PositionedCurrentRow
  overlay: PositionedCurrentRow | null | undefined
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
}): boolean {
  if (!fastIsNewer(options.fast, options.overlay, options.snapshot)) return false
  if (options.fast.operation === 'deleted') return true
  try {
    parseFastProjection(options.fast, options.kind)
    return true
  } catch {
    return false
  }
}

export async function overlayRowsForIds(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  ids: string[]
}): Promise<Map<string, PositionedCurrentRow>> {
  const output = new Map<string, PositionedCurrentRow>()
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
      currentObjectType(options.kind),
      ...ids,
    ).all<PositionedCurrentRow>()
    for (const row of result.results ?? []) output.set(row.object_id, row)
  }
  return output
}

export async function fastRowsForIds(options: {
  db: D1Database
  context: FastLaneReadContext
  kind: ReadModelKind
  ids: string[]
}): Promise<Map<string, PositionedCurrentRow>> {
  const output = new Map<string, PositionedCurrentRow>()
  for (let offset = 0; offset < options.ids.length; offset += MAX_IDS_PER_QUERY) {
    const ids = options.ids.slice(offset, offset + MAX_IDS_PER_QUERY)
    if (ids.length === 0) continue
    const placeholders = ids.map((_, index) => `?${index + 3}`).join(', ')
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
      currentObjectType(options.kind),
      ...ids,
    ).all<PositionedCurrentRow>()
    for (const row of result.results ?? []) output.set(row.object_id, row)
  }
  return output
}

export async function overlayObject(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  objectId: string
}): Promise<PositionedCurrentRow | null> {
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
    currentObjectType(options.kind),
    options.objectId,
  ).first<PositionedCurrentRow>()
}

export async function fastObject(options: {
  db: D1Database
  context: FastLaneReadContext
  kind: ReadModelKind
  objectId: string
}): Promise<PositionedCurrentRow | null> {
  return options.db.prepare(
    `SELECT object_id, operation, projection_json,
            source_ledger_index, source_transaction_index
     FROM fast_lane_shadow_objects_compact
     WHERE network = 'devnet'
       AND epoch_id = ?1
       AND object_type = ?2
       AND object_id = ?3
     LIMIT 1`,
  ).bind(
    options.context.epochId,
    currentObjectType(options.kind),
    options.objectId,
  ).first<PositionedCurrentRow>()
}

export async function loadFastLanePage(options: {
  db: D1Database
  context: FastLaneReadContext
  kind: ReadModelKind
  direction: 'asc' | 'desc'
  after: string | null
}): Promise<FastLanePage> {
  const comparison = options.direction === 'asc' ? '>' : '<'
  const order = options.direction === 'asc' ? 'ASC' : 'DESC'
  const bindings: unknown[] = [options.context.epochId, currentObjectType(options.kind)]
  const afterCondition = options.after === null ? '' : `AND object_id ${comparison} ?3`
  if (options.after !== null) bindings.push(options.after)
  bindings.push(PAGE_SIZE)
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
     LIMIT ?${bindings.length}`,
  ).bind(...bindings).all<PositionedCurrentRow>()
  const rows = result.results ?? []
  return {
    rows,
    scanEndId: rows.at(-1)?.object_id ?? options.after,
    complete: rows.length < PAGE_SIZE,
  }
}
