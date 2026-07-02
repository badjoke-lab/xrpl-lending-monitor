import { describe, expect, it } from 'vitest'

import { app } from './index'
import type { Bindings } from './env'

interface FakeDatabaseOptions {
  includeSnapshot?: boolean
}

function createFakeDatabase(options: FakeDatabaseOptions = {}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return this
        },
        async first() {
          if (sql.includes('FROM sync_state')) {
            return {
              network: 'devnet',
              epoch_id: 'epoch-1',
              last_processed_ledger: 123,
              last_processed_hash: 'PROCESSED',
              latest_observed_ledger: 125,
              latest_observed_hash: 'LATEST',
              latest_ledger_age_seconds: 3,
              last_attempt_at: '2026-07-01T00:00:10.000Z',
              last_success_at: '2026-07-01T00:00:11.000Z',
              status: 'healthy',
              consecutive_failures: 0,
              endpoint: 'https://s.devnet.rippletest.net:51234/',
              server_version: '3.2.0',
              server_state: 'full',
              complete_ledgers: '1-125',
              lending_protocol_enabled: 1,
              lending_protocol_supported: 1,
              single_asset_vault_enabled: 1,
              single_asset_vault_supported: 1,
              reset_reason: null,
              error_code: null,
              error_message: null,
              created_at: '2026-07-01T00:00:00.000Z',
              updated_at: '2026-07-01T00:00:12.000Z',
            }
          }

          if (sql.includes('FROM network_epochs')) {
            return {
              id: 'epoch-1',
              network: 'devnet',
              status: 'current',
              first_ledger_index: 100,
              first_ledger_hash: 'FIRST',
              last_ledger_index: null,
              last_ledger_hash: null,
              started_at: '2026-07-01T00:00:00.000Z',
              ended_at: null,
              reset_reason: null,
              created_at: '2026-07-01T00:00:00.000Z',
              updated_at: '2026-07-01T00:00:00.000Z',
            }
          }

          if (sql.includes('FROM current_state_snapshots') && options.includeSnapshot) {
            return {
              id: 'snapshot-1',
              epoch_id: 'epoch-1',
              ledger_index: 123,
              ledger_hash: 'SNAPSHOT',
              vault_count: 2,
              loan_broker_count: 3,
              loan_count: 5,
              object_count: 10,
              completed_at: '2026-07-01T00:00:20.000Z',
            }
          }

          return null
        },
      }
    },
  } as unknown as D1Database
}

function createEnv(db: D1Database): Bindings {
  return {
    APP_NETWORK: 'devnet',
    MAINNET_ENABLED: 'false',
    XRPL_DEVNET_RPC_URL: 'https://s.devnet.rippletest.net:51234/',
    DB: db,
    ASSETS: {
      fetch: () => Promise.resolve(new Response('not found', { status: 404 })),
    } as Fetcher,
  }
}

describe('core API routes', () => {
  it('returns overview counts, freshness, and provenance from the active snapshot', async () => {
    const response = await app.request('/api/overview', {}, createEnv(createFakeDatabase({ includeSnapshot: true })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      epoch: { id: 'epoch-1', status: 'current' },
      snapshot: {
        id: 'snapshot-1',
        epoch_id: 'epoch-1',
        ledger_index: 123,
        ledger_hash: 'SNAPSHOT',
      },
      freshness: {
        collector_status: 'healthy',
        latest_validated_ledger: 125,
        last_processed_ledger: 123,
      },
      counts: {
        vaults: 2,
        loan_brokers: 3,
        loans: 5,
        current_objects: 10,
      },
      provenance: {
        counts: 'direct',
        freshness: 'direct',
      },
      unavailable: [],
    })
  })

  it('returns an explicit unavailable entity collection before object shard reads exist', async () => {
    const response = await app.request('/api/loan-brokers?limit=2', {}, createEnv(createFakeDatabase({ includeSnapshot: true })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      kind: 'loan_brokers',
      snapshot: {
        id: 'snapshot-1',
        ledger_index: 123,
      },
      data: [],
      page: {
        limit: 2,
        next_cursor: null,
      },
      availability: {
        state: 'unavailable',
        reason: 'current object shard reader is not configured for public API reads yet',
      },
      provenance: {
        collection: 'unavailable',
      },
    })
  })

  it('bounds entity pagination limits', async () => {
    const response = await app.request('/api/vaults?limit=101', {}, createEnv(createFakeDatabase()))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_limit',
      message: 'limit must be an integer from 1 to 100',
    })
  })

  it('reports missing active snapshots without inventing current entities', async () => {
    const response = await app.request('/api/loans', {}, createEnv(createFakeDatabase()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      page: {
        limit: 25,
        next_cursor: null,
      },
      availability: {
        state: 'unavailable',
        reason: 'active current-state snapshot has not been activated',
      },
    })
  })
})
