import { describe, expect, it } from 'vitest'

import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { listResolvedCurrentProjections } from './base-overlay-current-reader'
import type { ReleaseCurrentStateSource } from './release-current-state'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-bind-budget',
  epochId: 'epoch-bind-budget',
  ledgerIndex: 100,
  ledgerHash: 'BASE',
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'A'.repeat(64),
  vaultCount: 100,
  loanBrokerCount: 0,
  loanCount: 0,
  objectCount: 100,
  shardCount: 1,
  compressedBytes: 0,
  completedAt: '2026-07-05T00:00:00.000Z',
}

function vault(id: string): VaultCurrentProjection {
  return {
    kind: 'vault',
    id,
    owner: `rOwner${id.slice(0, 4)}`,
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
    assetsAvailable: '100',
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

function record(projection: VaultCurrentProjection): ReleaseNativeDataRecord {
  return {
    schemaVersion: 1,
    segmentId: 'segment-bind-budget',
    sourcePage: 1,
    id: projection.id,
    kind: 'vault',
    valueSha256: '0'.repeat(64),
    value: { __readModelProjection: projection },
  }
}

function source(): ReleaseCurrentStateSource {
  const items = Array.from({ length: 100 }, (_, index) => {
    const id = index.toString(16).toUpperCase().padStart(64, '0')
    return record(vault(id))
  })
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
        counts: { vaults: 100, loanBrokers: 0, loans: 0 },
        pageCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
        manifestSha256: snapshot.manifestSha256,
      },
      reader: {
        async listObjects() {
          return { items, nextCursor: null, complete: true, assetReads: 1 }
        },
      },
    },
  } as ReleaseCurrentStateSource
}

function database(observedParameterMaxima: number[]): D1Database {
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
              overlay_ledger_index: snapshot.ledgerIndex,
              overlay_ledger_hash: snapshot.ledgerHash,
              updated_at: snapshot.completedAt,
            } as T
          }
          return null
        },
        async all<T>() {
          if (sql.includes('object_id IN')) {
            const maxima = [...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1]))
            observedParameterMaxima.push(Math.max(...maxima))
          }
          return { results: [] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('base plus overlay D1 bind budget', () => {
  it('chunks 100 base IDs so no overlay lookup exceeds the ?100 ceiling', async () => {
    const observedParameterMaxima: number[] = []
    const result = await listResolvedCurrentProjections({
      db: database(observedParameterMaxima),
      source: source(),
      snapshot,
      kind: 'vault',
      list: { limit: 1, direction: 'asc', scope: 'bind-budget-test' },
    })

    expect(result.items).toHaveLength(1)
    expect(observedParameterMaxima).toEqual([100, 6])
    expect(Math.max(...observedParameterMaxima)).toBeLessThanOrEqual(100)
  })
})
