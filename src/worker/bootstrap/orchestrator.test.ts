import { describe, expect, it, vi } from 'vitest'

import type { SnapshotManifest } from '../repositories/d1-snapshot-verify'
import { orchestrateBootstrap } from './orchestrator'

const identity = {
  snapshotId: 'snapshot-1',
  epochId: 'epoch-1',
  endpoint: 'https://devnet.example/',
  ledgerIndex: 123,
  ledgerHash: 'A'.repeat(64),
  objectPrefix: 'unused',
}

const completeCheckpoint = {
  snapshotId: identity.snapshotId,
  nextMarker: null,
  nextBatchSequence: 3,
  scanComplete: true,
  metrics: {
    pages: 1,
    requests: 1,
    decodedObjects: 2_048,
    objects: 81,
    elapsedMs: 10,
    requestedObjectsPerPage: 2_048,
    responseMode: 'binary' as const,
    byType: {
      vault: { objects: 81 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  },
  updatedAt: '2026-07-03T00:00:00.000Z',
}

function manifest(): SnapshotManifest {
  return {
    schemaVersion: 1,
    network: 'devnet',
    snapshotId: identity.snapshotId,
    epochId: identity.epochId,
    ledgerIndex: identity.ledgerIndex,
    ledgerHash: identity.ledgerHash,
    generatedAt: '2026-07-03T00:00:01.000Z',
    counts: { objects: 81, vaults: 81, loanBrokers: 0, loans: 0 },
    batchCount: 2,
    normalizedBytes: 1000,
    batches: [],
  }
}

describe('D1 bootstrap orchestration', () => {
  it('verifies a complete scan without activating it', async () => {
    const verify = vi.fn(async () => ({ manifest: manifest(), manifestHash: 'b'.repeat(64) }))
    const executeScan = vi.fn(async () => completeCheckpoint)

    const result = await orchestrateBootstrap({
      db: {} as D1Database,
      identity,
      timeoutMs: 1000,
      dependencies: {
        begin: vi.fn(async () => undefined),
        loadCheckpoint: vi.fn(async () => completeCheckpoint),
        executeScan,
        verify,
      },
      now: () => '2026-07-03T00:00:01.000Z',
    })

    expect(result.status).toBe('verified')
    expect(result.manifestHash).toBe('b'.repeat(64))
    expect(executeScan).toHaveBeenCalledWith(expect.objectContaining({
      objectLimitPerPage: 2_048,
      maxPagesPerRun: 25,
    }))
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      pageCount: 1,
      decodedObjectCount: 2_048,
    }))
  })

  it('rejects an RPC page size above the bounded maximum', async () => {
    await expect(orchestrateBootstrap({
      db: {} as D1Database,
      identity,
      timeoutMs: 1000,
      objectLimitPerPage: 2_049,
    })).rejects.toThrow('must not exceed 2048')
  })
})
