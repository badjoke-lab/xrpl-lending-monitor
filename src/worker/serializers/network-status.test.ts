import { describe, expect, it } from 'vitest'

import type {
  NetworkEpochRecord,
  StoredSyncState,
} from '../../domain/network/status'
import { serializeNetworkStatus } from './network-status'

const state: StoredSyncState = {
  network: 'devnet',
  epochId: 'epoch-1',
  lastProcessedLedger: 99,
  lastProcessedHash: 'PROCESSED',
  latestObservedLedger: 100,
  latestObservedHash: 'LATEST',
  latestLedgerAgeSeconds: 2,
  lastAttemptAt: '2026-07-01T00:00:00.000Z',
  lastSuccessAt: '2026-07-01T00:00:00.000Z',
  status: 'healthy',
  consecutiveFailures: 0,
  endpoint: 'https://devnet.example',
  serverVersion: '3.2.0',
  serverState: 'full',
  completeLedgers: '1-100',
  lendingProtocolEnabled: true,
  lendingProtocolSupported: true,
  singleAssetVaultEnabled: true,
  singleAssetVaultSupported: true,
  resetReason: null,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const epoch: NetworkEpochRecord = {
  id: 'epoch-1',
  network: 'devnet',
  status: 'current',
  firstLedgerIndex: 90,
  firstLedgerHash: 'FIRST',
  lastLedgerIndex: 100,
  lastLedgerHash: 'LATEST',
  startedAt: '2026-06-30T23:00:00.000Z',
  endedAt: null,
  resetReason: null,
  createdAt: '2026-06-30T23:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

describe('serializeNetworkStatus', () => {
  it('returns explicit epoch, amendment, collector, and freshness fields', () => {
    const response = serializeNetworkStatus({
      state,
      epoch,
      evaluatedAt: new Date('2026-07-01T00:00:05.000Z'),
    })

    expect(response).toMatchObject({
      network: 'devnet',
      epoch: {
        id: 'epoch-1',
        first_ledger_index: 90,
        last_ledger_index: 100,
      },
      server: {
        latest_validated_ledger: 100,
        latest_validated_hash: 'LATEST',
      },
      amendments: {
        lending_protocol: { enabled: true, supported: true },
        single_asset_vault: { enabled: true, supported: true },
      },
      collector: {
        status: 'healthy',
        data_age_seconds: 5,
        last_processed_ledger: 99,
        error: null,
      },
    })
  })

  it('returns an uninitialized response before the first scheduled refresh', () => {
    expect(serializeNetworkStatus({ state: null, epoch: null })).toMatchObject({
      epoch: null,
      server: {
        latest_validated_ledger: null,
      },
      collector: {
        status: 'uninitialized',
        consecutive_failures: 0,
      },
    })
  })
})
