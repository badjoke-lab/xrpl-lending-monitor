import { describe, expect, it } from 'vitest'

import {
  mapPortableProductRow,
  PortableProductMappingError,
} from './portable-collector-product-mappers'
import {
  canonicalPortableJson,
  type PortableReferenceRow,
} from './portable-collector-reference-store'

const ledgerHash = 'A'.repeat(64)
const parentHash = 'B'.repeat(64)
const transactionHash = 'C'.repeat(64)
const createdAt = '2026-08-01T16:00:00.000Z'

function row(input: {
  semanticClass: PortableReferenceRow['semanticClass']
  canonicalKey: string
  value: unknown | null
  transactionHash?: string | null
  objectId?: string | null
  relationships?: string[]
  tombstone?: boolean
}): PortableReferenceRow {
  return {
    workId: 'work-101',
    semanticClass: input.semanticClass,
    canonicalKey: input.canonicalKey,
    sourceLedgerIndex: 101,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash:
      input.transactionHash === undefined ? transactionHash : input.transactionHash,
    objectId: input.objectId ?? null,
    relationshipIds: input.relationships ?? [],
    valueJson: input.value === null ? null : canonicalPortableJson(input.value),
    isTombstone: input.tombstone ?? false,
    createdAt,
  }
}

function fixtures(): PortableReferenceRow[] {
  return [
    row({
      semanticClass: 'validated-ledger',
      canonicalKey: 'ledger:101',
      transactionHash: null,
      value: { ledgerIndex: 101, ledgerHash, parentHash },
    }),
    row({
      semanticClass: 'protocol-event',
      canonicalKey: 'event:1',
      relationships: ['loan:1'],
      value: {
        eventIndex: 0,
        closeTime: 1_700_000_000,
        eventType: 'LoanSet',
        resultCode: 'tesSUCCESS',
      },
    }),
    row({
      semanticClass: 'object-change',
      canonicalKey: 'change:1',
      objectId: 'loan:1',
      relationships: ['loan:1'],
      value: {
        transactionIndex: 1,
        closeTime: 1_700_000_001,
        transactionType: 'LoanSet',
        resultCode: 'tesSUCCESS',
        nodeIndex: 0,
        objectType: 'Loan',
        objectId: 'loan:1',
        action: 'modified',
        fieldName: 'PrincipalOutstanding',
        beforeJson: '100',
        afterJson: '90',
      },
    }),
    row({
      semanticClass: 'loan-lifecycle',
      canonicalKey: 'lifecycle:1',
      objectId: 'loan:1',
      relationships: ['loan:1'],
      value: {
        loanId: 'loan:1',
        transactionIndex: 2,
        closeTime: 1_700_000_002,
        eventType: 'payment',
        transactionType: 'LoanPay',
        resultCode: 'tesSUCCESS',
        statusBefore: 'active',
        statusAfter: 'active',
      },
    }),
    row({
      semanticClass: 'archived-object',
      canonicalKey: 'archive:1',
      objectId: 'loan:2',
      relationships: ['loan:2'],
      value: {
        objectType: 'Loan',
        objectId: 'loan:2',
        deletionTransactionIndex: 3,
        deletionCloseTime: 1_700_000_003,
        deletionReason: 'LoanDelete',
        finalStateJson: { status: 'closed' },
      },
    }),
    row({
      semanticClass: 'balance-history',
      canonicalKey: 'balance:1',
      objectId: 'vault:1',
      relationships: ['vault:1'],
      value: {
        subjectType: 'Vault',
        subjectId: 'vault:1',
        transactionIndex: 4,
        closeTime: 1_700_000_004,
        metricType: 'debt',
        assetKey: 'XRP',
        beforeValue: '100',
        afterValue: '90',
      },
    }),
    row({
      semanticClass: 'current-projection',
      canonicalKey: 'projection:1',
      objectId: 'loan:1',
      relationships: ['loan:loan:1'],
      value: {
        kind: 'loan',
        id: 'loan:1',
        previousTxHash: transactionHash,
        previousLedgerIndex: 101,
        borrower: 'rBorrower',
      },
    }),
  ]
}

describe('R3C portable product mappers', () => {
  it('maps all seven semantic classes with complete provenance', () => {
    const mapped = fixtures().map(mapPortableProductRow)
    expect(mapped.map((record) => record.kind)).toEqual([
      'validated_ledger',
      'protocol_event',
      'object_change',
      'loan_lifecycle',
      'archived_object',
      'balance_history',
      'current_projection',
    ])
    expect(mapped.every((record) => record.provenance.workId === 'work-101')).toBe(true)
    expect(mapped[1]).toMatchObject({
      kind: 'protocol_event',
      transactionHash,
      eventType: 'LoanSet',
      resultCode: 'tesSUCCESS',
    })
    expect(mapped[2]).toMatchObject({
      kind: 'object_change',
      objectId: 'loan:1',
      action: 'modified',
      before: '100',
      after: '90',
    })
    expect(mapped[6]).toMatchObject({
      kind: 'current_projection',
      projectionKind: 'loan',
      objectId: 'loan:1',
      state: 'present',
      previousTransactionHash: transactionHash,
      previousLedgerIndex: 101,
    })
  })

  it('maps a current projection tombstone without inventing a value', () => {
    const mapped = mapPortableProductRow(
      row({
        semanticClass: 'current-projection',
        canonicalKey: 'projection:deleted',
        objectId: 'loan:2',
        relationships: ['loan:loan:2'],
        value: null,
        tombstone: true,
      }),
    )
    expect(mapped).toMatchObject({
      kind: 'current_projection',
      projectionKind: 'loan',
      objectId: 'loan:2',
      state: 'deleted',
      projection: null,
    })
  })

  it('rejects class, transaction, object, ledger, and value mismatches', () => {
    const protocol = fixtures()[1]!
    expect(() =>
      mapPortableProductRow({
        ...protocol,
        sourceTransactionHash: null,
      }),
    ).toThrowError(expect.objectContaining({ code: 'identity_failure' }))

    const objectChange = fixtures()[2]!
    expect(() =>
      mapPortableProductRow({
        ...objectChange,
        objectId: 'loan:other',
      }),
    ).toThrowError(expect.objectContaining({ code: 'identity_failure' }))

    const validated = fixtures()[0]!
    expect(() =>
      mapPortableProductRow({
        ...validated,
        valueJson: canonicalPortableJson({
          ledgerIndex: 102,
          ledgerHash,
          parentHash,
        }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'identity_failure' }))

    expect(() =>
      mapPortableProductRow({
        ...protocol,
        valueJson: '{"eventType":"LoanSet", "eventIndex":0}',
      }),
    ).toThrowError(expect.objectContaining({ code: 'value_failure' }))

    expect(() =>
      mapPortableProductRow({
        ...protocol,
        semanticClass: 'unknown',
      }),
    ).toThrow(PortableProductMappingError)
  })
})
