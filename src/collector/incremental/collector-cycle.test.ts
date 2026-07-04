import { describe, expect, it, vi } from 'vitest'

import type { StoredSyncState } from '../../domain/network/status'
import { resolveIncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { IncrementalCollectorState } from '../../worker/repositories/incremental-collector-state'
import { runIncrementalCollectorCycle } from './collector-cycle'

const runtimeConfig = resolveRuntimeConfig({
  APP_NETWORK: 'devnet',
  MAINNET_ENABLED: 'false',
  XRPL_DEVNET_RPC_URL: 'https://devnet.example',
})
const incrementalConfig = resolveIncrementalRuntimeConfig({})
const db = {} as D1Database

function sync(overrides: Partial<StoredSyncState> = {}): StoredSyncState {
  return {
    network: 'devnet',
    epochId: 'epoch-1',
    lastProcessedLedger: 10,
    lastProcessedHash: 'HASH_10',
    latestObservedLedger: 12,
    latestObservedHash: 'HASH_12',
    latestLedgerAgeSeconds: 1,
    lastAttemptAt: '2026-07-05T00:00:00.000Z',
    lastSuccessAt: '2026-07-05T00:00:00.000Z',
    status: 'healthy',
    consecutiveFailures: 0,
    endpoint: 'https://devnet.example/',
    serverVersion: 'test',
    serverState: 'full',
    completeLedgers: '1-12',
    lendingProtocolEnabled: true,
    lendingProtocolSupported: true,
    singleAssetVaultEnabled: true,
    singleAssetVaultSupported: true,
    resetReason: null,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  }
}

const scope = {
  epoch_id: 'epoch-1',
  base_snapshot_id: 'snapshot-10',
  base_ledger_index: 10,
  base_ledger_hash: 'HASH_10',
  overlay_ledger_index: 10,
  overlay_ledger_hash: 'HASH_10',
}

describe('incremental collector cycle', () => {
  it('waits for explicit cursor initialization', async () => {
    const saved: IncrementalCollectorState[] = []
    const result = await runIncrementalCollectorCycle({
      db,
      runtimeConfig,
      incrementalConfig,
      dependencies: {
        getSync: async () => sync({ lastProcessedLedger: null, lastProcessedHash: null }),
        getCollectorState: async () => null,
        saveCollectorState: async (_db, state) => { saved.push(state) },
        readScope: async () => scope,
      },
    })
    expect(result.status).toBe('awaiting_initialization')
    expect(saved.at(-1)?.status).toBe('awaiting_initialization')
  })

  it('does not run a range when reset is suspected', async () => {
    const runRange = vi.fn()
    const result = await runIncrementalCollectorCycle({
      db,
      runtimeConfig,
      incrementalConfig,
      dependencies: {
        getSync: async () => sync({ status: 'reset_suspected' }),
        getCollectorState: async () => null,
        saveCollectorState: async () => undefined,
        readScope: async () => scope,
        runRange,
      },
    })
    expect(result.status).toBe('reset_suspected')
    expect(runRange).not.toHaveBeenCalled()
  })

  it('runs one bounded range and persists the resulting collector state', async () => {
    const saved: IncrementalCollectorState[] = []
    const state: IncrementalCollectorState = {
      network: 'devnet',
      status: 'behind',
      lastAttemptAt: '2026-07-05T00:00:00.000Z',
      lastSuccessAt: '2026-07-05T00:00:00.000Z',
      consecutiveFailures: 0,
      lagLedgers: 1,
      endpoint: 'https://devnet.example/',
      lastRunDurationMs: 10,
      lastRpcRequests: 2,
      lastEndpointAttempts: 2,
      lastLedgersProcessed: 2,
      lastInspectedTransactions: 0,
      lastLendingTransactions: 0,
      lastEstimatedRows: 10,
      lastEstimatedStatements: 9,
      lastOverlayMutations: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
    }
    const runRange = vi.fn(async () => ({
      result: { status: 'committed' as const, ledgersProcessed: 2, lagLedgers: 1 },
      state,
    }))

    const result = await runIncrementalCollectorCycle({
      db,
      runtimeConfig,
      incrementalConfig,
      dependencies: {
        getSync: async () => sync({ latestObservedLedger: 13, latestObservedHash: 'HASH_13' }),
        getCollectorState: async () => null,
        saveCollectorState: async (_db, next) => { saved.push(next) },
        readScope: async () => scope,
        runRange,
      },
    })

    expect(result).toEqual({ status: 'committed', ledgersProcessed: 2, lagLedgers: 1 })
    expect(runRange).toHaveBeenCalledTimes(1)
    expect(saved.at(-1)).toEqual(state)
  })
})
