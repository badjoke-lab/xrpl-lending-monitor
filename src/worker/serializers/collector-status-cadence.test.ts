import { describe, expect, it } from 'vitest'

import type { StoredSyncState } from '../../domain/network/status'
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

function sync(): StoredSyncState {
  return {
    network: 'devnet',
    epochId: 'devnet-3371675',
    lastProcessedLedger: 3_592_674,
    lastProcessedHash: 'A'.repeat(64),
    latestObservedLedger: 3_592_964,
    latestObservedHash: 'B'.repeat(64),
    latestLedgerAgeSeconds: 1,
    lastAttemptAt: lastSuccessAt,
    lastSuccessAt,
    status: 'healthy',
    consecutiveFailures: 0,
    endpoint: 'wss://example.invalid',
    serverVersion: '3.2.0',
    serverState: 'full',
    completeLedgers: '32570-3592964',
    lendingProtocolEnabled: true,
    lendingProtocolSupported: true,
    singleAssetVaultEnabled: true,
    singleAssetVaultSupported: true,
    resetReason: null,
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

  it('keeps the reported lag consistent with the cursor in the same response', () => {
    const result = serializeCollectorStatus({
      collector: collector(),
      sync: sync(),
      role: 'canonical_overlay_refresh',
      expectedIntervalSeconds: 4 * 60 * 60,
      staleAfterSeconds: 5 * 60 * 60,
    })

    expect(result.cursor).toMatchObject({
      last_processed_ledger: 3_592_674,
      latest_observed_ledger: 3_592_964,
      lag_ledgers: 290,
    })
  })
})
