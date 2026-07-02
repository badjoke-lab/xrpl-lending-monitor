import { describe, expect, it } from 'vitest'

import type { NormalizedObjectChange } from './affected-nodes'
import { deriveBalanceHistory } from './cover-debt-loss'

const base = {
  network: 'devnet' as const,
  epochId: 'epoch-1',
  ledgerIndex: 10,
  closeTime: 1000,
  transactionHash: 'T'.repeat(64),
  transactionIndex: 1,
  transactionType: 'LoanBrokerCoverDeposit',
  result: 'tesSUCCESS',
  nodeIndex: 0,
  objectType: 'LoanBroker' as const,
  objectId: 'B'.repeat(64),
  action: 'modified' as const,
  valueType: 'string' as const,
  unsupportedField: false,
  relationships: {
    vaultId: 'V'.repeat(64),
    loanBrokerId: 'B'.repeat(64),
    loanId: null,
    account: 'rBroker',
    owner: 'rOwner',
    borrower: null,
    assetKey: 'XRP',
    mptIssuanceId: null,
  },
}

function change(options: {
  fieldName: string
  beforeJson: string | null
  afterJson: string | null
  objectType?: 'Vault' | 'LoanBroker'
  objectId?: string
  assetKey?: string | null
  ledgerIndex?: number
}): NormalizedObjectChange {
  return {
    ...base,
    objectType: options.objectType ?? base.objectType,
    objectId: options.objectId ?? base.objectId,
    ledgerIndex: options.ledgerIndex ?? base.ledgerIndex,
    fieldName: options.fieldName,
    beforeValue: options.beforeJson === null ? undefined : JSON.parse(options.beforeJson),
    afterValue: options.afterJson === null ? undefined : JSON.parse(options.afterJson),
    beforeJson: options.beforeJson,
    afterJson: options.afterJson,
    relationships: {
      ...base.relationships,
      assetKey: options.assetKey === undefined ? base.relationships.assetKey : options.assetKey,
    },
  }
}

describe('deriveBalanceHistory', () => {
  it('records direct Broker debt and cover field histories', () => {
    const records = deriveBalanceHistory([
      change({ fieldName: 'DebtTotal', beforeJson: '"1000"', afterJson: '"1200"' }),
      change({ fieldName: 'CoverAvailable', beforeJson: '"100"', afterJson: '"150"' }),
    ])

    expect(records.map((record) => [record.metricType, record.beforeValue, record.afterValue])).toEqual([
      ['cover_available', '100', '150'],
      ['debt_total', '1000', '1200'],
    ])
    expect(records[0]).toMatchObject({
      subjectType: 'LoanBroker',
      subjectId: 'B'.repeat(64),
      assetKey: 'XRP',
      formula: null,
    })
  })

  it('calculates required minimum cover and surplus when all source fields are present', () => {
    const records = deriveBalanceHistory([
      change({ fieldName: 'DebtTotal', beforeJson: '"1000"', afterJson: '"1200"' }),
      change({ fieldName: 'CoverAvailable', beforeJson: '"80"', afterJson: '"90"' }),
      change({ fieldName: 'CoverRateMinimum', beforeJson: '1000', afterJson: '1500' }),
    ])

    expect(records.map((record) => record.metricType)).toEqual([
      'cover_available',
      'cover_surplus',
      'debt_total',
      'required_minimum_cover',
    ])
    expect(records.find((record) => record.metricType === 'required_minimum_cover')).toMatchObject({
      beforeValue: '10.00000',
      afterValue: '18.00000',
      formula: 'required_minimum_cover = DebtTotal * CoverRateMinimum / 100000',
      sourceFieldsJson: '["CoverAvailable","CoverRateMinimum","DebtTotal"]',
    })
    expect(records.find((record) => record.metricType === 'cover_surplus')).toMatchObject({
      beforeValue: '70',
      afterValue: '72',
      formula: 'cover_surplus = CoverAvailable - required_minimum_cover',
    })
  })

  it('records Vault unrealized loss separately with its own asset key', () => {
    const [record] = deriveBalanceHistory([
      change({
        objectType: 'Vault',
        objectId: 'V'.repeat(64),
        fieldName: 'LossUnrealized',
        beforeJson: '"0"',
        afterJson: '"5"',
        assetKey: 'IOU:USD:rIssuer',
      }),
    ])

    expect(record).toMatchObject({
      subjectType: 'Vault',
      subjectId: 'V'.repeat(64),
      metricType: 'loss_unrealized',
      assetKey: 'IOU:USD:rIssuer',
      beforeValue: '0',
      afterValue: '5',
    })
  })

  it('does not calculate cover formulas when source fields are missing', () => {
    const records = deriveBalanceHistory([
      change({ fieldName: 'DebtTotal', beforeJson: '"1000"', afterJson: '"1200"' }),
      change({ fieldName: 'CoverAvailable', beforeJson: '"80"', afterJson: '"90"' }),
    ])

    expect(records.map((record) => record.metricType)).toEqual(['cover_available', 'debt_total'])
  })

  it('does not combine unlike assets into one record', () => {
    const records = deriveBalanceHistory([
      change({
        fieldName: 'CoverAvailable',
        beforeJson: '"1"',
        afterJson: '"2"',
        objectId: '1'.repeat(64),
        assetKey: 'XRP',
      }),
      change({
        fieldName: 'CoverAvailable',
        beforeJson: '"1"',
        afterJson: '"2"',
        objectId: '2'.repeat(64),
        assetKey: 'MPT:000004C463C52827307480341125DA0577DEFC38405B0E3E',
      }),
    ])

    expect(records.map((record) => [record.subjectId, record.assetKey])).toEqual([
      ['1'.repeat(64), 'XRP'],
      ['2'.repeat(64), 'MPT:000004C463C52827307480341125DA0577DEFC38405B0E3E'],
    ])
  })
})
