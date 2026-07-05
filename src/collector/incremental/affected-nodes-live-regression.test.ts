import { describe, expect, it } from 'vitest'

import { normalizeAffectedNodes, type ObjectChangeContext } from './affected-nodes'

const context: ObjectChangeContext = {
  network: 'devnet',
  epochId: 'devnet-test',
  ledgerIndex: 3375762,
  closeTime: 0,
  transactionHash: '94B8D3E2A060DDDD94402B995B1ED3FAB56AECD16CF4A62ED44B5173B46AED10',
  transactionIndex: 3,
  transactionType: 'VaultCreate',
  result: 'tesSUCCESS',
}

describe('live metadata regressions', () => {
  it('ignores a ModifiedNode with no field payload while keeping material lending changes', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'AccountRoot',
              LedgerIndex: 'A'.repeat(64),
              PreviousTxnID: 'B'.repeat(64),
              PreviousTxnLgrSeq: 3375761,
            },
          },
          {
            CreatedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: 'V'.repeat(64),
              NewFields: {
                Account: 'rVaultAccount',
                Owner: 'rOwner',
                Asset: { currency: 'USD', issuer: 'rIssuer' },
              },
            },
          },
        ],
      },
      context,
    )

    expect(changes).toHaveLength(3)
    expect(changes.every((change) => change.objectType === 'Vault')).toBe(true)
    expect(changes.map((change) => change.fieldName)).toEqual(['Account', 'Asset', 'Owner'])
  })

  it('ignores a sparse non-lending ModifiedNode with FinalFields but no PreviousFields', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'DirectoryNode',
              LedgerIndex: 'D'.repeat(64),
              FinalFields: {
                Flags: 0,
                Owner: 'rDirectoryOwner',
                RootIndex: 'D'.repeat(64),
              },
            },
          },
        ],
      },
      context,
    )

    expect(changes).toEqual([])
  })

  it('still rejects one-sided malformed lending ModifiedNode field payloads', () => {
    expect(() => normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: 'L'.repeat(64),
              FinalFields: { PaymentRemaining: 1 },
            },
          },
        ],
      },
      context,
    )).toThrow('PreviousFields must be an object')
  })
})
