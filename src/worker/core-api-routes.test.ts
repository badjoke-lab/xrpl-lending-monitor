import { describe, expect, it } from 'vitest'

import { encodeCurrentStatePageGzip } from '../collector/current-state/bootstrap-shard-encoder'
import { serializeCurrentStateManifest, type CurrentStateManifest } from '../collector/current-state/current-state-manifest'
import type { CurrentStatePage } from '../collector/current-state/scan-current-state'
import type { ScannedLedgerObject } from '../collector/current-state/scan-ledger-objects'
import { app } from './index'
import type { Bindings } from './env'

interface FakeDatabaseOptions {
  includeSnapshot?: boolean
  snapshot?: Partial<Record<string, unknown>>
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
              object_prefix: 'current/snapshot-1',
              manifest_key: null,
              manifest_hash: null,
              vault_count: 2,
              loan_broker_count: 3,
              loan_count: 5,
              object_count: 10,
              shard_count: 0,
              compressed_bytes: 0,
              completed_at: '2026-07-01T00:00:20.000Z',
              ...options.snapshot,
            }
          }

          return null
        },
      }
    },
  } as unknown as D1Database
}

function createEnv(db: D1Database, bucket?: R2Bucket): Bindings {
  return {
    APP_NETWORK: 'devnet',
    MAINNET_ENABLED: 'false',
    XRPL_DEVNET_RPC_URL: 'https://s.devnet.rippletest.net:51234/',
    DB: db,
    ASSETS: {
      fetch: () => Promise.resolve(new Response('not found', { status: 404 })),
    } as Fetcher,
    ...(bucket ? { CURRENT_STATE: bucket } : {}),
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', source.buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function createVaultStorageFixture() {
  const vaultId = `${'A'.repeat(63)}1`
  const object: ScannedLedgerObject = {
    LedgerEntryType: 'Vault',
    index: vaultId,
    BinaryHex: 'ABCD',
    PreviousTxnID: 'F'.repeat(64),
    PreviousTxnLgrSeq: 120,
    Owner: 'rOwner',
    Account: 'rVaultAccount',
    Asset: { currency: 'XRP' },
    AssetsTotal: '10000000',
    AssetsAvailable: '7500000',
    AssetsMaximum: '20000000',
    LossUnrealized: '0',
    ShareMPTID: 'B'.repeat(48),
    DomainID: null,
    WithdrawalPolicy: 0,
    Scale: 6,
    Flags: 0,
  }
  const page: CurrentStatePage = {
    pageNumber: 1,
    markerBefore: null,
    markerAfter: null,
    firstLedgerIndex: vaultId,
    lastLedgerIndex: vaultId,
    decodedObjects: 1,
    vaults: [object],
    loanBrokers: [],
    loans: [],
  }
  const shard = await encodeCurrentStatePageGzip(page, { snapshotId: 'snapshot-1', pageNumber: 1 })
  const shardHash = await sha256(shard.bytes)
  const shardKey = 'current/snapshot-1/shards/000001.json.gz'
  const manifest: CurrentStateManifest = {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    network: 'devnet',
    epochId: 'epoch-1',
    ledgerIndex: 123,
    ledgerHash: 'SNAPSHOT',
    generatedAt: '2026-07-01T00:00:20.000Z',
    objectPrefix: 'current/snapshot-1',
    metrics: {
      pages: 1,
      requests: 1,
      decodedObjects: 1,
      objects: 1,
      elapsedMs: 1,
      requestedObjectsPerPage: 2048,
      responseMode: 'binary',
      byType: {
        vault: { objects: 1 },
        loan_broker: { objects: 0 },
        loan: { objects: 0 },
      },
    },
    counts: { vaults: 1, loanBrokers: 0, loans: 0 },
    compressedBytes: shard.bytes.byteLength,
    shards: [{
      key: shardKey,
      pageNumber: 1,
      firstLedgerIndex: vaultId,
      lastLedgerIndex: vaultId,
      decodedObjects: 1,
      vaultCount: 1,
      loanBrokerCount: 0,
      loanCount: 0,
      compressedBytes: shard.bytes.byteLength,
      sha256: shardHash,
    }],
  }
  const manifestBytes = serializeCurrentStateManifest(manifest)
  const manifestHash = await sha256(manifestBytes)
  const objects = new Map([
    [shardKey, { bytes: shard.bytes, sha256: shardHash }],
    ['current/snapshot-1/manifest.json', { bytes: manifestBytes, sha256: manifestHash }],
  ])
  const bucket = {
    async get(key: string) {
      const stored = objects.get(key)
      if (!stored) return null
      return {
        size: stored.bytes.byteLength,
        customMetadata: { sha256: stored.sha256 },
        arrayBuffer: async () => Uint8Array.from(stored.bytes).buffer,
      }
    },
  } as unknown as R2Bucket

  return {
    vaultId,
    bucket,
    snapshot: {
      vault_count: 1,
      loan_broker_count: 0,
      loan_count: 0,
      object_count: 1,
      shard_count: 1,
      compressed_bytes: shard.bytes.byteLength,
      manifest_key: 'current/snapshot-1/manifest.json',
      manifest_hash: manifestHash,
    },
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

  it('returns a verified available Vault collection and detail', async () => {
    const fixture = await createVaultStorageFixture()
    const db = createFakeDatabase({ includeSnapshot: true, snapshot: fixture.snapshot })
    const env = createEnv(db, fixture.bucket)

    const collection = await app.request('/api/vaults?limit=1&sort=id_asc', {}, env)
    expect(collection.status).toBe(200)
    await expect(collection.json()).resolves.toMatchObject({
      kind: 'vaults',
      data: [{
        id: fixture.vaultId,
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

    const detail = await app.request(`/api/vaults/${fixture.vaultId}`, {}, env)
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({
      kind: 'vault',
      data: {
        id: fixture.vaultId,
        raw: { LedgerEntryType: 'Vault' },
      },
      availability: { state: 'available' },
    })
  })

  it('returns an explicit unavailable entity collection without the storage binding', async () => {
    const response = await app.request('/api/loan-brokers?limit=2', {}, createEnv(createFakeDatabase({ includeSnapshot: true })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      kind: 'loan_brokers',
      data: [],
      page: { limit: 2, next_cursor: null },
      availability: {
        state: 'unavailable',
        reason: 'current object storage binding is not configured for public API reads',
      },
      provenance: { collection: 'unavailable' },
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
