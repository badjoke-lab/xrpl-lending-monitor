import type {
  LoanBrokerCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  decodeD1Cursor,
  encodeD1Cursor,
  parseLoanBrokerProjection,
  parseVaultProjection,
} from './d1-current-reader-common'
import { CurrentStateObjectReadError } from './current-state-object-reader'

export type LoanBrokerSort = 'id_asc' | 'id_desc'

export interface CurrentLoanBrokerRecord {
  broker: LoanBrokerCurrentProjection
  vault: VaultCurrentProjection
}

export interface ListCurrentLoanBrokersOptions {
  limit: number
  cursor?: string
  sort?: LoanBrokerSort
  query?: string
}

export interface ListCurrentLoanBrokersResult {
  data: CurrentLoanBrokerRecord[]
  nextCursor: string | null
  brokerShardsRead: number
  relationShardsRead: number
  objectsExamined: number
}

interface BrokerRow {
  object_id: string
  broker_projection_json: string
  broker_raw_json: string
  vault_projection_json: string
  vault_raw_json: string
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export async function listCurrentLoanBrokers(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoanBrokersOptions,
): Promise<ListCurrentLoanBrokersResult> {
  const sort = options.sort ?? 'id_asc'
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('limit must be an integer from 1 to 100')
  }
  const cursor = options.cursor ? decodeD1Cursor(options.cursor) : null
  if (cursor && cursor.snapshotId !== snapshot.id) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor belongs to a different snapshot')
  }
  if (cursor && cursor.sort !== sort) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor sort does not match request sort')
  }

  const conditions = ['broker.snapshot_id = ?1']
  const values: unknown[] = [snapshot.id]
  if (cursor) {
    conditions.push(`broker.object_id ${sort === 'id_asc' ? '>' : '<'} ?${values.length + 1}`)
    values.push(cursor.lastObjectId)
  }
  if (options.query) {
    const parameter = `?${values.length + 1}`
    conditions.push(`(
      broker.object_id LIKE ${parameter} ESCAPE '\\' OR
      broker.vault_id LIKE ${parameter} ESCAPE '\\' OR
      broker.owner LIKE ${parameter} ESCAPE '\\' OR
      broker.account LIKE ${parameter} ESCAPE '\\'
    )`)
    values.push(`%${escapeLike(options.query)}%`)
  }
  values.push(options.limit + 1)

  const result = await db
    .prepare(
      `SELECT broker.object_id,
              broker.projection_json AS broker_projection_json,
              broker.raw_json AS broker_raw_json,
              vault.projection_json AS vault_projection_json,
              vault.raw_json AS vault_raw_json
       FROM current_state_d1_loan_brokers broker
       JOIN current_state_d1_vaults vault
         ON vault.snapshot_id = broker.snapshot_id
        AND vault.object_id = broker.vault_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY broker.object_id ${sort === 'id_asc' ? 'ASC' : 'DESC'}
       LIMIT ?${values.length}`,
    )
    .bind(...values)
    .all<BrokerRow>()

  const rows = result.results ?? []
  const pageRows = rows.slice(0, options.limit)
  const data = pageRows.map((row) => ({
    broker: parseLoanBrokerProjection(row.broker_projection_json, row.broker_raw_json),
    vault: parseVaultProjection(row.vault_projection_json, row.vault_raw_json),
  }))
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
    brokerShardsRead: 0,
    relationShardsRead: 0,
    objectsExamined: rows.length,
  }
}

export async function getCurrentLoanBrokerById(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
  brokerId: string,
): Promise<CurrentLoanBrokerRecord | null> {
  const normalizedId = brokerId.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalizedId)) return null
  const row = await db
    .prepare(
      `SELECT broker.projection_json AS broker_projection_json,
              broker.raw_json AS broker_raw_json,
              vault.projection_json AS vault_projection_json,
              vault.raw_json AS vault_raw_json
       FROM current_state_d1_loan_brokers broker
       JOIN current_state_d1_vaults vault
         ON vault.snapshot_id = broker.snapshot_id
        AND vault.object_id = broker.vault_id
       WHERE broker.snapshot_id = ?1 AND broker.object_id = ?2`,
    )
    .bind(snapshot.id, normalizedId)
    .first<Omit<BrokerRow, 'object_id'>>()
  return row
    ? {
        broker: parseLoanBrokerProjection(row.broker_projection_json, row.broker_raw_json),
        vault: parseVaultProjection(row.vault_projection_json, row.vault_raw_json),
      }
    : null
}
