import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings } from '../env'
import { resolveHistorySource } from '../repositories/history-source'
import { handleHybridHistoryOverride } from './hybrid-history-override'

vi.mock('../repositories/history-source', () => ({
  resolveHistorySource: vi.fn(),
}))

const mockedResolve = vi.mocked(resolveHistorySource)
const objectId = 'A'.repeat(64)

function db(): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind() { return statement },
        async all<T>() {
          if (sql.includes('FROM archived_objects')) return { results: [] as T[] }
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
    finalStateJson: JSON.stringify({ PrincipalOutstanding: '0' }),
    vaultId: 'VAULT1',
    loanBrokerId: 'BROKER1',
    loanId: objectId,
    owner: null,
    account: null,
    borrower: 'rBorrower',
    assetKey: 'XRP',
  }
  return {
    kind: 'hybrid' as const,
    configured: true as const,
    reader: {
      publication: { epochId: 'epoch-immutable', endLedgerIndex: 105 },
      async list() {
        throw new Error('generic immutable scan must not run for exact archived detail')
      },
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
    },
    exactIndex: {
      manifest: {},
      reader: {
        async find(term: string, options: {
          direction?: 'asc' | 'desc'
          referencePredicate?: (value: unknown) => boolean
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

describe('archived object exact detail route', () => {
  it('serves the exact archive without generic immutable scanning', async () => {
    mockedResolve.mockResolvedValue(source() as never)
    const response = await handleHybridHistoryOverride(
      new Request(`https://example.test/api/audit/archived/Loan/${objectId}`),
      env(),
    )

    expect(response?.status).toBe(200)
    const body = await response?.json() as {
      data: {
        object_type: string
        object_id: string
        deletion_transaction_hash: string
        deletion_ledger_index: number
      }
    }
    expect(body.data).toMatchObject({
      object_type: 'Loan',
      object_id: objectId,
      deletion_transaction_hash: 'IMMUTABLE-TX',
      deletion_ledger_index: 105,
    })
  })
})
