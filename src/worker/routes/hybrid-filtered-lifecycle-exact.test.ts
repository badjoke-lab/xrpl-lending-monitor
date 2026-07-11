import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings } from '../env'
import { resolveHistorySource } from '../repositories/history-source'
import { handleHybridHistoryOverride } from './hybrid-history-override'

vi.mock('../repositories/history-source', () => ({
  resolveHistorySource: vi.fn(),
}))

const mockedResolve = vi.mocked(resolveHistorySource)

function db(): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind() { return statement },
        async all<T>() {
          if (sql.includes('FROM loan_lifecycle_events')) {
            return { results: [{
              loan_id: 'LOAN1', epoch_id: 'epoch-live', transaction_hash: 'LIVE-TX', ledger_index: 106,
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

function env(): Bindings {
  return {
    APP_NETWORK: 'devnet',
    MAINNET_ENABLED: 'false',
    XRPL_DEVNET_RPC_URL: 'https://devnet.example/',
    DB: db(),
    ASSETS: { fetch: () => Promise.resolve(new Response('not found', { status: 404 })) } as Fetcher,
  }
}

function source() {
  const lifecycle = {
    network: 'devnet', loanId: 'LOAN1', epochId: 'epoch-immutable', transactionHash: 'IMMUTABLE-TX', ledgerIndex: 105,
    transactionIndex: 1, closeTime: 800_000_000, eventType: 'payment', transactionType: 'LoanPay',
    result: 'tesSUCCESS', statusBefore: 'active', statusAfter: 'active', principalBefore: '100',
    principalAfter: '90', totalValueBefore: '100', totalValueAfter: '90', paymentRemainingBefore: 2,
    paymentRemainingAfter: 1, detailsJson: '{}',
  }
  return {
    kind: 'hybrid' as const,
    configured: true as const,
    reader: {
      publication: { epochId: 'epoch-immutable', endLedgerIndex: 105 },
      async list() {
        throw new Error('generic immutable scan must not run for filtered exact lifecycle')
      },
      async readReferenced<T>(options: { predicate?: (value: unknown) => boolean }) {
        const items = options.predicate && !options.predicate(lifecycle) ? [] : [lifecycle]
        return { items: items as T[], assetReads: 1, compressedBytes: 100, decompressedBytes: 200, recordsExamined: 1 }
      },
    },
    exactIndex: {
      manifest: {},
      reader: {
        async find(term: string, options: { direction?: 'asc' | 'desc'; referencePredicate?: (value: unknown) => boolean }) {
          expect(term).toBe('LOAN1')
          expect(options.direction).toBe('desc')
          const reference = {
            kind: 'loan_lifecycle', segmentId: 's', fileKind: 'loan_lifecycle', ledgerIndex: 105,
            searchResult: {
              kind: 'loan_lifecycle', epochId: 'epoch-immutable', ledgerIndex: 105,
              transactionHash: 'IMMUTABLE-TX', objectType: 'Loan', objectId: 'LOAN1', loanId: 'LOAN1',
            },
          }
          return {
            references: options.referencePredicate && !options.referencePredicate(reference) ? [] : [reference],
          }
        },
      },
    },
    channel: {
      schemaVersion: 1 as const,
      active: {
        dataCommitSha: 'b'.repeat(40),
        publicationPath: 'history/publication.json',
        publicationSha256: 'a'.repeat(64),
        chainId: 'chain-1',
        epochId: 'epoch-immutable',
        exactIndex: null,
      },
      updatedAt: '2026-07-06T00:00:00.000Z',
    },
    publication: {
      chainId: 'chain-1',
      epochId: 'epoch-immutable',
      startLedgerIndex: 101,
      endLedgerIndex: 105,
      segmentCount: 1,
      ledgerCount: 5,
      publicationSha256: 'a'.repeat(64),
    },
    unavailableReason: null,
  }
}

beforeEach(() => {
  mockedResolve.mockReset()
})

describe('filtered lifecycle exact route', () => {
  it('serves loan-filtered Explorer events newest first without generic immutable scanning', async () => {
    mockedResolve.mockResolvedValue(source() as never)
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/audit/lifecycle?loan_id=LOAN1&event_type=payment&limit=25'),
      env(),
    )

    expect(response?.status).toBe(200)
    const body = await response?.json() as {
      data: { loan_id: string; ledger_index: number; event_type: string }[]
      filters: { loan_id: string; event_type: string }
    }
    expect(body.data.map((event) => event.ledger_index)).toEqual([106, 105])
    expect(body.data.every((event) => event.loan_id === 'LOAN1' && event.event_type === 'payment')).toBe(true)
    expect(body.filters).toEqual({ event_type: 'payment', loan_id: 'LOAN1' })
  })
})
