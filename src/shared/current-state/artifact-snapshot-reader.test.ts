import { describe, expect, it } from 'vitest'

import {
  scanCurrentStateBatch,
  type CurrentStatePage,
  type CurrentStateScanMetrics,
} from '../../collector/current-state/scan-current-state'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { runArtifactBootstrap } from './artifact-bootstrap-runner'
import { InMemoryArtifactBootstrapCheckpointStore } from './artifact-bootstrap-types'
import { SnapshotArtifactReader } from './artifact-snapshot-reader'
import { InMemoryArtifactStore } from './in-memory-artifact-store'
import { buildAndPersistSnapshotLevelManifest } from './snapshot-level-manifest'

const identity = {
  network: 'devnet' as const,
  snapshotId: 'snapshot-reader',
  epochId: 'epoch-reader',
  endpoint: 'https://example.invalid',
  ledgerIndex: 200,
  ledgerHash: 'C'.repeat(64),
}

function object(
  type: 'Vault' | 'LoanBroker' | 'Loan',
  index: string,
  fields: Record<string, unknown> = {},
): ScannedLedgerObject {
  return { LedgerEntryType: type, index, BinaryHex: 'ABCD', Flags: 0, ...fields }
}

function page(options: {
  pageNumber: number
  markerAfter: unknown
  vaults?: ScannedLedgerObject[]
  loanBrokers?: ScannedLedgerObject[]
  loans?: ScannedLedgerObject[]
}): CurrentStatePage {
  const all = [
    ...(options.vaults ?? []),
    ...(options.loanBrokers ?? []),
    ...(options.loans ?? []),
  ]
  return {
    pageNumber: options.pageNumber,
    markerBefore: options.pageNumber === 1 ? undefined : { cursor: options.pageNumber - 1 },
    markerAfter: options.markerAfter,
    firstLedgerIndex: all[0]?.index ?? null,
    lastLedgerIndex: all.at(-1)?.index ?? null,
    decodedObjects: all.length,
    vaults: options.vaults ?? [],
    loanBrokers: options.loanBrokers ?? [],
    loans: options.loans ?? [],
  }
}

function metrics(): CurrentStateScanMetrics {
  return {
    pages: 2,
    requests: 2,
    decodedObjects: 4,
    objects: 4,
    elapsedMs: 40,
    requestedObjectsPerPage: 2_048,
    responseMode: 'binary',
    byType: {
      vault: { objects: 2 },
      loan_broker: { objects: 1 },
      loan: { objects: 1 },
    },
  }
}

async function fixture() {
  const store = new InMemoryArtifactStore()
  const checkpointStore = new InMemoryArtifactBootstrapCheckpointStore()
  const first = page({
    pageNumber: 1,
    markerAfter: { cursor: 1 },
    vaults: [object('Vault', 'V1', { Account: 'rVault', Owner: 'rOwner' })],
    loanBrokers: [object('LoanBroker', 'B1', {
      Account: 'rBroker',
      Owner: 'rOwner',
      VaultID: 'V1',
    })],
    loans: [object('Loan', 'L1', {
      Borrower: 'rBorrower',
      LoanBrokerID: 'B1',
    })],
  })
  const second = page({
    pageNumber: 2,
    markerAfter: null,
    vaults: [object('Vault', 'V2', { Owner: 'rOwner' })],
  })
  const scanBatch: typeof scanCurrentStateBatch = async (options) => {
    await options.onPage(first)
    await options.onPage(second)
    return {
      endpoint: options.endpoint,
      ledgerHash: options.ledgerHash,
      ledgerIndex: options.ledgerIndex,
      complete: true,
      nextMarker: null,
      metrics: metrics(),
    }
  }
  const bootstrap = await runArtifactBootstrap({
    identity,
    store,
    checkpointStore,
    timeoutMs: 1_000,
    scanBatch,
  })
  const snapshot = await buildAndPersistSnapshotLevelManifest({
    store,
    checkpoint: bootstrap.checkpoint,
    generatedAt: '2026-07-03T00:00:00.000Z',
  })
  const reader = await SnapshotArtifactReader.open({
    store,
    manifestKey: snapshot.key,
    manifestSha256: snapshot.sha256,
  })
  return { store, snapshot, reader }
}

describe('snapshot artifact reader', () => {
  it('paginates object lists with an opaque cursor', async () => {
    const { reader } = await fixture()
    const first = await reader.listObjects('vault', { limit: 1 })
    expect(first.items.map((item) => item.id)).toEqual(['V1'])
    expect(first.complete).toBe(false)
    expect(first.nextCursor).not.toBeNull()

    const second = await reader.listObjects('vault', {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.items.map((item) => item.id)).toEqual(['V2'])
    expect(second.complete).toBe(true)
    expect(second.nextCursor).toBeNull()
  })

  it('resolves object detail through the object-id index', async () => {
    const { reader } = await fixture()
    const result = await reader.getObject('B1')
    expect(result.complete).toBe(true)
    expect(result.item?.kind).toBe('loan-broker')
    expect(result.item?.value.VaultID).toBe('V1')

    const missing = await reader.getObject('UNKNOWN')
    expect(missing).toMatchObject({ item: null, complete: true })
  })

  it('paginates account matches and reads relationship indexes', async () => {
    const { reader } = await fixture()
    const first = await reader.findAccount('rOwner', { limit: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).not.toBeNull()
    const second = await reader.findAccount('rOwner', {
      limit: 10,
      cursor: first.nextCursor ?? undefined,
    })
    expect([...first.items, ...second.items].map((item) => item.reference.id).sort()).toEqual([
      'B1',
      'V1',
      'V2',
    ])

    const brokers = await reader.findRelationships('V1')
    expect(brokers.items).toEqual([
      expect.objectContaining({
        relation: 'vault-loan-broker',
        target: expect.objectContaining({ id: 'B1' }),
      }),
    ])
    const loans = await reader.findRelationships('B1')
    expect(loans.items).toEqual([
      expect.objectContaining({
        relation: 'loan-broker-loan',
        target: expect.objectContaining({ id: 'L1' }),
      }),
    ])
  })

  it('supports exact current-state search and explicit read bounds', async () => {
    const { reader } = await fixture()
    const objectSearch = await reader.searchExact('V1')
    expect(objectSearch.items).toEqual([
      expect.objectContaining({
        category: 'object-id',
        reference: expect.objectContaining({ id: 'V1' }),
      }),
    ])
    const accountSearch = await reader.searchExact('rOwner')
    expect(accountSearch.items).toEqual([{ category: 'account', account: 'rOwner' }])

    const bounded = await reader.getObject('V1', { maxShardReads: 1 })
    expect(bounded).toMatchObject({ item: null, complete: false, shardReads: 1 })
  })

  it('rejects a snapshot manifest digest mismatch', async () => {
    const { store, snapshot } = await fixture()
    await expect(SnapshotArtifactReader.open({
      store,
      manifestKey: snapshot.key,
      manifestSha256: '0'.repeat(64),
    })).rejects.toThrow('Snapshot manifest digest mismatch')
  })
})
