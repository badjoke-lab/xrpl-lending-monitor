import { describe, expect, it } from 'vitest'
import { initializeCatchUpFromVerifiedBase } from './catch-up-initialization'

interface PreparedRecord {
  sql: string
  values: unknown[]
}

const base = {
  epochId: 'devnet-3371675',
  snapshotId: 'devnet-3371675-0ba2ed766c19',
  ledgerIndex: 3371675,
  ledgerHash: '0BA2ED766C190C733F8F26288785CBDF01D0FC26E1A6C03EDB7E9DFF6F8BCB90',
}

function syncRow(initialized: boolean) {
  return {
    network: 'devnet',
    epoch_id: initialized ? base.epochId : 'devnet:4000000:abcdef0123456789',
    last_processed_ledger: initialized ? base.ledgerIndex : null,
    last_processed_hash: initialized ? base.ledgerHash : null,
    latest_observed_ledger: 4000000,
    latest_observed_hash: 'HEAD_HASH',
    latest_ledger_age_seconds: 1,
    last_attempt_at: '2026-07-05T00:00:00.000Z',
    last_success_at: '2026-07-05T00:00:00.000Z',
    status: 'healthy',
    consecutive_failures: 0,
    endpoint: 'https://devnet.example/',
    server_version: 'test',
    server_state: 'full',
    complete_ledgers: '1-4000000',
    lending_protocol_enabled: 1,
    lending_protocol_supported: 1,
    single_asset_vault_enabled: 1,
    single_asset_vault_supported: 1,
    reset_reason: null,
    error_code: null,
    error_message: null,
    created_at: '2026-07-05T00:00:00.000Z',
    updated_at: '2026-07-05T00:00:00.000Z',
  }
}

function epochRow(initialized: boolean) {
  return {
    id: initialized ? base.epochId : 'devnet:4000000:abcdef0123456789',
    network: 'devnet',
    status: 'current',
    first_ledger_index: initialized ? base.ledgerIndex : 4000000,
    first_ledger_hash: initialized ? base.ledgerHash : 'HEAD_HASH',
    last_ledger_index: 4000000,
    last_ledger_hash: 'HEAD_HASH',
    started_at: '2026-07-05T00:00:00.000Z',
    ended_at: null,
    reset_reason: null,
    created_at: '2026-07-05T00:00:00.000Z',
    updated_at: '2026-07-05T00:00:00.000Z',
  }
}

function fakeDatabase() {
  const prepared: PreparedRecord[] = []
  const batches: number[][] = []
  let initialized = false

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
          if (sql.includes('SELECT * FROM sync_state')) return syncRow(initialized) as T
          if (sql.includes("status = 'current'")) return epochRow(initialized) as T
          if (sql.includes('COUNT(*) AS count FROM network_epochs')) {
            return { count: initialized ? 1 : 0 } as T
          }
          if (sql.includes('COUNT(*) AS count FROM processed_ledgers')) return { count: 0 } as T
          throw new Error(`Unexpected first query: ${sql}`)
        },
        async all<T>() {
          if (sql.includes('FROM current_state_overlay_state')) {
            return {
              results: initialized
                ? [{
                    network: 'devnet',
                    epoch_id: base.epochId,
                    base_snapshot_id: base.snapshotId,
                    base_ledger_index: base.ledgerIndex,
                    base_ledger_hash: base.ledgerHash,
                    overlay_ledger_index: base.ledgerIndex,
                    overlay_ledger_hash: base.ledgerHash,
                    updated_at: '2026-07-05T00:00:00.000Z',
                  }]
                : [],
            } as T
          }
          throw new Error(`Unexpected all query: ${sql}`)
        },
      }
      return statement
    },
    async batch(statements: Array<{ __index?: number }>) {
      batches.push(statements.map((statement) => statement.__index ?? -1))
      initialized = true
      return []
    },
  }

  return { db: db as unknown as D1Database, prepared, batches }
}

describe('guarded catch-up initialization', () => {
  it('orders pre-guards, state handover, post-guards, and cleanup in one batch', async () => {
    const state = fakeDatabase()
    const result = await initializeCatchUpFromVerifiedBase({
      db: state.db,
      base,
      initializedAt: '2026-07-05T00:00:00.000Z',
    })

    expect(result.status).toBe('initialized')
    expect(state.batches).toHaveLength(1)
    const sql = state.batches[0]?.map((index) => state.prepared[index]?.sql ?? '') ?? []

    const preSync = sql.findIndex((item) => item.includes('INSERT INTO catch_up_initialization_guards'))
    const archiveEpoch = sql.findIndex((item) => item.includes("SET status = 'archived'"))
    const insertBaseEpoch = sql.findIndex((item) => item.includes('INSERT INTO network_epochs'))
    const updateCursor = sql.findIndex((item) => item.includes('UPDATE sync_state'))
    const initializeOverlay = sql.findIndex((item) => item.includes('INSERT INTO current_state_overlay_state'))
    const syncGuards = sql
      .map((item, index) => item.includes('INSERT INTO catch_up_initialization_guards') ? index : -1)
      .filter((index) => index >= 0)
    const cleanup = sql.findIndex((item) => item.includes('DELETE FROM catch_up_initialization_guards'))

    expect(preSync).toBe(0)
    expect(archiveEpoch).toBeGreaterThan(preSync)
    expect(insertBaseEpoch).toBeGreaterThan(archiveEpoch)
    expect(updateCursor).toBeGreaterThan(insertBaseEpoch)
    expect(initializeOverlay).toBeGreaterThan(updateCursor)
    expect(syncGuards).toHaveLength(2)
    expect(syncGuards[1]).toBeGreaterThan(initializeOverlay)
    expect(cleanup).toBeGreaterThan(syncGuards[1] ?? -1)
  })

  it('returns ready without writing during dry-run', async () => {
    const state = fakeDatabase()
    const result = await initializeCatchUpFromVerifiedBase({
      db: state.db,
      base,
      initializedAt: '2026-07-05T00:00:00.000Z',
      dryRun: true,
    })

    expect(result.status).toBe('ready')
    expect(state.batches).toEqual([])
  })
})
