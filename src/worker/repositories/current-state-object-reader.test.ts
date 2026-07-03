import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from './core-api-repository'
import { getCurrentVaultById, listCurrentVaults } from './d1-current-vault-reader'

interface QueryResponse {
  all?: unknown[]
  first?: unknown
}

function fakeDatabase(responses: QueryResponse[]) {
  const queue = [...responses]
  const prepared: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      const record = { sql, values: [] as unknown[] }
      prepared.push(record)
      const response = queue.shift() ?? {}
      const statement = {
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async all<T>() {
          return { results: (response.all ?? []) as T[] }
        },
        async first<T>() {
          return (response.first ?? null) as T | null
        },
      }
      return statement
    },
  }
  return { db: db as unknown as D1Database, prepared }
}

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 123,
  ledgerHash: 'A'.repeat(64),
  objectPrefix: '',
  manifestKey: null,
  manifestSha256: 'b'.repeat(64),
  vaultCount: 2,
  loanBrokerCount: 0,
  loanCount: 0,
  objectCount: 2,
  shardCount: 1,
  compressedBytes: 100,
  completedAt: '2026-07-03T00:00:00.000Z',
}

function vaultProjection(id: string, loss = '0') {
  return {
    kind: 'vault',
    id,
    owner: 'rOwner',
    account: 'rVault',
    asset: { kind: 'xrp', key: 'XRP', currency: 'XRP', issuer: null, issuanceId: null, displayCode: 'XRP' },
    assetsTotal: '100',
    assetsAvailable: '80',
    assetsMaximum: null,
    lossUnrealized: loss,
    shareMptId: 'A'.repeat(48),
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: 'F'.repeat(64),
    previousLedgerIndex: 122,
  }
}

function row(id: string, loss = '0') {
  return {
    object_id: id,
    projection_json: JSON.stringify(vaultProjection(id, loss)),
    raw_json: JSON.stringify({ LedgerEntryType: 'Vault', index: id }),
  }
}

describe('D1 current-state Vault reader', () => {
  it('returns a bounded keyset page and an opaque continuation cursor', async () => {
    const firstId = `${'0'.repeat(63)}1`
    const secondId = `${'0'.repeat(63)}2`
    const { db, prepared } = fakeDatabase([{ all: [row(firstId), row(secondId, '1')] }])

    const result = await listCurrentVaults(db, snapshot, { limit: 1, hasLoss: false })

    expect(result.data.map((vault) => vault.id)).toEqual([firstId])
    expect(result.data[0]?.raw).toMatchObject({ LedgerEntryType: 'Vault' })
    expect(result.nextCursor).toBeTruthy()
    expect(result.objectsExamined).toBe(2)
    expect(prepared[0]?.sql).toContain('current_state_d1_vaults')
    expect(prepared[0]?.sql).toContain('has_unrealized_loss')
    expect(prepared[0]?.values).toEqual([snapshot.id, 0, 2])
  })

  it('loads one Vault only from the active snapshot ID', async () => {
    const id = `${'A'.repeat(63)}1`
    const { db, prepared } = fakeDatabase([{ first: row(id) }])

    const result = await getCurrentVaultById(db, snapshot, id.toLowerCase())

    expect(result?.id).toBe(id)
    expect(prepared[0]?.values).toEqual([snapshot.id, id])
  })
})
