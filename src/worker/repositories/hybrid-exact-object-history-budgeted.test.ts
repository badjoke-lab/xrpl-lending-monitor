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

function readerFor(options: {
  references: HistoryExactIndexReference[]
  recordCounts: number[]
  onRead: (references: readonly { segmentId: string; fileKind: string }[], maxRecords: number) => void
}): HistorySegmentChainReader {
  return {
    publication: {
      epochId: 'devnet-3371675',
      endLedgerIndex: 3_592_674,
      segments: options.references.map((item, index) => ({
        segmentId: item.segmentId,
        recordCounts: {
          ledgers: 500,
          protocol_events: 0,
          object_changes: options.recordCounts[index] ?? 0,
          archived_objects: 0,
          loan_lifecycle: 0,
          balance_history: 0,
          current_projection_mutations: 0,
        },
      })),
    },
    async readReferenced<T>(readOptions: {
      references: readonly { segmentId: string; fileKind: string }[]
      maxRecordsExamined?: number
    }) {
      const maxRecords = readOptions.maxRecordsExamined ?? 0
      options.onRead(readOptions.references, maxRecords)
      const counts = new Map(options.references.map((item, index) => [item.segmentId, options.recordCounts[index] ?? 0]))
      const estimated = readOptions.references.reduce((sum, item) => sum + (counts.get(item.segmentId) ?? 0), 0)
      if (estimated > maxRecords) throw new Error('History referenced read exceeds record examination limit')
      return {
        items: [] as T[],
        assetReads: readOptions.references.length,
        compressedBytes: 0,
        decompressedBytes: 0,
        recordsExamined: estimated,
      }
    },
  } as unknown as HistorySegmentChainReader
}

function exactIndex(references: HistoryExactIndexReference[]): HistoryExactIndexReader {
  return {
    async find() {
      return {
        term: 'LOAN1',
        bucket: 0,
        references,
        assetReads: 1,
        compressedBytes: 1,
        decompressedBytes: 1,
      }
    },
  } as unknown as HistoryExactIndexReader
}

describe('budgeted exact object history', () => {
  it('keeps multiple assets within the Worker examination limit', async () => {
    const exactReferences = [reference(0), reference(1), reference(2)]
    let observedReferences: readonly { segmentId: string; fileKind: string }[] = []
    let observedMaxRecords = 0
    const reader = readerFor({
      references: exactReferences,
      recordCounts: [4_000, 4_000, 4_000],
      onRead(references, maxRecords) {
        observedReferences = references
        observedMaxRecords = maxRecords
      },
    })

    await expect(listBudgetedHybridExactObjectHistory({
      db: emptyDb(),
      reader,
      exactIndex: exactIndex(exactReferences),
      objectType: 'Loan',
      objectId: 'LOAN1',
      page: { limit: 25 },
    })).resolves.toEqual([])

    expect(observedMaxRecords).toBe(10_050)
    expect(observedReferences.map((item) => item.segmentId)).toEqual(['segment-0', 'segment-1'])
  })

  it('admits the 10,002-record production terminal segment', async () => {
    const exactReferences = [reference(0)]
    let observedReferences: readonly { segmentId: string; fileKind: string }[] = []
    const reader = readerFor({
      references: exactReferences,
      recordCounts: [10_002],
      onRead(references) {
        observedReferences = references
      },
    })

    await expect(listBudgetedHybridExactObjectHistory({
      db: emptyDb(),
      reader,
      exactIndex: exactIndex(exactReferences),
      objectType: 'Loan',
      objectId: 'LOAN1',
      page: { limit: 25 },
    })).resolves.toEqual([])

    expect(observedReferences.map((item) => item.segmentId)).toEqual(['segment-0'])
  })
})
