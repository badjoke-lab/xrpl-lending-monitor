import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from './core-api-repository'
import { searchGithubCurrentStateExact } from './github-current-indexes'
import type { ReleaseCurrentStateSource } from './release-current-state'

const objectId = 'A'.repeat(64)

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-search',
  epochId: 'epoch-search',
  ledgerIndex: 100,
  ledgerHash: 'B'.repeat(64),
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'C'.repeat(64),
  vaultCount: 0,
  loanBrokerCount: 0,
  loanCount: 1,
  objectCount: 1,
  shardCount: 3,
  compressedBytes: 0,
  completedAt: '2026-07-11T00:00:00.000Z',
}

function database(): D1Database {
  return {
    prepare() {
      const statement = {
        bind() { return statement },
        async first<T>() { return null as T | null },
        async all<T>() { return { results: [] as T[] } },
      }
      return statement
    },
  } as unknown as D1Database
}

function source(options: { searchExact?: () => Promise<unknown> } = {}): ReleaseCurrentStateSource {
  const projection = {
    kind: 'loan',
    id: objectId,
  }
  return {
    kind: 'release',
    db: database(),
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
        counts: { vaults: 0, loanBrokers: 0, loans: 1 },
        pageCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
        manifestSha256: snapshot.manifestSha256,
      },
      reader: {
        async listObjects() {
          throw new Error('collection listing must not run for an object ID Search')
        },
        async getObject() {
          return {
            item: {
              schemaVersion: 1,
              segmentId: 'read-model',
              sourcePage: 0,
              id: objectId,
              kind: 'loan',
              valueSha256: '0'.repeat(64),
              value: { __readModelProjection: projection },
            },
            complete: true,
            assetReads: 1,
          }
        },
        async findAccounts() {
          throw new Error('account scanning must not run for an object ID Search')
        },
        async findRelationships() {
          return { items: [], nextCursor: null, complete: true, assetReads: 0 }
        },
        async searchExact() {
          if (options.searchExact) return options.searchExact() as never
          throw new Error('adapter searchExact must not run for an object ID Search')
        },
      },
    },
  } as ReleaseCurrentStateSource
}

describe('GitHub current-state exact Search', () => {
  it('resolves a 64-character object ID through bounded three-layer detail reads', async () => {
    const result = await searchGithubCurrentStateExact(
      source(),
      snapshot,
      objectId.toLowerCase(),
      { limit: 100 },
    )

    expect(result).toMatchObject({
      complete: true,
      nextCursor: null,
      data: [{
        category: 'object-id',
        reference: {
          id: objectId,
          kind: 'loan',
          dataKey: 'read-model',
        },
      }],
    })
  })

  it('keeps non-object terms on the existing exact account search path', async () => {
    let delegated = 0
    const account = 'rExampleAccount'
    const release = source({
      async searchExact() {
        delegated += 1
        return {
          items: [{
            schemaVersion: 1,
            bucket: 0,
            term: account,
            lookupKind: 'account',
            value: {
              field: 'Borrower',
              reference: {
                segmentId: 'read-model',
                assetName: 'read-model',
                id: objectId,
                kind: 'loan',
              },
            },
          }],
          nextCursor: null,
          complete: true,
          assetReads: 1,
        }
      },
    })

    const result = await searchGithubCurrentStateExact(release, snapshot, account, { limit: 100 })

    expect(delegated).toBe(1)
    expect(result.data).toEqual([{ category: 'account', account }])
  })
})
