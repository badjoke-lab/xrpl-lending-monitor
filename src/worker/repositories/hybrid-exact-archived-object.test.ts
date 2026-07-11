import { describe, expect, it } from 'vitest'

import type { HistoryExactIndexReader } from '../../shared/history-segments/exact-index-reader'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'
import { getHybridExactArchivedObject } from './hybrid-exact-history-repository'

const objectId = 'A'.repeat(64)

function reader(): HistorySegmentChainReader {
  const archive = {
    network: 'devnet',
    epochId: 'epoch-immutable',
    objectType: 'Loan',
    objectId,
    deletionTransactionHash: 'IMMUTABLE-TX',
    deletionLedgerIndex: 105,
    deletionTransactionIndex: 1,
    deletionCloseTime: 800_000_000,
    deletionReason: 'loan_delete',
    finalStateJson: JSON.stringify({ PrincipalOutstanding: '10' }),
    vaultId: 'VAULT1',
    loanBrokerId: 'BROKER1',
    loanId: objectId,
    owner: null,
    account: null,
    borrower: 'rBorrower',
    assetKey: 'XRP',
  }
  return {
    publication: { epochId: 'epoch-immutable', endLedgerIndex: 105 },
    async readReferenced<T>(options: { predicate?: (value: unknown) => boolean }) {
      const items = options.predicate && !options.predicate(archive) ? [] : [archive]
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

function exactIndex(): HistoryExactIndexReader {
  return {
    async find(term: string, options: {
      direction?: 'asc' | 'desc'
      referencePredicate?: (reference: unknown) => boolean
    }) {
      expect(term).toBe(objectId)
      expect(options.direction).toBe('desc')
      const reference = {
        kind: 'archived_object',
        segmentId: 'segment-1',
        fileKind: 'archived_objects',
        ledgerIndex: 105,
        searchResult: {
          kind: 'archived_object',
          epochId: 'epoch-immutable',
          ledgerIndex: 105,
          transactionHash: 'IMMUTABLE-TX',
          objectType: 'Loan',
          objectId,
          loanId: objectId,
        },
      }
      return {
        references: options.referencePredicate && !options.referencePredicate(reference)
          ? []
          : [reference],
      }
    },
  } as unknown as HistoryExactIndexReader
}

function db(includeLive: boolean): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind() { return statement },
        async all<T>() {
          if (!includeLive || !sql.includes('FROM archived_objects')) {
            return { results: [] as T[] }
          }
          return { results: [{
            epoch_id: 'epoch-live',
            object_type: 'Loan',
            object_id: objectId,
            deletion_transaction_hash: 'LIVE-TX',
            deletion_ledger_index: 106,
            deletion_transaction_index: 2,
            deletion_close_time: 800_000_001,
            deletion_reason: 'loan_delete',
            final_state_json: JSON.stringify({ PrincipalOutstanding: '0' }),
            vault_id: 'VAULT1',
            loan_broker_id: 'BROKER1',
            loan_id: objectId,
            owner: null,
            account: null,
            borrower: 'rBorrower',
            asset_key: 'XRP',
            archived_at: '2025-05-08T06:13:21.000Z',
          }] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('exact archived object detail', () => {
  it('returns the exact immutable archive without a generic segment-chain scan', async () => {
    const archive = await getHybridExactArchivedObject({
      db: db(false),
      reader: reader(),
      exactIndex: exactIndex(),
      objectType: 'Loan',
      objectId,
    })

    expect(archive).toMatchObject({
      objectType: 'Loan',
      objectId,
      deletionTransactionHash: 'IMMUTABLE-TX',
      deletionLedgerIndex: 105,
    })
  })

  it('prefers a matching post-boundary live archive', async () => {
    const archive = await getHybridExactArchivedObject({
      db: db(true),
      reader: reader(),
      exactIndex: exactIndex(),
      objectType: 'Loan',
      objectId,
    })

    expect(archive).toMatchObject({
      objectId,
      deletionTransactionHash: 'LIVE-TX',
      deletionLedgerIndex: 106,
    })
  })
})
