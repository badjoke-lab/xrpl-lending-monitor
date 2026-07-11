import { describe, expect, it } from 'vitest'

import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { getThreeLayerCurrentProjection } from './three-layer-current-detail'
import type { ReleaseCurrentStateSource } from './release-current-state'

const objectId = 'A'.repeat(64)

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 100,
  ledgerHash: 'B'.repeat(64),
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'C'.repeat(64),
  vaultCount: 1,
  loanBrokerCount: 0,
  loanCount: 0,
  objectCount: 1,
  shardCount: 1,
  compressedBytes: 0,
  completedAt: '2026-07-11T00:00:00.000Z',
}

function vault(owner: string): VaultCurrentProjection {
  return {
    kind: 'vault',
    id: objectId,
    owner,
    account: `${owner}-account`,
    asset: {
      kind: 'xrp',
      key: 'XRP',
      currency: 'XRP',
      issuer: null,
      issuanceId: null,
      displayCode: 'XRP',
    },
    assetsTotal: '100',
    assetsAvailable: '90',
    assetsMaximum: null,
    lossUnrealized: '0',
    shareMptId: 'D'.repeat(48),
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: 'E'.repeat(64),
    previousLedgerIndex: 100,
    raw: { LedgerEntryType: 'Vault', index: objectId },
  }
}

function record(projection: VaultCurrentProjection): ReleaseNativeDataRecord {
  return {
    schemaVersion: 1,
    segmentId: 'read-model',
    sourcePage: 0,
    id: projection.id,
    kind: 'vault',
    valueSha256: '0'.repeat(64),
    value: { __readModelProjection: projection } as unknown as Record<string, unknown>,
  }
}

function source(): ReleaseCurrentStateSource {
  return {
    kind: 'release',
    db: {} as D1Database,
    readModel: { updatedAt: snapshot.completedAt } as ReleaseCurrentStateSource['readModel'],
    opened: {
      manifest: {
        schemaVersion: 1,
        snapshotId: snapshot.id,
        epochId: snapshot.epochId,
        releaseTag: 'test',
        ledgerIndex: snapshot.ledgerIndex,
        ledgerHash: snapshot.ledgerHash,
        complete: true,
        pageSize: 100,
        lookupPrefixLength: 1,
        counts: { vaults: 1, loanBrokers: 0, loans: 0 },
        pageCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
        manifestSha256: snapshot.manifestSha256,
      },
      reader: {
        async listObjects() {
          return { items: [], nextCursor: null, assetReads: 1 }
        },
        async getObject(id) {
          return {
            item: id === objectId ? record(vault('rBase')) : null,
            complete: true,
            assetReads: 1,
          }
        },
      },
    },
  } as ReleaseCurrentStateSource
}

interface PositionedRow {
  object_id: string
  operation: 'upsert' | 'deleted'
  projection_json: string | null
  source_ledger_index: number
  source_transaction_index: number
}

function database(options: {
  overlay?: PositionedRow | null
  fast?: PositionedRow | null
  stateStatus?: 'healthy' | 'behind' | 'error'
}): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement
        },
        async first<T>() {
          if (sql.includes('FROM current_state_overlay_state')) {
            return {
              network: 'devnet',
              epoch_id: snapshot.epochId,
              base_snapshot_id: snapshot.id,
              base_ledger_index: snapshot.ledgerIndex,
              base_ledger_hash: snapshot.ledgerHash,
              overlay_ledger_index: 110,
              overlay_ledger_hash: 'F'.repeat(64),
              updated_at: '2026-07-11T00:01:00.000Z',
            } as T
          }
          if (sql.includes('FROM current_state_overlay_objects')) {
            return (options.overlay ?? null) as T | null
          }
          if (sql.includes('FROM fast_lane_shadow_base_binding')) {
            return {
              shadow_epoch_id: 'fast-lane-shadow-devnet',
              base_epoch_id: snapshot.epochId,
              base_snapshot_id: snapshot.id,
              base_ledger_index: snapshot.ledgerIndex,
              base_ledger_hash: snapshot.ledgerHash,
              bound_at: '2026-07-11T00:02:00.000Z',
            } as T
          }
          if (sql.includes('FROM fast_lane_shadow_state')) {
            return {
              epoch_id: 'fast-lane-shadow-devnet',
              last_processed_ledger: 120,
              last_processed_hash: '1'.repeat(64),
              latest_observed_ledger: 120,
              latest_observed_hash: '1'.repeat(64),
              status: options.stateStatus ?? 'healthy',
              updated_at: '2026-07-11T00:03:00.000Z',
            } as T
          }
          if (sql.includes('FROM fast_lane_shadow_objects_compact')) {
            return (options.fast ?? null) as T | null
          }
          return null
        },
      }
      return statement
    },
  } as unknown as D1Database
}

function row(options: {
  owner?: string
  operation?: 'upsert' | 'deleted'
  ledger: number
  transaction?: number
}): PositionedRow {
  const operation = options.operation ?? 'upsert'
  return {
    object_id: objectId,
    operation,
    projection_json: operation === 'deleted' ? null : JSON.stringify(vault(options.owner ?? 'rFast')),
    source_ledger_index: options.ledger,
    source_transaction_index: options.transaction ?? 0,
  }
}

describe('three-layer detail resolver', () => {
  it('uses a newer fast-lane projection over canonical overlay', async () => {
    const result = await getThreeLayerCurrentProjection({
      db: database({
        overlay: row({ owner: 'rOverlay', ledger: 110, transaction: 1 }),
        fast: row({ owner: 'rFast', ledger: 111, transaction: 0 }),
      }),
      source: source(),
      snapshot,
      kind: 'vault',
      objectId,
    })
    expect((result.item as VaultCurrentProjection).owner).toBe('rFast')
  })

  it('keeps canonical overlay when it is newer than fast lane', async () => {
    const result = await getThreeLayerCurrentProjection({
      db: database({
        overlay: row({ owner: 'rOverlay', ledger: 112, transaction: 0 }),
        fast: row({ owner: 'rFast', ledger: 111, transaction: 9 }),
      }),
      source: source(),
      snapshot,
      kind: 'vault',
      objectId,
    })
    expect((result.item as VaultCurrentProjection).owner).toBe('rOverlay')
  })

  it('applies a newer fast-lane tombstone', async () => {
    const result = await getThreeLayerCurrentProjection({
      db: database({
        overlay: row({ owner: 'rOverlay', ledger: 110 }),
        fast: row({ operation: 'deleted', ledger: 111 }),
      }),
      source: source(),
      snapshot,
      kind: 'vault',
      objectId,
    })
    expect(result.item).toBeNull()
  })

  it('falls back to canonical state when fast-lane state is in error', async () => {
    const result = await getThreeLayerCurrentProjection({
      db: database({
        overlay: row({ owner: 'rOverlay', ledger: 110 }),
        fast: row({ owner: 'rFast', ledger: 111 }),
        stateStatus: 'error',
      }),
      source: source(),
      snapshot,
      kind: 'vault',
      objectId,
    })
    expect((result.item as VaultCurrentProjection).owner).toBe('rOverlay')
  })
})
