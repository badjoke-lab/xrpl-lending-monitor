import { describe, expect, it } from 'vitest'

import type { NormalizedObjectChange } from './affected-nodes'
import { deriveArchivedObjects } from './deleted-object-archive'

const relationships = {
  vaultId: 'V'.repeat(64),
  loanBrokerId: 'B'.repeat(64),
  loanId: 'L'.repeat(64),
  account: 'rAccount',
  owner: 'rOwner',
  borrower: 'rBorrower',
  assetKey: 'XRP',
  mptIssuanceId: null,
}

function change(options: {
  objectType: 'Vault' | 'LoanBroker' | 'Loan'
  objectId?: string
  transactionType: string
  fieldName: string
  beforeJson: string
  ledgerIndex?: number
  action?: NormalizedObjectChange['action']
}): NormalizedObjectChange {
  return {
    network: 'devnet',
    epochId: 'epoch-1',
    ledgerIndex: options.ledgerIndex ?? 10,
    closeTime: 1000,
    transactionHash: options.transactionType.padEnd(64, '0'),
    transactionIndex: 1,
    transactionType: options.transactionType,
    result: 'tesSUCCESS',
    nodeIndex: 0,
    objectType: options.objectType,
    objectId: options.objectId ?? options.objectType[0].repeat(64),
    action: options.action ?? 'deleted',
    fieldName: options.fieldName,
    beforeValue: JSON.parse(options.beforeJson),
    afterValue: undefined,
    beforeJson: options.beforeJson,
    afterJson: null,
    valueType: 'string',
    unsupportedField: false,
    relationships,
  }
}

describe('deriveArchivedObjects', () => {
  it('archives a deleted Vault final state with a supported delete reason', () => {
    const [archive] = deriveArchivedObjects([
      change({
        objectType: 'Vault',
        objectId: 'V'.repeat(64),
        transactionType: 'VaultDelete',
        fieldName: 'Owner',
        beforeJson: '"rOwner"',
      }),
      change({
        objectType: 'Vault',
        objectId: 'V'.repeat(64),
        transactionType: 'VaultDelete',
        fieldName: 'AssetsTotal',
        beforeJson: '"0"',
      }),
    ])

    expect(archive).toMatchObject({
      objectType: 'Vault',
      objectId: 'V'.repeat(64),
      deletionReason: 'vault_delete',
      finalStateJson: '{"AssetsTotal":"0","Owner":"rOwner"}',
      vaultId: 'V'.repeat(64),
      owner: 'rOwner',
      assetKey: 'XRP',
    })
  })

  it('archives deleted Broker and Loan relationships separately', () => {
    const archives = deriveArchivedObjects([
      change({
        objectType: 'LoanBroker',
        objectId: 'B'.repeat(64),
        transactionType: 'LoanBrokerDelete',
        fieldName: 'VaultID',
        beforeJson: `"${'V'.repeat(64)}"`,
      }),
      change({
        objectType: 'Loan',
        objectId: 'L'.repeat(64),
        transactionType: 'LoanDelete',
        fieldName: 'LoanBrokerID',
        beforeJson: `"${'B'.repeat(64)}"`,
      }),
    ])

    expect(archives.map((item) => [item.objectType, item.deletionReason])).toEqual([
      ['LoanBroker', 'loan_broker_delete'],
      ['Loan', 'loan_delete'],
    ])
    expect(archives[0]?.loanBrokerId).toBe('B'.repeat(64))
    expect(archives[1]?.loanId).toBe('L'.repeat(64))
  })

  it('uses unknown deletion reason when transaction evidence is not specific', () => {
    const [archive] = deriveArchivedObjects([
      change({
        objectType: 'Loan',
        transactionType: 'LoanManage',
        fieldName: 'Flags',
        beforeJson: '0',
      }),
    ])

    expect(archive?.deletionReason).toBe('unknown')
  })

  it('ignores non-deleted object changes', () => {
    expect(
      deriveArchivedObjects([
        change({
          objectType: 'Loan',
          transactionType: 'LoanSet',
          fieldName: 'PaymentRemaining',
          beforeJson: '2',
          action: 'modified',
        }),
      ]),
    ).toEqual([])
  })

  it('orders archive rows by deletion ledger and transaction order', () => {
    const archives = deriveArchivedObjects([
      change({
        objectType: 'Loan',
        objectId: '2'.repeat(64),
        transactionType: 'LoanDelete',
        fieldName: 'Flags',
        beforeJson: '0',
        ledgerIndex: 12,
      }),
      change({
        objectType: 'Loan',
        objectId: '1'.repeat(64),
        transactionType: 'LoanDelete',
        fieldName: 'Flags',
        beforeJson: '0',
        ledgerIndex: 11,
      }),
    ])

    expect(archives.map((item) => item.objectId)).toEqual(['1'.repeat(64), '2'.repeat(64)])
  })
})
