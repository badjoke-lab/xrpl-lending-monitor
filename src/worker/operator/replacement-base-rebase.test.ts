import { describe, expect, it } from 'vitest'

import { rebaseToReplacementBase } from './replacement-base-rebase'

interface PreparedRecord {
  sql: string
  values: unknown[]
}

const EPOCH = 'devnet-3371675'
const OLD_SNAPSHOT = 'devnet-3371675-0ba2ed766c19'
const TARGET_SNAPSHOT = 'devnet-3432924-canonical'
const OLD_HASH = '1'.repeat(64)
const TARGET_HASH = '2'.repeat(64)
const HEAD_HASH = '3'.repeat(64)

const target = {
  epochId: EPOCH,
  snapshotId: TARGET_SNAPSHOT,
  ledgerIndex: 3432924,
  ledgerHash: TARGET_HASH,
}

function syncRow(rebased: boolean) {
  return {
    network: 'devnet',
    epoch_id: EPOCH,
    last_processed_ledger: rebased ? target.ledgerIndex : 3390079,
    last_processed_hash: rebased ? target.ledgerHash : OLD_HASH,
    latest_observed_ledger: 3435000,
    latest_observed_hash: HEAD_HASH,
    latest_ledger_age_seconds: 1,
    last_attempt_at: '2026-07-06T00:00:00.000Z',
    last_success_at: '2026-07-06T00:00:00.000Z',
    status: 'healthy',
    consecutive_failures: 0,
    endpoint: 'https://devnet.example/',
    server_version: 'test',
    server_state: 'full',
    complete_ledgers: '1-3435000',
    lending_protocol_enabled: 1,
    lending_protocol_supported: 1,
    single_asset_vault_enabled: 1,
    single_asset_vault_supported: 1,
    reset_reason: null,
    error_code: null,
    error_message: null,
    created_at: '2026-07-05T00:00:00.000Z',
    updated_at: '2026-07-06T00:00:00.000Z',
  }
}

function epochRow() {
  return {
    id: EPOCH,
    network: 'devnet',
    status: 'current',
    first_ledger_index: 3371675,
    first_ledger_hash: '0'.repeat(64),
    last_ledger_index: 3435000,
    last_ledger_hash: HEAD_HASH,
    started_at: '2026-07-05T00:00:00.000Z',
    ended_at: null,
    reset_reason: null,
    created_at: '2026-07-05T00:00:00.000Z',
    updated_at: '2026-07-06T00:00:00.000Z',
  }
}

function overlayRows(rebased: boolean) {
  const rows = [{
    network: 'devnet',
    epoch_id: EPOCH,
    base_snapshot_id: OLD_SNAPSHOT,
    base_ledger_index: 3371675,
    base_ledger_hash: '0'.repeat(64),
    overlay_ledger_index: 3390079,
    overlay_ledger_hash: OLD_HASH,
    updated_at: '2026-07-06T00:00:00.000Z',
  }]
  if (rebased) {
    rows.unshift({
      network: 'devnet',
      epoch_id: EPOCH,
      base_snapshot_id: TARGET_SNAPSHOT,
      base_ledger_index: target.ledgerIndex,
      base_ledger_hash: target.ledgerHash,
      overlay_ledger_index: target.ledgerIndex,
      overlay_ledger_hash: target.ledgerHash,
      updated_at: '2026-07-06T01:00:00.000Z',
    })
  }
  return rows
}

function fakeDatabase(initiallyRebased = false) {
  const prepared: PreparedRecord[] = []
  const batches: number[][] = []
  let rebased = initiallyRebased

  const db = {
    prepare(sql: string) {
      const index = prepared.length
      const record: PreparedRecord = { sql, values: [] }
      prepared.push(record)
      const statement = {
        __index: index,
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async first<T>() {
          if (sql.includes('SELECT * FROM sync_state')) return syncRow(rebased) as T
          if (sql.includes("FROM network_epochs") && sql.includes("status = 'current'")) return epochRow() as T
          throw new Error(`Unexpected first query: ${sql}`)
        },
        async all<T>() {
          if (sql.includes('FROM current_state_overlay_state')) {
            return { results: overlayRows(rebased) } as T
          }
          throw new Error(`Unexpected all query: ${sql}`)
        },
      }
      return statement
    },
    async batch(statements: Array<{ __index?: number }>) {
      batches.push(statements.map((statement) => statement.__index ?? -1))
      rebased = true
      return []
    },
  }

  return { db: db as unknown as D1Database, prepared, batches }
}

describe('replacement-base rebase operator', () => {
  it('orders guards, target overlay insertion, cursor CAS, post-guards, and cleanup in one batch', async () => {
    const state = fakeDatabase()
    const result = await rebaseToReplacementBase({
      db: state.db,
      target,
      rebasedAt: '2026-07-06T01:00:00.000Z',
    })

    expect(result.status).toBe('rebased')
    expect(state.batches).toHaveLength(1)
    const sql = state.batches[0]!.map((index) => state.prepared[index]!.sql)

    expect(sql).toHaveLength(11)
    expect(sql[0]).toContain('INSERT INTO catch_up_initialization_guards')
    expect(sql[1]).toContain('INSERT INTO catch_up_overlay_guards')
    expect(sql[2]).toContain('INSERT INTO catch_up_epoch_guards')
    expect(sql[3]).toContain('INSERT INTO current_state_overlay_state')
    expect(sql[4]).toContain('UPDATE sync_state')
    expect(sql[5]).toContain('INSERT INTO catch_up_initialization_guards')
    expect(sql[6]).toContain('INSERT INTO catch_up_overlay_guards')
    expect(sql[7]).toContain('INSERT INTO catch_up_epoch_guards')
    expect(sql[8]).toContain('DELETE FROM catch_up_initialization_guards')
    expect(sql[9]).toContain('DELETE FROM catch_up_overlay_guards')
    expect(sql[10]).toContain('DELETE FROM catch_up_epoch_guards')

    const insertTarget = state.prepared[state.batches[0]![3]!]!
    expect(insertTarget.values).toEqual([
      EPOCH,
      TARGET_SNAPSHOT,
      target.ledgerIndex,
      target.ledgerHash,
      '2026-07-06T01:00:00.000Z',
    ])

    const updateCursor = state.prepared[state.batches[0]![4]!]!
    expect(updateCursor.values).toEqual([
      target.ledgerIndex,
      target.ledgerHash,
      '2026-07-06T01:00:00.000Z',
      EPOCH,
      3390079,
      OLD_HASH,
      3435000,
      HEAD_HASH,
    ])
  })

  it('returns ready without writes during dry-run', async () => {
    const state = fakeDatabase()
    const result = await rebaseToReplacementBase({
      db: state.db,
      target,
      rebasedAt: '2026-07-06T01:00:00.000Z',
      dryRun: true,
    })

    expect(result.status).toBe('ready')
    expect(result.plan.action).toBe('rebase')
    expect(state.batches).toEqual([])
  })

  it('returns replayed without writes for an already aligned target', async () => {
    const state = fakeDatabase(true)
    const result = await rebaseToReplacementBase({
      db: state.db,
      target,
      rebasedAt: '2026-07-06T01:00:00.000Z',
    })

    expect(result.status).toBe('replayed')
    expect(state.batches).toEqual([])
  })
})
