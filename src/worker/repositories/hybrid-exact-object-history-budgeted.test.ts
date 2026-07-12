import { describe, expect, it } from 'vitest'

import type { HistoryExactIndexReference } from '../../shared/history-segments/exact-index'
import type { HistoryExactIndexReader } from '../../shared/history-segments/exact-index-reader'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'
import { listBudgetedHybridExactObjectHistory } from './hybrid-exact-object-history-budgeted'

function emptyDb(): D1Database {
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

function reference(index: number): HistoryExactIndexReference {
  const transactionHash = index.toString(16).toUpperCase().padStart(64, '0')
  return {
    kind: 'object_change',
    segmentId: `segment-${index}`,
    fileKind: 'object_changes',
    ledgerIndex: 3_592_674 - index,
    searchResult: {
      kind: 'object_change',
      epochId: 'devnet-3371675',
      ledgerIndex: 3_592_674 - index,
      transactionHash,
      objectType: 'Loan',
      objectId: 'LOAN1',
      loanId: 'LOAN1',
    },
  }
}

describe('budgeted exact object history', () => {
  it('keeps the estimated record scan below the Worker examination limit', async () => {
    const exactReferences = [reference(0), reference(1), reference(2)]
    let observedReferences: readonly { segmentId: string; fileKind: string }[] = []
    let observedMaxRecords = 0

    const reader = {
      publication: {
        epochId: 'devnet-3371675',
        endLedgerIndex: 3_592_674,
        segments: exactReferences.map((item) => ({
          segmentId: item.segmentId,
          recordCounts: {
            ledgers: 500,
            protocol_events: 0,
            object_changes: 4_000,
            archived_objects: 0,
            loan_lifecycle: 0,
            balance_history: 0,
            current_projection_mutations: 0,
          },
        })),
      },
      async readReferenced<T>(options: {
        references: readonly { segmentId: string; fileKind: string }[]
        maxRecordsExamined?: number
      }) {
        observedReferences = options.references
        observedMaxRecords = options.maxRecordsExamined ?? 0
        const estimated = options.references.length * 4_000
        if (estimated > observedMaxRecords) throw new Error('History referenced read exceeds record examination limit')
        return {
          items: [] as T[],
          assetReads: options.references.length,
          compressedBytes: 0,
          decompressedBytes: 0,
          recordsExamined: estimated,
        }
      },
    } as unknown as HistorySegmentChainReader

    const exactIndex = {
      async find() {
        return {
          term: 'LOAN1',
          bucket: 0,
          references: exactReferences,
          assetReads: 1,
          compressedBytes: 1,
          decompressedBytes: 1,
        }
      },
    } as unknown as HistoryExactIndexReader

    await expect(listBudgetedHybridExactObjectHistory({
      db: emptyDb(),
      reader,
      exactIndex,
      objectType: 'Loan',
      objectId: 'LOAN1',
      page: { limit: 25 },
    })).resolves.toEqual([])

    expect(observedMaxRecords).toBe(9_500)
    expect(observedReferences.map((item) => item.segmentId)).toEqual(['segment-0', 'segment-1'])
  })
})
