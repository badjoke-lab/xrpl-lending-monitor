import { describe, expect, it } from 'vitest'

import {
  scanCurrentStateBatch,
  type CurrentStatePage,
  type CurrentStateScanMetrics,
} from '../../collector/current-state/scan-current-state'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { runArtifactBootstrap } from './artifact-bootstrap-runner'
import { InMemoryArtifactBootstrapCheckpointStore } from './artifact-bootstrap-types'
import { InMemoryArtifactStore } from './in-memory-artifact-store'
import { buildAndPersistSnapshotLevelManifest } from './snapshot-level-manifest'

const identity = {
  network: 'devnet' as const,
  snapshotId: 'snapshot-1',
  epochId: 'epoch-1',
  endpoint: 'https://example.invalid',
  ledgerIndex: 100,
  ledgerHash: 'A'.repeat(64),
}

function page(pageNumber: number, markerAfter: unknown): CurrentStatePage {
  const value: ScannedLedgerObject = {
    LedgerEntryType: 'Vault',
    index: `V${pageNumber}`,
    BinaryHex: 'ABCD',
    Flags: 0,
    Owner: `r${pageNumber}`,
  }
  return {
    pageNumber,
    markerBefore: pageNumber === 1 ? undefined : { cursor: pageNumber - 1 },
    markerAfter,
    firstLedgerIndex: value.index,
    lastLedgerIndex: value.index,
    decodedObjects: 1,
    vaults: [value],
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

async function completeBootstrap() {
  const store = new InMemoryArtifactStore()
  const checkpointStore = new InMemoryArtifactBootstrapCheckpointStore()
  const scanBatch: typeof scanCurrentStateBatch = async (options) => {
    await options.onPage(page(1, { cursor: 1 }))
    await options.onPage(page(2, null))
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
  return { store, checkpoint: result.checkpoint }
}

describe('snapshot-level manifest', () => {
  it('verifies and aggregates complete page manifests deterministically', async () => {
    const fixture = await completeBootstrap()
    const first = await buildAndPersistSnapshotLevelManifest({
      ...fixture,
      generatedAt: '2026-07-03T00:00:00.000Z',
    })
    const second = await buildAndPersistSnapshotLevelManifest({
      ...fixture,
      generatedAt: '2026-07-03T00:00:00.000Z',
    })

    expect(first.manifest.pageCount).toBe(2)
    expect(first.manifest.totals.dataObjects).toBe(2)
    expect(first.manifest.totals.indexEntries).toBe(8)
    expect(first.key).toBe('current-state/devnet/epoch-1/snapshot-1/manifest.json')
    expect(first.sha256).toBe(second.sha256)
  })

  it('rejects incomplete checkpoints', async () => {
    const fixture = await completeBootstrap()
    const checkpoint = { ...fixture.checkpoint, scanComplete: false }
    await expect(buildAndPersistSnapshotLevelManifest({
      store: fixture.store,
      checkpoint,
      generatedAt: '2026-07-03T00:00:00.000Z',
    })).rejects.toThrow('requires a complete bootstrap checkpoint')
  })

  it('rejects page manifest digest mismatches', async () => {
    const fixture = await completeBootstrap()
    const checkpoint = structuredClone(fixture.checkpoint)
    const first = checkpoint.pageManifests[0]
    if (!first) throw new Error('Missing page manifest reference')
    first.sha256 = '0'.repeat(64)

    await expect(buildAndPersistSnapshotLevelManifest({
      store: fixture.store,
      checkpoint,
      generatedAt: '2026-07-03T00:00:00.000Z',
    })).rejects.toThrow('Page manifest digest mismatch')
  })
})
