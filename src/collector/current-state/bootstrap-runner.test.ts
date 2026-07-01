import { describe, expect, it } from 'vitest'

import type { ScannedLedgerObject } from './scan-ledger-objects'
import type {
  CurrentStateBatchResult,
  CurrentStatePage,
  CurrentStateScanMetrics,
} from './scan-current-state'
import {
  runCurrentStateBootstrap,
  type BootstrapCheckpoint,
  type BootstrapCheckpointStore,
  type BootstrapIdentity,
  type BootstrapLifecycle,
  type BootstrapObjectStore,
} from './bootstrap-runner'

const identity: BootstrapIdentity = {
  snapshotId: 'snapshot-1',
  epochId: 'epoch-1',
  endpoint: 'https://devnet.example',
  ledgerIndex: 123,
  ledgerHash: 'A'.repeat(64),
  objectPrefix: 'current/devnet/epoch-1/snapshot-1',
}

function object(type: 'Vault' | 'LoanBroker' | 'Loan', index: string): ScannedLedgerObject {
  return {
    LedgerEntryType: type,
    index,
    BinaryHex: '00',
  }
}

function page(options: {
  pageNumber?: number
  markerBefore?: unknown
  markerAfter?: unknown
  vaults?: number
  brokers?: number
  loans?: number
}): CurrentStatePage {
  const vaults = Array.from({ length: options.vaults ?? 0 }, (_, index) =>
    object('Vault', `V-${index}`),
  )
  const loanBrokers = Array.from({ length: options.brokers ?? 0 }, (_, index) =>
    object('LoanBroker', `B-${index}`),
  )
  const loans = Array.from({ length: options.loans ?? 0 }, (_, index) =>
    object('Loan', `L-${index}`),
  )
  return {
    pageNumber: options.pageNumber ?? 1,
    markerBefore: options.markerBefore,
    markerAfter: options.markerAfter,
    firstLedgerIndex: '0001',
    lastLedgerIndex: '0002',
    decodedObjects: vaults.length + loanBrokers.length + loans.length + 2,
    vaults,
    loanBrokers,
    loans,
  }
}

function metrics(options: {
  pages: number
  decoded: number
  relevant: number
  elapsed?: number
}): CurrentStateScanMetrics {
  return {
    pages: options.pages,
    requests: options.pages,
    decodedObjects: options.decoded,
    objects: options.relevant,
    elapsedMs: options.elapsed ?? 10,
    requestedObjectsPerPage: 2_048,
    responseMode: 'binary',
    byType: {
      vault: { objects: 0 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  }
}

function batch(options: {
  complete: boolean
  nextMarker: unknown
  pages: number
  decoded: number
  relevant: number
}): CurrentStateBatchResult {
  return {
    endpoint: identity.endpoint,
    ledgerHash: identity.ledgerHash,
    ledgerIndex: identity.ledgerIndex,
    complete: options.complete,
    nextMarker: options.nextMarker,
    metrics: metrics({
      pages: options.pages,
      decoded: options.decoded,
      relevant: options.relevant,
    }),
  }
}

function harness(options: { verify?: () => boolean } = {}) {
  let checkpoint: BootstrapCheckpoint | null = null
  const stored = new Map<string, { bytes: Uint8Array; sha256: string }>()
  const began: BootstrapIdentity[] = []
  const activated: string[] = []

  const checkpointStore: BootstrapCheckpointStore = {
    async load() {
      return checkpoint
    },
    async save(value) {
      checkpoint = structuredClone(value)
    },
    async clear() {
      checkpoint = null
    },
  }

  const objectStore: BootstrapObjectStore = {
    async putShard(value) {
      const existing = stored.get(value.key)
      if (existing && existing.sha256 !== value.sha256) {
        throw new Error('idempotent shard key changed content')
      }
      stored.set(value.key, { bytes: value.bytes, sha256: value.sha256 })
      return { storedBytes: value.bytes.byteLength }
    },
    async putManifest(value) {
      stored.set(value.key, { bytes: value.bytes, sha256: value.sha256 })
    },
    async verifyManifest(value) {
      return (options.verify?.() ?? true) && stored.get(value.key)?.sha256 === value.sha256
    },
  }

  const lifecycle: BootstrapLifecycle = {
    async begin(value) {
      began.push(value)
    },
    async activate(value) {
      activated.push(value.manifestKey)
    },
  }

  return {
    checkpointStore,
    objectStore,
    lifecycle,
    stored,
    began,
    activated,
    getCheckpoint: () => checkpoint,
    setCheckpoint: (value: BootstrapCheckpoint) => {
      checkpoint = value
    },
  }
}

const encodePage = (value: CurrentStatePage) => ({
  bytes: new Uint8Array([0x1f, 0x8b, value.pageNumber, value.decodedObjects]),
  encoding: 'gzip' as const,
})

describe('runCurrentStateBootstrap', () => {
  it('writes shards, verifies a manifest, and activates a complete snapshot', async () => {
    const state = harness()
    const scanBatch = async (options: Parameters<typeof runCurrentStateBootstrap>[0] extends {
      scanBatch?: infer Scan
    }
      ? Scan extends (...args: never[]) => unknown
        ? Parameters<Scan>[0]
        : never
      : never) => {
      const currentPage = page({ markerAfter: null, vaults: 1, brokers: 1, loans: 1 })
      await options.onPage(currentPage)
      return batch({
        complete: true,
        nextMarker: null,
        pages: 1,
        decoded: currentPage.decodedObjects,
        relevant: 3,
      })
    }

    const result = await runCurrentStateBootstrap({
      identity,
      checkpointStore: state.checkpointStore,
      objectStore: state.objectStore,
      lifecycle: state.lifecycle,
      encodePage,
      timeoutMs: 1_000,
      generatedAt: () => '2026-07-01T00:00:00.000Z',
      scanBatch: scanBatch as never,
    })

    expect(result.status).toBe('complete')
    expect(result.manifest?.counts).toEqual({ vaults: 1, loanBrokers: 1, loans: 1 })
    expect(result.manifest?.shards).toHaveLength(1)
    expect(result.manifest?.shards[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(state.activated).toEqual([`${identity.objectPrefix}/manifest.json`])
    expect(state.getCheckpoint()).toBeNull()
  })

  it('resumes from the exact marker and continues the global shard sequence', async () => {
    const state = harness()
    let calls = 0
    const scanBatch = async (options: {
      startMarker?: unknown
      onPage: (value: CurrentStatePage) => Promise<void> | void
    }) => {
      calls += 1
      if (calls === 1) {
        expect(options.startMarker).toBeUndefined()
        const currentPage = page({ markerAfter: 'marker-1', vaults: 1 })
        await options.onPage(currentPage)
        return batch({
          complete: false,
          nextMarker: 'marker-1',
          pages: 1,
          decoded: currentPage.decodedObjects,
          relevant: 1,
        })
      }
      expect(options.startMarker).toBe('marker-1')
      const currentPage = page({ markerBefore: 'marker-1', markerAfter: null, loans: 2 })
      await options.onPage(currentPage)
      return batch({
        complete: true,
        nextMarker: null,
        pages: 1,
        decoded: currentPage.decodedObjects,
        relevant: 2,
      })
    }

    const first = await runCurrentStateBootstrap({
      identity,
      checkpointStore: state.checkpointStore,
      objectStore: state.objectStore,
      lifecycle: state.lifecycle,
      encodePage,
      timeoutMs: 1_000,
      scanBatch: scanBatch as never,
    })
    expect(first.status).toBe('paused')
    expect(first.checkpoint?.nextMarker).toBe('marker-1')
    expect(first.checkpoint?.nextPageNumber).toBe(2)

    const second = await runCurrentStateBootstrap({
      identity,
      checkpointStore: state.checkpointStore,
      objectStore: state.objectStore,
      lifecycle: state.lifecycle,
      encodePage,
      timeoutMs: 1_000,
      scanBatch: scanBatch as never,
    })

    expect(second.status).toBe('complete')
    expect(second.manifest?.shards.map((shard) => shard.pageNumber)).toEqual([1, 2])
    expect(second.manifest?.counts).toEqual({ vaults: 1, loanBrokers: 0, loans: 2 })
    expect(state.began).toHaveLength(1)
  })

  it('retries manifest verification without rescanning durable final shards', async () => {
    let verificationAttempts = 0
    const state = harness({
      verify: () => {
        verificationAttempts += 1
        return verificationAttempts > 1
      },
    })
    let scanCalls = 0
    const scanBatch = async (options: {
      onPage: (value: CurrentStatePage) => Promise<void> | void
    }) => {
      scanCalls += 1
      const currentPage = page({ markerAfter: null, loans: 1 })
      await options.onPage(currentPage)
      return batch({
        complete: true,
        nextMarker: null,
        pages: 1,
        decoded: currentPage.decodedObjects,
        relevant: 1,
      })
    }

    await expect(
      runCurrentStateBootstrap({
        identity,
        checkpointStore: state.checkpointStore,
        objectStore: state.objectStore,
        lifecycle: state.lifecycle,
        encodePage,
        timeoutMs: 1_000,
        scanBatch: scanBatch as never,
      }),
    ).rejects.toThrow('Current-state manifest verification failed')

    expect(state.getCheckpoint()?.scanComplete).toBe(true)

    const retried = await runCurrentStateBootstrap({
      identity,
      checkpointStore: state.checkpointStore,
      objectStore: state.objectStore,
      lifecycle: state.lifecycle,
      encodePage,
      timeoutMs: 1_000,
      scanBatch: scanBatch as never,
    })

    expect(retried.status).toBe('complete')
    expect(scanCalls).toBe(1)
  })

  it('rejects a checkpoint tied to a different validated ledger', async () => {
    const state = harness()
    state.setCheckpoint({
      schemaVersion: 1,
      ...identity,
      ledgerHash: 'B'.repeat(64),
      nextMarker: 'marker-1',
      nextPageNumber: 2,
      scanComplete: false,
      metrics: metrics({ pages: 1, decoded: 2, relevant: 0 }),
      shards: [
        {
          key: `${identity.objectPrefix}/shards/page-00000001.json.gz`,
          pageNumber: 1,
          firstLedgerIndex: '0001',
          lastLedgerIndex: '0002',
          decodedObjects: 2,
          vaultCount: 0,
          loanBrokerCount: 0,
          loanCount: 0,
          compressedBytes: 4,
          sha256: 'a'.repeat(64),
        },
      ],
    })

    await expect(
      runCurrentStateBootstrap({
        identity,
        checkpointStore: state.checkpointStore,
        objectStore: state.objectStore,
        lifecycle: state.lifecycle,
        encodePage,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('Bootstrap checkpoint ledgerHash does not match')
  })
})
