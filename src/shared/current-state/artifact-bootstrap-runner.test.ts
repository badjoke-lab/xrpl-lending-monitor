import { describe, expect, it } from 'vitest'

import {
  scanCurrentStateBatch,
  type CurrentStatePage,
  type CurrentStateScanMetrics,
} from '../../collector/current-state/scan-current-state'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { ArtifactMetadata, ArtifactStore } from './artifact-metadata'
import { runArtifactBootstrap } from './artifact-bootstrap-runner'
import { InMemoryArtifactBootstrapCheckpointStore } from './artifact-bootstrap-types'
import { InMemoryArtifactStore } from './in-memory-artifact-store'

const identity = {
  network: 'devnet' as const,
  snapshotId: 'snapshot-1',
  epochId: 'epoch-1',
  endpoint: 'https://example.invalid',
  ledgerIndex: 100,
  ledgerHash: 'A'.repeat(64),
}

function vault(index: string): ScannedLedgerObject {
  return {
    LedgerEntryType: 'Vault',
    index,
    BinaryHex: 'ABCD',
    Flags: 0,
    Owner: `r${index}`,
  }
}

function page(pageNumber: number, markerBefore: unknown, markerAfter: unknown): CurrentStatePage {
  return {
    pageNumber,
    markerBefore,
    markerAfter,
    firstLedgerIndex: `first-${pageNumber}`,
    lastLedgerIndex: `last-${pageNumber}`,
    decodedObjects: 1,
    vaults: [vault(`V${pageNumber}`)],
    loanBrokers: [],
    loans: [],
  }
}

function metrics(pages: number, elapsedMs: number): CurrentStateScanMetrics {
  return {
    pages,
    requests: pages,
    decodedObjects: pages,
    objects: pages,
    elapsedMs,
    requestedObjectsPerPage: 2_048,
    responseMode: 'binary',
    byType: {
      vault: { objects: pages },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  }
}

class FailingStore implements ArtifactStore {
  readonly delegate = new InMemoryArtifactStore()
  writes = 0

  async write(key: string, bytes: Uint8Array, sha256: string): Promise<void> {
    this.writes += 1
    if (this.writes === 2) throw new Error('Injected artifact failure')
    await this.delegate.write(key, bytes, sha256)
  }

  read(key: string): Promise<Uint8Array | null> {
    return this.delegate.read(key)
  }

  inspect(key: string): Promise<ArtifactMetadata | null> {
    return this.delegate.inspect(key)
  }

  enumerate(prefix: string): Promise<ArtifactMetadata[]> {
    return this.delegate.enumerate(prefix)
  }
}

describe('artifact bootstrap runner', () => {
  it('persists every page manifest and completes without activation', async () => {
    const checkpointStore = new InMemoryArtifactBootstrapCheckpointStore()
    const store = new InMemoryArtifactStore()
    const scanBatch: typeof scanCurrentStateBatch = async (options) => {
      await options.onPage(page(1, undefined, { cursor: 'next' }))
      await options.onPage(page(2, { cursor: 'next' }, null))
      return {
        endpoint: options.endpoint,
        ledgerHash: options.ledgerHash,
        ledgerIndex: options.ledgerIndex,
        complete: true,
        nextMarker: null,
        metrics: metrics(2, 50),
      }
    }

    const result = await runArtifactBootstrap({
      identity,
      store,
      checkpointStore,
      timeoutMs: 1_000,
      scanBatch,
    })

    expect(result.status).toBe('complete')
    expect(result.checkpoint.scanComplete).toBe(true)
    expect(result.checkpoint.nextPageSequence).toBe(3)
    expect(result.checkpoint.pageManifests).toHaveLength(2)
    expect(result.checkpoint.metrics.pages).toBe(2)
    expect(result.checkpoint.metrics.elapsedMs).toBe(50)
    const stored = await store.enumerate('current-state/devnet/epoch-1/snapshot-1/')
    expect(stored.filter((item) => item.key.endsWith('/manifest.json'))).toHaveLength(2)
  })

  it('resumes from the last committed marker and page sequence', async () => {
    const checkpointStore = new InMemoryArtifactBootstrapCheckpointStore()
    const store = new InMemoryArtifactStore()
    const firstScan: typeof scanCurrentStateBatch = async (options) => {
      await options.onPage(page(1, undefined, { cursor: 'resume' }))
      return {
        endpoint: options.endpoint,
        ledgerHash: options.ledgerHash,
        ledgerIndex: options.ledgerIndex,
        complete: false,
        nextMarker: { cursor: 'resume' },
        metrics: metrics(1, 20),
      }
    }
    const paused = await runArtifactBootstrap({
      identity,
      store,
      checkpointStore,
      timeoutMs: 1_000,
      maxPagesPerRun: 1,
      scanBatch: firstScan,
    })
    expect(paused.status).toBe('paused')

    const secondScan: typeof scanCurrentStateBatch = async (options) => {
      expect(options.startMarker).toEqual({ cursor: 'resume' })
      await options.onPage(page(1, { cursor: 'resume' }, null))
      return {
        endpoint: options.endpoint,
        ledgerHash: options.ledgerHash,
        ledgerIndex: options.ledgerIndex,
        complete: true,
        nextMarker: null,
        metrics: metrics(1, 30),
      }
    }
    const complete = await runArtifactBootstrap({
      identity,
      store,
      checkpointStore,
      timeoutMs: 1_000,
      scanBatch: secondScan,
    })

    expect(complete.status).toBe('complete')
    expect(complete.checkpoint.nextPageSequence).toBe(3)
    expect(complete.checkpoint.pageManifests.map((item) => item.pageSequence)).toEqual([1, 2])
    expect(complete.checkpoint.metrics.elapsedMs).toBe(50)
  })

  it('does not save a checkpoint when page artifacts fail before durability', async () => {
    const checkpointStore = new InMemoryArtifactBootstrapCheckpointStore()
    const store = new FailingStore()
    const scanBatch: typeof scanCurrentStateBatch = async (options) => {
      await options.onPage(page(1, undefined, { cursor: 'not-committed' }))
      return {
        endpoint: options.endpoint,
        ledgerHash: options.ledgerHash,
        ledgerIndex: options.ledgerIndex,
        complete: false,
        nextMarker: { cursor: 'not-committed' },
        metrics: metrics(1, 10),
      }
    }

    await expect(runArtifactBootstrap({
      identity,
      store,
      checkpointStore,
      timeoutMs: 1_000,
      scanBatch,
    })).rejects.toThrow('Injected artifact failure')
    expect(await checkpointStore.load(identity.snapshotId)).toBeNull()
  })
})
