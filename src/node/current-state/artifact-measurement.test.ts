import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import {
  scanCurrentStateBatch,
  type CurrentStatePage,
  type CurrentStateScanMetrics,
} from '../../collector/current-state/scan-current-state'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { runLocalArtifactMeasurement } from './artifact-measurement'

const roots: string[] = []
const ledgerHash = 'A'.repeat(64)

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'xrpl-lending-measurement-'))
  roots.push(root)
  return root
}

function page(markerBefore: unknown, markerAfter: unknown, id: string): CurrentStatePage {
  const vault: ScannedLedgerObject = {
    LedgerEntryType: 'Vault',
    index: id,
    BinaryHex: 'ABCD',
    Flags: 0,
    Owner: `r${id}`,
  }
  return {
    pageNumber: 1,
    markerBefore,
    markerAfter,
    firstLedgerIndex: id,
    lastLedgerIndex: id,
    decodedObjects: 1,
    vaults: [vault],
    loanBrokers: [],
    loans: [],
  }
}

function metrics(elapsedMs: number): CurrentStateScanMetrics {
  return {
    pages: 1,
    requests: 1,
    decodedObjects: 1,
    objects: 1,
    elapsedMs,
    requestedObjectsPerPage: 2_048,
    responseMode: 'binary',
    byType: {
      vault: { objects: 1 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  }
}

const scanBatch: typeof scanCurrentStateBatch = async (options) => {
  if (options.startMarker == null) {
    await options.onPage(page(undefined, { cursor: 'next' }, 'V1'))
    return {
      endpoint: options.endpoint,
      ledgerHash: options.ledgerHash,
      ledgerIndex: options.ledgerIndex,
      complete: false,
      nextMarker: { cursor: 'next' },
      metrics: metrics(20),
    }
  }
  expect(options.startMarker).toEqual({ cursor: 'next' })
  await options.onPage(page(options.startMarker, null, 'V2'))
  return {
    endpoint: options.endpoint,
    ledgerHash: options.ledgerHash,
    ledgerIndex: options.ledgerIndex,
    complete: true,
    nextMarker: null,
    metrics: metrics(30),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local artifact measurement', () => {
  it('persists a fixed run plan and resumes to a complete snapshot', async () => {
    const root = await temporaryRoot()
    const first = await runLocalArtifactMeasurement({
      root,
      ledgerIndex: 100,
      ledgerHash,
      pageBudget: 1,
      maxPagesPerRun: 1,
      scanBatch,
      now: () => '2026-07-03T00:00:00.000Z',
    })

    expect(first.status).toBe('paused')
    expect(first.runtime.startingPageCount).toBe(0)
    expect(first.runtime.endingPageCount).toBe(1)
    expect(first.snapshotManifest).toBeNull()

    const second = await runLocalArtifactMeasurement({
      root,
      ledgerIndex: 100,
      ledgerHash,
      pageBudget: 1,
      maxPagesPerRun: 1,
      scanBatch,
      now: () => '2026-07-03T00:00:00.000Z',
    })

    expect(second.status).toBe('complete')
    expect(second.runtime.startingPageCount).toBe(1)
    expect(second.runtime.endingPageCount).toBe(2)
    expect(second.runtime.processedPagesThisInvocation).toBe(1)
    expect(second.checkpoint.metrics.elapsedMs).toBe(50)
    expect(second.payload.dataObjects).toBe(2)
    expect(second.payload.indexEntries).toBe(8)
    expect(second.payload.catalogEntries).toBeGreaterThan(0)
    expect(second.payload.catalogUncompressedBytes).toBeGreaterThan(0)
    expect(second.payload.catalogShareOfCompressedPayload).toBeGreaterThan(0)
    expect(second.artifacts.pageManifestCount).toBe(2)
    expect(second.artifacts.catalogArtifactCount).toBeGreaterThan(0)
    expect(second.artifacts.catalogCompressedBytes).toBeGreaterThan(0)
    expect(second.artifacts.maxCatalogArtifactBytes).toBeGreaterThan(0)
    expect(second.artifacts.maxArtifactBytes).toBeGreaterThanOrEqual(second.artifacts.maxCatalogArtifactBytes)
    expect(second.artifacts.totalStoredBytes).toBe(
      second.artifacts.dataCompressedBytes
      + second.artifacts.indexCompressedBytes
      + second.artifacts.catalogCompressedBytes
      + second.artifacts.pageManifestBytes
      + second.artifacts.snapshotManifestBytes,
    )
    expect(second.snapshotManifest?.key).toBe(
      'current-state/devnet/devnet-measurement-100/devnet-100-aaaaaaaaaaaa/manifest.json',
    )

    const runPlan = JSON.parse(await readFile(join(root, 'run.json'), 'utf8')) as {
      identity: { ledgerIndex: number; ledgerHash: string }
    }
    expect(runPlan.identity).toMatchObject({ ledgerIndex: 100, ledgerHash })
    expect(JSON.parse(await readFile(join(root, 'evidence.json'), 'utf8'))).toMatchObject({
      status: 'complete',
      artifacts: { catalogArtifactCount: second.artifacts.catalogArtifactCount },
      payload: { dataObjects: 2, catalogEntries: second.payload.catalogEntries },
    })
  })
})
