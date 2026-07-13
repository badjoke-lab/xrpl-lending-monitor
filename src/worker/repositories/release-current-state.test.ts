import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import {
  GithubCurrentStateReadModelReader,
  type ReadModelBrokerRecord,
  type ReadModelKind,
  type ReadModelLoanRecord,
} from '../../shared/current-state/github-read-model-reader'
import type { RuntimeConfig } from '../../shared/runtime-config'
import {
  clearVerifiedReleaseCurrentStateCacheForTest,
  createReadModelAdapter,
  resolveCurrentStateStorage,
} from './release-current-state'

const id = (value: number) => value.toString(16).toUpperCase().padStart(64, '0')
const vault = (value: number) => ({ kind: 'vault', id: id(value) }) as VaultCurrentProjection
const broker = (value: number, vaultId: string) => ({
  kind: 'loan_broker', id: id(value), vaultId,
}) as LoanBrokerCurrentProjection
const loan = (value: number, loanBrokerId: string) => ({
  kind: 'loan', id: id(value), loanBrokerId,
}) as LoanCurrentProjection

function model(options: { brokers: ReadModelBrokerRecord[]; loans: ReadModelLoanRecord[] }) {
  let getCalls = 0
  const reader = {
    async list<T>(kind: ReadModelKind, request: { limit: number; predicate?: (item: T) => boolean }) {
      const source = kind === 'loan-broker'
        ? options.brokers
        : kind === 'loan'
          ? options.loans
          : options.brokers.map((item) => item.vault)
      const typed = source as T[]
      const filtered = request.predicate ? typed.filter(request.predicate) : typed
      return { items: filtered.slice(0, request.limit), nextCursor: null, pageReads: 1, objectsExamined: filtered.length }
    },
    async get<T>() { getCalls += 1; return null as T | null },
  } as unknown as GithubCurrentStateReadModelReader
  return { reader, getCalls: () => getCalls }
}

function runtimeConfig(snapshotId = 'devnet-test-snapshot'): RuntimeConfig {
  return {
    network: 'devnet',
    mainnetEnabled: false,
    xrplRpcUrls: ['https://example.invalid/'],
    rpcTimeoutMs: 8_000,
    staleAfterSeconds: 30,
    currentState: {
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      githubBranch: 'current-state-data',
      replacement: { snapshotId, githubBranch: 'current-state-data' },
      releaseChannelTag: 'current-state-channel',
      maxAssetBytes: 8 * 1024 * 1024,
      maxDecompressedBytes: 16 * 1024 * 1024,
    },
    history: {
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      githubBranch: 'history-data',
      channelPath: 'history-channel.json',
      maxAssetBytes: 32 * 1024 * 1024,
      fetchTimeoutMs: 8_000,
    },
  }
}

function verifiedReader(snapshotId = 'devnet-test-snapshot'): GithubCurrentStateReadModelReader {
  return {
    updatedAt: '2026-07-13T08:00:00.000Z',
    manifest: {
      schemaVersion: 1,
      snapshotId,
      epochId: 'devnet-test-epoch',
      releaseTag: 'current-state-channel',
      ledgerIndex: 3_600_000,
      ledgerHash: 'A'.repeat(64),
      complete: true,
      pageSize: 100,
      lookupPrefixLength: 2,
      counts: { vaults: 1, loanBrokers: 1, loans: 1 },
      pageCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
      manifestSha256: 'b'.repeat(64),
    },
  } as unknown as GithubCurrentStateReadModelReader
}

beforeEach(() => {
  clearVerifiedReleaseCurrentStateCacheForTest()
  vi.restoreAllMocks()
})

describe('release current-state relationship cache', () => {
  it('reuses embedded Vaults for a 25-row Broker page', async () => {
    const brokers = Array.from({ length: 25 }, (_, index) => {
      const relatedVault = vault(index + 1)
      return { broker: broker(index + 1001, relatedVault.id), vault: relatedVault }
    })
    const source = model({ brokers, loans: [] })
    const adapter = createReadModelAdapter(source.reader, () => { throw new Error('unexpected resolved read') })

    await adapter.listObjects('loan-broker', { limit: 25, direction: 'asc' })
    for (const item of brokers) {
      expect((await adapter.getObject(item.vault.id, { maxAssetReads: 512 })).item?.id).toBe(item.vault.id)
    }
    expect(source.getCalls()).toBe(0)
  })

  it('reuses embedded Broker and Vault records for a 25-row Loan page', async () => {
    const loans = Array.from({ length: 25 }, (_, index) => {
      const relatedVault = vault(index + 1)
      const relatedBroker = broker(index + 1001, relatedVault.id)
      return { loan: loan(index + 2001, relatedBroker.id), broker: relatedBroker, vault: relatedVault }
    })
    const source = model({ brokers: [], loans })
    const adapter = createReadModelAdapter(source.reader, () => { throw new Error('unexpected resolved read') })

    await adapter.listObjects('loan', { limit: 25, direction: 'asc' })
    for (const item of loans) {
      expect((await adapter.getObject(item.broker.id, { maxAssetReads: 512 })).item?.id).toBe(item.broker.id)
      expect((await adapter.getObject(item.vault.id, { maxAssetReads: 512 })).item?.id).toBe(item.vault.id)
    }
    expect(source.getCalls()).toBe(0)
  })
})

describe('verified release current-state fallback', () => {
  it('reuses the last verified reader after a transient GitHub release fetch failure', async () => {
    const open = vi.spyOn(GithubCurrentStateReadModelReader, 'open')
      .mockResolvedValueOnce(verifiedReader())
      .mockRejectedValueOnce(new Error('temporary GitHub Raw failure'))
    const db = {} as D1Database
    const config = runtimeConfig()

    const initial = await resolveCurrentStateStorage(config, db, 0)
    const fallback = await resolveCurrentStateStorage(config, db, 5 * 60 * 1000 + 1)

    expect(open).toHaveBeenCalledTimes(2)
    expect(initial.releaseUnavailable).toBe(false)
    expect(initial.releaseFallback).toBe(false)
    expect(fallback.releaseUnavailable).toBe(false)
    expect(fallback.releaseFallback).toBe(true)
    expect(fallback.snapshot?.id).toBe('devnet-test-snapshot')
    expect(fallback.source).toBe(initial.source)
  })

  it('does not reuse a cached reader after the configured snapshot identity changes', async () => {
    vi.spyOn(GithubCurrentStateReadModelReader, 'open')
      .mockResolvedValueOnce(verifiedReader('snapshot-a'))
      .mockRejectedValueOnce(new Error('temporary GitHub Raw failure'))
    const db = {} as D1Database

    const initial = await resolveCurrentStateStorage(runtimeConfig('snapshot-a'), db, 0)
    const changed = await resolveCurrentStateStorage(runtimeConfig('snapshot-b'), db, 5 * 60 * 1000 + 1)

    expect(initial.releaseUnavailable).toBe(false)
    expect(changed.releaseUnavailable).toBe(true)
    expect(changed.snapshot).toBeNull()
  })
})
