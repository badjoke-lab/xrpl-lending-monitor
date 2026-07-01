import { describe, expect, it } from 'vitest'

import { normalizeAffectedNodes, type ObjectChangeContext } from './affected-nodes'

const context: ObjectChangeContext = {
  network: 'devnet',
  epochId: 'epoch-1',
  ledgerIndex: 101,
  closeTime: 1000,
  transactionHash: 'T'.repeat(64),
  transactionIndex: 2,
  transactionType: 'LoanPay',
  result: 'tesSUCCESS',
}

describe('normalizeAffectedNodes', () => {
  it('normalizes CreatedNode fields in deterministic order with direct relationships', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: 'L'.repeat(64),
              NewFields: {
                PaymentRemaining: 12,
                Borrower: 'rBorrower',
                LoanBrokerID: 'B'.repeat(64),
                PrincipalOutstanding: '100',
              },
            },
          },
        ],
      },
      context,
    )

    expect(changes.map((item) => item.fieldName)).toEqual([
      'Borrower',
      'LoanBrokerID',
      'PaymentRemaining',
      'PrincipalOutstanding',
    ])
    expect(changes[0]).toMatchObject({
      action: 'created',
      objectType: 'Loan',
      objectId: 'L'.repeat(64),
      beforeJson: null,
      afterJson: '"rBorrower"',
      relationships: {
        loanId: 'L'.repeat(64),
        loanBrokerId: 'B'.repeat(64),
        borrower: 'rBorrower',
      },
    })
  })

  it('normalizes ModifiedNode previous and final values without emitting unchanged fields', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'LoanBroker',
              LedgerIndex: 'B'.repeat(64),
              PreviousFields: {
                DebtTotal: '90',
                OwnerCount: 3,
              },
              FinalFields: {
                VaultID: 'V'.repeat(64),
                DebtTotal: '100',
                OwnerCount: 3,
              },
            },
          },
        ],
      },
      context,
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      action: 'modified',
      fieldName: 'DebtTotal',
      beforeJson: '"90"',
      afterJson: '"100"',
      valueType: 'string',
      relationships: {
        vaultId: 'V'.repeat(64),
        loanBrokerId: 'B'.repeat(64),
      },
    })
  })

  it('normalizes DeletedNode final fields and keeps deleted objects addressable', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            DeletedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: 'V'.repeat(64),
              FinalFields: {
                Owner: 'rOwner',
                Account: 'rVaultAccount',
                AssetsTotal: '0',
              },
            },
          },
        ],
      },
      context,
    )

    expect(changes.map((item) => item.fieldName)).toEqual(['Account', 'AssetsTotal', 'Owner'])
    expect(changes[1]).toMatchObject({
      action: 'deleted',
      fieldName: 'AssetsTotal',
      beforeJson: '"0"',
      afterJson: null,
      relationships: {
        vaultId: 'V'.repeat(64),
        owner: 'rOwner',
        account: 'rVaultAccount',
      },
    })
  })

  it('preserves numeric zero values separately from absent fields', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: 'L'.repeat(64),
              PreviousFields: {
                PaymentRemaining: 1,
                ManagementFeeOutstanding: '5',
              },
              FinalFields: {
                PaymentRemaining: 0,
                ManagementFeeOutstanding: '0',
              },
            },
          },
        ],
      },
      context,
    )

    expect(changes.map((item) => [item.fieldName, item.afterJson])).toEqual([
      ['ManagementFeeOutstanding', '"0"'],
      ['PaymentRemaining', '0'],
    ])
  })

  it('extracts XRP, IOU, and MPT asset identities without combining unlike assets', () => {
    const mptIssuanceId = 'a'.repeat(48)
    const xrp = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: 'V'.repeat(64),
              NewFields: { Asset: { currency: 'XRP' } },
            },
          },
        ],
      },
      context,
    )
    const iou = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: 'I'.repeat(64),
              NewFields: { Asset: { currency: 'USD', issuer: 'rIssuer' } },
            },
          },
        ],
      },
      context,
    )
    const mpt = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: 'M'.repeat(64),
              NewFields: {
                Asset: { mpt_issuance_id: mptIssuanceId },
                ShareMPTID: 'b'.repeat(48),
              },
            },
          },
        ],
      },
      context,
    )

    expect(xrp[0]?.relationships.assetKey).toBe('XRP')
    expect(iou[0]?.relationships.assetKey).toBe('IOU:USD:rIssuer')
    expect(mpt[0]?.relationships.assetKey).toBe(`MPT:${mptIssuanceId.toUpperCase()}`)
    expect(mpt[0]?.relationships.mptIssuanceId).toBe('b'.repeat(48))
  })

  it('reports unsupported fields while preserving their values', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: 'L'.repeat(64),
              PreviousFields: { FutureProtocolField: { nested: 1 } },
              FinalFields: { FutureProtocolField: { nested: 2 } },
            },
          },
        ],
      },
      context,
    )

    expect(changes[0]).toMatchObject({
      fieldName: 'FutureProtocolField',
      beforeJson: '{"nested":1}',
      afterJson: '{"nested":2}',
      valueType: 'object',
      unsupportedField: true,
    })
  })

  it('preserves failed transaction result context when metadata contains nodes', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: 'L'.repeat(64),
              PreviousFields: { PaymentRemaining: 2 },
              FinalFields: { PaymentRemaining: 1 },
            },
          },
        ],
      },
      { ...context, result: 'tecPATH_PARTIAL' },
    )

    expect(changes[0]?.result).toBe('tecPATH_PARTIAL')
  })

  it('normalizes mixed created, modified, and deleted nodes in ledger metadata order', () => {
    const changes = normalizeAffectedNodes(
      {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: '1'.repeat(64),
              NewFields: { Borrower: 'rBorrower' },
            },
          },
          {
            ModifiedNode: {
              LedgerEntryType: 'LoanBroker',
              LedgerIndex: '2'.repeat(64),
              PreviousFields: { DebtTotal: '1' },
              FinalFields: { DebtTotal: '2' },
            },
          },
          {
            DeletedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: '3'.repeat(64),
              FinalFields: { Owner: 'rOwner' },
            },
          },
        ],
      },
      context,
    )

    expect(changes.map((item) => [item.nodeIndex, item.action, item.objectType])).toEqual([
      [0, 'created', 'Loan'],
      [1, 'modified', 'LoanBroker'],
      [2, 'deleted', 'Vault'],
    ])
  })

  it('rejects malformed AffectedNodes safely', () => {
    expect(() => normalizeAffectedNodes({}, context)).toThrow('AffectedNodes must be an array')
    expect(() => normalizeAffectedNodes({ AffectedNodes: [{}] }, context)).toThrow(
      'AffectedNodes entry must contain',
    )
  })
})
