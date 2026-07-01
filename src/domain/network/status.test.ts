import { describe, expect, it } from 'vitest'

import type { NetworkSnapshot } from '../../collector/network/read-network-snapshot'
import {
  planFailedStatus,
  planSuccessfulStatus,
  type StoredSyncState,
} from './status'

function snapshot(overrides: Partial<NetworkSnapshot> = {}): NetworkSnapshot {
  return {
    network: 'devnet',
    observedAt: '2026-07-01T00:00:00.000Z',
    endpoint: 'https://devnet.example',
    serverVersion: '3.2.0',
    serverState: 'full',
    completeLedgers: '1-100',
    validatedLedger: {
      ageSeconds: 2,
      hash: 'ABCDEF0123456789',
      index: 100,
    },
    amendments: {
      lendingProtocol: {
        id: 'lending',
        name: 'LendingProtocol',
        enabled: true,
        supported: true,
      },
      singleAssetVault: {
        id: 'vault',
        name: 'SingleAssetVault',
        enabled: true,
        supported: true,
      },
    },
    ...overrides,
  }
}

function storedState(overrides: Partial<StoredSyncState> = {}): StoredSyncState {
  return {
    network: 'devnet',
    epochId: 'devnet:90:old',
    lastProcessedLedger: null,
    lastProcessedHash: null,
    latestObservedLedger: 90,
    latestObservedHash: 'OLD',
    latestLedgerAgeSeconds: 2,
    lastAttemptAt: '2026-06-30T23:59:00.000Z',
    lastSuccessAt: '2026-06-30T23:59:00.000Z',
    status: 'healthy',
    consecutiveFailures: 0,
    endpoint: 'https://devnet.example',
    serverVersion: '3.2.0',
    serverState: 'full',
    completeLedgers: '1-90',
    lendingProtocolEnabled: true,
    lendingProtocolSupported: true,
    singleAssetVaultEnabled: true,
    singleAssetVaultSupported: true,
    resetReason: null,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T23:59:00.000Z',
    ...overrides,
  }
}

describe('planSuccessfulStatus', () => {
  it('creates the first epoch from a validated ledger observation', () => {
    const plan = planSuccessfulStatus({
      previous: null,
      snapshot: snapshot(),
      staleAfterSeconds: 30,
    })

    expect(plan.state).toMatchObject({
      status: 'healthy',
      epochId: 'devnet:100:abcdef0123456789',
      latestObservedLedger: 100,
    })
    expect(plan.newEpoch).toMatchObject({
      id: 'devnet:100:abcdef0123456789',
      firstLedgerIndex: 100,
      firstLedgerHash: 'ABCDEF0123456789',
      status: 'current',
    })
  })

  it('marks old validated-ledger data as stale', () => {
    const plan = planSuccessfulStatus({
      previous: storedState(),
      snapshot: snapshot({
        validatedLedger: {
          ageSeconds: 31,
          hash: 'NEXT',
          index: 100,
        },
      }),
      staleAfterSeconds: 30,
    })

    expect(plan.state.status).toBe('stale')
    expect(plan.newEpoch).toBeNull()
  })

  it('records a reset suspicion without replacing the epoch', () => {
    const plan = planSuccessfulStatus({
      previous: storedState(),
      snapshot: snapshot({
        validatedLedger: {
          ageSeconds: 1,
          hash: 'NEW',
          index: 10,
        },
      }),
      staleAfterSeconds: 30,
    })

    expect(plan.state).toMatchObject({
      status: 'reset_suspected',
      resetReason: 'ledger_index_rewind',
      epochId: 'devnet:90:old',
    })
    expect(plan.newEpoch).toBeNull()
  })

  it('does not compare an incomplete previous ledger observation', () => {
    const plan = planSuccessfulStatus({
      previous: storedState({ latestObservedHash: null }),
      snapshot: snapshot({
        validatedLedger: {
          ageSeconds: 1,
          hash: 'CURRENT',
          index: 90,
        },
      }),
      staleAfterSeconds: 30,
    })

    expect(plan.state.status).toBe('healthy')
  })
})

describe('planFailedStatus', () => {
  it('preserves committed data and increments failure count', () => {
    const failed = planFailedStatus({
      previous: storedState({ consecutiveFailures: 2 }),
      attemptedAt: '2026-07-01T00:01:00.000Z',
      code: 'all_endpoints_failed',
      message: 'No endpoint responded',
    })

    expect(failed).toMatchObject({
      status: 'error',
      consecutiveFailures: 3,
      latestObservedLedger: 90,
      errorCode: 'all_endpoints_failed',
      errorMessage: 'No endpoint responded',
    })
  })
})
