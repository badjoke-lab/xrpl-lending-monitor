import { describe, expect, it } from 'vitest'
import type { HistoryExactIndexReader } from '../../shared/history-segments/exact-index-reader'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'
import {
  getHybridTransactionDetail,
  listHybridExactLoanLifecycle,
  listHybridExactLoanLifecycleEvents,
  listHybridExactObjectHistory,
  searchHybridHistory,
} from './hybrid-exact-history-repository'

const immutableEvent = {
  eventHash: 'TX1', ledgerIndex: 105, eventIndex: 1, closeTime: 800_000_000,
  eventType: 'LoanPay', resultCode: 'tesSUCCESS', account: 'rAccount', sequence: 1, fee: '10',
}
const immutableChange = {
  network: 'devnet', epochId: 'epoch-1', ledgerIndex: 105, closeTime: 800_000_000,
  transactionHash: 'TX1', transactionIndex: 1, transactionType: 'LoanPay', result: 'tesSUCCESS',
  nodeIndex: 0, objectType: 'Loan', objectId: 'LOAN1', action: 'modified',
  fieldName: 'PrincipalOutstanding', beforeValue: '100', afterValue: '90',
  beforeJson: '"100"', afterJson: '"90"', valueType: 'string', unsupportedField: false,
  relationships: {
    vaultId: null, loanBrokerId: 'BROKER1', loanId: 'LOAN1', account: null,
    owner: null, borrower: 'rBorrower', assetKey: 'XRP', mptIssuanceId: null,
  },
}
const immutableLifecycle = {
  network: 'devnet', loanId: 'LOAN1', epochId: 'epoch-1', transactionHash: 'TX1', ledgerIndex: 105,
  transactionIndex: 1, closeTime: 800_000_000, eventType: 'payment', transactionType: 'LoanPay',
  result: 'tesSUCCESS', statusBefore: 'active', statusAfter: 'active', principalBefore: '100',
  principalAfter: '90', totalValueBefore: '100', totalValueAfter: '90', paymentRemainingBefore: 2,
  paymentRemainingAfter: 1, detailsJson: '{}',
}

function reader(): HistorySegmentChainReader {
  return {
    publication: { epochId: 'epoch-1', endLedgerIndex: 105 },
    async readReferenced<T>(options: { references: { fileKind: string }[]; predicate?: (value: unknown) => boolean }) {
      const fileKind = options.references[0]?.fileKind
      const item = fileKind === 'protocol_events'
        ? immutableEvent
        : fileKind === 'loan_lifecycle'
          ? immutableLifecycle
          : immutableChange
      const items = options.predicate && !options.predicate(item) ? [] : [item]
      return { items: items as T[], assetReads: 1, compressedBytes: 100, decompressedBytes: 200, recordsExamined: 1 }
    },
  } as unknown as HistorySegmentChainReader
}

function exactIndex(): HistoryExactIndexReader {
  return {
    async find(_term: string, options: {
      referenceKinds?: readonly string[]
      referencePredicate?: (reference: unknown) => boolean
      direction?: 'asc' | 'desc'
    }) {
      const kinds = options.referenceKinds ?? []
      const candidate = kinds.length === 1 && kinds[0] === 'transaction_event'
        ? { kind: 'transaction_event', segmentId: 's', fileKind: 'protocol_events', ledgerIndex: 105, searchResult: null }
        : kinds.length === 1 && kinds[0] === 'loan_lifecycle'
          ? {
              kind: 'loan_lifecycle', segmentId: 's', fileKind: 'loan_lifecycle', ledgerIndex: 105,
              searchResult: {
                kind: 'loan_lifecycle', epochId: 'epoch-1', ledgerIndex: 105,
                transactionHash: 'TX1', objectType: 'Loan', objectId: 'LOAN1', loanId: 'LOAN1',
              },
            }
          : {
              kind: 'object_change', segmentId: 's', fileKind: 'object_changes', ledgerIndex: 105,
              searchResult: {
                kind: 'object_change', epochId: 'epoch-1', ledgerIndex: 105,
                transactionHash: 'TX1', objectType: 'Loan', objectId: 'LOAN1', loanId: 'LOAN1',
              },
            }
      if (options.referencePredicate && !options.referencePredicate(candidate)) return { references: [] }
      return { references: [candidate] }
    },
  } as unknown as HistoryExactIndexReader
}

function db(options: { liveObjectTransactionHash?: string } = {}): D1Database {
  const liveObjectTransactionHash = options.liveObjectTransactionHash ?? 'TX1'
  return {
    prepare(sql: string) {
      const statement = {
        bind() { return statement },
        async first<T>() {
          if (!sql.includes('FROM protocol_events')) return null
          return {
            event_hash: 'TX1', epoch_id: 'epoch-live', ledger_index: 106, event_index: 1,
            close_time: 800_000_001, event_type: 'LoanPay', result_code: 'tesSUCCESS',
            payload_retained: 0, source_json: null, metadata_json: null,
            created_at: '2025-05-08T06:13:21.000Z',
          } as T
        },
        async all<T>() {
          if (sql.includes("SELECT 'transaction' AS kind")) {
            return { results: [{
              kind: 'transaction', epoch_id: 'epoch-live', ledger_index: 107,
              transaction_hash: 'TX-LIVE', object_type: null, object_id: null, loan_id: null,
            }] as T[] }
          }
          if (sql.includes('SELECT * FROM object_changes')) {
            return { results: [{
              transaction_hash: liveObjectTransactionHash, epoch_id: 'epoch-live', ledger_index: 106, transaction_index: 1,
              transaction_type: 'LoanPay', result_code: 'tesSUCCESS', close_time: 800_000_001,
              node_index: 0, object_type: 'Loan', object_id: 'LOAN1', action: 'modified',
              field_name: 'PrincipalOutstanding', before_json: '"90"', after_json: '"80"',
              value_type: 'string', unsupported_field: 0, vault_id: null, loan_broker_id: 'BROKER1',
              loan_id: 'LOAN1', account: null, owner: null, borrower: 'rBorrower', asset_key: 'XRP',
              mpt_issuance_id: null, created_at: '2025-05-08T06:13:21.000Z',
            }] as T[] }
          }
          if (sql.includes('FROM loan_lifecycle_events')) {
            return { results: [{
              loan_id: 'LOAN1', epoch_id: 'epoch-live', transaction_hash: 'TX2', ledger_index: 106,
              transaction_index: 1, close_time: 800_000_001, event_type: 'payment', transaction_type: 'LoanPay',
              result_code: 'tesSUCCESS', status_before: 'active', status_after: 'active', principal_before: '90',
              principal_after: '80', total_value_before: '90', total_value_after: '80', payment_remaining_before: 1,
              payment_remaining_after: 0, details_json: '{}', created_at: '2025-05-08T06:13:21.000Z',
            }] as T[] }
          }
          return { results: [] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('hybrid exact history repository', () => {
  it('prefers later live event and suppresses duplicate change identity across boundary', async () => {
    const result = await getHybridTransactionDetail({
      db: db(), reader: reader(), exactIndex: exactIndex(), transactionHash: 'TX1',
    })
    expect(result.event?.ledgerIndex).toBe(106)
    expect(result.changes.map((change) => change.ledgerIndex)).toEqual([106])
  })

  it('merges exact immutable and post-boundary object history newest first', async () => {
    const result = await listHybridExactObjectHistory({
      db: db({ liveObjectTransactionHash: 'TX2' }), reader: reader(), exactIndex: exactIndex(),
      objectType: 'Loan', objectId: 'LOAN1', page: { limit: 25 },
    })
    expect(result.map((change) => change.ledgerIndex)).toEqual([106, 105])
    expect(result.every((change) => change.objectType === 'Loan' && change.objectId === 'LOAN1')).toBe(true)
  })

  it('merges exact immutable and post-boundary Loan lifecycle oldest first', async () => {
    const result = await listHybridExactLoanLifecycle({
      db: db(), reader: reader(), exactIndex: exactIndex(), loanId: 'LOAN1', page: { limit: 25 },
    })
    expect(result.map((event) => event.ledgerIndex)).toEqual([105, 106])
    expect(result.every((event) => event.loanId === 'LOAN1')).toBe(true)
  })

  it('merges a filtered exact lifecycle explorer newest first', async () => {
    const result = await listHybridExactLoanLifecycleEvents({
      db: db(), reader: reader(), exactIndex: exactIndex(),
      list: { limit: 25, loanId: 'LOAN1', eventType: 'payment' },
    })
    expect(result.map((event) => event.ledgerIndex)).toEqual([106, 105])
    expect(result.every((event) => event.loanId === 'LOAN1' && event.eventType === 'payment')).toBe(true)
  })

  it('filters immutable lifecycle events before Explorer merge', async () => {
    const result = await listHybridExactLoanLifecycleEvents({
      db: db(), reader: reader(), exactIndex: exactIndex(),
      list: { limit: 25, loanId: 'LOAN1', eventType: 'created' },
    })
    expect(result).toEqual([])
  })

  it('merges live and immutable search results newest first', async () => {
    const result = await searchHybridHistory({
      db: db(), reader: reader(), exactIndex: exactIndex(), query: 'LOAN1', limit: 10,
    })
    expect(result.map((item) => item.ledgerIndex)).toEqual([107, 105])
    expect(result.map((item) => item.kind)).toEqual(['transaction', 'object_change'])
  })
})
