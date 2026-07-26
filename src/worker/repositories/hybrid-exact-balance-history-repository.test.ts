import { describe, expect, it } from 'vitest'
import type { HistoryExactIndexReader } from '../../shared/history-segments/exact-index-reader'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'
import { listHybridExactBalanceHistory } from './hybrid-exact-balance-history-repository'

const SUBJECT_ID = 'A'.repeat(64)

const immutableBalance = {
  network: 'devnet',
  epochId: 'epoch-1',
  subjectType: 'LoanBroker',
  subjectId: SUBJECT_ID,
  transactionHash: 'B'.repeat(64),
  ledgerIndex: 105,
  transactionIndex: 1,
  closeTime: 800_000_000,
  metricType: 'debt_total',
  assetKey: null,
  beforeValue: '100',
  afterValue: '90',
  formula: null,
  sourceFieldsJson: '{}',
}

function reader(): HistorySegmentChainReader {
  return {
    publication: { epochId: 'epoch-1', endLedgerIndex: 105 },
    async readReferenced<T>(options: { predicate?: (value: unknown) => boolean }) {
      const items = options.predicate && !options.predicate(immutableBalance)
        ? []
        : [immutableBalance]
      return {
        items: items as T[],
        assetReads: 1,
        compressedBytes: 100,
        decompressedBytes: 200,
        recordsExamined: 1,
      }
    },
  } as unknown as HistorySegmentChainReader
}

function exactIndex(terms: string[]): HistoryExactIndexReader {
  return {
    async find(term: string, options: { referenceKinds?: readonly string[] }) {
      terms.push(term)
      expect(options.referenceKinds).toEqual(['balance_history'])
      return {
        references: [{
          kind: 'balance_history',
          segmentId: 'segment-1',
          fileKind: 'balance_history',
          ledgerIndex: 105,
          searchResult: null,
        }],
      }
    },
  } as unknown as HistoryExactIndexReader
}

function db(): D1Database {
  return {
    prepare() {
      const statement = {
        bind() { return statement },
        async all<T>() { return { results: [] as T[] } },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('hybrid exact balance history repository', () => {
  it('uses the subject ID exact index and returns the filtered immutable record', async () => {
    const terms: string[] = []
    const records = await listHybridExactBalanceHistory({
      db: db(),
      reader: reader(),
      exactIndex: exactIndex(terms),
      list: {
        limit: 100,
        metricType: 'debt_total',
        subjectType: 'LoanBroker',
        subjectId: SUBJECT_ID,
        assetKey: null,
      },
    })

    expect(terms).toEqual([SUBJECT_ID])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      subjectType: 'LoanBroker',
      subjectId: SUBJECT_ID,
      metricType: 'debt_total',
      ledgerIndex: 105,
      beforeValue: '100',
      afterValue: '90',
    })
  })

  it('filters non-matching metrics after the exact lookup', async () => {
    const records = await listHybridExactBalanceHistory({
      db: db(),
      reader: reader(),
      exactIndex: exactIndex([]),
      list: {
        limit: 100,
        metricType: 'cover_available',
        subjectType: 'LoanBroker',
        subjectId: SUBJECT_ID,
        assetKey: null,
      },
    })

    expect(records).toEqual([])
  })
})
