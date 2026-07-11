import { describe, expect, it } from 'vitest'

import type { IncrementalCollectorState } from '../repositories/incremental-collector-state'
import { serializeCollectorStatus } from './collector-status'

const lastSuccessAt = '2026-07-11T04:00:00.000Z'

function collector(): IncrementalCollectorState {
  return {
    network: 'devnet',
    status: 'behind',
    lastAttemptAt: lastSuccessAt,
    lastSuccessAt,
    consecutiveFailures: 0,
    lagLedgers: 20_000,
    endpoint: 'wss://example.invalid',
    lastRunDurationMs: 7000,
    lastRpcRequests: 32,
    lastEndpointAttempts: 1,
    lastLedgersProcessed: 32,
    lastInspectedTransactions: 500,
    lastLendingTransactions: 10,
    lastEstimatedRows: 50,
    lastEstimatedStatements: 60,
    lastOverlayMutations: 3,
    lastPersistenceBatchResults: 60,
    lastPersistenceStatements: 60,
    lastPersistenceRowsRead: 10,
    lastPersistenceRowsWritten: 40,
    errorCode: null,
    errorMessage: null,
    createdAt: lastSuccessAt,
    updatedAt: lastSuccessAt,
  }
}

describe('protected heavy collector status cadence', () => {
  it('does not mark a four-hour cadence stale before the five-hour threshold', () => {
    const result = serializeCollectorStatus({
      collector: collector(),
      sync: null,
      role: 'canonical_overlay_refresh',
      expectedIntervalSeconds: 4 * 60 * 60,
      staleAfterSeconds: 5 * 60 * 60,
      nowMs: Date.parse(lastSuccessAt) + 4.5 * 60 * 60 * 1000,
    })

    expect(result.status).toBe('behind')
    expect(result).toMatchObject({
      role: 'canonical_overlay_refresh',
      cadence: {
        expected_interval_seconds: 14_400,
        stale_after_seconds: 18_000,
      },
    })
  })

  it('marks the protected heavy collector stale after the five-hour threshold', () => {
    const result = serializeCollectorStatus({
      collector: collector(),
      sync: null,
      role: 'canonical_overlay_refresh',
      expectedIntervalSeconds: 4 * 60 * 60,
      staleAfterSeconds: 5 * 60 * 60,
      nowMs: Date.parse(lastSuccessAt) + (5 * 60 * 60 + 1) * 1000,
    })

    expect(result.status).toBe('stale')
  })
})
