import { describe, expect, it } from 'vitest'

import type { StoredSyncState } from '../../domain/network/status'
import type { CurrentStateOverlayState } from '../repositories/current-state-overlay'
import { planReplacementBaseRebase } from './replacement-base-rebase-plan'

const EPOCH = 'devnet-3371675'
const OLD_HASH = '1'.repeat(64)
const TARGET_HASH = '2'.repeat(64)
const HEAD_HASH = '3'.repeat(64)
const CONTINUED_HASH = '4'.repeat(64)

const target = {
  epochId: EPOCH,
  snapshotId: 'devnet-3432924-canonical',
  ledgerIndex: 3432924,
  ledgerHash: TARGET_HASH,
}

function sync(overrides: Partial<StoredSyncState> = {}): StoredSyncState {
  return {
    network: 'devnet',
    epochId: EPOCH,
    lastProcessedLedger: 3390079,
    lastProcessedHash: OLD_HASH,
    latestObservedLedger: 3435000,
    latestObservedHash: HEAD_HASH,
    latestLedgerAgeSeconds: 1,
    lastAttemptAt: '2026-07-06T00:00:00.000Z',
    lastSuccessAt: '2026-07-06T00:00:00.000Z',
    status: 'healthy',
    consecutiveFailures: 0,
    endpoint: 'https://devnet.example/',
    serverVersion: 'test',
    serverState: 'full',
    completeLedgers: '1-3435000',
    lendingProtocolEnabled: true,
    lendingProtocolSupported: true,
    singleAssetVaultEnabled: true,
    singleAssetVaultSupported: true,
    resetReason: null,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  }
}

function oldOverlay(overrides: Partial<CurrentStateOverlayState> = {}): CurrentStateOverlayState {
  return {
    network: 'devnet',
    epochId: EPOCH,
    baseSnapshotId: 'devnet-3371675-0ba2ed766c19',
    baseLedgerIndex: 3371675,
    baseLedgerHash: '0'.repeat(64),
    overlayLedgerIndex: 3390079,
    overlayLedgerHash: OLD_HASH,
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  }
}

function targetOverlay(overrides: Partial<CurrentStateOverlayState> = {}): CurrentStateOverlayState {
  return {
    network: 'devnet',
    epochId: EPOCH,
    baseSnapshotId: target.snapshotId,
    baseLedgerIndex: target.ledgerIndex,
    baseLedgerHash: target.ledgerHash,
    overlayLedgerIndex: target.ledgerIndex,
    overlayLedgerHash: target.ledgerHash,
    updatedAt: '2026-07-06T01:00:00.000Z',
    ...overrides,
  }
}

describe('replacement-base rebase planning', () => {
  it('plans a forward rebase from the active cursor-aligned overlay', () => {
    expect(planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync(),
        currentEpochId: EPOCH,
        overlayStates: [oldOverlay()],
      },
    })).toEqual({
      action: 'rebase',
      previousSnapshotId: 'devnet-3371675-0ba2ed766c19',
      previousBaseLedgerIndex: 3371675,
      previousBaseLedgerHash: '0'.repeat(64),
      previousCursorLedgerIndex: 3390079,
      previousCursorLedgerHash: OLD_HASH,
      latestObservedLedger: 3435000,
      latestObservedHash: HEAD_HASH,
    })
  })

  it('returns replay when sync and target overlay are aligned at the target', () => {
    expect(planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync({
          lastProcessedLedger: target.ledgerIndex,
          lastProcessedHash: target.ledgerHash,
        }),
        currentEpochId: EPOCH,
        overlayStates: [targetOverlay(), oldOverlay()],
      },
    })).toEqual({ action: 'replay' })
  })

  it('returns replay after live continuation advances beyond the replacement target', () => {
    const continuedLedger = target.ledgerIndex + 40
    expect(planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync({
          lastProcessedLedger: continuedLedger,
          lastProcessedHash: CONTINUED_HASH,
        }),
        currentEpochId: EPOCH,
        overlayStates: [
          targetOverlay({
            overlayLedgerIndex: continuedLedger,
            overlayLedgerHash: CONTINUED_HASH,
          }),
          oldOverlay(),
        ],
      },
    })).toEqual({ action: 'replay' })
  })

  it('blocks later cursors that are not bound to the replacement target', () => {
    expect(() => planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync({
          lastProcessedLedger: target.ledgerIndex + 1,
          lastProcessedHash: CONTINUED_HASH,
        }),
        currentEpochId: EPOCH,
        overlayStates: [oldOverlay({
          overlayLedgerIndex: target.ledgerIndex + 1,
          overlayLedgerHash: CONTINUED_HASH,
        })],
      },
    })).toThrow('refuses to regress')
  })

  it('blocks target reuse without an aligned replay state', () => {
    expect(() => planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync(),
        currentEpochId: EPOCH,
        overlayStates: [oldOverlay(), targetOverlay()],
      },
    })).toThrow('already exists')
  })

  it('blocks overlay/cursor mismatch', () => {
    expect(() => planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync(),
        currentEpochId: EPOCH,
        overlayStates: [oldOverlay({ overlayLedgerIndex: 3390078 })],
      },
    })).toThrow('exactly one overlay aligned')
  })

  it('blocks continued replay when target overlay watermark disagrees with the cursor', () => {
    expect(() => planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync({
          lastProcessedLedger: target.ledgerIndex + 40,
          lastProcessedHash: CONTINUED_HASH,
        }),
        currentEpochId: EPOCH,
        overlayStates: [targetOverlay()],
      },
    })).toThrow('target overlay watermark is inconsistent')
  })

  it('blocks epoch mismatch, bad health, and observed head behind target', () => {
    expect(() => planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync({ epochId: 'other' }),
        currentEpochId: EPOCH,
        overlayStates: [oldOverlay()],
      },
    })).toThrow('remain in the active epoch')

    expect(() => planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync({ status: 'error' }),
        currentEpochId: EPOCH,
        overlayStates: [oldOverlay()],
      },
    })).toThrow('network status is error')

    expect(() => planReplacementBaseRebase({
      target,
      evidence: {
        sync: sync({ latestObservedLedger: target.ledgerIndex - 1 }),
        currentEpochId: EPOCH,
        overlayStates: [oldOverlay()],
      },
    })).toThrow('behind the replacement base ledger')
  })
})
