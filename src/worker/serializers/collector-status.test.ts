import { describe, expect, it } from 'vitest'

import type { IncrementalCollectorState } from '../repositories/incremental-collector-state'
import { serializeCollectorStatus } from './collector-status'

describe('collector status', () => {
  it('returns uninitialized without state', () => {
    const result = serializeCollectorStatus({ collector: null, sync: null, staleAfterSeconds: 30, nowMs: 0 })
    expect(result.status).toBe('uninitialized')
  })

  it('exposes measured persistence batch usage separately from estimates', () => {
    const collector: IncrementalCollectorState = {
      network: 'devnet',
      status: 'behind',
      lastAttemptAt: '2026-07-10T05:00:00.000Z',
      lastSuccessAt: '2026-07-10T05:00:00.000Z',
      consecutiveFailures: 0,
      lagLedgers: 100,
      endpoint: 'wss://example.invalid',
      lastRunDurationMs: 6000,
      lastRpcRequests: 32,
      lastEndpointAttempts: 1,
      lastLedgersProcessed: 32,
      lastInspectedTransactions: 400,
      lastLendingTransactions: 20,
      lastEstimatedRows: 80,
      lastEstimatedStatements: 90,
      lastOverlayMutations: 4,
      lastPersistenceBatchResults: 90,
      lastPersistenceStatements: 90,
      lastPersistenceRowsRead: 12,
      lastPersistenceRowsWritten: 76,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-07-10T04:00:00.000Z',
      updatedAt: '2026-07-10T05:00:00.000Z',
    }

    const result = serializeCollectorStatus({ collector, sync: null, staleAfterSeconds: 3600, nowMs: Date.parse(collector.updatedAt) })
    expect(result.usage).toMatchObject({
      estimated_rows: 80,
      estimated_statements: 90,
      persistence_batch_results: 90,
      persistence_statements: 90,
      persistence_rows_read: 12,
      persistence_rows_written: 76,
    })
  })
})
