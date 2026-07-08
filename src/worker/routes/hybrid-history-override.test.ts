import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings } from '../env'
import { resolveHistorySource } from '../repositories/history-source'
import { handleHybridHistoryOverride } from './hybrid-history-override'

vi.mock('../repositories/history-source', () => ({
  resolveHistorySource: vi.fn(),
}))

const mockedResolve = vi.mocked(resolveHistorySource)

interface FakeStatement {
  bind: (...values: unknown[]) => FakeStatement
  all: <T>() => Promise<{ results: T[] }>
}

function db(): D1Database {
  return {
    prepare(sql: string) {
      const statement: FakeStatement = {
        bind() { return statement },
        async all<T>() {
          if (sql.includes('FROM protocol_events')) {
            return { results: [{
              event_hash: 'LIVE-106',
              epoch_id: 'epoch-1',
              ledger_index: 106,
              event_index: 1,
              close_time: 800_000_001,
              event_type: 'LoanPay',
              result_code: 'tesSUCCESS',
              payload_retained: 0,
              created_at: '2025-05-08T06:13:21.000Z',
            }] as T[] }
          }
          if (sql.includes('SELECT * FROM object_changes')) {
            return { results: [{
              transaction_hash: 'LIVE-TX', epoch_id: 'epoch-1', ledger_index: 106, transaction_index: 1,
              transaction_type: 'LoanPay', result_code: 'tesSUCCESS', close_time: 800_000_001,
              node_index: 0, object_type: 'Loan', object_id: 'LOAN1', action: 'modified',
              field_name: 'PrincipalOutstanding', before_json: '"90"', after_json: '"80"', value_type: 'string',
              unsupported_field: 0, vault_id: null, loan_broker_id: 'BROKER1', loan_id: 'LOAN1', account: null,
              owner: null, borrower: 'rBorrower', asset_key: 'XRP', mpt_issuance_id: null,
              created_at: '2025-05-08T06:13:21.000Z',
            }] as T[] }
          }
          if (sql.includes('FROM loan_lifecycle_events')) {
            return { results: [{
              loan_id: 'LOAN1', epoch_id: 'epoch-1', transaction_hash: 'LIVE-TX', ledger_index: 106,
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

function immutableObjectChange() {
  return {
    network: 'devnet', epochId: 'epoch-1', ledgerIndex: 105, closeTime: 800_000_000,
    transactionHash: 'IMMUTABLE-TX', transactionIndex: 1, transactionType: 'LoanPay', result: 'tesSUCCESS',
    nodeIndex: 0, objectType: 'Loan', objectId: 'LOAN1', action: 'modified',
    fieldName: 'PrincipalOutstanding', beforeValue: '100', afterValue: '90',
    beforeJson: '"100"', afterJson: '"90"', valueType: 'string', unsupportedField: false,
    relationships: {
      vaultId: null, loanBrokerId: 'BROKER1', loanId: 'LOAN1', account: null,
      owner: null, borrower: 'rBorrower', assetKey: 'XRP', mptIssuanceId: null,
    },
  }
}

function immutableLifecycle() {
  return {
    loanId: 'LOAN1', epochId: 'epoch-1', transactionHash: 'IMMUTABLE-TX', ledgerIndex: 105,
    transactionIndex: 1, closeTime: 800_000_000, eventType: 'payment', transactionType: 'LoanPay',
    resultCode: 'tesSUCCESS', statusBefore: 'active', statusAfter: 'active', principalBefore: '100',
    principalAfter: '90', totalValueBefore: '100', totalValueAfter: '90', paymentRemainingBefore: 2,
    paymentRemainingAfter: 1, details: {},
  }
}

function hybridSource(options: { exact?: boolean } = {}) {
  const reader = {
    publication: {
      epochId: 'epoch-1',
      endLedgerIndex: 105,
    },
    async list() {
      return {
        items: [{
          eventHash: 'IMMUTABLE-105',
          ledgerIndex: 105,
          eventIndex: 1,
          closeTime: 800_000_000,
          eventType: 'LoanPay',
          resultCode: 'tesSUCCESS',
          account: 'rAccount',
          sequence: 1,
          fee: '10',
        }],
        nextCursor: null,
        complete: true,
        segmentReads: 1,
        compressedBytes: 100,
        decompressedBytes: 200,
        recordsExamined: 1,
      }
    },
    async readReferenced<T>(readOptions: { references: { fileKind: string }[] }) {
      const value = readOptions.references[0]?.fileKind === 'loan_lifecycle'
        ? immutableLifecycle()
        : immutableObjectChange()
      return { items: [value] as T[], assetReads: 1, compressedBytes: 100, decompressedBytes: 200, recordsExamined: 1 }
    },
  }
  const exactIndex = options.exact ? {
    manifest: {},
    reader: {
      async find(_term: string, findOptions: { referenceKinds?: readonly string[]; referencePredicate?: (reference: unknown) => boolean }) {
        const lifecycle = findOptions.referenceKinds?.includes('loan_lifecycle') ?? false
        const reference = lifecycle
          ? {
              kind: 'loan_lifecycle', segmentId: 's', fileKind: 'loan_lifecycle', ledgerIndex: 105,
              searchResult: {
                kind: 'loan_lifecycle', epochId: 'epoch-1', ledgerIndex: 105,
                transactionHash: 'IMMUTABLE-TX', objectType: 'Loan', objectId: 'LOAN1', loanId: 'LOAN1',
              },
            }
          : {
              kind: 'object_change', segmentId: 's', fileKind: 'object_changes', ledgerIndex: 105,
              searchResult: {
                kind: 'object_change', epochId: 'epoch-1', ledgerIndex: 105,
                transactionHash: 'IMMUTABLE-TX', objectType: 'Loan', objectId: 'LOAN1', loanId: 'LOAN1',
              },
            }
        if (findOptions.referencePredicate && !findOptions.referencePredicate(reference)) return { references: [] }
        return { references: [reference] }
      },
    },
  } : null
  return {
    kind: 'hybrid' as const,
    configured: true as const,
    reader,
    exactIndex,
    channel: {
      schemaVersion: 1 as const,
      active: {
        dataCommitSha: 'b'.repeat(40),
        publicationPath: 'history/publication.json',
        publicationSha256: 'a'.repeat(64),
        chainId: 'chain-1',
        epochId: 'epoch-1',
        exactIndex: null,
      },
      updatedAt: '2026-07-06T00:00:00.000Z',
    },
    publication: {
      chainId: 'chain-1',
      epochId: 'epoch-1',
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

describe('hybrid history route override', () => {
  it('passes through to existing D1 routes when history is not configured', async () => {
    mockedResolve.mockResolvedValue({
      kind: 'd1', configured: false, reader: null, exactIndex: null, channel: null, publication: null, unavailableReason: null,
    })
    await expect(handleHybridHistoryOverride(
      new Request('https://example.test/api/activity'),
      env(),
    )).resolves.toBeNull()
  })

  it('returns explicit unavailable instead of silent D1 fallback for invalid configured history', async () => {
    mockedResolve.mockResolvedValue({
      kind: 'unavailable', configured: true, reader: null, exactIndex: null, channel: null, publication: null,
      unavailableReason: 'history_source_integrity_error',
    })
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/activity'),
      env(),
    )
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({
      error: 'history_source_unavailable',
      reason: 'history_source_integrity_error',
    })
  })

  it('serves merged newest-first activity through the existing response shape', async () => {
    mockedResolve.mockResolvedValue(hybridSource() as never)
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/activity?limit=10'),
      env(),
    )
    expect(response?.status).toBe(200)
    const body = await response?.json() as { data: { transaction_hash: string }[]; page: unknown }
    expect(body.data.map((item) => item.transaction_hash)).toEqual(['LIVE-106', 'IMMUTABLE-105'])
    expect(body.page).toEqual({ limit: 10, next_cursor: null })
  })

  it('serves Object History through exact targeted immutable reads plus live continuation', async () => {
    mockedResolve.mockResolvedValue(hybridSource({ exact: true }) as never)
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/objects/Loan/LOAN1/history?limit=25'),
      env(),
    )
    expect(response?.status).toBe(200)
    const body = await response?.json() as { data: { ledger_index: number }[] }
    expect(body.data.map((item) => item.ledger_index)).toEqual([106, 105])
  })

  it('serves Loan lifecycle detail through exact targeted immutable reads plus live continuation', async () => {
    mockedResolve.mockResolvedValue(hybridSource({ exact: true }) as never)
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/loans/LOAN1/lifecycle?limit=25'),
      env(),
    )
    expect(response?.status).toBe(200)
    const body = await response?.json() as { data: { ledger_index: number }[] }
    expect(body.data.map((item) => item.ledger_index)).toEqual([105, 106])
  })

  it('fails explicitly for exact history lookup until immutable indexes exist', async () => {
    mockedResolve.mockResolvedValue(hybridSource() as never)
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/transactions/TX1'),
      env(),
    )
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({
      error: 'history_exact_lookup_unavailable',
    })
  })
})
