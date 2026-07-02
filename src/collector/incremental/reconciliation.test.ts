import { describe, expect, it } from 'vitest'

import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import { reconcileCurrentRelationships } from './reconciliation'

function vault(id: string): VaultCurrentProjection {
  return { id } as VaultCurrentProjection
}

function broker(id: string, vaultId: string): LoanBrokerCurrentProjection {
  return { id, vaultId } as LoanBrokerCurrentProjection
}

function loan(id: string, loanBrokerId: string): LoanCurrentProjection {
  return { id, loanBrokerId } as LoanCurrentProjection
}

describe('reconcileCurrentRelationships', () => {
  it('reports no issues for consistent current relationships', () => {
    expect(
      reconcileCurrentRelationships({
        vaults: [vault('V1')],
        brokers: [broker('B1', 'V1')],
        loans: [loan('L1', 'B1')],
      }),
    ).toEqual([])
  })

  it('reports missing Broker Vault and missing Loan Broker references', () => {
    expect(
      reconcileCurrentRelationships({
        vaults: [],
        brokers: [broker('B1', 'V1')],
        loans: [loan('L1', 'B2'), loan('L2', 'B1')],
      }),
    ).toEqual([
      { type: 'broker_missing_vault', objectId: 'B1', relatedId: 'V1' },
      { type: 'loan_broker_vault_missing', objectId: 'L2', relatedId: 'V1' },
      { type: 'loan_missing_broker', objectId: 'L1', relatedId: 'B2' },
    ])
  })

  it('accepts archived relationship targets without rewriting current state', () => {
    expect(
      reconcileCurrentRelationships({
        vaults: [],
        brokers: [broker('B1', 'V1')],
        loans: [loan('L1', 'B2')],
        archivedVaultIds: ['V1'],
        archivedBrokerIds: ['B2'],
      }),
    ).toEqual([])
  })

  it('sorts reported issues deterministically', () => {
    expect(
      reconcileCurrentRelationships({
        vaults: [],
        brokers: [broker('B2', 'V2'), broker('B1', 'V1')],
        loans: [loan('L2', 'B9'), loan('L1', 'B8')],
      }).map((issue) => issue.objectId),
    ).toEqual(['B1', 'B2', 'L1', 'L2'])
  })
})
