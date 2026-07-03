import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  decodeD1Cursor,
  encodeD1Cursor,
  parseVaultProjection,
} from './d1-current-reader-common'
import { CurrentStateObjectReadError } from './current-state-object-reader'

export type VaultSort = 'id_asc' | 'id_desc'

export interface ListCurrentVaultsOptions {
  limit: number
  cursor?: string
  sort?: VaultSort
  query?: string
  hasLoss?: boolean
}

export interface ListCurrentVaultsResult {
  data: VaultCurrentProjection[]
  nextCursor: string | null
  shardsRead: number
  objectsExamined: number
}

interface VaultRow {
  object_id: string
  projection_json: string
  raw_json: string
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function validateCursor(
  cursor: ReturnType<typeof decodeD1Cursor> | null,
  snapshot: ActiveSnapshotRecord,
  sort: VaultSort,
): void {
  if (cursor && cursor.snapshotId !== snapshot.id) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor belongs to a different snapshot')
  }
  if (cursor && cursor.sort !== sort) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor sort does not match request sort')
  }
}

export async function listCurrentVaults(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentVaultsOptions,
): Promise<ListCurrentVaultsResult> {
  const sort = options.sort ?? 'id_asc'
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('limit must be an integer from 1 to 100')
  }
  const cursor = options.cursor ? decodeD1Cursor(options.cursor) : null
  validateCursor(cursor, snapshot, sort)

  const conditions = ['snapshot_id = ?1']
  const values: unknown[] = [snapshot.id]
  if (cursor) {
    conditions.push(`object_id ${sort === 'id_asc' ? '>' : '<'} ?${values.length + 1}`)
    values.push(cursor.lastObjectId)
  }
  if (options.query) {
    const parameter = `?${values.length + 1}`
    conditions.push(`(
      object_id LIKE ${parameter} ESCAPE '\\' OR
      owner LIKE ${parameter} ESCAPE '\\' OR
      account LIKE ${parameter} ESCAPE '\\' OR
      asset_key LIKE ${parameter} ESCAPE '\\'
    )`)
    values.push(`%${escapeLike(options.query)}%`)
  }
  if (options.hasLoss !== undefined) {
    conditions.push(`has_unrealized_loss = ?${values.length + 1}`)
    values.push(options.hasLoss ? 1 : 0)
  }
  values.push(options.limit + 1)

  const result = await db
    .prepare(
      `SELECT object_id, projection_json, raw_json
       FROM current_state_d1_vaults
       WHERE ${conditions.join(' AND ')}
       ORDER BY object_id ${sort === 'id_asc' ? 'ASC' : 'DESC'}
       LIMIT ?${values.length}`,
    )
    .bind(...values)
    .all<VaultRow>()

  const rows = result.results ?? []
  const pageRows = rows.slice(0, options.limit)
  const data = pageRows.map((row) => parseVaultProjection(row.projection_json, row.raw_json))
  const last = pageRows.at(-1)
  const nextCursor = rows.length > options.limit && last
    ? encodeD1Cursor({
        version: 1,
        snapshotId: snapshot.id,
        lastObjectId: last.object_id,
        sort,
      })
    : null

  return {
    data,
    nextCursor,
    shardsRead: 0,
    objectsExamined: rows.length,
  }
}

export async function getCurrentVaultById(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
  vaultId: string,
): Promise<VaultCurrentProjection | null> {
  const normalizedId = vaultId.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalizedId)) return null
  const row = await db
    .prepare(
      `SELECT projection_json, raw_json
       FROM current_state_d1_vaults
       WHERE snapshot_id = ?1 AND object_id = ?2`,
    )
    .bind(snapshot.id, normalizedId)
    .first<Pick<VaultRow, 'projection_json' | 'raw_json'>>()
  return row ? parseVaultProjection(row.projection_json, row.raw_json) : null
}
