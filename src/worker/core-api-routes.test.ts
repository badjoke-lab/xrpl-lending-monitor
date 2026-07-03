import { describe, expect, it } from 'vitest'

import { app } from './index'
import type { Bindings } from './env'

interface FakeDatabaseOptions {
  includeSnapshot?: boolean
  snapshot?: Partial<Record<string, unknown>>
  vault?: {
    id: string
    projectionJson: string
    rawJson: string
  }
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

          if (sql.includes('FROM current_state_d1_active_snapshots') && options.includeSnapshot) {
            return {
              id: 'snapshot-1',
              epoch_id: 'epoch-1',
              ledger_index: 123,
              ledger_hash: 'SNAPSHOT',
              manifest_hash: 'A'.repeat(64),
              vault_count: 2,
              loan_broker_count: 3,
              loan_count: 5,
              object_count: 10,
              batch_count: 1,
              normalized_bytes: 1024,
              completed_at: '2026-07-01T00:00:20.000Z',
              ...options.snapshot,
            }
          }

          if (sql.includes('FROM current_state_d1_vaults') && options.vault) {
            return {
              projection_json: options.vault.projectionJson,
              raw_json: options.vault.rawJson,
            }
          }

          return null
        },
        async all() {
          if (sql.includes('FROM current_state_d1_vaults') && options.vault) {
            return {
              results: [{
                object_id: options.vault.id,
                projection_json: options.vault.projectionJson,
                raw_json: options.vault.rawJson,
              }],
            }
          }
          return { results: [] }
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

function createVaultFixture() {
  const id = `${'A'.repeat(63)}1`
  const projection = {
    kind: 'vault',
    id,
    owner: 'rOwner',
    account: 'rVaultAccount',
    asset: {
      kind: 'xrp',
      key: 'XRP',
      currency: 'XRP',
      issuer: null,
      issuanceId: null,
      displayCode: 'XRP',
    },
    assetsTotal: '10000000',
    assetsAvailable: '7500000',
    assetsMaximum: '20000000',
    lossUnrealized: '0',
    shareMptId: 'B'.repeat(48),
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: 'F'.repeat(64),
    previousLedgerIndex: 120,
  }
  return {
    id,
    projectionJson: JSON.stringify(projection),
    rawJson: JSON.stringify({ LedgerEntryType: 'Vault', index: id }),
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
      provenance: { counts: 'direct', freshness: 'direct' },
      unavailable: [],
    })
  })

  it('returns an available D1 Vault collection and detail', async () => {
    const vault = createVaultFixture()
    const db = createFakeDatabase({
      includeSnapshot: true,
      snapshot: {
        vault_count: 1,
        loan_broker_count: 0,
        loan_count: 0,
        object_count: 1,
      },
      vault,
    })
    const env = createEnv(db)

    const collection = await app.request('/api/vaults?limit=1&sort=id_asc', {}, env)
    expect(collection.status).toBe(200)
    await expect(collection.json()).resolves.toMatchObject({
      kind: 'vaults',
      data: [{
        id: vault.id,
        asset: { key: 'XRP' },
        assets_total: '10000000',
        assets_available: '7500000',
        derived: {
          used_assets: '2500000',
          utilization_bps: 2500,
          provenance: 'derived',
        },
      }],
      availability: { state: 'available' },
      provenance: { collection: 'direct' },
    })

    const detail = await app.request(`/api/vaults/${vault.id}`, {}, env)
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({
      kind: 'vault',
      data: {
        id: vault.id,
        raw: { LedgerEntryType: 'Vault' },
      },
      availability: { state: 'available' },
    })
  })

  it('reads an active empty Loan Broker collection through the single D1 binding', async () => {
    const response = await app.request(
      '/api/loan-brokers?limit=2',
      {},
      createEnv(createFakeDatabase({ includeSnapshot: true })),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      kind: 'loan_brokers',
      data: [],
      page: { limit: 2, next_cursor: null },
      availability: { state: 'available' },
      provenance: { collection: 'direct' },
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

  it('rejects invalid Vault identifiers before storage reads', async () => {
    const response = await app.request('/api/vaults/not-a-vault', {}, createEnv(createFakeDatabase()))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_identifier' })
  })

  it('reports missing active snapshots without inventing current entities', async () => {
    const response = await app.request('/api/loans', {}, createEnv(createFakeDatabase()))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      page: { limit: 25, next_cursor: null },
      availability: {
        state: 'unavailable',
        reason: 'active current-state snapshot has not been activated',
      },
    })
  })
})
