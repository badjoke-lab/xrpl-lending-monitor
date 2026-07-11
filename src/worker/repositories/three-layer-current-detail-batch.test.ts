import { describe, expect, it } from 'vitest'

import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { getThreeLayerCurrentProjections } from './three-layer-current-detail'
import type { ReleaseCurrentStateSource } from './release-current-state'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 100,
  ledgerHash: 'A'.repeat(64),
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'B'.repeat(64),
  vaultCount: 3,
  loanBrokerCount: 0,
  loanCount: 0,
  objectCount: 3,
  shardCount: 1,
  compressedBytes: 0,
  completedAt: '2026-07-11T00:00:00.000Z',
}

function vault(id: string): VaultCurrentProjection {
  return {
    kind: 'vault',
    id,
    owner: `r${id.slice(0, 4)}`,
    account: `rAccount${id.slice(0, 4)}`,
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
    shareMptId: 'C'.repeat(48),
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: 'D'.repeat(64),
    previousLedgerIndex: 100,
    raw: { LedgerEntryType: 'Vault', index: id },
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

function database(): D1Database {
  return {
    prepare() {
      const statement = {
        bind() {
          return statement
        },
        async first<T>() {
          return null as T | null
        },
        async all<T>() {
          return { results: [] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('batched three-layer detail resolution', () => {
  it('deduplicates IDs and overlaps canonical detail reads', async () => {
    const ids = ['E'.repeat(64), 'F'.repeat(64), '1'.repeat(64)]
    const projections = new Map(ids.map((id) => [id, vault(id)]))
    let calls = 0
    let active = 0
    let maxActive = 0

    const source = {
      kind: 'release',
      db: {} as D1Database,
      readModel: { updatedAt: snapshot.completedAt },
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
          counts: { vaults: 3, loanBrokers: 0, loans: 0 },
          pageCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
          manifestSha256: snapshot.manifestSha256,
        },
        reader: {
          async listObjects() {
            return { items: [], nextCursor: null, assetReads: 0 }
          },
          async getObject(objectId: string) {
            calls += 1
            active += 1
            maxActive = Math.max(maxActive, active)
            await new Promise((resolve) => setTimeout(resolve, 10))
            active -= 1
            const projection = projections.get(objectId)
            return {
              item: projection ? record(projection) : null,
              complete: true,
              assetReads: 1,
            }
          },
        },
      },
    } as ReleaseCurrentStateSource

    const result = await getThreeLayerCurrentProjections({
      db: database(),
      source,
      snapshot,
      kind: 'vault',
      objectIds: [ids[0]!, ids[1]!, ids[0]!, ids[2]!],
    })

    expect(calls).toBe(3)
    expect(maxActive).toBeGreaterThan(1)
    expect(result.assetReads).toBe(3)
    expect([...result.items.keys()]).toEqual(ids)
    expect(result.items.get(ids[1]!)).toMatchObject({ id: ids[1], kind: 'vault' })
  })
})
