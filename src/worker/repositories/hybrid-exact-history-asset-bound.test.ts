import { describe, expect, it } from 'vitest'

import type { HistoryExactIndexReference } from '../../shared/history-segments/exact-index'
import type { HistoryExactIndexReader } from '../../shared/history-segments/exact-index-reader'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'
import { listHybridExactObjectHistory } from './hybrid-exact-history-repository'

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
    segmentId: `segment-${index.toString().padStart(2, '0')}`,
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

describe('hybrid exact history asset bounds', () => {
  it('keeps exact object history within the 16-asset read budget', async () => {
    const exactReferences = Array.from({ length: 17 }, (_, index) => reference(index))
    let observedAssetCount = 0
    let observedReferences: readonly { segmentId: string; fileKind: string }[] = []

    const reader = {
      publication: { epochId: 'devnet-3371675', endLedgerIndex: 3_592_674 },
      async readReferenced<T>(options: {
        references: readonly { segmentId: string; fileKind: string }[]
        maxAssetReads?: number
      }) {
        observedReferences = options.references
        observedAssetCount = new Set(options.references.map((item) => `${item.segmentId}:${item.fileKind}`)).size
        if (observedAssetCount > (options.maxAssetReads ?? 4)) {
          throw new Error('History referenced read exceeds asset-read limit')
        }
        return {
          items: [] as T[],
          assetReads: observedAssetCount,
          compressedBytes: 0,
          decompressedBytes: 0,
          recordsExamined: 0,
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

    await expect(listHybridExactObjectHistory({
      db: emptyDb(),
      reader,
      exactIndex,
      objectType: 'Loan',
      objectId: 'LOAN1',
      page: { limit: 25 },
    })).resolves.toEqual([])

    expect(observedAssetCount).toBe(16)
    expect(observedReferences).toHaveLength(16)
    expect(observedReferences.map((item) => item.segmentId)).toEqual(
      exactReferences.slice(0, 16).map((item) => item.segmentId),
    )
  })
})
