import { describe, expect, it } from 'vitest'

import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getResolvedCurrentProjection,
  listResolvedCurrentProjections,
} from './base-overlay-current-reader'
import type { ReleaseCurrentStateSource } from './release-current-state'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 100,
  ledgerHash: 'BASE',
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'A'.repeat(64),
  vaultCount: 2,
  loanBrokerCount: 0,
  loanCount: 0,
  objectCount: 2,
  shardCount: 1,
  compressedBytes: 0,
  completedAt: '2026-07-04T00:00:00.000Z',
}

function vault(id: string, owner: string): VaultCurrentProjection {
  return {
    kind: 'vault',
    id,
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
    shareMptId: 'B'.repeat(48),
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: 'C'.repeat(64),
    previousLedgerIndex: 100,
    raw: { LedgerEntryType: 'Vault', index: id },
  }
}

function record(kind: ReadModelKind, projection: VaultCurrentProjection): ReleaseNativeDataRecord {
  return {
    schemaVersion: 1,
    segmentId: 'read-model',
    sourcePage: 0,
    id: projection.id,
    kind,
    valueSha256: '0'.repeat(64),
    value: { __readModelProjection: projection } as unknown as Record<string, unknown>,
  }
}

function source(baseItems: VaultCurrentProjection[]): ReleaseCurrentStateSource {
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
        counts: { vaults: baseItems.length, loanBrokers: 0, loans: 0 },
        pageCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
        manifestSha256: snapshot.manifestSha256,
      },
      reader: {
        async listObjects(kind, options, predicate) {
          const offset = options.cursor ? Number(options.cursor) : 0
          const ordered = [...baseItems].sort((left, right) =>
            options.direction === 'asc'
              ? left.id.localeCompare(right.id)
              : right.id.localeCompare(left.id),
          )
          const filtered = ordered
            .map((item) => record(kind, item))
            .filter((item) => predicate ? predicate(item) : true)
          const items = filtered.slice(offset, offset + options.limit)
          const next = offset + items.length < filtered.length ? String(offset + items.length) : null
          return { items, nextCursor: next, assetReads: 1 }
        },
        async getObject(objectId) {
          const item = baseItems.find((candidate) => candidate.id === objectId)
          return { item: item ? record('vault', item) : null, complete: true, assetReads: 1 }
        },
      },
    },
  } as ReleaseCurrentStateSource
}

interface OverlayRow {
  object_id: string
  operation: 'upsert' | 'deleted'
  projection_json: string | null
}

function database(rows: OverlayRow[]): D1Database {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = []
      const statement = {
        bind(...values: unknown[]) {
          bindings = values
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
              overlay_ledger_index: 105,
              overlay_ledger_hash: 'OVERLAY',
              updated_at: '2026-07-04T00:01:00.000Z',
            } as T
          }
          if (sql.includes('FROM current_state_overlay_objects')) {
            const objectId = bindings[3]
            return (rows.find((row) => row.object_id === objectId) ?? null) as T | null
          }
          return null
        },
        async all<T>() {
          if (!sql.includes('FROM current_state_overlay_objects')) return { results: [] as T[] }
          if (sql.includes('object_id IN')) {
            const ids = new Set(bindings.slice(3))
            return { results: rows.filter((row) => ids.has(row.object_id)) as T[] }
          }
          const after = bindings.length === 5 ? String(bindings[3]) : null
          const limit = Number(bindings.at(-1))
          const desc = sql.includes('DESC')
          const ordered = rows
            .filter((row) => row.operation === 'upsert')
            .filter((row) => after === null || (desc ? row.object_id < after : row.object_id > after))
            .sort((left, right) => desc
              ? right.object_id.localeCompare(left.object_id)
              : left.object_id.localeCompare(right.object_id))
            .slice(0, limit)
          return { results: ordered as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('base plus overlay current-state reader', () => {
  it('resolves detail precedence and fails closed on overlay identity mismatch', async () => {
    const base = source([vault('A', 'rBaseA'), vault('C', 'rBaseC')])
    const db = database([
      { object_id: 'B', operation: 'upsert', projection_json: JSON.stringify(vault('B', 'rOverlayB')) },
      { object_id: 'C', operation: 'upsert', projection_json: JSON.stringify(vault('C', 'rOverlayC')) },
      { object_id: 'A', operation: 'deleted', projection_json: null },
    ])

    await expect(getResolvedCurrentProjection({ db, source: base, snapshot, kind: 'vault', objectId: 'C' }))
      .resolves.toMatchObject({ item: { id: 'C', owner: 'rOverlayC' } })
    await expect(getResolvedCurrentProjection({ db, source: base, snapshot, kind: 'vault', objectId: 'B' }))
      .resolves.toMatchObject({ item: { id: 'B', owner: 'rOverlayB' } })
    await expect(getResolvedCurrentProjection({ db, source: base, snapshot, kind: 'vault', objectId: 'A' }))
      .resolves.toMatchObject({ item: null })

    const mismatched = database([
      { object_id: 'D', operation: 'upsert', projection_json: JSON.stringify(vault('E', 'rWrong')) },
    ])
    await expect(getResolvedCurrentProjection({
      db: mismatched,
      source: base,
      snapshot,
      kind: 'vault',
      objectId: 'D',
    })).rejects.toThrow('overlay projection identity mismatch')
  })

  it('merges list order, pagination, filters, tombstones, and overlay duplicates', async () => {
    const base = source([vault('A', 'rBaseA'), vault('C', 'rBaseC')])
    const db = database([
      { object_id: 'B', operation: 'upsert', projection_json: JSON.stringify(vault('B', 'rOverlayB')) },
      { object_id: 'C', operation: 'upsert', projection_json: JSON.stringify(vault('C', 'rOverlayC')) },
      { object_id: 'A', operation: 'deleted', projection_json: null },
    ])

    const first = await listResolvedCurrentProjections({
      db,
      source: base,
      snapshot,
      kind: 'vault',
      list: { limit: 1, direction: 'asc', scope: 'test' },
    })
    expect(first.items.map((item) => item.id)).toEqual(['B'])
    expect(first.nextCursor).not.toBeNull()

    const second = await listResolvedCurrentProjections({
      db,
      source: base,
      snapshot,
      kind: 'vault',
      list: { limit: 2, cursor: first.nextCursor ?? undefined, direction: 'asc', scope: 'test' },
    })
    expect(second.items.map((item) => item.id)).toEqual(['C'])
    expect(second.nextCursor).toBeNull()

    const descending = await listResolvedCurrentProjections({
      db,
      source: base,
      snapshot,
      kind: 'vault',
      list: { limit: 10, direction: 'desc', scope: 'desc' },
    })
    expect(descending.items.map((item) => item.id)).toEqual(['C', 'B'])

    const filtered = await listResolvedCurrentProjections({
      db,
      source: base,
      snapshot,
      kind: 'vault',
      list: {
        limit: 10,
        direction: 'asc',
        scope: 'filtered',
        predicate: (projection) => (projection as VaultCurrentProjection).owner === 'rOverlayC',
      },
    })
    expect(filtered.items.map((item) => item.id)).toEqual(['C'])
  })
})
