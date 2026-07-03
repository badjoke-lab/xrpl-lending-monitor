import { describe, expect, it, vi } from 'vitest'

import type { CurrentStatePage, CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'
import type { D1BootstrapCheckpoint } from '../repositories/d1-bootstrap-checkpoint-repository'
import type { SnapshotManifest } from '../repositories/d1-snapshot-verify'
import { runD1Bootstrap } from './d1-bootstrap'

const identity = {
  snapshotId: 'snapshot-1',
  epochId: 'epoch-1',
  endpoint: 'https://devnet.example/',
  ledgerIndex: 123,
  ledgerHash: 'A'.repeat(64),
  objectPrefix: 'unused-by-d1',
}

function metrics(options: Partial<CurrentStateScanMetrics> = {}): CurrentStateScanMetrics {
  return {
    pages: 0,
    requests: 0,
    decodedObjects: 0,
    objects: 0,
    elapsedMs: 0,
    requestedObjectsPerPage: 80,
    responseMode: 'binary',
    byType: {
      vault: { objects: 0 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
    ...options,
  }
}

function page(markerBefore: unknown, markerAfter: unknown): CurrentStatePage {
  return {
    pageNumber: 1,
    markerBefore,
    markerAfter,
    firstLedgerIndex: null,
    lastLedgerIndex: null,
    decodedObjects: 80,
    vaults: [],
    loanBrokers: [],
    loans: [],
  }
}

function manifest(): SnapshotManifest {
  return {
    schemaVersion: 1,
    network: 'devnet',
    snapshotId: identity.snapshotId,
    epochId: identity.epochId,
    ledgerIndex: identity.ledgerIndex,
    ledgerHash: identity.ledgerHash,
    generatedAt: '2026-07-03T00:00:03.000Z',
    counts: { objects: 0, vaults: 0, loanBrokers: 0, loans: 0 },
    batchCount: 2,
    normalizedBytes: 0,
    batches: [],
  }
}

function clock() {
  const values = [
    '2026-07-03T00:00:00.000Z',
    '2026-07-03T00:00:00.100Z',
    '2026-07-03T00:00:01.000Z',
    '2026-07-03T00:00:02.000Z',
    '2026-07-03T00:00:03.000Z',
  ]
  return () => values.shift() ?? '2026-07-03T00:00:04.000Z'
}

describe('D1 bootstrap orchestration', () => {
  it('persists a bounded page before returning a resumable pause', async () => {
    const writeBatch = vi.fn(async () => ({
      status: 'stored' as const,
      batchHash: 'b'.repeat(64),
      objectCount: 0,
      normalizedBytes: 0,
    }))
    const updateMetrics = vi.fn(async () => undefined)
    const verify = vi.fn(async () => ({ manifest: manifest(), manifestHash: 'c'.repeat(64) }))

    const result = await runD1Bootstrap({
      db: {} as D1Database,
      identity,
      timeoutMs: 1000,
      now: clock(),
      dependencies: {
        begin: vi.fn(async () => undefined),
        loadCheckpoint: vi.fn(async () => null),
        writeBatch,
        updateMetrics,
        verify,
        scanBatch: async (options) => {
          await options.onPage(page(undefined, { cursor: 'next' }))
          return {
            endpoint: identity.endpoint,
            ledgerHash: identity.ledgerHash,
            ledgerIndex: identity.ledgerIndex,
            complete: false,
            nextMarker: { cursor: 'next' },
            metrics: metrics({ elapsedMs: 5 }),
          }
        },
      },
    })

    expect(result.status).toBe('paused')
    expect(result.checkpoint.nextBatchSequence).toBe(2)
    expect(result.checkpoint.nextMarker).toEqual({ cursor: 'next' })
    expect(result.checkpoint.metrics).toMatchObject({ pages: 1, requests: 1, decodedObjects: 80, elapsedMs: 5 })
    expect(writeBatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      snapshotId: identity.snapshotId,
      sequence: 1,
      markerAfter: { cursor: 'next' },
    }))
    expect(updateMetrics).toHaveBeenCalledOnce()
    expect(verify).not.toHaveBeenCalled()
  })

  it('resumes from the exact stored marker and verifies only after terminal completion', async () => {
    const checkpoint: D1BootstrapCheckpoint = {
      snapshotId: identity.snapshotId,
      nextMarker: { cursor: 'next' },
      nextBatchSequence: 2,
      scanComplete: false,
      metrics: metrics({ pages: 1, requests: 1, decodedObjects: 80, elapsedMs: 5 }),
      updatedAt: '2026-07-03T00:00:00.000Z',
    }
    const verify = vi.fn(async () => ({ manifest: manifest(), manifestHash: 'c'.repeat(64) }))

    const result = await runD1Bootstrap({
      db: {} as D1Database,
      identity,
      timeoutMs: 1000,
      now: clock(),
      dependencies: {
        begin: vi.fn(async () => undefined),
        loadCheckpoint: vi.fn(async () => checkpoint),
        writeBatch: vi.fn(async () => ({
          status: 'stored' as const,
          batchHash: 'd'.repeat(64),
          objectCount: 0,
          normalizedBytes: 0,
        })),
        updateMetrics: vi.fn(async () => undefined),
        verify,
        scanBatch: async (options) => {
          expect(options.startMarker).toEqual({ cursor: 'next' })
          expect(options.objectLimitPerPage).toBe(80)
          await options.onPage(page({ cursor: 'next' }, null))
          return {
            endpoint: identity.endpoint,
            ledgerHash: identity.ledgerHash,
            ledgerIndex: identity.ledgerIndex,
            complete: true,
            nextMarker: null,
            metrics: metrics({ elapsedMs: 7 }),
          }
        },
      },
    })

    expect(result.status).toBe('verified')
    expect(result.checkpoint.scanComplete).toBe(true)
    expect(result.checkpoint.nextMarker).toBeNull()
    expect(result.checkpoint.metrics).toMatchObject({ pages: 2, requests: 2, decodedObjects: 160, elapsedMs: 12 })
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: identity.snapshotId,
      pageCount: 2,
      requestCount: 2,
      decodedObjectCount: 160,
      durationMs: 12,
    }))
  })

  it('rejects a page size that could exceed the D1 statement envelope', async () => {
    await expect(runD1Bootstrap({
      db: {} as D1Database,
      identity,
      timeoutMs: 1000,
      objectLimitPerPage: 81,
    })).rejects.toThrow('must not exceed 80')
  })
})
