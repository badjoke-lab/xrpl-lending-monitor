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

describe('progressed catch-up initialization state', () => {
  it('treats an aligned progressed cursor and watermark as a safe no-op', () => {
    const sync = {
      network: 'devnet',
      epochId: base.epochId,
      lastProcessedLedger: 3371700,
      lastProcessedHash: 'PROGRESSED_HASH',
      latestObservedLedger: 3371800,
      latestObservedHash: 'HEAD_HASH',
      latestLedgerAgeSeconds: 1,
      lastAttemptAt: '2026-07-05T00:00:00.000Z',
      lastSuccessAt: '2026-07-05T00:00:00.000Z',
      status: 'healthy',
      consecutiveFailures: 0,
      endpoint: 'https://devnet.example/',
      serverVersion: 'test',
      serverState: 'full',
      completeLedgers: '1-3371800',
      lendingProtocolEnabled: true,
      lendingProtocolSupported: true,
      singleAssetVaultEnabled: true,
      singleAssetVaultSupported: true,
      resetReason: null,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
    } satisfies StoredSyncState
    const overlay = {
      network: 'devnet',
      epochId: base.epochId,
      baseSnapshotId: base.snapshotId,
      baseLedgerIndex: base.ledgerIndex,
      baseLedgerHash: base.ledgerHash,
      overlayLedgerIndex: 3371700,
      overlayLedgerHash: 'PROGRESSED_HASH',
      updatedAt: '2026-07-05T00:00:00.000Z',
    } satisfies CurrentStateOverlayState

    expect(planCatchUpInitialization({
      base,
      evidence: {
        sync,
        currentEpochId: base.epochId,
        baseEpochExists: true,
        overlayStates: [overlay],
        processedLedgerCount: 25,
      },
    })).toEqual({ action: 'replay' })
  })
})
