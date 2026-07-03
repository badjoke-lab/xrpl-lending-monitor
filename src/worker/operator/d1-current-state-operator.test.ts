import { beforeEach, describe, expect, it, vi } from 'vitest'

const runD1Bootstrap = vi.fn()

vi.mock('../bootstrap/d1-bootstrap', () => ({ runD1Bootstrap }))

import { executeD1CurrentStateOperator } from './d1-current-state-operator'

const db = {} as D1Database
const identity = {
  snapshotId: 'snapshot-1',
  epochId: 'epoch-1',
  endpoint: 'https://devnet.example/',
  ledgerIndex: 100,
  ledgerHash: 'A'.repeat(64),
}

describe('D1 current-state operator bootstrap action', () => {
  beforeEach(() => {
    runD1Bootstrap.mockReset()
  })

  it('returns public-safe evidence without verifying or activating', async () => {
    runD1Bootstrap.mockResolvedValue({
      status: 'complete',
      checkpoint: {
        snapshotId: identity.snapshotId,
        nextMarker: null,
        nextBatchSequence: 3,
        scanComplete: true,
        metrics: {
          pages: 2,
          requests: 2,
          decodedObjects: 160,
          objects: 4,
          elapsedMs: 12,
          requestedObjectsPerPage: 80,
          responseMode: 'binary',
          byType: {
            vault: { objects: 1 },
            loan_broker: { objects: 1 },
            loan: { objects: 2 },
          },
        },
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
      manifest: null,
      manifestHash: null,
    })

    const evidence = await executeD1CurrentStateOperator({
      db,
      input: {
        action: 'bootstrap',
        identity,
        timeoutMs: 10_000,
        maxPagesPerRun: 2,
        objectLimitPerPage: 80,
      },
      now: () => '2026-07-03T00:00:00.000Z',
      heapUsedBytes: () => 1234,
    })

    expect(runD1Bootstrap).toHaveBeenCalledWith(expect.objectContaining({
      db,
      identity: expect.objectContaining({
        snapshotId: identity.snapshotId,
        ledgerIndex: identity.ledgerIndex,
        ledgerHash: identity.ledgerHash,
      }),
      verifyOnComplete: false,
      maxPagesPerRun: 2,
      objectLimitPerPage: 80,
    }))
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      action: 'bootstrap',
      result: {
        status: 'complete',
        scanComplete: true,
        markerPresent: false,
        retries: 0,
        heapUsedBytes: 1234,
        activationPerformed: false,
      },
    })
    expect(JSON.stringify(evidence)).not.toContain('nextMarker')
  })

  it('rejects unbounded operator inputs before starting bootstrap', async () => {
    await expect(
      executeD1CurrentStateOperator({
        db,
        input: {
          action: 'bootstrap',
          identity,
          timeoutMs: 10_000,
          maxPagesPerRun: 26,
        },
      }),
    ).rejects.toThrow('maxPagesPerRun')
    expect(runD1Bootstrap).not.toHaveBeenCalled()
  })
})
