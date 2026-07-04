import { describe, expect, it } from 'vitest'
import type { StoredSyncState } from '../../domain/network/status'
import type { CurrentStateOverlayState } from '../repositories/current-state-overlay'
import { planCatchUpInitialization } from './catch-up-initialization-plan'

const base = {
  epochId: 'devnet-3371675',
  snapshotId: 'devnet-3371675-0ba2ed766c19',
  ledgerIndex: 3371675,
  ledgerHash: '0BA2ED766C190C733F8F26288785CBDF01D0FC26E1A6C03EDB7E9DFF6F8BCB90',
}

function sync(overrides: Partial<StoredSyncState> = {}): StoredSyncState {
  return {
    network: 'devnet',
    epochId: 'devnet:4000000:abcdef0123456789',
    lastProcessedLedger: null,
    lastProcessedHash: null,
    latestObservedLedger: 4000000,
    latestObservedHash: 'HEAD_HASH',
    latestLedgerAgeSeconds: 1,
    lastAttemptAt: '2026-07-05T00:00:00.000Z',
    lastSuccessAt: '2026-07-05T00:00:00.000Z',
    status: 'healthy',
    consecutiveFailures: 0,
    endpoint: 'https://devnet.example/',
    serverVersion: 'test',
    serverState: 'full',
    completeLedgers: '1-4000000',
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

function overlay(): CurrentStateOverlayState {
  return {
    network: 'devnet',
    epochId: base.epochId,
    baseSnapshotId: base.snapshotId,
    baseLedgerIndex: base.ledgerIndex,
    baseLedgerHash: base.ledgerHash,
    overlayLedgerIndex: base.ledgerIndex,
    overlayLedgerHash: base.ledgerHash,
    updatedAt: '2026-07-05T00:00:00.000Z',
  }
}

describe('catch-up initialization planner', () => {
  it('allows a fresh initialization only from empty cursor, history, and overlay state', () => {
    expect(planCatchUpInitialization({
      base,
      evidence: {
        sync: sync(),
        currentEpochId: 'devnet:4000000:abcdef0123456789',
        baseEpochExists: false,
        overlayStates: [],
        processedLedgerCount: 0,
      },
    })).toEqual({
      action: 'initialize',
      previousEpochId: 'devnet:4000000:abcdef0123456789',
      latestObservedLedger: 4000000,
      latestObservedHash: 'HEAD_HASH',
    })
  })

  it('treats a fully aligned initialized state as an exact replay', () => {
    expect(planCatchUpInitialization({
      base,
      evidence: {
        sync: sync({
          epochId: base.epochId,
          lastProcessedLedger: base.ledgerIndex,
          lastProcessedHash: base.ledgerHash,
        }),
        currentEpochId: base.epochId,
        baseEpochExists: true,
        overlayStates: [overlay()],
        processedLedgerCount: 0,
      },
    })).toEqual({ action: 'replay' })
  })

  it('rejects existing cursor, history, overlay, reset, and epoch mismatch states', () => {
    expect(() => planCatchUpInitialization({
      base,
      evidence: {
        sync: sync({ lastProcessedLedger: 3999999, lastProcessedHash: 'OLD' }),
        currentEpochId: 'devnet:4000000:abcdef0123456789',
        baseEpochExists: false,
        overlayStates: [],
        processedLedgerCount: 0,
      },
    })).toThrow('existing incremental cursor')

    expect(() => planCatchUpInitialization({
      base,
      evidence: {
        sync: sync(),
        currentEpochId: 'devnet:4000000:abcdef0123456789',
        baseEpochExists: false,
        overlayStates: [],
        processedLedgerCount: 1,
      },
    })).toThrow('processed-ledger history')

    expect(() => planCatchUpInitialization({
      base,
      evidence: {
        sync: sync(),
        currentEpochId: 'devnet:4000000:abcdef0123456789',
        baseEpochExists: false,
        overlayStates: [overlay()],
        processedLedgerCount: 0,
      },
    })).toThrow('existing overlay state')

    expect(() => planCatchUpInitialization({
      base,
      evidence: {
        sync: sync({ status: 'reset_suspected' }),
        currentEpochId: 'devnet:4000000:abcdef0123456789',
        baseEpochExists: false,
        overlayStates: [],
        processedLedgerCount: 0,
      },
    })).toThrow('reset is suspected')

    expect(() => planCatchUpInitialization({
      base,
      evidence: {
        sync: sync(),
        currentEpochId: 'different-epoch',
        baseEpochExists: false,
        overlayStates: [],
        processedLedgerCount: 0,
      },
    })).toThrow('does not match sync state')
  })
})
